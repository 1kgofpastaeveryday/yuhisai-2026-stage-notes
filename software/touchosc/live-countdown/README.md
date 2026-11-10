# 小講堂1日目・拍表示の受信テスト

これは2026-10-27のDFS用受信モニターの検証記録です。C'2・RUMY・DFSの操作と今後の統合版は[共通操作画面](../show-control/README.md)を参照してください。各版の用途は[TouchOSC一覧](../README.md)にあります。以下の演目位置・検証用コピー・接続状況は作成当時の記録で、現行セットの値とは区別します。2026-11-03の整理で旧検証用ALSと過去のバックアップは削除しました。

2026-10-27作成。[day01-live-countdown.tosc](day01-live-countdown.tosc)をTouchOSCで開く。iPad縦向き744×1133。画面の文字は現在の演目名だけで、拍の進行と停止を大きな光・帯・色で示す。

スマートフォンには[iPhone Air用の操作パネル](iphone-air/README.md)もある。操作パネルはStageControlと直接OSCで接続する。このページの受信モニターとは接続方法が異なる。



## 演目と停止点

元セットは`project-files/Dance_Free_Style Project/小講堂1日目.als`。`[演目名]`と`[演目名] SETSTOP`を対応付ける。大文字・小文字と前後の空白を正規化し、表示名には開始ロケーターの表記を使う。セット内の位置は4分音符単位。

| 演目 | 開始 | 終了 |
|---|---:|---:|
| OP | 0 | 538 |
| 1ja | 542 | 919 |
| MoNaChi | 962 | 1466 |
| 1new | 1470 | 1794 |
| CLAPUNITY | 1802 | 2273 |
| 2JA | 2281 | 2709 |
| 2NEW | 3041 | 3417 |
| haruka | 3425 | 3813 |
| POP | 3821 | 4429 |
| 3ja | 4437 | 5161 |
| 3NEW | 5173 | 5801 |
| LOCK | 5809 | 6437 |

読み取り結果は[set-manifest.json](set-manifest.json)。帯は各演目の開始から終了までを基準に短くなる。最後16拍はマスが減り、最後4拍は大きな光が1つずつ消える。Liveが終了点以降で停止したことを受信すると、演目名と赤い光を保つ。通信が途絶えると光と演目名が灰色になり、拍の動きが止まる。

このファイルは受信用のモニター。LiveとQLC+の操作用ボタンを含む[既存の操作画面](../prototype/README.md)は別ファイルで保管している。

## 接続

WindowsのLiveに導入済みのAbletonMCPから再生位置・再生状態・テンポ・拍子を読み、OSCでTouchOSCへ返す。送信側はPython標準ライブラリのみで動く。

1. WindowsのLiveで対象セットを開く。Control SurfaceのAbletonMCPが有効であることを確認する。
2. iPadのTouchOSCでこのファイルを開く。ConnectionsのOSCでConnection 1を有効にし、TypeをUDP、Receive Portを`8000`にする。
3. PCとiPadを同じネットワークまたはTailscaleにつなぐ。Windowsのリポジトリ直下から次を実行する。`IPAD_IP`をiPadの実際のアドレスに置き換える。受信ポートを変更した場合は同じ番号を指定する。

```powershell
python -X utf8 yuhisai-2026/touchosc/live_set_countdown.py stream --host IPAD_IP --port 8000
```

TouchOSCを操作画面へ切り替え、Liveを再生する。送信側を止めるにはPowerShellでCtrl+Cを押す。この受信テスト版にはTouchOSCからLiveへ命令を返す処理はない。

起動時にLive上のロケーターと指定セットを照合する。セトリやロケーターを編集した場合は保存し、送信側を起動し直す。

## 実行と確認

元セットのハッシュを保存し、同じProject内へ検証用コピーを作った。コピーでは84クリップを無効にし、21トラックをミュート、MIDI出力をNoneにして実再生した。コピーの場所と設定は[test-copy.json](test-copy.json)に記録。元セットは変更していない。

[live-transport-verification.json](live-transport-verification.json)には、Windows版Live 11.3.43で全12演目の終了点を手前から通過し、自動停止した結果を保存した。停止位置は終了点より0.083〜0.284拍後だった。停止後の位置保持も確認した。

再開には実機のShift+Spaceを使った。Live APIの通常開始は挿入マーカーから始まり、停止中の`current_song_time`の代入はContinue用の再開位置を設定しないため、試験では実際に再生して停止した位置から続行した。最初のAPIのみの試行はこの違いで失敗し、成功結果には含めていない。

[live-trace.json](live-trace.json)は314サンプルの実際の再生位置。[verification.json](verification.json)にはOSCのバイナリー化・読み取り、12演目への対応、最後4拍、停止後の保持、通信停止、古いパケットの除外、Unicode名を検証した結果を保存した。表示のLuaにも実際の再生位置を渡し、全サンプルの演目名と残りのマスが対応することを確認した。

MacのTouchOSC本体で、この最終ファイルの読み込み・Luaコンパイル・演目名だけのラベル構成を確認した。[native-verification.json](native-verification.json)に結果を保存。操作モードでの受信は未確認。

TouchOSC本体でのOSC受信、iPadの表示・視認性、会場の通信は未確認。Macの接続設定は試験前へ戻してある。iPadの受信ポートの回答を待っている。

## 再生成と検証

```powershell
python -X utf8 yuhisai-2026/touchosc/build_live_countdown.py
python -X utf8 yuhisai-2026/touchosc/verify_live_countdown.py
```

生成にはPillow、表示の検証にはLupaが必要。実機の検証には、選択済みのLiveウィンドウを使って[verify_live_transport_native.mjs](../verify_live_transport_native.mjs)をcomputer-useのNode REPLから実行した。受信用Luaは[live_countdown.lua](../live_countdown.lua)、再生位置の読み取りとOSC送信は[live_set_countdown.py](../live_set_countdown.py)。
