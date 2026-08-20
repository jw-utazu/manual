// ============================================================
// マニュアル用スクリーンショット撮影スクリプト
//
// recipes/<対象者>.json に書かれた手順どおりにアプリを操作し、
//   shots/<対象者>/<ショット名>.webp   … 画面画像
//   content/<対象者>.json              … ビューアが読むステップ定義
// を生成する。
//
// 使い方は README.md を参照。
//   node capture.mjs volunteer          対象者ぶん全部
//   node capture.mjs volunteer login    タスクを指定して撮り直す
//   node capture.mjs --login            ログイン用にブラウザだけ開く
//
// 【重要】説明文の原本はレシピ側にある。content/*.json と shots/ は生成物なので
// 直接編集しない。文言を直したいときも recipes/*.json を直して撮り直す。
// ============================================================
import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const PROFILE = path.join(HERE, '.profile')

// 本番の Edge Function。ここを通る全リクエストに demo=1 を差し込む
const API_HOST = 'nqtswiynoxawccldqcwi.supabase.co'

// 撮影に使う動作確認専用アカウント（supabase/functions/api/handlers_auth.ts の TEST_EMAIL）
const TEST_EMAIL = 'jw.utazu.test@gmail.com'

// ログイン状態を書き込むために開くページ。3アプリ共通のログイン画面
const SESSION_ORIGIN_PAGE = 'https://jw-utazu.github.io/shift-form/login.html'

// テストアカウントにだけ見えていて、ふつうの奉仕者の画面には出ないもの。
// これが写ったマニュアルは「自分の画面と違う」となって混乱のもとになるので、
// 撮影中は隠して一般の利用者と同じ見え方にそろえる。
// レシピ側で hide を書けば、対象を足せる
const HIDE_ALWAYS = [
  '#debugDatePanel',        // 疑似日付シミュレーション（🧪 実日付ボタン）
  '#pw-type-bar-form',      // 限定PWのタブ。テストアカウントは全タイプ見えてしまう
  '#wish-list-proxy-area',  // 代理送信の選び直し（架空の代理送信先が出る）
  '#proxy-area',            // 同上（希望フォーム側）
  '#test-limited-type-picker',
]

const DEVICES = {
  mobile:  { viewport: { width: 390, height: 844 },  deviceScaleFactor: 2, isMobile: true,  hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
}

const log = (...a) => console.log(...a)

// ------------------------------------------------------------
// ブラウザ起動：永続プロファイルを使う。
// テストアカウントへの Google ログインは人が一度手で済ませれば、以降ここに残る
// ------------------------------------------------------------
async function launch(device, headless) {
  return await chromium.launchPersistentContext(PROFILE, {
    headless,
    ...DEVICES[device],
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  })
}

// ログイン用にブラウザを開いて待つだけのモード
async function loginMode(baseUrl) {
  const ctx = await launch('mobile', false)
  const page = ctx.pages()[0] || await ctx.newPage()
  await page.goto(baseUrl)
  log('\nブラウザを開きました。テストアカウントでログインしてください。')
  log('ログインが終わったらブラウザを閉じてください。ログイン状態はプロファイルに残ります。')
  log('  プロファイル: ' + PROFILE + '\n')
  await ctx.waitForEvent('close', { timeout: 0 })
}

// ------------------------------------------------------------
// 1ステップぶんの操作を実行する
// ------------------------------------------------------------
async function runActions(page, actions = []) {
  for (const a of actions) {
    if (a.click)      await page.click(a.click)
    else if (a.fill)  await page.fill(a.fill[0], a.fill[1])
    else if (a.select)await page.selectOption(a.select[0], a.select[1])
    else if (a.press) await page.press(a.press[0], a.press[1])
    else if (a.eval)  await page.evaluate(a.eval)
    else if (a.wait)  await page.waitForTimeout(a.wait)
    else throw new Error('未知の操作: ' + JSON.stringify(a))
  }
}

// ハイライト枠の位置を、画像に対する相対座標（0〜1）で求める。
// セレクタから自動算出するので、UIが変わっても撮り直せば座標が追従する
async function hotspotsOf(page, highlight, viewport, adjust) {
  if (!highlight) return []
  const sels = Array.isArray(highlight) ? highlight : [highlight]
  // 各辺を px でずらす微調整。正の値は右／下方向。
  // 中身をこちらから測れない要素（クロスオリジンの iframe に描かれる
  // Googleのログインボタンなど）で、枠を見た目に合わせるために使う
  const a = adjust || {}
  const [dl, dt, dr, db] = [a.left || 0, a.top || 0, a.right || 0, a.bottom || 0]
  const out = []
  for (const sel of sels) {
    const el = page.locator(sel).first()
    try {
      await el.scrollIntoViewIfNeeded({ timeout: 3000 })
    } catch (_) { /* 固定要素などスクロール不要なものは無視 */ }
    const box = await el.boundingBox()
    if (!box) { log('  ! ハイライト対象が見つかりません: ' + sel); continue }

    // 「実体ではなくラッパーを指している」ことに気づけるようにする。
    // Googleのログインボタンで実際にこれをやってしまい、枠が左右に14pxずつ
    // 大きい状態で撮れていた（#g-btn は実ボタンを包む div だった）
    const loose = await el.evaluate((node) => {
      if (node.children.length !== 1) return null
      const b = node.getBoundingClientRect()
      const k = node.children[0].getBoundingClientRect()
      if (!k.width || !k.height) return null
      const dx = b.width - k.width, dy = b.height - k.height
      return (dx > 6 || dy > 6) ? { dx: Math.round(dx), dy: Math.round(dy) } : null
    })
    if (loose) {
      log('  ! 枠が中身より大きいです（横 ' + loose.dx + 'px / 縦 ' + loose.dy + 'px）: ' + sel)
      log('    ラッパーを指しているかもしれません。子要素を指すか adjust で詰めてください')
    }
    out.push({
      x: +((box.x + dl) / viewport.width).toFixed(4),
      y: +((box.y + dt) / viewport.height).toFixed(4),
      w: +((box.width  + dr - dl) / viewport.width).toFixed(4),
      h: +((box.height + db - dt) / viewport.height).toFixed(4),
    })
  }
  return out
}

// テストアカウントのログイン状態を置く／外す。
//
// Google は自動化ブラウザからのログインを弾くため、Googleの画面は通れない。
// だがこのアプリが localStorage に持つのは「誰でログインしたか」だけで、権限は
// 起動のたびにサーバー（action=auth）へ問い合わせる作りになっている
// （shift-form/js/session.js の冒頭コメントのとおり）。
// したがってセッションを置けば、テストアカウントとして正しい権限が返る。
// ログイン画面そのものを撮るときは on=false で外す
async function ensureSession(page, baseUrl, on) {
  // localStorage を触るには同一オリジンにいる必要がある。
  // 3つのアプリは同じ jw-utazu.github.io にあり localStorage を共有しているので、
  // 共通ログイン画面を開いて書けば admin でも shift-form でも有効になる
  // （admin 自体を先に開くと、セッションが無い状態で起動してログイン画面へ飛ばされる）
  const origin = new URL(baseUrl).origin
  if (!page.url().startsWith(origin)) {
    await page.goto(SESSION_ORIGIN_PAGE, { waitUntil: 'domcontentloaded' })
  }
  await page.evaluate(({ on, email }) => {
    try {
      if (on) {
        const acc = { email, name: 'テストアカウント', picture: '', savedAt: Date.now() }
        localStorage.setItem('pwgws_session', JSON.stringify(acc))
        localStorage.setItem('pwgws_accounts', JSON.stringify([acc]))
        localStorage.setItem('pwgws_relogin_done_1', '1')
      } else {
        localStorage.removeItem('pwgws_session')
        localStorage.removeItem('pwgws_accounts')
        localStorage.removeItem('adminUser')
        localStorage.removeItem('shiftapp_session')
      }
    } catch (_) {}
  }, { on, email: TEST_EMAIL })
}

// ------------------------------------------------------------
// 撮影本体
// ------------------------------------------------------------
async function capture(audience, onlyTask, headless) {
  const recipe = JSON.parse(await fs.readFile(path.join(HERE, 'recipes', audience + '.json'), 'utf8'))
  const device = recipe.device || 'mobile'
  const viewport = DEVICES[device].viewport
  const shotDir = path.join(ROOT, 'shots', audience)
  await fs.mkdir(shotDir, { recursive: true })

  const ctx = await launch(device, headless)

  // すべての API 呼び出しに demo=1 を付ける。
  // これが無いと実在メンバーの氏名が画面に出て、そのまま公開マニュアルに載ってしまう
  await ctx.route('**://' + API_HOST + '/**', (route) => {
    const u = new URL(route.request().url())
    u.searchParams.set('demo', '1')
    route.continue({ url: u.toString() })
  })

  // 隠す指定は CSS で入れる。DOM を消すとアプリ側の処理が転ぶことがあるため。
  // show は逆に、条件がそろわないと出ない要素を撮るために表示させる
  // （「アプリとして追加」はブラウザがインストール可能と判断したときだけ出るので、
  //   撮影用のブラウザでは出てこない）
  const hides = HIDE_ALWAYS.concat(recipe.hide || [])
  await ctx.addInitScript(({ sels, shows }) => {
    const css = sels.join(',') + '{display:none !important;}'
      + (shows.length ? shows.join(',') + '{display:flex !important;}' : '')
    const put = () => {
      if (document.getElementById('__capture_hide')) return
      const st = document.createElement('style')
      st.id = '__capture_hide'
      st.textContent = css
      document.head && document.head.appendChild(st)
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', put)
    else put()
  }, { sels: hides, shows: recipe.show || [] })

  const tasks = recipe.tasks.filter((t) => !onlyTask || t.id === onlyTask)
  if (!tasks.length) throw new Error('該当するタスクがありません: ' + onlyTask)

  const outTasks = []
  let page = null
  for (const task of tasks) {
    log('\n■ ' + task.id + ' — ' + task.title)

    // タスクごとにページを作り直す。
    // addInitScript はページに積み上がっていき、あとから外せない。
    // 使い回すと前のタスクの setup（「未登録状態を試す」など）が次のタスクにも
    // 効いてしまい、まとめて撮ったときだけ失敗する
    if (page) await page.close()
    page = await ctx.newPage()

    // setup をページ読み込み前に仕込む。
    // fakeNow は「申込受付中」「公開後」など撮りたい時期を作るために使う
    const setup = task.setup || {}
    await page.addInitScript((s) => {
      try {
        if (s.fakeNow) localStorage.setItem('debugFakeNow', s.fakeNow)
        else localStorage.removeItem('debugFakeNow')
        if (s.simulateRegister) sessionStorage.setItem('debugSimulateRegisterOnce', '1')
      } catch (_) {}
    }, setup)

    const steps = []
    for (const [i, step] of task.steps.entries()) {
      const no = String(i + 1).padStart(2, '0')
      const shotName = step.shot || (task.id + '-' + no)
      log('  ' + no + ' ' + (step.noShot ? '(画面なし)' : shotName))

      // 画面を持たないステップ（Google のログイン画面など、こちらで撮れないもの）。
      // 手順の流れを切らさないために、説明だけのカードとして残す
      if (step.noShot) {
        steps.push({
          instruction: step.instruction || '',
          ...(step.note ? { note: step.note } : {}),
        })
        continue
      }

      // アプリ側のログイン状態だけを捨てる（Google の Cookie は残すので再ログインは不要）。
      // ログイン画面そのものを撮るために使う
      if (step.clearSession) {
        await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch (_) {} })
      }
      if (step.session !== undefined) await ensureSession(page, recipe.baseUrl, step.session)
      if (step.goto) {
        const url = new URL(step.goto, recipe.baseUrl).toString()
        await page.goto(url, { waitUntil: 'domcontentloaded' })
      }
      await runActions(page, step.do)
      if (step.waitFor) await page.waitForSelector(step.waitFor, { timeout: 15000 })
      // 画面遷移のアニメーションやオーバーレイの解除を待つ
      await page.waitForTimeout(step.settle ?? 600)

      // 画面の文字を撮影用に差し替える。
      // アプリが JS で書き込む値（ログイン中のメールアドレスなど）は
      // サーバー側のデモモードを通らないため、ここで置き換える。
      // アプリの描画が終わったあとに当てる必要があるので、撮る直前に実行する
      if (recipe.text) {
        await page.evaluate((map) => {
          for (const [sel, val] of Object.entries(map)) {
            document.querySelectorAll(sel).forEach((e) => { e.textContent = val })
          }
        }, recipe.text)
      }

      const hotspots = await hotspotsOf(page, step.highlight, viewport, step.adjust)
      // ハイライト対象を画面に入れるためにスクロールが起きることがある。
      // 動いている最中に撮ろうとすると安定待ちで止まるので、落ち着くまで待つ
      await page.waitForTimeout(400)
      const png = path.join(shotDir, shotName + '.png')
      // animations:'disabled' を付けないと、アプリ側の読み込みスピナーなどが
      // 回り続けている間ずっと待たされて撮影がタイムアウトする
      await page.screenshot({ path: png, animations: 'disabled', timeout: 60000 })

      steps.push({
        shot: 'shots/' + audience + '/' + shotName + '.webp',
        instruction: step.instruction || '',
        ...(step.note ? { note: step.note } : {}),
        ...(hotspots.length ? { hotspots } : {}),
      })
    }
    outTasks.push({ id: task.id, title: task.title, summary: task.summary || '', steps })
  }

  await ctx.close()

  // content/*.json を更新する。
  // タスク指定で撮り直したときは、そのタスクだけ差し替えて他は残す
  const contentPath = path.join(ROOT, 'content', audience + '.json')
  let content = { audience, title: recipe.title, device, tasks: [] }
  try {
    content = JSON.parse(await fs.readFile(contentPath, 'utf8'))
    content.title = recipe.title
    content.device = device
  } catch (_) { /* 初回は新規作成 */ }

  for (const t of outTasks) {
    const at = content.tasks.findIndex((x) => x.id === t.id)
    if (at >= 0) content.tasks[at] = t
    else content.tasks.push(t)
  }
  // レシピの並び順に揃える（撮り直しで順序が崩れないように）
  const order = recipe.tasks.map((t) => t.id)
  content.tasks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))

  await fs.mkdir(path.join(ROOT, 'content'), { recursive: true })
  await fs.writeFile(contentPath, JSON.stringify(content, null, 2) + '\n', 'utf8')
  log('\n生成: ' + path.relative(ROOT, contentPath))

  // PNG を WebP へ変換して容量を落とす（Pillow を使う）
  // PCの画面はそのまま 750px に縮めると文字が読めなくなるので、幅を広く取る
  const outW = device === 'desktop' ? 1200 : 750
  const r = spawnSync('python', [path.join(HERE, 'to_webp.py'), shotDir, String(outW)], { stdio: 'inherit' })
  if (r.status !== 0) {
    log('! WebP 変換に失敗しました。PNG のまま残っています。')
    log('  python と Pillow が使えるか確認してください（python -c "import PIL"）')
  }

  log('\n--------------------------------------------------------')
  log('撮影が終わりました。公開する前に必ず全画像を目視で確認し、')
  log('実名・実メールアドレスが写っていないことを確かめてください。')
  log('（demo=1 の自動置換だけを信用しないこと）')
  log('--------------------------------------------------------')
}

// ------------------------------------------------------------
const args = process.argv.slice(2)
const headless = !args.includes('--headed')
const rest = args.filter((a) => !a.startsWith('--'))

if (args.includes('--login')) {
  const recipe = JSON.parse(await fs.readFile(path.join(HERE, 'recipes', rest[0] || 'volunteer') + '.json', 'utf8'))
  await loginMode(recipe.baseUrl)
} else if (!rest.length) {
  console.error('対象者を指定してください。例: node capture.mjs volunteer')
  process.exit(1)
} else {
  await capture(rest[0], rest[1], headless)
}
