# TouchOSC マニピュレーター画面のプロトタイプ

2026-10-25作成。iPad縦向き、744×1133。演目01〜12と各演目4曲の仮データを入れた。実際の演目が3曲なら、設定データから4曲目を除いて作り直せる。




## 画面の操作

1. 最初の画面で演目を押す。その演目の曲の一覧が開く。この操作ではMIDIを送らない。
2. 曲を押すと、その曲のボタンに青い枠と背景色が付く。選択は全演目で最大1曲。一覧では、その曲を含む演目も同じ色で示す。選択中の曲をもう一度押すと、曲と演目の強調が消える。この解除操作では頭出しMIDIを送らない。本番用に接続した後は、新たに曲を選ぶ操作で対応する曲頭のロケーターへ移動する想定。
3. 下部の「Live 続きから再開」は、その時点のLiveの位置から続行する。本番用の命令はClyphXの`SETCONT`。その下の「Live 再生停止」はLive標準のStopへ割り当てる。
4. 左上の戻るアイコンで一覧へ戻る。タップできる範囲は48×48。上下の操作は、どちらの画面でも同じ場所にある。
5. 上部の「QLC+ 全停止」はQLC+の`StopAll`へ送る。右隣の「ボーダー」のON／OFFは、ボーダー用Sceneだけを開始・停止する設定案。
6. 再開ボタンの上の「メトロノーム」のON／OFFで、Liveのメトロノームを明示的に切り替える設定案。

曲のボタンの強調は、この画面で選んだ曲を示す。演目を開く・一覧へ戻る操作では選択を変えず、別の曲を押すと強調が移る。同じ曲を再タップして解除しても、Liveの位置や再生状態は変えない。初期状態ではどの曲も強調しない。プレビュー画像は演目01の曲02を選んだ例。

強調はLiveの現在位置や再生中の曲を受信した表示ではない。再開・停止・メトロノーム・ボーダー操作でも選択を保持する。再生状態・メトロノームの状態・点灯状態を示す表示は付けていない。画面内の操作手順と押下後の説明文を削り、変更前後を[文言の確認表](ui-copy-review.md)に記録した。

## MIDIの設定例

このファイルは55個すべてのMIDIメッセージを無効にしてある。画面上には「試作　送信OFF」と表示する。実際に使う前に、PJのロケーター、MIDIの接続先、ClyphXとQLC+の入力を設定し、メッセージを有効にした運用版を別名で作る。

| 操作 | 接続 | MIDI | 受け側 |
|---|---|---|---|
| 48曲の頭出し | MIDI Connection 1 | Ch16・Note0〜47 | 各曲頭のLiveロケーターへMIDIマップ |
| 続きから再開 | MIDI Connection 1 | Ch16・CC119、押したとき127 | ClyphXの`RESUME = CC, 16, 119, SETCONT` |
| Live 再生停止 | MIDI Connection 1 | Ch16・CC118、押したとき127 | Live標準のStopへMIDIマップ |
| メトロノーム ON | MIDI Connection 1 | Ch16・CC117、押したとき127 | ClyphXの`METRO ON` |
| メトロノーム OFF | MIDI Connection 1 | Ch16・CC116、押したとき127 | ClyphXの`METRO OFF` |
| QLC+ 全停止 | MIDI Connection 2 | Ch1・Note111、押したとき127 | 既存VCボタンID 3の`StopAll` |
| ボーダー ON | MIDI Connection 2 | Ch1・CC117、押したとき127 | Scene ID 10のFlashへ入力を割り当てる案 |
| ボーダー OFF | MIDI Connection 2 | Ch1・CC117、押したとき0 | ONと同じ受け側へ0を送る案 |

曲頭の仮のロケーター名は`ACT01_SONG01`〜`ACT12_SONG04`。対応表は[midi-mapping.csv](midi-mapping.csv)にある。これは設定案であり、既存のLiveファイルへ書き込み済みではない。MIDIのチャンネルは1始まり、音符は0〜127の番号で記録している。

Connection 1はLive操作用、Connection 2はQLC+用として別に選ぶ。Connection 2を実際にQLC+へ届くポートに接続する必要があり、番号だけで出力先のアプリが決まるわけではない。現行qxwの入力は`Babyface Midi Port 1`で、TouchOSCからの実接続は未設定。

メッセージはすべて押したときの`RISE`だけを送信条件とし、値は定数で格納した。離したときには送らない。ボーダーOFFもボタンを押したときに定数0を送る。ON／OFFは同じCCを使う2つの操作で、ほかの操作との意図しない重複はない。[TouchOSCのMIDI設定](https://hexler.net/touchosc/manual/editor-messages-midi)に従う。

曲の選択解除時は`onValueChanged`から`true`を返し、その押下のメッセージ処理を止める。[TouchOSCのコールバック仕様](https://hexler.net/touchosc/manual/script-objects-control#onvaluechanged)に基づく。強調を消すだけで頭出しを再実行しない。

メトロノームは、運用版のClyphX `UserSettings.txt`の`[USER CONTROLS]`に次を追加する設定案。[ClyphX 2.7.6](https://github.com/ldrolez/clyphx-live11/blob/v2.7.6/reference.md)で`METRO ON`と`METRO OFF`を確認した。Liveの設定ファイルにはまだ追加していない。

```text
METRO_ON = CC, 16, 117, METRO ON
METRO_OFF = CC, 16, 116, METRO OFF
```

「Live 再生停止」に`SETSTOP`は使わない。この命令は再生・停止の切り替えだからである。標準Stopは停止位置から再開する運用で使えるが、停止操作の繰り返しで先頭へ戻る挙動も使用PJで確認する。LiveのマニュアルではStopのダブルクリックが1.1.1へ戻る操作となっている。[Live 11のTransport](https://www.ableton.com/en/live-manual/11/arrangement-view/#transport)

`StopAll`はScene・Sequence・Chaserなど全Functionが対象。Liveから後続の照明ノートが届けば再び動く可能性がある。押したあとの再発火を抑止する機能やBlackoutは付けていない。

## ボーダーの受信設定

指定の[261009-ableton-hold-midi.qxw](../../project-files/261009-ableton-hold-midi.qxw)を読み取り、次を確認した。

- Fixture ID 0「ボーダー01」はUniverse 0、Address 0。画面上のDMXチャンネル1に当たる。
- Scene ID 10「ボーダー」はFixture 0のローカルチャンネル0だけを255にする。
- 既存のボーダー用VCボタンはFlashで、MIDI入力の割り当てがない。

運用版ではScene 10をFlashで操作する専用VCボタンを用意し、Ch1・CC117を割り当てる案とする。QLC+のFlashは外部入力の正値で開始し、0で解除する。[QLC+のボタン仕様](https://docs.qlcplus.org/v5/virtual-console/button)と[入力処理のソース](https://github.com/mcallegari/qlcplus/blob/master/ui/src/virtualconsole/vcbutton.cpp)を参照。QLC+のページを切り替えても届く配置・入力設定を運用版で確認する。元のqxwは変更していない。

ONを押して離しても127の入力を保持し、OFFを押したときに0を送る。QLC+全停止でもScene 10が停止対象になる。ほかのSceneやSimple Deskが同じDMXチャンネルを上げている場合、その出力まではOFFで消さない。ここでのOFFはボーダー用Sceneの解除である。

## 修正と再生成

元データは[layouts/manipulation-12.json](../layouts/manipulation-12.json)。演目・曲の名前、曲数、対応ロケーター、MIDI番号はここで変更する。実際の曲順・停止点は[運用資料](../../operations/playback/legacy-setup.md)と合わせる。

```powershell
python yuhisai-2026/touchosc/build_manipulation_prototype.py
```

生成スクリプトは[build_manipulation_prototype.py](../build_manipulation_prototype.py)。実行にはPythonとPillow、プレビュー画像の描画にはWindowsの游ゴシックを使う。既存の10/18版`build_layout.py`、`sample.json`、`sample.png`は置き換えない。

生成物はTouchOSCファイル、読み取り用XML、MIDI対応表、全体／曲一覧の画像、[build-report.json](build-report.json)。MIDI送信を有効にした運用版を作る機能は、このプロトタイプ用スクリプトには入れていない。

## 確認したこと

- TouchOSCデスクトップ版のMacで、生成した`.tosc`を744×1133の文書として読み込めた。
- 79個のボタンのLuaがTouchOSC本体でコンパイルできた。
- 48曲と再開・Live停止・メトロノームON/OFF・QLC+全停止・ボーダーON/OFFの55個のMIDIメッセージを読み取り、すべて無効であることを確認した。Live・QLC+へ操作は送っていない。
- 全ボタンが画面内に入り、最小のタッチ領域は高さ48。配置から描画したプレビューで、文字のはみ出しがないことを確認した。
- ボーダーON/OFFだけが同じCCを使い、送信値127と0で分かれる。ほかの操作に意図しないMIDIアドレスの重複がないことを確認した。
- 全13画面で操作ボタンが重ならないことを確認した。[配置の検証記録](layout-verification.json)と[TouchOSC本体の検証記録](native-verification.json)を保存した。
- 生成したLuaを模擬コントロール上で実行し、48曲の単一選択・再タップ解除・再選択、演目一覧との往復と再開・停止操作での選択保持を確認した。解除時の戻り値とRISE条件からMIDIの処理を模擬し、解除では頭出しが送られないことも確認した。[選択処理の検証記録](selection-verification.json)を保存した。TouchOSC本体での操作確認とは区別する。

TouchOSC本体でのControl Surfaceモードによる操作確認は、アプリのダイアログで切り替えが止まり、未完了。iPad実機での表示・選択解除・画面切り替え、Liveの頭出し・再開・停止・メトロノーム、QLC+の全停止・ボーダーON/OFFも未確認。実際の再生・メトロノーム・点灯状態を受信する機能は未実装。文書の読み込みとLuaのコンパイルを、実機での操作確認済みとは扱わない。
