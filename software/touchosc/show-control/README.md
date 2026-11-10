# 共通TouchOSC操作画面

## RUMYの曲別頭出し（2026-11-06）

共通パネルで「団体 → RUMY → 演目 → RUMY」または「ENCORE」を選ぶと、「区間」に各曲名が並ぶ。本編はMela!、能動的三分間、Cruel Summer、JANE DOE、晩餐歌、Take what you want、怪獣の花唄の7曲。アンコールはOne Thing、アポロ、Walking with youの3曲。4曲ずつ表示し、「次へ」で続きを開く。

曲名を押すとその位置へ移動して停止する。「続きから再開」で再生する。本編・アンコールの途中にSETSTOPは追加せず、それぞれ最後まで続けて再生する。Walking with youは歌い出しより前の打音から頭出しする。「演目の頭へ」は従来の開始位置を使う。

位置の根拠と確認結果は[曲ロケーター記録](../../project-files/rumy/song-locators.json)に保存した。本編は音源編集表に先頭4秒を加え、アンコールは音源クリップの開始位置に編集表・打音の時刻を加えた。音源・照明・既存の停止点は変更していない。

Windowsへ反映するには、更新後の`RUMY.als`と、生成した`profiles.json`・`Stage-control.tosc`を使う。配置先の`profiles.json`とUser Libraryの`Remote Scripts/StageShowControl/profiles.json`をそろえ、保存後にLiveセットを開き直して受信スクリプトを再読み込みする。PCとスマホも更新後の文書を開く。ローカルの隔離検査と、Windows・スマホ・音声・灯体での確認は別に記録する。

## Unified on Windows — 2026-11-05

The shared panel now includes **Unified** alongside the unchanged per-group C'2, RUMY and DFS choices. Unified uses the current saved `project-files/integrated/Yuhisai-2026-integrated.als` and its `.qxw`: C'2's seven acts followed by DFS's twelve. Choose Unified on the phone; choose acts across three pages. The existing order screen can move DFS acts within this 19-act list and saves the order under the `unified` key in `StageShowControl/order.json`. It does not change Arrangement or the separate DFS order. Default order follows the saved locators.

The deployed files are in `<PATH>`. The previous deployment and complete User Library `StageShowControl` folder were backed up to `<PATH>`. Neither `C2StageControl` nor the C'2 rehearsal panel was changed. RUMY still uses its own set/workspace. Full check output and changed files: [UNIFIED-RESULTS.md](UNIFIED-RESULTS.md).

**2026-11-07 phone groups.** The 団体 picker now offers only C'2, RUMY and DFS. C'2 and DFS are views of the unified set (`unified-c2`, `unified-dfs-day1`, `unified-dfs-day2` in `shows.json`, filtered by the `[C2_` / `[DFS_` locator prefix), so each list holds only that group's acts. RUMY keeps its own set. In DFS, the 演目 page has 1日目 / 2日目 buttons above the list; each day is a separate profile with its own saved order in `order.json`. Day 1 starts in locator order. Day 2 starts from the setlist the user supplied on 2026-11-07 (`default_order` in `shows.json`: OP, 1new, CLAPUNITY, 1ja, haruka, 2JA, 2NEW, MoNaChi, LOCK, 3NEW, 3ja, POP); an order saved from the phone takes precedence. The buttons sit at the top on purpose, away from 続きから再開. The legacy `c2`, `dfs-day1` and `unified` profiles stay in `profiles.json` for the launchers and receiver but are no longer listed on the phone. An order saved earlier under `unified` does not carry over to the new DFS day views. The receiver reads act boundaries from Live's locators by name each time, so moving a locator needs no profile change; renaming or adding one does.

The saved unified set is now hand-edited production work. **Never run `build_integrated.py` again.** To refresh profiles and the shared panel from saved inputs only:

```powershell
python -X utf8 yuhisai-2026/touchosc/show-control/build_profiles.py --integrated
python -X utf8 yuhisai-2026/touchosc/show-control/build_panel.py
```

Copy `profiles.json`, `Stage-control.tosc` and `host.py` to the deployment, and `profiles.json` to User Library `Remote Scripts/StageShowControl`. The receiver Python code is unchanged, but it loads profiles only when initialized. In Live's MIDI preferences, select `StageShowControl` on a free Control Surface row (Input/Output None), or change its existing row to None and back to reload it. Keep ClyphX. Leave the C'2 rehearsal controls as they are. Do not enable legacy `StageControl` on UDP 8001 together with `StageShowControl`.

Before running `Start Unified.cmd`, confirm the integrated `.qxw` is open in the existing QLC+ instance, keeping Web API port 9999. The initial November 5 check found the per-group DFS workspace (357 functions); a later read-only check matched all 479 unified functions. The latest check still found no receiver on UDP 8001 and no shared editor server or adapter. Nothing was switched automatically by this work.

The launcher runs `<PATH>` and pauses for its result. It checks the existing QLC+ workspace first and aborts on a mismatch. If QLC+ is absent it can launch the configured executable with the unified workspace; if an existing QLC+ has no working API it refuses to launch another. After a successful QLC+ check it starts the adapter on UDP 8002 if free and opens TouchOSC with the shared document and editor server if TCP 6666 is absent. It never opens/restarts Live, reloads its script, or sends transport/function commands. It does not replace a document in an already-running TouchOSC editor server.

On the PC, open `<PATH>` and use Editor Network Server. On the phone, save the current rehearsal panel, connect Editor Network Client to this PC on port 6666 and load the shared document. Set OSC Connection 1 to UDP, Host=this PC, Send=8001, Receive=8000; select Unified. Keep the old phone document for C'2 rehearsal. Run the deployed `host.py check unified` again after setup; actual phone taps, audio/light output and ClyphX stops on `_` names remain unverified.

The sections below retain the earlier per-group setup and validation history; they do not establish unified native operation.

`Stage-control.tosc`でC'2の7曲、RUMYの連続メドレー、DFSの12演目を操作します。演目一覧の「順番」で上下に移動すると、SETSTOP後の「続きから再開」がその順番に従います。曲順は停止中に変更でき、PC側の`order.json`に保存します。Arrangementのクリップは並べ替えません。

2026-11-03、MacのLive本体で20か所のSETSTOP通過と、停止・再開・頭出し・曲順保持など計41件の検査を確認しました。TouchOSC本体とLiveのループバックOSC往復も確認しています。検証後、Macの元スクリプトと文書を復元しました。iPhone・実音声・実灯体は未検証です。Windowsでの共通受信スクリプト有効化とスマホ切り替えはまだで、従来のC'2版はUDP 8003の設定で残っています。

Macの検証結果は[最終結果](validation/results/final.md)、必要時の再実行手順は[validation/README.md](validation/README.md)に集約しました。ソースとセットはGitHubからpullし、`project-files/`の本体を参照します。SSH転送したZIP・展開先・重複する引き継ぎ資料は撤去しました。Macの通常のアプリ承認画面で進め、許可設定を直接書き換えて拒否を回避しません。

## 使用するセット

### 次回作業：本番用プロジェクトの統合

2026-11-03、本人と相談し、本番前に3団体を統合する方針を記録しました。統合版の配置先は[project-files/integrated/](../../project-files/integrated/README.md)です。現在の団体別ファイルは制作元として残します。統合版とDFSの日別ビューはまだ作成していません。

本番ではLiveとQLC+をそれぞれ1つ開き、共通TouchOSC画面から団体とDFSの「1日目／2日目」を選ぶ構成を目指します。DFSの日別ビューは、この統合と合わせて対応します。

- 元の3団体のプロジェクトを残し、別名の本番用統合版を作る。
- Liveのテンポ・拍子・ロケーター・音声ルーティングを統合する。
- QLC+で重複しているFunction IDと、その参照先を整理する。
- DFSの日別の演目順を照合し、日別ビューから切り替えられるようにする。
- 統合後に20か所のSETSTOP、頭出し・停止・再開、曲順保持、照明連携を再検証する。統合前の41件の検査結果を、統合版の合格結果には流用しない。

以下は現在の団体別構成です。統合と本番切り替えは未実施です。

| 団体 | Live | QLC+ | 演目数 |
|---|---|---|---:|
| C'2 | `project-files/C2 Project/C2-measure-aligned-v4.als` | `project-files/C2 Project/C2-lighting-v4.qxw` | 7 |
| RUMY | `project-files/rumy/RUMY Project/RUMY.als` | `project-files/rumy/261023-rumy.qxw` | 1 |
| DFS | `project-files/Dance_Free_Style Project/小講堂1日目.als` | `project-files/261009-ableton-hold-midi.qxw` | 12 |

パスは`yuhisai-2026`からの相対パスです。DFSの2日目は本人指定で旧版へ退避し、その旧版は2026-11-03の整理で削除しました。両日とも1日目のセットを使い、TouchOSCで順番を変えます。RUMYは連続メドレー1演目として扱います。

## ロケーターの余白

3セットの開始ロケーターを音源より1小節以上前、SETSTOPを終了より1小節以上後の小節頭へ動かしました。開始と前演目の停止点の間にも余白があります。RUMYは音源に既に入っている4秒の無音を使っています。DFSは必要な曲間へ計44拍の無音を追加し、クリックとオートメーションも追従させました。3セットの計335クリップを保持し、DFSのオートメーションは1616地点で対応を確認しました。

変更時には変更前のセットを`.before-show-control.old`へ保存しましたが、その旧版は2026-11-03の整理で削除しました。各演目の変更位置・ハッシュは[locator-margin-verification.json](locator-margin-verification.json)に残しています。C'2の音源・照明クリップの配置は今回の余白変更では動かしていません。以前のv4検査にある「ロケーター不変」は、今回の変更前の記録です。

## このWindowsでの切り替え手順

作業全体の順番は[起動手順](../../operations/startup/README.md)。以下は共通スクリプトとWindows補助プロセスの具体的な配置・切り替え手順。

ネイティブ検証完了後に実施します。自動起動スクリプトはLiveのセットや設定を切り替えません。

1. Liveで使用するセットを開き、Control Surfaceに`StageShowControl`を1行だけ選びます。Input／OutputはNoneにします。既存のClyphXはSETSTOPに必要です。旧`StageControl`と新スクリプトはUDP 8001が重複するため同時に有効化しません。C'2リハーサル用の`C2StageControl`と既存のスマホ画面はそのまま残します。
2. QLC+の編集を保存し、使用する団体のQLC+セットを開きます。Web APIのポートは9999です。修正版を使う場合の実行ファイルは`<PATH>`です。現在動いている旧プロセスの置き換えは未実施です。
3. PCのTouchOSCで`Stage-control.tosc`を開き、Editor NetworkをServerにします。スマホのEditor Network ClientからLiveのPCのIPアドレス、ポート`6666`へ接続します。PC側はEditorに戻し、スマホだけを操作画面として使います。
4. スマホのOSC Connection 1をUDP、有効にし、HostをLiveのPCのIPアドレス、Send Portを`8001`、Receive Portを`8000`にします。別回線ではTailscaleを有効にします。
5. このフォルダの`Start C2.cmd`／`Start RUMY.cmd`／`Start DFS.cmd`を実行します。補助プロセスはローカルの`<PATH>`から起動します。QLC+が未起動なら指定セットで起動します。既に動いているQLC+のAPIが応答しない場合や別の団体のセットの場合はエラーになります。

起動チェックは実際のHTTP・WebSocket応答、QLC+のFunction一覧、Liveのロケーター、共通TouchOSC文書、補助プロセスの応答を確認します。ポートが開いているだけでは`ready: true`にしません。表示されたエラーに対応して再実行します。既に開いているTouchOSCの文書とLiveセットは手動で切り替えます。

## 操作

団体・演目の選択、頭出し・停止・再開、曲順の扱いは[本番操作の手順](../../operations/playback/README.md)へ移した。起動と切り替えは[起動手順](../../operations/startup/README.md)を使う。設定・生成・検証原本はこのディレクトリに置く。

## Web API修正と検査範囲

QLC+側に、待受開始に失敗しても「Started」になる不具合がありました。実際の待受結果を状態へ反映し、失敗後に再試行できるよう修正しています。ワークスペースの自動起動より先にCLIのポート設定も適用します。最初に待受が失敗したOS側の理由は記録されていません。

停止の補助プロセスは、全Functionの状態がStoppedになったことを応答で確認します。処理全体の上限は1100ms、Live側の応答待ちは1500msです。切断・無応答は失敗にし、連打は処理中の1回へまとめます。遅れて停止を送るキューは作りません。診断は読み取り専用です。

| 検査 | 結果 | 証拠 |
|---|---|---|
| 実際のLuaと隔離したLive代用API、UDP往復 | 3団体・20演目・39頭出し、順番保存、予約取消、別セット拒否を確認 | `control-verification.json` |
| 共通版API・停止処理の隔離試験 | 122／390／357 Function、誤った名前の拒否、無応答・切断・遅延・連打を確認 | `webapi-verification.json` |
| QLC+本体の待受状態 | ポート占有時の失敗と再試行、20回の起動停止を確認 | `<PATH>` |
| 隔離した修正版QLC+アプリ | C'2の122シーンの内部DMX・リリース、7ページ、全停止を確認 | `project-files/C2 Project/Analysis/qlc-webapi-native-verification-v4.json` |
| 実際の旧版APIへ読み取り100回 | 応答・HTTPとWS接続を確認 | `project-files/C2 Project/TouchOSC/webapi-read-and-fault-verification.json` |
| MacのLive本体・TouchOSC本体 | 20停止点、41件のネイティブ検査、ループバックOSC往復を確認 | `validation/results/native-report.json`、`validation/results/final.md`（ローカル結果） |
| スマホ・実音声・実灯体 | 未確認 | 実端末と会場での検証が必要 |

上表のシーン検査後にCLI設定の適用順も修正・再ビルドしています。最終EXEは別名で配置済みですが、最終EXEでのワークスペース自動起動とCLIポート指定の組み合わせ、本番出力経路の検査は残っています。待受状態の単体検査や代用APIの検査を、実機確認済みとは扱いません。

## 再生成と検査

`shows.json`に団体のID・表示名・LiveとQLC+のパスを記載し、`build_profiles.py`が現在のALSとQLC+から定義を作ります。開始の`[NAME]`と停止の`[NAME] SETSTOP`を組にします。C'2の既存形式だけは`numbered_end_prefix`で`[01 Title]`と`[C2_01] SETSTOP`を組にします。統合版の命名規則は[統合版のロケーター名](../../project-files/integrated/README.md#統合版のロケーター名)を参照してください。DFSのWindows版は本人が変更した現在のファイル名を参照します。Mac版との手動マージは本人が行います。

`python3 check_profiles.py`で、架空のロケーターを使って`GROUP_NAME`形式の構文を検査します。最初のアンダースコアで団体名と演目名を分けること、完全な名前で開始とSETSTOPを組にすること、Live上の位置順を保つこと、名前内の空白を拒否することを確認します。既存の`profiles.json`やTouchOSC文書は書き換えません。

`build_panel.py`がTouchOSC文書を生成します。QLC+ではEngine直下のFunction定義を読み、Chaser等の子要素にあるFunction参照は読みません。セットのロケーターやQLC+定義を変更したときは再生成して配置し直します。アプリが開いたままの未保存変更は読み取れません。

Python検査は`requirements-validation.txt`の依存を入れて`python3 verify_control.py`、API検査は親フォルダの`package-lock.json`で固定した`ws`を使用して`node verify_webapi.cjs`で実行します。Windowsで依存をローカルディスクへ配置している場合は、その`node_modules`を`NODE_PATH`に指定します。共通版API検査の停止命令は、毎回作成する隔離サーバーだけへ送ります。
