# Mac側のCodexへの引き継ぎ

この文書は2026-10-27のDFS専用`StageControl`の引き継ぎ記録です。現在のC'2・RUMY・DFS共通版は[show-control/README.md](show-control/README.md)を参照してください。共通版は2026-11-03にMacの消音コピーで41件のネイティブ検査とOSC往復を確認しましたが、本番環境への切り替えと実端末・実音声・実灯体の確認は残っています。

以下の「次の作業」「未解決点」はDFS専用版を引き継いだ時点の記録です。共通版の現在の作業順や検証結果としては扱いません。各版の用途は[TouchOSC一覧](README.md)に整理しました。

2026-10-27のWindows側引き継ぎ記録。以降のMac内接続試験は[操作画面のREADME](live-countdown/iphone-air/README.md)とmac-live-connection-verification.jsonに記録した。物理iPhoneからの通信と頭出し直後の即停止は未解決。REWの相対音量表示を追加し、本番の起動順は[本番起動リスト](../operations/startup/legacy-dfs.md)に整理した。以下の「未有効化」「未設定」は引き継ぎ時点の記録。

## 引き継ぎ時点で使用したファイル

- `live-countdown/iphone-air/day01-iphone-air-control.tosc`：今回の操作付きiPhone Air版。MacのTouchOSCで開いてある。
- `build_iphone_control.py`：上記を生成する。420×912、29ボタン。
- `iphone_control.lua`：操作とOSC送受信。
- `live_countdown.lua`：Liveから受信した位置に従う拍表示。
- `StageControl/__init__.py`：LiveのControl Surface。OSC UDP 8001で操作を受け、拍と操作状態を返す。MacのUser Libraryへ配置済みだが、Live側では未有効化。
- `stage-qlc.cjs`：QLC+のWebSocket APIを操作する補助プロセス。ローカルUDP 8002。QLC+の既定Webポートは9999。

旧`day01-iphone-air.tosc`とiPad版は受信専用モニター。`countdown-demo`は内蔵時計による仮テスト。今回の操作付き版と混同しないこと。

## 本人の要件

iPhone Airを使用。演目名だけをカウントの見出しに表示し、分・秒ではなく拍で示す。4つの大きな光、最後16拍のマス、最後4拍の赤い表示。再開・停止を常設し、メトロノームON/OFF、演目・曲の頭出し、QLC+全停止、ボーダーON/OFFも使う。「拡大」中も再開・停止の位置は変わらない。説明文はUIに加えない。

入力セットは`../project-files/Dance_Free_Style Project/小講堂1日目.als`。開始`[演目名]`、終了`[演目名] SETSTOP`の12組。大文字小文字と末尾空白を正規化して対応付ける。`set-manifest.json`に実際の曲ロケーターも記録済み。

## 確認済みと未確認

- `control-verification.json`：実際のLuaで29ボタン、24ロケーターの頭出しメッセージ、押下時のみの送信、実再生314サンプルの表示、拡大、失敗応答、タイムアウトを確認。
- `control-native-verification.json`：MacのTouchOSC本体で420×912として読み込み、30本のスクリプトのコンパイルを確認。ネイティブのタップ操作やOSC受信の確認ではない。
- `stage-qlc-native-verification.json`：外部入出力を外したMacのQLC+のコピーで、Scene 10のON/OFF、複数Functionからの全停止と全Functionの停止状態、UDP応答を確認。実機DMX出力は未確認。
- 旧受信モニターの`live-transport-verification.json`は、無音のWindows用コピーで全12組のClyphX自動停止とネイティブShift+Spaceの続行を確認した記録。**新しいStageControlの成功記録ではない。**
- 直近のMacの読み取りでは、StageControlの起動ログもUDP 8001の待受もなかった。MacのTouchOSCの保存済みOSC設定もHost空欄、送受信ポート未設定。iPhone側の設定は読めていない。

## 引き継ぎ時点の次の作業

1. MacのLiveでStageControlを有効化する。Live再起動後、環境設定のLink/Tempo/MIDIの空きControl Surface行に`StageControl`、Input/OutputはNone。既存のClyphXは維持する。Windows側から本人に選択を依頼したが、完了の返答はまだない。
2. iPhoneのOSC Connection 1を、HostはMac、Send Port 8001、Receive Port 8000、UDPにする。TouchOSC BridgeのMIDIとは別経路。起動中の画面が500msごとに`/stage/hello`を送り、Liveが受信先を知る。
3. 無音・MIDI出力なしの**別名コピー**で、新しいStageControl経由の頭出し、再開、繰り返し停止、ClyphX自動停止後の再開を確認する。本人が編集中の原本へ試験操作を送らない。
4. QLC+が必要なら、`npm ci --ignore-scripts`後に`start-stage-qlc.command`または`node stage-qlc.cjs`で補助プロセスを起動する。ボーダーのScene IDは10。

### 引き継ぎ時点の未解決点

Windowsのネイティブ試験で、停止中の`cue.jump()`は見た目の位置を移すが、直後に`continue_playing()`すると**以前の停止位置**から始まることが分かった。

現コードは、明示的な頭出しを`_prepared_cue`に保持し、その位置にいるときの最初の再開だけ`start_playing()`を使うよう変更済み。**この修正はネイティブ未検証。** 挿入マーカーと続行マーカーの違いを実際のLiveで確認してから使うこと。通常の停止からの再開は`continue_playing()`。`SETSTOP`はトグルなので、手動の停止には使わない。

`verify_stage_transport.py`は、この問題を検出した途中のWindows用検証スクリプト。MCPの9877番、無音コピー、Windowsのパスに依存し、MacにはMCPを配置していない。PASS結果はない。修正後のWindows再起動では復元ダイアログで止まり、確認を完了できなかった。Macの連携確認のためにWindows側の検証を再開する必要はない。

## 再生成・単体検証

PythonにPillowとlupaが必要。

```sh
python3 build_iphone_control.py
python3 verify_iphone_control.py
npm ci --ignore-scripts
```

画面を変更したら、MacのTouchOSCで再読み込みとコンパイルを確認する。iPhoneの実タップからLiveへの通信と音声出力は、まだ確認していない。
