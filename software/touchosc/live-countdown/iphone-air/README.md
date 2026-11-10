# iPhone Air 操作パネル

[day01-iphone-air-control.tosc](day01-iphone-air-control.tosc)をiPhoneのTouchOSCで開く。縦画面420×912、音量基準ボタンを含む30ボタン。以前の`day01-iphone-air.tosc`は受信専用モニター。

2026-10-27、MacのLive 11.3.43とTouchOSC本体のOSC接続を確認した。演目名・拍位置・停止状態を受信し、OPの頭出しと再生、停止位置からの続行、3jaの自動停止後の続行が動いた。ただし、3jaの曲ロケーター「4」への頭出し後、最初の再開が5105.22拍で止まる現象が1回あり、原因は未特定。再開をもう一度押すと続行した。iPhone実機からの通信は未確認。[今回の検証記録](mac-live-connection-verification.json)を参照。

下部に「続きから再開」「再生停止」を常設し、メトロノーム、QLC+全停止、ボーダーON/OFFを同じ画面に配置した。「演目」から12演目を開き、演目の頭や実際の曲ロケーターへ移動できる。選択画面を開くだけでは頭出ししない。

上部の拍表示は、Liveから受け取った位置に従う。残り16拍で黄色、4拍で赤色。文字は演目名。「拡大」で拍の面積を広げても、再開・停止は同じ位置に残る。



## 配置とHIG

Appleの[HIG・レイアウト](https://developer.apple.com/design/human-interface-guidelines/layout)、[アクセシビリティ](https://developer.apple.com/design/human-interface-guidelines/accessibility)、[モーション](https://developer.apple.com/design/human-interface-guidelines/motion)を参照した。

演目名を上部の一定位置に置く。光と帯の端を揃え、上部と下部には余白を取った。色に加えて、光る位置・残るマスの数・帯の長さでも拍の進行を示す。操作対象は44以上の大きさを確保した。

文書420×912は、[AppleのiPhone Air技術仕様](https://support.apple.com/en-euro/125092)にある物理解像度1260×2736と同じ縦横比。ここで使う余白と文字サイズはレイアウト側の設定であり、実機のセーフエリアを取得する処理ではない。Dynamic Island・ホームインジケータとの重なり、TouchOSCの表示設定は実機で確認する。

HIGの大きな文字の基準に合わせ、演目名のコントラストを3:1以上として検証した。実機の表示設定での確認は残っている。

## 接続

Macには`StageControl`を配置済み。再インストールする場合は、`touchosc/StageControl`フォルダを`~/Music/Ableton/User Library/Remote Scripts/`へコピーする。

1. Liveを再起動し、環境設定のLink/Tempo/MIDIで、Control Surfaceの空き行に`StageControl`を選ぶ。InputとOutputは両方`None`。自動停止用の`ClyphX`は既存の行を使う。
2. iPhoneのTouchOSCで`day01-iphone-air-control.tosc`を開く。
3. Connections → OSCでConnection 1を有効にし、UDPでHostをMacのTailscale IP `<HOST>`、Send Portを`8001`、Receive Portを`8000`にする。
4. コントロールモードに入る。接続後は「Live未接続」が消える。受信先のiPhoneのIPは自動で通知される。

同じWi-Fi、または双方で通信できるTailscale接続を使う。TouchOSC BridgeのMIDI接続とは別のOSC接続。この操作パネルでは旧`live_set_countdown.py stream`は不要。

## 操作

- 再開は停止位置から続行する。頭出しを選んだ直後の最初の再開だけは、選択位置から開始する。
- 再生停止は停止中に押しても再生せず、停止位置を保つ。
- 頭出しは再生を止めて位置を準備する。その後「続きから再開」で開始する。
- メトロノームON/OFFの強調は、Liveから受信した実際の状態。
- 通信が750ms以上途切れると拍表示を暗くし、ローカルで拍を進めない。
- ロケーターや曲名を変更した後は、`build_iphone_control.py`で画面を再生成する。

## QLC+

Macの`touchosc`フォルダで`npm ci --ignore-scripts`を実行し、`start-stage-qlc.command`を起動する。QLC+はWebサーバーをポート`9999`で起動する。別ポートなら`node stage-qlc.cjs ws://127.0.0.1:ポート/qlcplusWS`で指定する。

QLC+全停止は、現在のQLC+にあるすべてのFunctionへ停止を送り、状態を確認する。ボーダーは既存ショーのScene ID `10`を開始・停止する。別のショーではIDを確認する。未接続や応答失敗時は「QLC+未接続」を表示する。接続復帰時に古いON操作を再送しない。

## REWの相対音量

通常表示の拍の下に「現在」「1分平均」「基準」を追加した。耳でよいと思う音量に合わせて「基準」を押すと、その時のREWのA/Slowの値を0 dBにする。「現在」とREWのLAeq,1minを同じ基準からの差で表示する。絶対音圧の校正やdB SPLの表示は行わない。最初の1分未満は平均の経過秒数を表示する。拡大表示や演目選択中は音量欄を隠す。

REWの設定、中継の起動、OSC接続と基準の取り直しは[相対音量表示の手順](../../../audio/level-monitor/README.md)へ移した。既存の[relative-level-verification.json](../../../audio/level-monitor/validation/relative-level-verification.json)はLuaと中継の検証結果で、実マイクと会場試験の記録ではない。

## 確認状況

[control-verification.json](control-verification.json)には、実際のLuaで29ボタン、24か所の頭出し、押下時のみのOSC送信、実再生314サンプル、拡大、状態受信、失敗・タイムアウトを確認した結果を保存。

[control-native-verification.json](control-native-verification.json)は、MacのTouchOSC本体で420×912と30本のスクリプトのコンパイルを確認した結果。[stage-qlc-native-verification.json](stage-qlc-native-verification.json)は、外部入出力を外したMacのQLC+でボーダーON/OFF、全Functionの停止、UDP応答を確認した結果。StageControl経由のMac本体でのOSC往復と基本操作は今回確認したが、頭出し直後の再開には上記の未解決点がある。

iPhoneからMacへの実通信、実機上の余白、実際の音声・照明出力は別途確認が必要。

## 再生成

```powershell
python -X utf8 yuhisai-2026/touchosc/build_iphone_control.py
python -X utf8 yuhisai-2026/touchosc/verify_iphone_control.py
```

2026-10-27追記：iPhoneのConnection 1のHostを`<HOST>`からMacのTailscale IP `<HOST>`へ変更すると接続が直ったと本人確認。Mac版TouchOSCの操作モードは停止済み。iPhoneのREW用Connection 2と基準ボタンは未確認。
