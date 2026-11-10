# QLC Live Auto Sync 0.9.0

QLCの保存済みVCをLiveのノート名とルーティングへ反映する。作業ファイルは`261009-ableton-hold-midi.qxw`。Mac版の設定は`config.json`にあり、Google Drive内の同名ファイルを参照する。対応する修正版QLC+5.3.0と隣接するJS・node_modulesを使用する。

## 演目ページと共通RGB

MIDIチャンネル1は共通、2〜16はVCのページ1〜15に対応する。Liveの各照明トラックで`Track page`を選ぶと、そのページのボタンと共通RGBを同時に表示する。送り先チャンネルは同期デバイスが付ける。QLCの表示タブを切り替えても、Liveトラックの担当ページは変わらない。

共通項目は各演目の同じノート位置に置き、同じQLCボタンを呼ぶ。演目ごとの複製は不要。名前を変えても登録したボタンIDで追跡する。

| ノート | 項目 |
|---|---|
| N0 | Color Override |
| N1〜7 | Red Bottom 01〜07 |
| N8〜14 | Blue Bottom 01〜07 |
| N15〜21 | Blue Top 01〜07 |
| N22〜28 | Red Top 01〜07 |
| N29〜35 | Green Top 01〜07 |
| N36〜42 | Green Bottom 01〜07 |
| N43以降 | 各演目の固有項目 |

ページ切り替えノートは末尾に予約する。現在はN127がページ1、N126がページ2、N125がページ3。QLCの表示切り替え用で、Web API出力で使う。`Shared controls only`では共通項目だけを表示する。ページは最大15。追加するときは最後のタブの右側に作り、保存してからLiveで選ぶ。途中への挿入・既存ページの順番変更ではチャンネルの対応も変わるため避ける。

1ページの128枠には共通項目とページ切り替え枠も含まれる。現在は共通46枠で、各ページに82枠の固有項目を置ける。削除済みの予約はページごとに保持し、他ページの追加枠を圧迫しない。1ページが満杯でも既存キューや他ページの出力は止めず、新規項目だけを未登録として表示する。

## ページごとの共有行

`.qxw.live-map.json`の`pagesWithoutSharedRows`に、共有行を使わないページの番号を0始まりで指定する。リストにないページは従来どおり共有行を使い、項目自体がなければ既存の動作は変わらない。設定の変更は、ワークスペースを保存し直さなくても監視処理が読み取る。

```json
"pagesWithoutSharedRows": [6, 7, 8, 9, 10, 11, 12, 13]
```

この例ではVCの7〜14ページが共有行を使わない。そのページでは全128ノートがページ専用になり、共有ボタンや削除済みの共有予約は割り込まない。登録済みのページ専用割り当ては保持し、新しいボタンも共有予約を避けずに空き行へ登録する。

共有行を使わないページにColor Overrideやページ切り替えを残す場合は、`scene-color`や`page:N`をそのページのチャンネルへ明示的に登録する。同じ合成IDを別チャンネルで使える。通常のQLCボタンは別の実体として複製し、それぞれを登録する。MIDIコピーはボタンごとに入力を持つため、Stop Allのような通常ボタンを複数チャンネルへ重複登録しない。共有行を再び有効にするときは、その行と重なるページ専用割り当てを先に解消する。衝突があればエラーにして、ノートの呼び先を自動では変えない。

共有行の設定はWeb APIとMIDIコピーの両方に適用する。Color Overrideとページ切り替えがWeb API出力専用である点は従来どおり。クリップのノートや`.amxd`を変更する設定ではない。

統合セットでは既存の`defaultLayout`を1つ使い、C'2のページ専用割り当てを元のローカル行からそのwireノートへ変換する。schema 2では保存済みの`Note layout`よりワークスペースの表が優先されるため、保存値だけでは3団体の違いを扱えない。割り当て側の変換で、クリップを変更せずに対応する。

## 新しいLiveトラックで使う

1. 配布ZIPを展開し、`QLC Live Auto Sync`フォルダーをUser Libraryへ置く。
2. 照明用MIDIトラックへ`261009-QLC-Live-Auto-Labels.adg`、`QLC Live Auto Sync.amxd`の順に追加する。名前表示Rackはオフ、同期デバイスはオンにする。
3. `Choose .qxw`でQLCと同じ保存ファイルを指定し、`Track page`で演目ページを選ぶ。`Synced`を確認する。
4. QLCでFunctionを設定して保存すると、約0.5秒間隔で追加・改名を取得する。既存位置は保ち、新規項目だけを配置順で末尾へ追加する。改名やVC上の移動で既存ノートを並べ替えない。ページ別割り当てでは`Tidy notes`による再配置を行わない。
5. Liveセットを保存する。既存デバイスを削除せず、更新時は隣接ファイルを上書きしてLiveを開き直す。

削除して作り直す場合は、削除後にQLCを一度保存してから追加する。古いノートが別の照明を動かさないよう、削除済みの番号は予約する。旧形式からの移行では`migrate-page-channels.py`で候補を作り、保存済みLiveのノートの呼び出し先とオートメーションを照合してから適用する。

## Web APIとMIDI

Macでは、先に開いているQLCを閉じ、このフォルダーの`Open QLC Live Sync.command`で「QLC+ 5 Live Sync.app」をWebサーバー付きで起動する。同期デバイスの`Output`をWeb APIにする。接続先のVCと保存済みファイルが一致するまで出力しない。QLCは同時に1つだけ起動する。

MIDIで使う場合は`MIDI copy`で`…-midi.qxw`を書き出し、そのコピーをQLCで開く。元のqxwは変更しない。コピーにはチャンネル別マッピングを含め、既存のMIDI入力ポート設定を引き継ぐ。MacではAudio MIDI設定でIACドライバを有効にし、Universe 0の入力をそのIACバスへ設定する。QLCのMIDIプラグインはOMNI受信にし、Liveの出力先も同じIACバスにする。WindowsではloopMIDIを使う。

ページ別MIDIコピーには`MIDIPageChannels`属性を付ける。対応する修正版QLCでは表示中のページに関係なく、割り当てられたチャンネルのボタンへ入力を渡す。この属性のない通常プロジェクトのMIDI入力動作は変えない。

ページ切り替え、Color Override、Fade Override、Brightness OverrideはWeb APIを使用する。MIDI出力だけではこれらを送信しない。FlashボタンはNote Onで開始、Note Offで解除する。Live停止・panic・Output Offで保持中のキューを解除し、再接続時に古いNote Onを再生しない。

## Color・Fade・Brightness

Color OverrideはN0を保持した間だけ有効。Red／Green／Blueを0〜100%で設定し、SceneとRGB Matrixの色を上書きする。純緑はRed 0、Green 100、Blue 0。消灯中のMatrix画素は点灯しない。

Fade Overrideは独立したON/OFF。Fade InとFade Outはそれぞれ0〜100%で、100%＝1000ms。OFFではFunction本来の時間に戻る。変更した時間は次に始まるFadeへ適用する。

Brightness Overrideも独立したON/OFF。Brightnessは0〜100%で、100%では元のRGB明るさを正規化して最大にし、0%で消灯する。色比率、点滅、Fadeを保ち、OFFで元の設定へ戻る。VCのIntensityとGrand Masterは引き続き適用する。対象は1ヘッド・8bit RGBと8bit Dimmer。

LiveのEnvelopesでは同期デバイスの同名パラメーターを選ぶ。QLCのScene保存値は書き換えない。停止・panic・Output Off・接続切断では実行中の上書きを解除する。

## Mac版の配置と確認

User Libraryの`QLC Live Auto Sync`フォルダーに、amxd、名前表示用adg、隣接JSとnode_modulesをまとめて置く。Mac版はLive 11.3.43に同梱のMax for LiveのNode 16.6.0で回帰試験を実行する。PythonのビルドツールはMacのMax MIDI Effectテンプレートからデバイスを生成する。Mac版のパッチでは、ファイル選択・保存済みSource workspaceを`conformpath slash boot`に通す。相対パスはJSが保存値を直接読み、Liveセットのフォルダーを基準に解決する。

既存のQLC+ 5 Stable.appは残し、上書きAPIを含む版をQLC+ 5 Live Sync.appとして追加する。どちらにもScene画面、Qt QML、Canvasの安定性対策が入っている。Auto SyncにはLive Sync版を使う。Remote ScriptsのAbletonMCPはこのデバイスの依存関係ではない。

## Source workspaceのパス

保存済みLiveセットで`.qxw`を選ぶと、`Source workspace`にはセットのフォルダーからの相対パスを`../Lighting/show.qxw`のようにスラッシュ区切りで保存する。セットを開くと、そのセットのフォルダーから`.qxw`を解決して監視する。WindowsとMacでセットとshowの位置関係を保って移せば、選び直す必要はない。ノート番号を保つため、showの隣に既存の`.live-map.json`も置く。

既存の絶対パスは、そのファイルが存在すれば引き続き使い、相対パスへ変換する。変換後はLiveセットを保存する。ファイルが見つからなければ、欠けているパスをエラーとSource表示のヒントで確認し、`Choose .qxw`で指定する。同名ファイルを探して選ぶことはしない。Windowsの古い絶対パスが残ったままMacへ移した場合も、そのパスが使えなければ一度選び直す。

未保存のセットと、showがWindowsの別ドライブ・別共有にある場合は絶対パスを保持する。セットの初回保存や「別名で保存」を監視する処理はない。保存後に`.qxw`を選び直すか、セットを開き直してから保存すると、その時点のセットの場所で変換する。相対パスを保存したセットだけを別フォルダーへ移した場合は、新しい場所から同じ相対パスを解決するため、showの位置関係もそろえるか選び直す。

相対パス対応は隣接する`qlc-live.js`、`qlc-watch.js`、`source.js`の更新で適用する。`.amxd`の再生成は不要。Live 11の同梱資料でLiveセットの`file_path`を確認し、ローカル回帰試験とMax APIモデルで検証した。実際のLive／Maxでの`file_path`取得とMacの`conformpath`通過は未確認。`file_path`が取得できない場合は、絶対パスを保持する。

このアプリでも、変更した名前付きshowは30秒ごとに自動保存し、直前の30版をバックアップする。試験にはshowと`.live-map.json`のコピーを使う。物理MIDI・DMX・実際の公演での同期は、接続した機材で確認する。
