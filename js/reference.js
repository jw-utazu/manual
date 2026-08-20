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

  data.sections.forEach((sec) => {
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
