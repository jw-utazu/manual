// ============================================================
// ウォークスルー・ビューア
//
// content/<対象者>.json を読み、1ステップ＝1画面で表示する。
// 利用者は自分のスマホ画面と見比べながら「次へ」で進む。
//
// URL は #/対象者/タスク/ステップ番号 の形。
//   #/volunteer            … タスク一覧
//   #/volunteer/login      … タスクの最初（続きがあればそこから）
//   #/volunteer/login/3    … 3ステップ目を直接開く
// ============================================================

const AUD = {
  volunteer:   { icon: '🙋', name: '奉仕者向け' },
  responsible: { icon: '📋', name: '責任者向け' },
  pdf:         { icon: '📄', name: '道路使用許可書 担当者向け' },
  admin:       { icon: '⚙️', name: '区域係向け' },
};

const app  = document.getElementById('app');
const nav  = document.getElementById('nav');
const hdrT = document.getElementById('hdr-title');
const hdrB = document.getElementById('hdr-back');

const cache = {};

// ---- 進捗（どこまで見たか）--------------------------------
const posKey  = (a, t) => 'pwman.pos.'  + a + '.' + t;
const doneKey = (a, t) => 'pwman.done.' + a + '.' + t;

function savePos(a, t, i) {
  try { localStorage.setItem(posKey(a, t), String(i)); } catch (_) {}
}
function loadPos(a, t) {
  try { return parseInt(localStorage.getItem(posKey(a, t)) || '0', 10) || 0; } catch (_) { return 0; }
}
function markDone(a, t) {
  try { localStorage.setItem(doneKey(a, t), '1'); localStorage.removeItem(posKey(a, t)); } catch (_) {}
}
function isDone(a, t) {
  try { return localStorage.getItem(doneKey(a, t)) === '1'; } catch (_) { return false; }
}

// ---- 小道具 ------------------------------------------------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function noteBox(note) {
  const box = el('div', 'note note-' + (note.type === 'warn' ? 'warn' : 'info'));
  box.appendChild(el('span', 'note-icon', note.type === 'warn' ? '⚠️' : 'ℹ️'));
  box.appendChild(el('span', null, note.text));
  return box;
}

async function loadContent(aud) {
  if (cache[aud]) return cache[aud];
  const res = await fetch('content/' + aud + '.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('not_found');
  cache[aud] = await res.json();
  return cache[aud];
}

// ---- 画面：タスク一覧 --------------------------------------
function renderList(content) {
  const aud = content.audience;
  hdrT.textContent = content.title || AUD[aud].name;
  hdrB.textContent = '← 対象者を選ぶ';
  hdrB.onclick = () => { location.href = 'index.html'; };
  hdrB.hidden = false;
  nav.hidden = true;

  const wrap = el('div', 'wrap');
  wrap.style.paddingTop = '16px';
  wrap.appendChild(el('p', 'lead', 'やりたいことを選んでください。画面を見ながら1つずつ進められます。'));

  content.tasks.forEach((task, i) => {
    const b = el('button', 'task');
    b.appendChild(el('span', 'task-no', String(i + 1)));

    const body = el('div', 'task-body');
    body.appendChild(el('div', 'task-name', task.title));
    if (task.summary) body.appendChild(el('div', 'task-sub', task.summary));
    b.appendChild(body);

    const pos = loadPos(aud, task.id);
    if (isDone(aud, task.id)) {
      b.appendChild(el('span', 'task-badge', '✓ 済'));
    } else if (pos > 0) {
      b.appendChild(el('span', 'task-badge resume', '続きから'));
    }

    b.onclick = () => { location.hash = '#/' + aud + '/' + task.id; };
    wrap.appendChild(b);
  });

  // 手順ではない説明（色分け・バッジ・用語・よくある質問）への導線
  const ref = el('a', 'pick');
  ref.href = 'reference.html';
  ref.appendChild(el('span', 'pick-icon', '📖'));
  const rb = el('div', 'pick-body');
  rb.appendChild(el('div', 'pick-name', '色や記号の意味を調べる'));
  rb.appendChild(el('div', 'pick-sub', '画面の色分け・バッジ・よくある質問'));
  ref.appendChild(rb);
  ref.appendChild(el('span', 'pick-arr', '›'));
  ref.style.marginTop = '20px';
  wrap.appendChild(ref);

  app.replaceChildren(wrap);
  window.scrollTo(0, 0);
}

// ---- 画面：ステップ ----------------------------------------
function renderStep(content, task, idx) {
  const aud = content.audience;
  const step = task.steps[idx];
  const total = task.steps.length;

  hdrT.textContent = task.title;
  hdrB.textContent = '← 一覧';
  hdrB.onclick = () => { location.hash = '#/' + aud; };
  hdrB.hidden = false;

  const wrap = el('div', 'wrap');

  // 進捗
  const pw = el('div', 'prog-wrap');
  const row = el('div', 'prog-row');
  row.appendChild(el('span', null, task.title));
  row.appendChild(el('span', null, (idx + 1) + ' / ' + total));
  pw.appendChild(row);
  const bar = el('div', 'prog-bar');
  const fill = el('div', 'prog-fill');
  fill.style.width = Math.round(((idx + 1) / total) * 100) + '%';
  bar.appendChild(fill);
  pw.appendChild(bar);
  wrap.appendChild(pw);

  // 先に「何をするか」を読ませ、そのあとで画面を見せる。
  // 画像が先だと、どこを見ればよいか分からないまま眺めることになるため
  const instr = el('div', 'instr');
  instr.appendChild(el('span', 'instr-no', String(idx + 1)));
  instr.appendChild(el('span', null, step.instruction || ''));
  wrap.appendChild(instr);

  if (step.note) {
    const n = noteBox(step.note);
    n.classList.add('instr-note');
    wrap.appendChild(n);
  }

  // 画面画像（撮れない場面は説明カードで代替する）
  if (step.shot) {
    const sw = el('div', 'shot-wrap');
    const img = el('img');
    img.src = step.shot;
    img.alt = step.instruction || ('ステップ' + (idx + 1) + 'の画面');
    sw.appendChild(img);
    // 枠は要素より一回り大きく描く。
    // 余白を % で足すと横は画像の幅・縦は高さが基準になり、
    // 同じ数値でも上下と左右で実際の太さが変わってしまう。
    // 四辺を同じ幅にするため px で広げる。
    // 脈動でさらに 4px 開くので、静止時はこれくらいで足りる（最大 8px）
    const PAD = 4;
    (step.hotspots || []).forEach((h) => {
      const hot = el('div', 'hot');
      hot.style.left   = 'calc(' + (h.x * 100) + '% - ' + PAD + 'px)';
      hot.style.top    = 'calc(' + (h.y * 100) + '% - ' + PAD + 'px)';
      hot.style.width  = 'calc(' + (h.w * 100) + '% + ' + (PAD * 2) + 'px)';
      hot.style.height = 'calc(' + (h.h * 100) + '% + ' + (PAD * 2) + 'px)';
      sw.appendChild(hot);
    });
    wrap.appendChild(sw);
  } else {
    const ns = el('div', 'noshot');
    ns.appendChild(el('div', 'noshot-icon', '📱'));
    ns.appendChild(el('div', 'noshot-cap', 'ここはアプリの外の画面です'));
    wrap.appendChild(ns);
  }

  app.replaceChildren(wrap);

  // 下部固定ナビ
  nav.replaceChildren();
  const prev = el('button', 'prev', '← 戻る');
  prev.disabled = idx === 0;
  prev.onclick = () => { location.hash = '#/' + aud + '/' + task.id + '/' + idx; };

  const next = el('button', 'next', idx === total - 1 ? 'できました 🎉' : '次へ →');
  next.onclick = () => {
    if (idx === total - 1) {
      markDone(aud, task.id);
      renderDone(content, task);
    } else {
      location.hash = '#/' + aud + '/' + task.id + '/' + (idx + 2);
    }
  };
  nav.appendChild(prev);
  nav.appendChild(next);
  nav.hidden = false;

  savePos(aud, task.id, idx + 1);
  window.scrollTo(0, 0);
}

// ---- 画面：完了 --------------------------------------------
function renderDone(content, task) {
  const aud = content.audience;
  nav.hidden = true;
  hdrT.textContent = task.title;

  const wrap = el('div', 'wrap');
  const d = el('div', 'done');
  d.appendChild(el('div', 'done-icon', '🎉'));
  d.appendChild(el('div', 'done-title', 'できました'));
  d.appendChild(el('div', 'done-sub', '「' + task.title + '」はこれで終わりです。'));

  const back = el('button', 'pick');
  back.appendChild(el('span', 'pick-icon', '📋'));
  const bb = el('div', 'pick-body');
  bb.appendChild(el('div', 'pick-name', 'ほかの操作を見る'));
  bb.appendChild(el('div', 'pick-sub', content.title + 'の一覧に戻ります'));
  back.appendChild(bb);
  back.appendChild(el('span', 'pick-arr', '›'));
  back.onclick = () => { location.hash = '#/' + aud; };

  d.appendChild(back);
  wrap.appendChild(d);
  app.replaceChildren(wrap);
  window.scrollTo(0, 0);
}

// ---- ルーティング ------------------------------------------
function showMessage(text) {
  nav.hidden = true;
  const w = el('div', 'wrap');
  w.appendChild(el('div', 'msg', text));
  app.replaceChildren(w);
}

async function route() {
  const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  const aud = parts[0];

  if (!aud || !AUD[aud]) { location.href = 'index.html'; return; }

  document.body.dataset.device = 'mobile';
  showMessage('読み込み中...');

  let content;
  try {
    content = await loadContent(aud);
  } catch (_) {
    showMessage('このマニュアルはまだ準備中です。');
    return;
  }
  document.body.dataset.device = content.device || 'mobile';

  if (!parts[1]) { renderList(content); return; }

  const task = content.tasks.find((t) => t.id === parts[1]);
  if (!task || !task.steps.length) { location.hash = '#/' + aud; return; }

  // ステップ番号が無いときは、前回の続きから開く
  let idx;
  if (parts[2]) {
    idx = parseInt(parts[2], 10) - 1;
  } else {
    const pos = loadPos(aud, task.id);
    idx = pos > 0 && pos < task.steps.length ? pos : 0;
  }
  if (!(idx >= 0) || idx >= task.steps.length) idx = 0;

  renderStep(content, task, idx);
}

window.addEventListener('hashchange', route);
route();
