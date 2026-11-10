# 雄飛祭2026 小講堂ステージのツール

今年の小講堂ステージ向けに作成した操作画面、照明リモート、同期デバイス、QLC+のパッチとビルド用スクリプトです。各フォルダーのREADMEには、当時の構成と確認範囲を残しています。

公開用コピーでは、接続先や個人の設定をプレースホルダーに置換しています。画像、バイナリ、機械固有の検証記録、一緒に配布できるライセンスがない第三者コードは含めていません。TouchOSC の画面ファイル（.tosc）と Max for Live のデバイス本体（.amxd）は含めています。

独自部分のライセンスは[MIT](LICENSE)です。第三者部分には、その部分のライセンスが適用されます。QLC+関連のApache-2.0、qhttpserver、http-parser、管理画面のvendor資材のライセンスは各フォルダーに残しています。

## TouchOSCとStageShowControl

[TouchOSC](touchosc/README.md)の画面とAbleton LiveのControl Surfaceスクリプトで、演目選択、頭出し、停止・再開、SETSTOPまでの表示を扱います。TouchOSC、Live、SETSTOPに使うClyphX、Python、QLC+連携用のNode.jsが必要です。元資料に記録されたMacでの検証環境はLive 11.3.43です。

今回のショー向けにそのまま公開しています。汎用化はしていません。

## 照明リモート

[ブラウザー版](remote-dimmer/web/README.md)と[iPhone用サーバー](remote-dimmer/backend/README.md)で、担当するディマーの明るさとオン・オフを操作します。Web画面、Go製バックエンド、Swift製iOSアプリを含みます。記録上の環境はQLC+ 5.3.0、Go 1.26.1、iOS 17.0以上、Swift 6.0、XcodeGen 2.44.0以上です。インターネット経由の構成はCloudflare Tunnelを使います。

今回のショー向けにそのまま公開しています。汎用化はしていません。

## QLC Live Auto Sync

[QLC Live Auto Sync](tools/qlc-live-auto-sync/README.md)は、保存済みQLC+のVirtual ConsoleをLiveのノート名とルーティングへ反映し、照明の色・フェード・明るさの上書きを扱います。対応する修正版QLC+ 5.3.0とMax for Liveが必要です。元資料ではLive 11.3.43に同梱されたNode 16.6.0を回帰試験に使っています。隣接するJavaScriptとnpm依存関係も必要です。

今回のショー向けにそのまま公開しています。汎用化はしていません。

## QLC+ Master Patched

[QLC+ Master Patched](tools/qlc-master-patched/README.txt)は、QLC+のmasterに、このショー向けのAuto Sync、Functionツリー、ボタン名、自動保存の変更を合わせた候補版のビルド用資材です。記録上のバージョン表記は5.3.1 GITで、Qt 6.10.2とMinGW 13.1のSDK、記録された依存関係を使います。

今回のショー向けにそのまま公開しています。汎用化はしていません。

## Sceneの色・フェード・明るさの上書き

[qlc-scene-color](tools/qlc-scene-color/README.md)は、LiveからQLC+のSceneとRGB Matrixの色・フェード・明るさを実行中に上書きするためのパッチです。ベースはQLC+ 5.3.0で、Qt 6.10.2とMinGW 13.1のSDKを使います。対応するAuto Syncと修正済みの実行ファイル・エンジンを組み合わせる構成です。

今回のショー向けにそのまま公開しています。汎用化はしていません。

## Function名とVCボタン名の同期

[qlc-v5-name-sync](tools/qlc-v5-name-sync/README.md)は、Functionの割り当て・読み込み・改名に合わせて、対応するVCボタンの表示名を更新するパッチです。QLC+ 5.3.0、Windows x64、Python、CMake/Ninja、Qt 6.10.2、MinGW 13.1と、対応する既存エンジンを使います。

今回のショー向けにそのまま公開しています。汎用化はしていません。

## Mac版QLC+の安定性対策

[qlc5-mac-stability](tools/qlc5-mac-stability/README.md)は、Scene画面の寿命管理、同名Function、自動保存などを扱うMac版のビルド・検証用資材です。QLC+ 5.3.0の公式Macアプリ、Qt 6.10.3のSDK、CMake、arm64環境を前提としています。元の構成で使うQt由来のパッチと回帰試験用QMLは、対象ファイル内に対応するQtライセンスがないため、このコピーから除外しています。

今回のショー向けにそのまま公開しています。汎用化はしていません。
