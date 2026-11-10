# ダウンロード

小講堂でそのまま使えるファイルです。今回のショーのファイルそのものではなく、次の担当者が自分のショーを作り始めるときの土台になるものに絞りました。各ファイルの前提と、確かめていないことも書いておきます。

## 照明

### DMX アドレスの表

小講堂の既設の灯体です。QLC+ 以外のソフトでも使えるように、表にしました。同じ内容を [CSV](files/lighting/small-auditorium-dmx.csv) でも配っています。アドレスはすべてユニバース1です。表の左右は、客席から舞台を見た向きです。

{{dmx_table}}

「状態」は次の意味です。「本番で使用」は今回の本番で点けたもの、「点かない」は今回点かなかったもの、「年々暗くなっている」は点くが年ごとに明るさが落ちているもの、「未使用（状態未確認）」は今回使わず、点くかどうかを確かめていないものです。点かない灯体も、アドレスが分かるように表に残しています。電球の交換などで直ったら、そのまま使えます。

ボーダー01は、舞台の上方に電球が複数並んだ灯体です。舞台全体を、ごく薄く照らします。切れた電球が年々増えているので、使う年ごとに明るさが違う可能性があります。本番の途中で暗くなるという意味ではありません。前に作ったシーンの明るさをそのまま使わず、仕込みのときに見て合わせてください。

サスライトは5台です。アドレスは4・9・8・5・6番で、左から1/5〜5/5の順です。真ん中の3/5（8番）と4/5（5番）は点きません。

### ファイル

| ファイル | 中身 |
|---|---|
| [small-auditorium-patch.qxw](files/lighting/small-auditorium-patch.qxw) | QLC+ 5 のワークスペース。上の表の灯体とアドレスだけが入っていて、シーンや操作画面は入っていない。点かない灯体は、名前の後ろに［点かない］と付けている |
| [small-auditorium-dmx.csv](files/lighting/small-auditorium-dmx.csv) | 上の表の CSV 版 |
| [small-auditorium-fixtures.csv](files/lighting/small-auditorium-fixtures.csv) | 照明の計画ソフト Capture から書き出した灯体の一覧。位置と向きの参考に。灯体名は表と一部違う |

使う前に確かめることが3つあります。

- 会場の DMX 端子は XLR 5ピンです。DMX インターフェースの出力端子がこれと合うか確かめてください。ワークスペースの出力は「DMX USB」の1本目にしてあります。手元の DMX インターフェースに合わせて、QLC+ の入出力の画面で選び直してください。
- カラー LED のアドレスは灯体側でも設定します。表のアドレスは、今回灯体側で設定したものです。仕込みの日の朝に、14台の灯体のアドレスと ch 数（3ch）がこの表と合っているかを確かめてください。
- ワークスペースは QLC+ 5.3.0 の形式です。QLC+ 4 で開けるかは確かめていません。Capture の CSV の機種名と位置は、Capture の上で近いものを選んで置いたもので、実際の機種や実測の位置とは限りません。

## 会場のモデルと写真

小講堂の 3D モデルと、Capture のプロジェクトです。寸法と客席数は写真から推定したもので、実測ではありません。Capture の灯体の位置も概略です。

| ファイル | 中身 |
|---|---|
| [small-auditorium.c2s](files/venue/capture/small-auditorium.c2s) | 照明の計画ソフト Capture のプロジェクト。会場のモデルと灯体が入っている。Capture Student 版で作った |
| [small-auditorium.blend](files/venue/model/small-auditorium.blend) | Blender で編集できる会場のモデル |
| [small-auditorium-combined.glb](files/venue/model/small-auditorium-combined.glb) | 舞台と客席を合わせたモデル（glTF）。ほかのソフトに読み込むときはこれを使う |
| [small-auditorium-stage.glb](files/venue/model/small-auditorium-stage.glb) | 舞台、舞台の開口、幕、スクリーン、前の階段だけのモデル |
| [small-auditorium-context.glb](files/venue/model/small-auditorium-context.glb) | 客席側の壁、座席の概略、調整室の窓だけのモデル |
| [venue_parameters.json](files/venue/model/venue_parameters.json) | モデルの推定寸法 |
| [audience-preview0001.png](files/venue/model/audience-preview0001.png) | 客席から見たモデルのプレビュー |

座標の向きは、Capture では X が横、Y が上、Z が舞台の奥です。Blender では（X, −Z, Y）になります。舞台の床が Y=0、舞台の前端が Z=0 です。

### 写真

照明の回路を1つずつ点けた直後に撮った写真です。どの灯体が舞台のどこを照らすかの参考にしてください。初めは上の DMX アドレスの表と同じ灯体順で、DMX アドレス順にも並べ替えられます。開くと写真が出ます。写真を押すと元の大きさで開きます。写っている人の顔はぼかしています。写真の丸や線は、撮ったときの書き込みです。

<div class="sort-toggle" role="group" aria-label="写真の並び"><button type="button" data-sort="fixture" aria-pressed="true">灯体順</button><button type="button" data-sort="addr" aria-pressed="false">DMX アドレス順</button></div>
<div class="photo-list">
<details data-addr="1"><summary>1番　ボーダー01（写真なし）</summary><p class="photo-note">写真はありません。舞台全体を、ごく薄く照らします。</p></details>
<details data-addr="4"><summary>4番　サスライト 1/5（左端）（2枚）</summary><div class="photos"><a href="files/venue/photos/IMG_0095.jpg"><img src="files/venue/photos/IMG_0095.jpg" alt="4番　サスライト 1/5（左端）" loading="lazy"></a><a href="files/venue/photos/IMG_0102.jpg"><img src="files/venue/photos/IMG_0102.jpg" alt="4番　サスライト 1/5（左端）" loading="lazy"></a></div></details>
<details data-addr="9"><summary>9番　サスライト 2/5（左寄り）（1枚）</summary><div class="photos"><a href="files/venue/photos/IMG_0106.jpg"><img src="files/venue/photos/IMG_0106.jpg" alt="9番　サスライト 2/5（左寄り）" loading="lazy"></a></div></details>
<details data-addr="8"><summary>8番　サスライト 3/5（中央） ※点かない（1枚）</summary><div class="photos"><a href="files/venue/photos/IMG_0097.jpg"><img src="files/venue/photos/IMG_0097.jpg" alt="8番　サスライト 3/5（中央） ※点かない" loading="lazy"></a></div></details>
<details data-addr="5"><summary>5番　サスライト 4/5（右寄り） ※点かない（1枚）</summary><div class="photos"><a href="files/venue/photos/IMG_0091.jpg"><img src="files/venue/photos/IMG_0091.jpg" alt="5番　サスライト 4/5（右寄り） ※点かない" loading="lazy"></a></div></details>
<details data-addr="6"><summary>6番　サスライト 5/5（右端）（1枚）</summary><div class="photos"><a href="files/venue/photos/IMG_0104.jpg"><img src="files/venue/photos/IMG_0104.jpg" alt="6番　サスライト 5/5（右端）" loading="lazy"></a></div></details>
<details data-addr="27"><summary>27番　ステージ全体、差し日（右ケラレ）（3枚）</summary><div class="photos"><a href="files/venue/photos/IMG_0083.jpg"><img src="files/venue/photos/IMG_0083.jpg" alt="27番　ステージ全体、差し日（右ケラレ）" loading="lazy"></a><a href="files/venue/photos/IMG_0109.jpg"><img src="files/venue/photos/IMG_0109.jpg" alt="27番　ステージ全体、差し日（右ケラレ）" loading="lazy"></a><a href="files/venue/photos/IMG_0111.jpg"><img src="files/venue/photos/IMG_0111.jpg" alt="27番　ステージ全体、差し日（右ケラレ）" loading="lazy"></a></div></details>
<details data-addr="31"><summary>31番　客席左上方 ステージ右側（1枚）</summary><div class="photos"><a href="files/venue/photos/IMG_0117.jpg"><img src="files/venue/photos/IMG_0117.jpg" alt="31番　客席左上方 ステージ右側" loading="lazy"></a></div></details>
<details data-addr="28"><summary>28番　客席右上方 ステージ左側（3枚）</summary><div class="photos"><a href="files/venue/photos/IMG_0113.jpg"><img src="files/venue/photos/IMG_0113.jpg" alt="28番　客席右上方 ステージ左側" loading="lazy"></a><a href="files/venue/photos/IMG_0114.jpg"><img src="files/venue/photos/IMG_0114.jpg" alt="28番　客席右上方 ステージ左側" loading="lazy"></a><a href="files/venue/photos/IMG_0115.jpg"><img src="files/venue/photos/IMG_0115.jpg" alt="28番　客席右上方 ステージ左側" loading="lazy"></a></div></details>
<details data-addr="37"><summary>37番　遠方 左端手前（2枚）</summary><div class="photos"><a href="files/venue/photos/IMG_0081.jpg"><img src="files/venue/photos/IMG_0081.jpg" alt="37番　遠方 左端手前" loading="lazy"></a><a href="files/venue/photos/IMG_0130.jpg"><img src="files/venue/photos/IMG_0130.jpg" alt="37番　遠方 左端手前" loading="lazy"></a></div></details>
<details data-addr="38"><summary>38番　遠方 中央左寄り（1枚）</summary><div class="photos"><a href="files/venue/photos/IMG_0132.jpg"><img src="files/venue/photos/IMG_0132.jpg" alt="38番　遠方 中央左寄り" loading="lazy"></a></div></details>
<details data-addr="35"><summary>35番　遠方中央 なぜか2方向（中央右手前と左奥）（3枚）</summary><div class="photos"><a href="files/venue/photos/IMG_0089.jpg"><img src="files/venue/photos/IMG_0089.jpg" alt="35番　遠方中央 なぜか2方向（中央右手前と左奥）" loading="lazy"></a><a href="files/venue/photos/IMG_0099.jpg"><img src="files/venue/photos/IMG_0099.jpg" alt="35番　遠方中央 なぜか2方向（中央右手前と左奥）" loading="lazy"></a><a href="files/venue/photos/IMG_0128.jpg"><img src="files/venue/photos/IMG_0128.jpg" alt="35番　遠方中央 なぜか2方向（中央右手前と左奥）" loading="lazy"></a></div></details>
<details data-addr="34"><summary>34番　遠方 右手前 狭め（1枚）</summary><div class="photos"><a href="files/venue/photos/IMG_0126.jpg"><img src="files/venue/photos/IMG_0126.jpg" alt="34番　遠方 右手前 狭め" loading="lazy"></a></div></details>
<details data-addr="33"><summary>33番　遠方 右奥 狭め（2枚）</summary><div class="photos"><a href="files/venue/photos/IMG_0093.jpg"><img src="files/venue/photos/IMG_0093.jpg" alt="33番　遠方 右奥 狭め" loading="lazy"></a><a href="files/venue/photos/IMG_0124.jpg"><img src="files/venue/photos/IMG_0124.jpg" alt="33番　遠方 右奥 狭め" loading="lazy"></a></div></details>
<details data-addr="33"><summary>33・34・35・37・38番　遠方の5回路をまとめて点けたところ（2枚）</summary><div class="photos"><a href="files/venue/photos/IMG_0121.jpg"><img src="files/venue/photos/IMG_0121.jpg" alt="33・34・35・37・38番　遠方の5回路をまとめて点けたところ" loading="lazy"></a><a href="files/venue/photos/IMG_0122.jpg"><img src="files/venue/photos/IMG_0122.jpg" alt="33・34・35・37・38番　遠方の5回路をまとめて点けたところ" loading="lazy"></a></div></details>
</div>

| ファイル | 中身 |
|---|---|
| [house-audio-console-2026-10-20.jpg](files/venue/photos/house-audio-console-2026-10-20.jpg) | 会場の音響卓 |
| [house-audio-inputs-2026-10-20.jpg](files/venue/photos/house-audio-inputs-2026-10-20.jpg) | 会場の音響の入力端子 |

## 音響測定

[REW](https://www.roomeqwizard.com/)（無料の音響測定ソフト）で開ける測定データです。小講堂で持ち込みのスピーカー（Bose F1 Model 812 と F1 Subwoofer を左右に1組ずつ）を鳴らして測りました。

| ファイル | 中身 |
|---|---|
| [2026-11-06-rear-center-initial.mdat](files/audio/rew/2026-11-06-rear-center-initial.mdat) | 11月6日、客席最後方の中央。返しスピーカーも鳴らした状態で測っている |
| [2026-11-07-center-f1.mdat](files/audio/rew/2026-11-07-center-f1.mdat) | 11月7日朝、客席後方の中央。左だけ、右だけ、左右両方を、それぞれ3回ずつ。返しスピーカーも鳴らした状態 |
| [2026-11-07-center-eq-trials.mdat](files/audio/rew/2026-11-07-center-eq-trials.mdat) | 11月7日夜、同じ位置で EQ を変えながら測った8回分。返しスピーカーも鳴らした状態。1〜2回目は55Hz を持ち上げた状態、3〜4回目は持ち上げない状態、5〜6回目は43Hz と61Hz を下げた状態、7〜8回目はさらにサブウーファーの音量を10時から12時の位置に上げた状態 |

どの測定にも、43Hz 前後と61Hz に山があり、50Hz 前後に谷がありました。ただし、これが部屋のせいなのか、スピーカーや置き方のせいなのかは、客席後方だけの測定では分けられていません。次に測るときは、前方を含めて客席の2〜3か所で測ると原因を切り分けられます。

担当者（筆者）の評価では、2日目に確定した設定の音が一番よいものでした。低音はぼやけたままでしたが、体に響く低音があるほうが楽しく、客席も1日目より盛り上がりました。その設定は、作業記録の「[5.1 音響](record.html#51-音響)」にある最終の設定です。Ableton Live のマスターは0dB のままにして、音量は TotalMix FX の2段目（ソフトウェアからの再生）で、ASIO の出力の音量だけを調整しました。

測定マイクは dbx RTA-420 v2 で、マイクごとの校正データはありません。音圧の値は、スマートフォンの騒音計アプリの表示に合わせて REW で校正したものです。絶対的な音圧としてではなく、同じ日の測定どうしを比べる目安として見てください。

## AI エージェント用の指示

| ファイル | 中身 |
|---|---|
| [AGENTS.md](files/agents/AGENTS.md) | Claude Code や Codex に読ませる指示。会場の前提と、今回の失敗から作った約束（外部への連絡、期限の再計算、報告前の確かめ方、ファイルの版、委任の仕方、公開前の検査） |

リポジトリの直下に `AGENTS.md` として置くと、Codex はそのまま読みます。Claude Code では、`CLAUDE.md` に `@AGENTS.md` と1行書くと読み込みます。各項目の理由は、「[AIエージェントの記録](ai.html)」と作業記録の「[第8章 次回への提案](record.html#第8章-次回への提案)」にあります。

## ツールのソースコード

今回のショーのために作ったツールを、そのまま公開しています。汎用化はしていないので、使うには接続先などの設定を自分の環境に合わせる必要があります。ライセンスは MIT です（同梱の他者のコードは、それぞれのライセンスに従います）。

| フォルダ | 中身 |
|---|---|
| [touchosc](https://github.com/1kgofpastaeveryday/yuhisai-2026-stage-notes/tree/main/software/touchosc) | TouchOSC の操作画面と、Ableton Live の Control Surface スクリプト。演目の選択、頭出し、停止と再開 |
| [remote-dimmer](https://github.com/1kgofpastaeveryday/yuhisai-2026-stage-notes/tree/main/software/remote-dimmer) | スマートフォンからディマーを操作する照明リモート（Web、Go のサーバー、iOS アプリ） |
| [qlc-live-auto-sync](https://github.com/1kgofpastaeveryday/yuhisai-2026-stage-notes/tree/main/software/tools/qlc-live-auto-sync) | Ableton Live と QLC+ を同期する Max for Live のデバイス |
| [QLC+ のパッチ類](https://github.com/1kgofpastaeveryday/yuhisai-2026-stage-notes/tree/main/software/tools) | QLC+ に加えた修正とビルド用の資材 |

各フォルダの説明は [software/README.md](https://github.com/1kgofpastaeveryday/yuhisai-2026-stage-notes/blob/main/software/README.md) にあります。
