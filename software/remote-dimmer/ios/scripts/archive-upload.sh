#!/usr/bin/env bash
# Archive DimmerRemote signed, then re-sign for distribution and upload to App Store Connect
# with the team's ASC API key. Unlike reflect-hud-ios, the archive must be signed: an
# unsigned archive embeds no entitlements, and export does not add them, so the Hotspot
# Configuration entitlement (venue Wi-Fi button) would be missing. EXPORT_OPTIONS selects
# App Store upload (default) or scripts/ExportOptions-adhoc.plist for Ad Hoc.
# Usage: bash scripts/archive-upload.sh   (bump CURRENT_PROJECT_VERSION in project.yml first)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SCHEME="DimmerRemote"
PROJECT="DimmerRemote.xcodeproj"
PROJECT_YML="project.yml"
TEAM_ID="<REDACTED>"

ASC_KEY_PATH="${ASC_KEY_PATH:-$HOME/.private_keys/AuthKey_<REDACTED>.p8}"
ASC_KEY_ID="${ASC_KEY_ID:-<REDACTED>}"
ASC_ISSUER_ID="${ASC_ISSUER_ID:-<REDACTED>}"

BUILD_NUMBER="$(awk '/CURRENT_PROJECT_VERSION:/ { print $2; exit }' "$PROJECT_YML")"
MARKETING_VERSION="$(awk '/MARKETING_VERSION:/ { print $2; exit }' "$PROJECT_YML")"
BUILD_DIR="${BUILD_DIR:-$ROOT/build/testflight/build-$BUILD_NUMBER-$(date -u +%Y%m%dT%H%M%SZ)}"
ARCHIVE_PATH="$BUILD_DIR/DimmerRemote.xcarchive"
EXPORT_PATH="$BUILD_DIR/export"

EXPORT_OPTIONS="${EXPORT_OPTIONS:-$ROOT/scripts/ExportOptions.plist}"
for required_file in "$ASC_KEY_PATH" "$EXPORT_OPTIONS" "$ROOT/Config/Venue.xcconfig"; do
  [[ -f "$required_file" ]] || { echo "Missing required upload file: $required_file" >&2; exit 1; }
done

/opt/homebrew/bin/xcodegen generate --spec "$PROJECT_YML"
mkdir -p "$BUILD_DIR"

echo "Archiving DimmerRemote $MARKETING_VERSION ($BUILD_NUMBER)..."
xcodebuild archive \
  -scheme "$SCHEME" -project "$PROJECT" \
  -destination 'generic/platform=iOS' -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  DEVELOPMENT_TEAM="$TEAM_ID"

INFO="$ARCHIVE_PATH/Products/Applications/DimmerRemote.app/Info.plist"
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$INFO")" == "$BUILD_NUMBER" ]] || { echo "Archive build mismatch" >&2; exit 1; }
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO")" == "$MARKETING_VERSION" ]] || { echo "Archive version mismatch" >&2; exit 1; }

if [[ "${ARCHIVE_ONLY:-}" == "1" ]]; then
  echo "Archive only: $ARCHIVE_PATH"
  exit 0
fi

echo "Cloud-signing and uploading build $BUILD_NUMBER..."
EXPORT_LOG="$BUILD_DIR/export.log"
set +e
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID" 2>&1 | tee "$EXPORT_LOG"
STATUS="${PIPESTATUS[0]}"
set -e
if [[ "$STATUS" -ne 0 ]] || grep -Eq '\*\* EXPORT FAILED \*\*|error: exportArchive' "$EXPORT_LOG"; then
  echo "Upload of build $BUILD_NUMBER failed." >&2
  exit 1
fi
# Without the Hotspot entitlement the venue Wi-Fi button cannot work; fail loudly.
APP="$(find "$EXPORT_PATH" -maxdepth 1 -name "*.ipa" | head -1)"
if [[ -n "$APP" ]]; then
  CHECK="$(mktemp -d)"; unzip -q "$APP" -d "$CHECK"
  codesign -d --entitlements :- "$CHECK/Payload/DimmerRemote.app" 2>/dev/null | grep -q HotspotConfiguration \
    || { echo "Exported app lacks the Hotspot Configuration entitlement." >&2; exit 1; }
  echo "Exported: $APP"
fi
echo "Build $BUILD_NUMBER done."
