// ============================================================
// マニュアルの入口：対象者の出し分け
//
// マニュアルとアプリは同じ jw-utazu.github.io にあるため、
// アプリが localStorage に持っているログイン状態（pwgws_session）を読める。
// そこから「この人は責任者か・会計者か・区域係か」を問い合わせ、
// 関係のある対象者だけを並べる。
//
// これは表示の出し分けであって、アクセス制御ではない。
// このサイトは PUBLIC な GitHub Pages にあり、URL を直接開けば誰でも読める。
// 目的は「関係のない人が迷い込んで混乱しないようにする」こと。
//
// ログインしていないときは奉仕者向けだけを出す
// （初回ログインの手順はログインする前に必要なので、常に読める必要がある）。
// ============================================================

const API_URL  = 'https://nqtswiynoxawccldqcwi.supabase.co/functions/v1/api';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdHN3aXlub3hhd2NjbGRxY3dpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MzQxNjIsImV4cCI6MjA5ODMxMDE2Mn0.M-AnCBnXBI1FIyouoa5ttF6mb8PF2YqHfv180PqQWQU';

// アプリと共通のセッションキー（shift-form/js/session.js と同じ）
const PWGWS_SESSION_KEY = 'pwgws_session';

function currentEmail() {
  try {
    const s = JSON.parse(localStorage.getItem(PWGWS_SESSION_KEY) || 'null');
    return (s && s.email) ? String(s.email) : '';
  } catch (_) { return ''; }
}

async function fetchRoles(email) {
  const url = API_URL + '?action=getMyRoles&email=' + encodeURIComponent(email);
  const res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + ANON_KEY, 'apikey': ANON_KEY },
  });
  if (!res.ok) throw new Error('failed');
  return await res.json();
}

function show(roles) {
  // data-need を持つカードは、その権限があるときだけ出す。
  // 奉仕者向けと「色や記号の意味」は data-need を持たないので常に出る
  document.querySelectorAll('[data-need]').forEach((el) => {
    el.hidden = !roles[el.dataset.need];
  });
  document.getElementById('picks').classList.add('ready');
}

(async () => {
  const email = currentEmail();
  if (!email) { show({}); return; }
  try {
    const r = await fetchRoles(email);
    show(r && r.ok ? r : {});
  } catch (_) {
    // 通信できないときは奉仕者向けだけ。
    // 権限が取れないことを理由に何も出さないと、マニュアルが読めなくなってしまう
    show({});
  }
})();
