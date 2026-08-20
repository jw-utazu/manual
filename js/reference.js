// ============================================================
// リファレンス（色分け・用語・よくある質問）
// 手順ではない「意味の説明」をまとめて置く。
// ウォークスルーの各ステップからもここへリンクする。
// ============================================================
const app = document.getElementById('app');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function renderLegend(items) {
  const list = el('div', 'legend');
  items.forEach((it) => {
    const row = el('div', 'legend-row');
    const chip = el('span', 'legend-chip', 'あ');
    chip.style.background = it.color;
    if (it.text) chip.style.color = it.text;
    row.appendChild(chip);
    const body = el('div', 'legend-body');
    body.appendChild(el('div', 'legend-label', it.label));
    body.appendChild(el('div', 'legend-desc', it.desc));
    row.appendChild(body);
    list.appendChild(row);
  });
  return list;
}

function renderFaq(items) {
  const list = el('div');
  items.forEach((it) => {
    const d = el('details', 'faq');
    d.appendChild(el('summary', 'faq-q', it.q));
    d.appendChild(el('div', 'faq-a', it.a));
    list.appendChild(d);
  });
  return list;
}

function renderTerms(items) {
  const list = el('div');
  items.forEach((it) => {
    const row = el('div', 'term');
    row.appendChild(el('div', 'term-name', it.term));
    row.appendChild(el('div', 'term-desc', it.desc));
    list.appendChild(row);
  });
  return list;
}

// need を持つセクションは、その権限のある人にだけ見せる。
// 入口（js/index.js）と同じ仕組みで、アプリのログイン状態から権限を問い合わせる。
// これは表示の出し分けであってアクセス制御ではない
const API_URL  = 'https://nqtswiynoxawccldqcwi.supabase.co/functions/v1/api';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdHN3aXlub3hhd2NjbGRxY3dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MzQxNjIsImV4cCI6MjA5ODMxMDE2Mn0.M-AnCBnXBI1FIyouoa5ttF6mb8PF2YqHfv180PqQWQU';

async function myRoles() {
  try {
    const s = JSON.parse(localStorage.getItem('pwgws_session') || 'null');
    if (!s || !s.email) return {};
    const res = await fetch(API_URL + '?action=getMyRoles&email=' + encodeURIComponent(s.email),
      { headers: { 'Authorization': 'Bearer ' + ANON_KEY, 'apikey': ANON_KEY } });
    if (!res.ok) return {};
    const r = await res.json();
    return (r && r.ok) ? r : {};
  } catch (_) { return {}; }
}

async function main() {
  const wrap = el('div', 'wrap');
  wrap.style.paddingTop = '16px';
  wrap.style.paddingBottom = '32px';

  let data;
  try {
    const res = await fetch('content/reference.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error();
    data = await res.json();
  } catch (_) {
    wrap.appendChild(el('div', 'msg', '読み込めませんでした。'));
    app.replaceChildren(wrap);
    return;
  }

  const roles = await myRoles();

  data.sections.filter((sec) => !sec.need || roles[sec.need]).forEach((sec) => {
    wrap.appendChild(el('div', 'sec-title', sec.title));
    const card = el('div', 'card');
    if (sec.type === 'legend')      card.appendChild(renderLegend(sec.items));
    else if (sec.type === 'faq')    card.appendChild(renderFaq(sec.items));
    else if (sec.type === 'terms')  card.appendChild(renderTerms(sec.items));
    wrap.appendChild(card);
  });

  app.replaceChildren(wrap);
}

main();
