# マニュアル変更記録

アプリの画面に影響する変更は、マニュアル撮影の変更記録を1件作る。記録の `id` は変更単位で一意にし、ファイル名は `<id>.json` にする。

```json
{
  "id": "2026-09-11-operation-guide",
  "sourceRepo": "shift-form",
  "mode": "diff-capture",
  "flags": ["shift-form.home.navigation"],
  "status": "planned",
  "summary": "ホーム画面の操作ナビ表示を撮り直す"
}
```

`flags` は [../impact-map.json](../impact-map.json) の登録済みIDだけを使う。`mode` は次の3種類。

- `diff-capture`: 既存タスクの対象ステップだけ撮り直す
- `new-task`: 新しいタスクをレシピへ追加し、そのタスクを全ステップ撮影する。影響マップのtargetはtask単位にする
- `text-only`: 画像を増やさない文言変更。必要に応じてレシピを撮り直す

撮影前は `planned`、撮影後は `captured`、画像を目視確認して公開できる状態になったら `verified` にする。アプリ側のPR本文には次のマーカーを入れる。

```text
<!-- pwgws-manual-change
{"id":"2026-09-11-operation-guide","sourceRepo":"shift-form","mode":"diff-capture","flags":["shift-form.home.navigation"]}
-->
```

アプリ側のCIは `verified` の記録がない画面変更を通さない。新機能の場合は、先に影響フラグ・レシピのタスク・変更記録・画像を用意してからアプリPRをマージする。
