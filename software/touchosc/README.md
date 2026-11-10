# TouchOSCとLiveの操作

2026-11-03更新。C'2・RUMY・DFSの共通操作は[show-control/README.md](show-control/README.md)から確認する。Macの消音コピーでは20停止点を含む41件のネイティブ検査とTouchOSCとのOSC往復を確認した。本番環境への切り替え、iPhone・実音声・実灯体の確認は残っている。

## 現行の共通版と本番前の統合

| 用途 | 資料 |
|---|---|
| 共通操作画面、接続、検証状況 | [show-control/README.md](show-control/README.md) |
| Macで確認した結果と未検証の範囲 | [ネイティブ検証結果](show-control/validation/results/final.md) |
| 団体別の制作元 | [プロジェクト一覧](../project-files/README.md) |
| 本番用統合版の配置方針 | [project-files/integrated/README.md](../project-files/integrated/README.md) |
| 周辺機器を含む起動順 | [SHOW_STARTUP.md](../operations/startup/README.md) |

本番前に、LiveとQLC+をそれぞれ1つ開いて運用できる統合版を別に作る。団体別の制作元は残す。統合とDFSの日別ビューは未実装であり、現在の共通操作画面は団体別セットを選んで使う構成である。

REWの音量中継と手順は[音響の相対音量表示](../audio/level-monitor/README.md)へ移した。

## DFS専用版と過去の検証

| フォルダ・資料 | 用途と時点 |
|---|---|
| [live-countdown/iphone-air/](live-countdown/iphone-air/README.md) | DFS専用のiPhone Air操作パネル。旧`StageControl`とREW相対音量表示の記録 |
| [live-countdown/](live-countdown/README.md) | 2026-10-27のiPad用受信モニター。TouchOSCからLiveへの操作は含まない |
| [countdown-demo/](countdown-demo/README.md) | 内蔵時計と仮データによる拍表示の試験 |
| [prototype/](prototype/README.md) | 初期のMIDI操作画面案と模擬検証 |
| [HANDOFF.md](HANDOFF.md) | 2026-10-27のWindowsからMacへの引き継ぎ記録 |

旧`StageControl`と共通版の`StageShowControl`はUDP 8001を使うため、同時に有効化しない。DFS専用版の接続手順・検証結果を共通版へそのまま適用せず、共通版のREADMEを基準にする。
