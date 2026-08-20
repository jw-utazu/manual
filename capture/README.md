# スクリーンショットの撮り方

マニュアルの画面画像は、このフォルダのスクリプトで**アプリを実際に操作して撮影**する。
手で撮ったりCSSで似せて描いたりはしない。UIが変わったら撮り直すだけで最新の画面に揃う。

## 全体の流れ

```
recipes/<対象者>.json  ← 原本（手順と説明文をここに書く）
        │  node capture.mjs <対象者>
        ▼
shots/<対象者>/*.webp   画面画像        ← 生成物
content/<対象者>.json   ステップ定義    ← 生成物
```

**`content/*.json` と `shots/` は生成物。直接編集しない。**
マニュアルの文言を直したいときも `recipes/*.json` を直して撮り直す（原本を1つに保つため）。

## 準備（初回だけ）

```bash
cd manual/capture
npm install
npx playwright install chromium
```

## ログイン（初回と、ログインが切れたとき）

撮影にはテストアカウント `jw.utazu.test@gmail.com` を使う。
**Googleへのログインは人が手で行う**（自動化しない）。一度ログインすれば `.profile/` に残り、以降は不要。

```bash
npm run login
```

ブラウザが開くのでテストアカウントでログインし、終わったらブラウザを閉じる。

## 撮影

```bash
node capture.mjs volunteer          # 奉仕者向けを全部
node capture.mjs volunteer login    # タスク「login」だけ撮り直す
node capture.mjs volunteer --headed # ブラウザを見ながら（デバッグ用）
```

撮り終わると PNG は自動で WebP（幅750px）に変換され、PNG は消える。

## ⚠ 撮影後に必ずやること

**全画像を目視で確認し、実名・実メールアドレスが写っていないか確かめる。**

撮影中は全API呼び出しに `demo=1` が付き、サーバー側（`supabase/functions/api/_demo.ts`）が
実在メンバーの氏名・ふりがな・メールアドレスをダミーへ置き換える。
ただしマニュアルは **PUBLIC な GitHub Pages で全世界に公開される**ため、
自動置換だけを信用してはいけない。人の目で最終確認する。

## テストアカウントで使える仕込み

| 仕掛け | レシピでの書き方 | 何ができるか |
|---|---|---|
| 疑似日付 | `"setup": { "fakeNow": "2026-09-05" }` | 「申込受付中」「締切後」「シフト公開後」など撮りたい時期を作る |
| 未登録状態 | `"setup": { "simulateRegister": true }` | 初回登録画面を呼び出す |
| セッション破棄 | ステップに `"clearSession": true` | ログイン画面そのものを撮る（Googleのログインは保持される） |
| 画面なしの説明 | ステップに `"noShot": true` | Googleのログイン画面などこちらで撮れない場面を、説明カードとして手順に挟む |

## レシピの書き方

```jsonc
{
  "id": "login",
  "title": "はじめてログインする",
  "summary": "一覧に出る短い説明",
  "setup": { "fakeNow": "2026-09-05", "simulateRegister": true },
  "steps": [
    {
      "shot": "login-01",          // 画像のファイル名
      "goto": "login.html",        // baseUrl からの相対パス
      "do": [{ "click": "#btn" }], // 操作（click / fill / select / press / eval / wait）
      "waitFor": "#screen-main",   // この要素が出るまで待つ
      "highlight": "#g-btn",       // 枠で示す要素。座標は自動算出される
      "instruction": "「Googleでログイン」をタップします",
      "note": { "type": "info", "text": "補足。type は info か warn" }
    }
  ]
}
```

`highlight` は配列でも書ける（複数箇所を同時に示したいとき）。
`settle` でスクショ前の待ち時間をミリ秒で指定できる（既定 600ms）。

### ハイライトがずれるとき

**枠は「実体」を指す。ラッパーを指さない。**
Googleのログインボタンで実際にこれをやり、枠が左右14pxずつ大きい状態で撮れていた
（`#g-btn` は実ボタンを包む div だった → `#g-btn > div` が正しい）。
撮影時に「枠が中身より大きいです」と警告が出たら、子要素を指し直す。

**中身を測れない要素は `adjust` で詰める。**
Googleのボタンはクロスオリジンの iframe に描画されるため、外から測れる矩形と
見た目の下端が 4px ずれる。こういう場所は px で微調整する。

```jsonc
"highlight": "#g-btn > div",
"adjust": { "top": -1, "bottom": -4 }   // 各辺を px でずらす。正の値は右／下
```

補正値は勘で決めず、撮った画像から実測する（背景から浮いている色の範囲を調べれば分かる）。
