# 雄飛祭2026 小講堂ステージの記録

雄飛祭2026で小講堂のステージの音響・照明・再生操作・撮影の支援を担当した記録です。GitHub Pages で2ページとして公開しています。

- `content/stage/`：小講堂でステージを担当する人へ
- `content/ai/`：AIエージェントでステージを動かした記録

各フォルダの Markdown を番号順につないで1ページにします。

## ビルドと確認

```sh
pip install markdown==3.7
python3 tools/build.py              # _site/ に出力
python3 tools/check_leaks.py . _site # 個人情報などが混ざっていないか確認
```

公開前の漏洩チェックは2か所で走ります。commit の前（`git config core.hooksPath .githooks` で有効にする）と、GitHub Actions の中です。Actions では、ソースとビルド結果の両方を確かめてからデプロイします。チェックに引っかかったら公開しません。
