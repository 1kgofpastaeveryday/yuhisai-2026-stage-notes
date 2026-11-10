#!/usr/bin/env python3
"""Register cable-connected iOS devices, export Ad Hoc, verify, and install.

ASC_KEY_PATH, ASC_KEY_ID, and ASC_ISSUER_ID use archive-upload.sh defaults.
Manual --udid entries replace automatic target selection. Disconnected manual
entries are registered and verified, but installation is skipped and logged.
Dry runs never write the portal, output directories, or onboarding logs.
"""

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shlex
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


HOTSPOT = "com.apple.developer.networking.HotspotConfiguration"
PORTAL_NAME_LIMIT = 50
FALLBACK = "Finder でこの iPhone を開き、IPA をウインドウへドラッグする"
EXPORT_OPTIONS = Path(__file__).resolve().parent / "ExportOptions-adhoc.plist"


def run(command):
    """Capture output so command failures remain visible to the operator."""
    result = subprocess.run([str(arg) for arg in command], capture_output=True)
    if result.returncode:
        detail = (result.stdout + result.stderr).decode("utf-8", errors="replace")
        raise RuntimeError(f"Command failed ({result.returncode}): "
                           f"{shlex.join(map(str, command))}\n{detail}")
    return result.stdout


def parse_devices(document):
    """Read current CoreDevice properties, or its documented legacy fields."""
    devices = []
    for item in document["result"]["devices"]:
        properties = item.get("properties", {})
        hardware = properties.get("hardware", item.get("hardwareProperties", {}))
        connection = properties.get("connection", item.get("connectionProperties", {}))
        state = properties.get("state", item.get("deviceProperties", {}))
        if hardware.get("reality") != "physical" or hardware.get("platform") != "iOS":
            continue
        udid = hardware.get("udid")
        if not udid:
            continue
        devices.append({
            "udid": udid,
            "name": state.get("name") or udid,
            # A cabled phone reports tunnelState "disconnected" until devicectl opens a
            # tunnel for an operation (418P, 2026-10-29), so the transport alone decides.
            "connected": connection.get("transportType") == "wired",
        })
    return devices


def discover_devices():
    with tempfile.TemporaryDirectory(prefix="dimmer-devices-") as directory:
        output = Path(directory) / "devices.json"
        run(["xcrun", "devicectl", "list", "devices", "--timeout", "30",
             "--json-output", output])
        return parse_devices(json.loads(output.read_text()))


def manual_device(value):
    udid, separator, name = value.partition(",")
    udid = udid.strip()
    if not re.fullmatch(r"(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{8}-[0-9a-fA-F]{16})", udid):
        raise argparse.ArgumentTypeError(f"Invalid physical iOS UDID: {udid}")
    return udid, name.strip() if separator else ""


def select_targets(devices, manual):
    known = {device["udid"].upper(): device for device in devices}
    if not manual:
        return [device.copy() for device in devices if device["connected"]]
    targets = {}
    for udid, name in manual:
        device = known.get(udid.upper(), {"name": udid, "connected": False})
        targets[udid.upper()] = {"udid": udid, "name": name or device["name"],
                                 "connected": device["connected"]}
    return list(targets.values())


class Portal:
    def __init__(self):
        self.key_path = Path(os.environ.get(
            "ASC_KEY_PATH", "~/.private_keys/AuthKey_<REDACTED>.p8")).expanduser().resolve()
        self.key_id = os.environ.get("ASC_KEY_ID", "<REDACTED>")
        self.issuer_id = os.environ.get(
            "ASC_ISSUER_ID", "<REDACTED>")

    def request(self, method, path, body=None):
        import jwt

        now = int(time.time())
        token = jwt.encode({"iss": self.issuer_id, "iat": now, "exp": now + 1200,
                            "aud": "appstoreconnect-v1"}, self.key_path.read_bytes(),
                           algorithm="ES256", headers={"kid": self.key_id})
        request = urllib.request.Request(
            "https://api.appstoreconnect.apple.com" + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Portal {method} failed: HTTP {error.code}\n{detail}") from error
        except urllib.error.URLError as error:
            raise RuntimeError(f"Portal {method} failed: {error.reason}") from error

    def find(self, udid):
        query = urllib.parse.urlencode({"filter[udid]": udid, "filter[platform]": "IOS"})
        data = self.request("GET", "/v1/devices?" + query)["data"]
        return data[0] if data else None

    def register(self, udid, name):
        return self.request("POST", "/v1/devices", {"data": {
            "type": "devices", "attributes": {"name": name, "udid": udid, "platform": "IOS"}
        }})["data"]

    def export_command(self, archive, output):
        return ["xcodebuild", "-exportArchive", "-archivePath", str(archive),
                "-exportPath", str(output), "-exportOptionsPlist", str(EXPORT_OPTIONS),
                "-allowProvisioningUpdates", "-authenticationKeyPath", str(self.key_path),
                "-authenticationKeyID", self.key_id, "-authenticationKeyIssuerID", self.issuer_id]


def verify_profile(profile, udids):
    provisioned = {value.upper() for value in profile.get("ProvisionedDevices", [])}
    missing = [udid for udid in udids if udid.upper() not in provisioned]
    if missing:
        raise RuntimeError("ProvisionedDevices に対象UDIDがありません: " + ", ".join(missing))
    expiration = profile.get("ExpirationDate")
    if not isinstance(expiration, dt.datetime):
        raise RuntimeError("プロファイルのExpirationDateがありません。")
    if expiration.tzinfo is None:
        expiration = expiration.replace(tzinfo=dt.timezone.utc)
    print(f"Profile ExpirationDate: {expiration.isoformat()}")
    if expiration <= dt.datetime.now(dt.timezone.utc):
        raise RuntimeError("プロファイルの有効期限が切れています。")


def verify_entitlements(entitlements):
    if entitlements.get(HOTSPOT) is not True:
        raise RuntimeError(f"アプリに必要なentitlementがありません: {HOTSPOT}")


def verify_ipa(ipa, udids):
    with tempfile.TemporaryDirectory(prefix="dimmer-ipa-") as directory:
        root = Path(directory)
        run(["/usr/bin/ditto", "-x", "-k", ipa, root])
        apps = list((root / "Payload").glob("*.app"))
        if len(apps) != 1:
            raise RuntimeError("IPAのPayloadにアプリが1つだけ含まれている必要があります。")
        profile = plistlib.loads(run(["security", "cms", "-D", "-i",
                                     apps[0] / "embedded.mobileprovision"]))
        verify_profile(profile, udids)
        entitlements = plistlib.loads(run(["codesign", "-d", "--entitlements", ":-", apps[0]]))
        verify_entitlements(entitlements)
    print("IPA検証OK: 全対象UDIDとHotspotConfigurationを確認しました。")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def install_command(udid, ipa):
    return ["xcrun", "devicectl", "device", "install", "app", "--device", udid, str(ipa)]


def execute(args, targets):
    portal = Portal()
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    output = args.out or (args.ipa.parent if args.ipa else args.archive.parent / f"adhoc-{stamp}")
    records = [{"portal_name": (args.name + device["name"])[:PORTAL_NAME_LIMIT],
                "udid": device["udid"], "registration": "not_checked",
                "ipa_path": str(args.ipa) if args.ipa else None, "ipa_sha256": None,
                "install_result": "not_attempted"} for device in targets]
    ipa = args.ipa
    failed = False
    if not args.dry_run:
        # A fresh export directory prevents accidentally selecting a stale IPA.
        output.mkdir(parents=True, exist_ok=bool(args.ipa))
    try:
        for record in records:
            existing = portal.find(record["udid"])
            if existing:
                attributes = existing["attributes"]
                record["registration"] = "already_present"
                record["portal_name"] = attributes["name"]
                print(f"登録済み: {record['udid']} ({record['portal_name']})")
                if attributes.get("status") == "DISABLED":
                    raise RuntimeError(f"ポータルで端末が無効です: {record['udid']}")
            elif args.dry_run:
                record["registration"] = "would_register"
                print(f"[dry-run] 登録予定: {record['udid']} ({record['portal_name']})")
            else:
                portal.register(record["udid"], record["portal_name"])
                record["registration"] = "newly_registered"
                print(f"登録完了: {record['udid']} ({record['portal_name']})")

        if not ipa:
            command = portal.export_command(args.archive, output)
            if args.dry_run:
                print("[dry-run] Export: " + shlex.join(command))
            else:
                print("Ad Hoc IPAを書き出しています。", flush=True)
                result = run(command)
                print(result.decode("utf-8", errors="replace"))
                candidates = list(output.glob("*.ipa"))
                if len(candidates) != 1:
                    raise RuntimeError("書き出し先にIPAが1つだけ存在する必要があります。")
                ipa = candidates[0].resolve()

        if ipa:
            digest = sha256(ipa)
            for record in records:
                record.update(ipa_path=str(ipa), ipa_sha256=digest)
            verify_ipa(ipa, [device["udid"] for device in targets])
        else:
            print("[dry-run] 書き出したIPAの全対象UDID、HotspotConfiguration、ExpirationDateを検証します。")

        for device, record in zip(targets, records):
            if args.no_install:
                record["install_result"] = "skipped_no_install"
                print(f"インストール省略 (--no-install): {device['udid']}")
            elif not device["connected"]:
                record["install_result"] = "skipped_not_connected"
                print(f"有線未接続のためインストール省略: {device['udid']}")
            elif args.dry_run:
                print("[dry-run] Install: " + shlex.join(
                    install_command(device["udid"], ipa or str(output / "<exported>.ipa"))))
            else:
                try:
                    print(run(install_command(device["udid"], ipa)).decode("utf-8", errors="replace"))
                    record["install_result"] = "installed"
                except (OSError, RuntimeError) as error:
                    record["install_result"] = "failed"
                    record["install_error"] = str(error)
                    print(f"{device['udid']}: {error}\n{FALLBACK}", file=sys.stderr)
                    failed = True
        if args.dry_run:
            print(f"[dry-run] ログ予定: {output / 'onboard-log.log'} (端末ごとに1行、IPAパス・SHA-256・結果)")
    except Exception as error:
        for record in records:
            record["error"] = str(error)
        raise
    finally:
        if not args.dry_run:
            with (output / "onboard-log.log").open("a", encoding="utf-8") as log:
                for record in records:
                    record["time"] = dt.datetime.now(dt.timezone.utc).isoformat()
                    log.write(json.dumps(record, ensure_ascii=False) + "\n")
            print(f"Log: {output / 'onboard-log.log'}")
    return 1 if failed else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--archive", type=Path, help="Signed .xcarchive to export")
    source.add_argument("--ipa", type=Path, help="Existing IPA; skip export, still verify")
    parser.add_argument("--out", type=Path, help="New export directory (with --ipa: log directory)")
    parser.add_argument("--udid", type=manual_device, action="append", default=[], metavar="UDID[,NAME]",
                        help="Manual targets instead of automatic wired discovery; repeatable")
    parser.add_argument("--name", default="照明リモート ", metavar="PREFIX", help="Portal name prefix (default: 照明リモート )")
    parser.add_argument("--no-install", action="store_true", help="Register and verify without installing")
    parser.add_argument("--dry-run", action="store_true", help="Read-only plan; GET portal, verify existing IPA, no writes")
    args = parser.parse_args(argv)
    try:
        targets = select_targets(discover_devices(), args.udid)
        if not targets:
            print("有線で接続中の物理iOS端末はありません。No connected devices; nothing to do.")
            return 0
        for name in ("archive", "ipa", "out"):
            path = getattr(args, name)
            if path is not None:
                setattr(args, name, path.expanduser().resolve())
        if args.archive and not args.archive.is_dir():
            raise RuntimeError(f"Archive not found: {args.archive}")
        if args.ipa and not args.ipa.is_file():
            raise RuntimeError(f"IPA not found: {args.ipa}")
        if args.archive and not EXPORT_OPTIONS.is_file():
            raise RuntimeError(f"Export options not found: {EXPORT_OPTIONS}")
        if args.archive and args.out and args.out.exists():
            raise RuntimeError(f"Export directory already exists; choose a new --out: {args.out}")
        return execute(args, targets)
    except (OSError, ValueError, KeyError, RuntimeError, ImportError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
