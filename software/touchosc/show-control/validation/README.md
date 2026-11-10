# Macでのネイティブ検証

2026-11-03、MacのLiveとTouchOSC本体で消音コピーによる検証を完了しました。20停止点を含む41件が通り、追加検査でも実際のSETSTOP後に並べ替えた次演目へ再開することを確認しました。[最終結果と未検証の範囲](results/final.md)を先に参照してください。iPhone・実音声・実灯体、Windowsへの本番切り替え、今後作成する統合版は、この検証の対象外です。

以下は同じ検証を再実行するための手順です。検証完了は共通版を本番で有効化したことを意味しません。

この手順と実装はstagesリポジトリ内で管理します。MacもGitHubから取得した同じコミットを使います。SSHでZIPやソースを転送する運用は終了しました。

## 再実行の始め方

Macのデスクトップ版Codexでstagesを作業フォルダとして開き、必要な再検証の範囲を決めたうえで、次の指示を使います。

> `yuhisai-2026/touchosc/show-control/validation/README.md`を読んで、MacのLiveとTouchOSCでネイティブ検証を再実行してください。Windowsの画面は操作しないでください。元セットを保存し直さず、消音した検証用コピーを使ってください。検査結果と必要な修正をstages内に残してください。

承認が必要な場合は、この見えるチャットで通常のアプリ承認を求めます。前回の非対話CLIではLiveに`cgWindowNotFound`、TouchOSCに`Computer Use was not approved to use TouchOSC`が返り、本人に承認画面は表示されませんでした。「ユーザーの許可待ち」とは扱いません。許可設定の直接変更や、拒否されたアプリへの別の入力方法での迂回はしません。

## 入力と出力

入力は親フォルダの`profiles.json`と、そこに記載した`yuhisai-2026/project-files/`以下の3セットです。ソースを`source/`や`sets/`へ複製しません。`build_panel.py`は既存のTouchOSC共通ビルダーを相対パスで参照します。

```sh
cd yuhisai-2026/touchosc/show-control
python3 validation/prepare_silent_sets.py
```

このコマンドは元セットのハッシュとロケーターを照合し、`validation/work/`へ3つの検証用ALSを作ります。全クリップを無効化し、ミキサーをミュート、MIDI出力をNoneにし、Maxの初期化・ネットワーク出力を避けるためデバイスを取り除きます。これらはXMLの検査であり、Live本体の動作確認ではありません。確認結果は`validation/results/silent-copy-preparation.json`へ保存します。

元のALS・QLC+・音源は変更しません。Macで既存の文書が開いていれば保存・退避してから検証用コピーを開きます。音源がMacで未取得でも、消音したコピーによるロケーターとトランスポートの検証はできます。ClyphXはSETSTOPに必要なので保持します。`StageShowControl`を選ぶ際は、同じUDP 8001を使う旧`StageControl`を同時に有効にしません。検証用通信はループバックだけを使います。

ネイティブ結果は`validation/results/native-report.json`と`validation/results/final.md`へ保存します。機械固有のログ・スクリーンショット・検証用ALSはGitへ追加しません。実装を直した場合は、コピーしたソースではなく、このリポジトリの本体を修正します。

## 必須の検査

1. C'2の7曲、RUMYの1メドレー、DFSの12演目、計20か所のSETSTOPを手前から再生して通過し、停止位置を記録する。
2. 演目途中の手動停止後、続行が同じ位置から始まること、停止を連打しても位置が戻らないことを確かめる。
3. 3団体それぞれ、明示的な頭出し後の再開が指定位置から始まることを確かめる。
4. DFSの順番を変え、SETSTOP後の再開が保存した次演目へ進むことを確かめる。予約した再開の停止による取り消し、最終演目の終了、受信スクリプト再読み込み後の曲順保持も調べる。
5. 別団体を選んだ画面の命令を拒否し、トランスポートを変更しないことを確かめる。
6. 元セットのハッシュが変わっていないことを確かめる。音源・デバイス不足と、トランスポートの成否は別に記録する。
7. TouchOSC本体で`Stage-control.tosc`を開き、LuaのコンパイルとOSC往復を確認する。iPhoneを触っていなければ実端末は未検証と書く。

Live内で使う検証専用スクリプトが必要なら`validation/`に限定します。本番受信側へデバッグ命令を追加しません。既存文書と設定を元へ戻し、`DONE <件数>`または`PARTIAL <理由>`で報告を終えます。

## 現時点の確認範囲

2026-11-03、MacのLive 11.3.43とTouchOSC本体で検証を完了しました。20か所のSETSTOPを手前から再生して通過し、3団体の頭出し・手動停止後の続行・停止連打・別団体命令の拒否を確認しました。DFSの曲順保存、並べ替え後の再開、予約取消、最終演目、Live再起動後の曲順保持と元順への復元も確認しました。計41件のネイティブ検査が通っています。

停止位置は指定点から0.077～0.347拍後でした。TouchOSC本体ではLuaの画面切り替えと、ループバックOSCによるLiveの頭出し・再開・停止・状態表示を確認しました。音源不足の表示はトランスポートの成否と分けて記録しています。iPhone・実音声・実灯体は未検証です。Windowsの修正版QLC+ EXEは今回操作していません。

DFSの元ALSは最初のコピー生成後にハッシュが変わりました。ロケーター不変とMIDIクリップ1個の減少を照合し、変更を巻き戻さず`profiles.json`のハッシュを更新しました。最新コピーは計334クリップです。再生成後から検証終了まで元ALSとQLC+のハッシュは一致しています。

詳しい位置・結果は`results/native-report.json`と`results/final.md`に保存しています。これらの機械固有の結果は既存の`.gitignore`に従いGit対象外です。最初の失敗した実行は履歴として`previous-attempt.json`に残します。

## 検証専用スクリプト

`StageNativeValidation/__init__.py`は本体の`StageShowControl`を継承し、Liveのメインスレッドで検査します。本体のOSCプロトコルには検証用命令を追加していません。`StageShowControl`パッケージから本体と`profiles.json`を読み込める状態で、旧StageControlと競合させずに検証用スクリプトを有効にします。今回は本人の明示承認を得て既存StageControlを一時退避し、そのスロットで実行しました。終了後、元フォルダの3ファイルのハッシュ一致と旧スクリプトの起動ログを確認し、一時参照を撤去しました。Control Surface設定は変更していません。

スクリプトは名前が`<団体ID>-NATIVE-TEST-SILENT`のセットだけを対象にし、Live APIでミュート・全音量ゼロ・デバイスなしを確認してから再生します。停止点通過の準備では`start_time`と`current_song_time`を指定し、`start_playing()`を使います。`continue_playing()`は前の停止位置を再開するため、この準備操作には使いません。各API操作の反映を待ってから次の操作へ進みます。

通常検査のDFS終了時は順番を入れ替えたまま残し、元順と次に期待する順を`results/dfs-day1-live.json`に記録します。再読み込み検査は`work/reload-check.json`へ`show`・`expected`・`original`を指定してLiveを再起動し、同じDFSコピーを開きます。結果は`results/dfs-day1-reload-live.json`へ分けて保存し、曲順を元に戻します。検査後はこの設定ファイルも撤去します。

`native_osc_probe.py <団体ID> <ラベル>`はループバックだけでLiveの状態を読み取ります。トランスポート命令は送りません。応答先を一時登録するため、TouchOSCの次のハートビートが応答先を戻します。`results/touchosc-live-osc.json`に画面操作後の実際の位置と再生状態を追記します。
