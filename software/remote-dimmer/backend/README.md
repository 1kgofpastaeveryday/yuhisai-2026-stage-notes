# iPhone用ディマーサーバー

QLC+と同じPCで使います。iPhoneを使う枠ではサーバーを起動し、Abletonを使う前にCtrl+Cで止めます。終了時はiPhone用スライダーを0に戻します。強制終了した場合は値が残るため、起動し直してから正常終了してください。

## QLC+の準備

QLC+ 5.3.0をWebアクセス付きで起動し、使用するプロジェクトを開きます。v5には操作モードがなく、VCスライダーは編集モードに関係なくDMXを出力します。

```sh
qlcplus5 -w show.qxw
```

Windowsではインストール先の`qlcplus5.exe`を使います。PowerShellの例です。

```powershell
& "<PATH>" -w "<PATH>"
```

macOSのバンドル内実行ファイル名は`qlcplus5`です。次はパスの例で、アプリ名とインストール先は未確認です。実際のアプリに合わせてください。

```sh
/Applications/QLC+.app/Contents/MacOS/qlcplus5 -w show.qxw
```

各ディマーにLevelモードのVCスライダーを1本用意し、そのディマーの1chだけを割り当てます。下限は0、上限は255です。

iPhone用スライダーのチャンネル監視（Monitor）は無効にしてください。

起動表示用のFrameは2ページ、ページの折り返しは無効にします。1ページ目を空にし、2ページ目には赤背景で「iPhone 稼働中　Ableton の前にサーバーを止める」と大きく表示してください。

赤い起動表示は、そのFrameを置いたVCページを選択している間だけ見えるため、普段開いておくページに配置してください。

稼働中はページコマンドが30秒の自動保存タイマーを繰り返しリセットするため自動保存されないと推定されます。サーバー起動前にプロジェクトを保存してください。

## ネットワークとファイアウォール

iPhoneから8765番へのTCP接続を許可し、QLC+の9999番へのLANからの接続を遮断します。同じPC内の127.0.0.1から9999番への接続は必要です。サーバーのIPは会場ネットワークに合わせて固定してください。

Windowsでは、管理者PowerShellで次の規則を追加します。9999番の遮断は、有線LANを含むすべてのインターフェースとネットワークプロファイルに適用します。Windowsファイアウォールはループバック通信を制限しないため、同じPC内からの接続は維持されます。

```powershell
New-NetFirewallRule -DisplayName "Remote dimmer QLC LAN block" -Direction Inbound -Action Block -Protocol TCP -LocalPort 9999 -Profile Any
New-NetFirewallRule -DisplayName "Remote dimmer phones" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8765 -Profile Private
```

会場ネットワークをWindowsの設定でプライベートにしてください。8765番の許可規則はプライベートネットワークで適用されます。遮断規則はQLC+自身の許可規則より優先されるため、既存のQLC+許可規則があっても9999番を遮断できます。

macOSでは「システム設定 → ネットワーク → ファイアウォール」を有効にし、「オプション」でQLC+を「外部からの接続をブロック」に設定します。remote-dimmerの実行ファイルは受信接続を許可してください。このアプリケーションファイアウォールは、同じMac内の127.0.0.1からの接続には影響しません。

リハーサルでは、同じPCの`http://127.0.0.1:9999`へ接続でき、別のLAN端末からは9999番へ接続できないことを確認します。別端末から`http://サーバーIP:8765/status`が403になることも確認します。これは8765番には届き、管理画面はLANから開けない状態です。実際のiPhoneアプリでも接続を確認してください。

## Cloudflare Tunnel

インターネット経由では、iPhoneから`wss://<HOST>/ws`へ接続します。`publicListen`はTunnel用の待受で、`/ws`だけを公開します。`127.0.0.1:8766`や`[::1]:8766`のようなループバックIPとポートを指定してください。省略または空文字なら待受を作りません。`0.0.0.0`、空のホスト、LANのIP、ホスト名を指定すると起動を拒否します。

Cloudflare Tunnelのingressは次のように設定します。`tunnel`と`credentials-file`は既存のTunnelに合わせてください。

```yaml
ingress:
  - hostname: <HOST>
    path: ^/ws$
    service: http://127.0.0.1:8766
  - service: http_status:404
```

Tunnelの転送先は`publicListen`にしてください。管理画面を含む8765番へ転送すると、Tunnelからの接続がループバックとして扱われ、管理操作まで公開されます。状態ページと管理コマンドは、引き続き同じPCの8765番で使います。LAN内で直接接続するときは従来どおり`ws://サーバーIP:8765/ws`を使えますが、`ws://`ではキーも暗号化されずに流れます。

## 設定と起動

PLANS.mdの例をもとに`config.json`を作ります。

```json
{
  "listen": ":8765",
  "publicListen": "127.0.0.1:8766",
  "qlcURL": "ws://127.0.0.1:9999/qlcplusWS",
  "project": "<PATH>",
  "indicatorFrame": 120,
  "assignmentsFile": "assignments.json",
  "logFile": "remote-dimmer.log",
  "fixtures": [
    {"name": "中央", "slider": 45, "universe": 1, "address": 9},
    {"name": "左", "slider": 46, "universe": 1, "address": 10, "faderMode": "absolute"}
  ]
}
```

`slider`と`indicatorFrame`には実際のVCウィジェットIDを指定します。`universe`は1〜4、`address`は1〜512です。XML内のUniverseとAddressは0始まりですが、この設定は1始まりです。`project`は保存済みの`.qxw`へのパスです。macOSでは`<PATH>`のように指定します。相対パスは起動したディレクトリが基準になります。

```sh
./remote-dimmer -config config.json
```

Windowsでは`./remote-dimmer.exe -config config.json`を使います。起動直後の明るさはすべて0です。割り当ては保存しますが、明るさは保存しません。ログは画面と`logFile`の両方に出ます。`set`は灯体ごとに500ms以上間隔を空け、操作が止まって500ms経った最終値も記録します。

## 割り当てと状態ページ

サーバーと同じPCで`http://127.0.0.1:8765/status`を開き、ブラウザーを全画面表示にしてください。QLC+の接続、各灯体の値、割り当て、端末の接続とIP、最終変更、検証の警告を表示します。端末の行の「灯体を追加」で、空いている灯体を選ぶと割り当てられます。4灯体まで追加できます。各灯体の「解除」で、その灯体だけを解除し、明るさを0にします。別の端末へ明るさを保って移すときは、管理コンソールの「移す（明るさはそのまま）」、または`assign <移動先の端末ID> <灯体名>`を使ってください。先に解除する必要はありません。管理コンソールで新しく割り当てられるのは1台につき1灯体です。

同じ操作を別のターミナルから実行できます。

```sh
./remote-dimmer devices
./remote-dimmer assign K7Q2MX 中央
./remote-dimmer assign K7Q2MX 左
./remote-dimmer release 中央
./remote-dimmer forget K7Q2MX
```

設定を別の場所に置いた場合は、各コマンドの前に`-config パス`を付けます。端末IDは各iPhoneに表示される6文字です。1台に最大4灯体、1灯体に1台まで割り当てられます。iPhoneには`config.json`の`fixtures`に書いた順で並びます。`assignments.json`は従来どおり`{"中央":"K7Q2MX","左":"K7Q2MX"}`の形で保存します。

割り当てるときは、手元のiPhoneでアプリを開き、端末IDを確認してください。接続中の端末のキーを、そのIDの認証情報として登録します。未登録の端末も一覧に出ますが、操作はできません。未接続の端末、または直近60秒以内に異なるキーで接続した端末には割り当てられません。状態ページの`bound`は登録済み、`unbound`は未登録、`key conflict`はキーの競合です。競合したら手元のiPhoneを確認し、別の端末からの接続を止め、最後の競合から60秒以上待ってください。

`forget <端末ID>`または状態ページの「登録を削除」は、認証情報とその端末の全割り当てを削除し、割り当てられていた全灯体の明るさを0にします。端末を交換するときや、キーが変わったときに使い、接続中の端末を確認してから改めて割り当ててください。キーの競合履歴は60秒経つまで残ります。

認証情報は`assignmentsFile`と同じフォルダーの`bindings.json`に、端末IDとキーのSHA-256ハッシュの組で保存します。キーとハッシュは画面やログには出しません。両ファイルは一時ファイルへの書き込みとrenameで置き換えます。割り当て時は認証情報を先に保存し、登録削除時は割り当てを先に保存します。途中で保存に失敗した場合、認証情報だけが残ることがあります。エラーを確認して操作をやり直してください。`bindings.json`が壊れている場合は起動を拒否します。バックアップから復元して内容を確認してください。ファイルがない場合は全端末を未登録として扱い、以前の割り当てが残っていても操作を許可しません。移行時はその割り当てを解除し、接続中の端末に割り当て直してください。

`active`がtrueならiPhoneで操作できます。QLC+側の対象スライダーを直接動かすと`locked`がtrueになり、`active`はfalseになります。このロックはサーバーの再起動で解除します。Simple Deskや残ったシーンによる出力の違いは`overridden`で表示し、iPhoneの操作は受け付け続けます。値が一致すると上書き表示は消えます。グランドマスターによる変化は検出できません。検出には2回の連続した不一致と、最後のスライダー送信から500ms以上の経過が必要です。

`.qxw`は起動時と保存時に検証します。警告があってもサーバーは止まりません。ディスク上のファイルの検証なので、QLC+で開いているプロジェクトと同じかも確認してください。状態ページが灰色の「サーバー応答なし」になった場合は値が残っている可能性があります。「停止（0 に戻し済み）」は最終の0送信が完了した状態をページが取得できた場合だけ表示します。送信完了は実際のDMX出力を確認した意味ではありません。

## ビルドと確認

Go 1.26.1でビルドします。実行先にはGoのインストールは不要です。

```sh
GOFLAGS=-buildvcs=false go build ./...
GOFLAGS=-buildvcs=false go vet ./...
GOFLAGS=-buildvcs=false go test -race -count=3 ./...
GOFLAGS=-buildvcs=false GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o remote-dimmer.exe
GOFLAGS=-buildvcs=false GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -o remote-dimmer-mac
```

ここでの`GOFLAGS`は、Gitを呼ぶビルド情報の取得を無効にします。PowerShellでは`$env:GOOS="windows"`のように各環境変数を設定してから`go build`を実行してください。

## 灯体の操作方式とムービング

`faderMode`は灯体ごとに指定します。`relative`（既定）は、指を動かした量だけ明るさが変わり、タップでオン/オフします。`absolute`は、バーの中で触れた位置がそのまま明るさになり、バーの外をタップするとオン/オフします。オンでは、その灯体の直前の0でない値に戻ります。値がなければ255になります。

ムービング灯体はiPhoneへ割り当てられません。以前のムービング割り当てが`assignments.json`に残っている場合は起動エラーになるため、起動前に取り除いてください。サーバー内のQLC+向け処理は残っています。設定にムービング灯体があると起動時に軸を保持するため、今回使わない灯体は`config.json`から外してください。残す場合の消灯・待機キュー・停止手順は[../MOVING.md](../MOVING.md)を参照してください。
