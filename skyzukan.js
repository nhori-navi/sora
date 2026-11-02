// skyzukan.js：空の図鑑（v46。ミルトコの「空の帳」の中身。app.js・ui.js のあとに読む）
// ・月のカード8枚（新月・三日月・上弦の月・十三夜・満月・寝待月・下弦の月・有明の月＝moonPhaseName と同じ名前）と、星座のカード30枚（constellations.js の CONSTEL）
// ・月：空に向けた画面で月に照準を2秒合わせると、その夜の月齢のカードが入る。新月は見えないので、新月の日に星座を見つけるか惑星に2秒合わせると入る
// ・星座：今ある「星座を見つけた！」（conFound）をそのまま使う（新しい操作はない）
// ・置き場所 sora_skyz_v1 {moon:{名前:{t,d}}, con:{略号:{t,d}}}。sora_day_v1 は30日で消えるので、ずっと残す帳はこちら
//   初めて読み込んだときと開くたびに、sora_day_v1 の days[*].con から星座を拾い直す（取りこぼしがないように）
//   月は sora_day_v1 の days[その日].moon {ph,t} にも書く（ミルトコ toko 版6 がそこを数えるため）
// ・MichiMiru の「4つのアプリの控え」と TenMiru の「記録を書き出す」は sora_ で始まるものを全部入れるので、そのまま入る
// ・仕掛け：app.js の moonPhaseName()（引数なしで呼ばれるのは空に向けた画面の月の表示だけ）と brightRank(s)（惑星の表示だけ）を包んで「照準に入っている」を知る。
//   conFound を包んで星座を帳に入れる。どれも app.js の function 宣言なので、あとから差し替えられる
(window.SORA_FV = window.SORA_FV || {}).skyz = 46;
(function () {
  const K = 'sora_skyz_v1', HOLD = 2000, GAP = 700;
  const MOONS = [['新月', '🌑', 0], ['三日月', '🌒', 45], ['上弦の月', '🌓', 90], ['十三夜', '🌔', 135], ['満月', '🌕', 180], ['寝待月', '🌖', 225], ['下弦の月', '🌗', 270], ['有明の月', '🌘', 315]];
  const SEASONS = [['冬', '冬の星座'], ['春', '春の星座'], ['夏', '夏の星座'], ['秋', '秋の星座'], ['北', '北の空（一年中）']];
  let skyz = lsGet(K, null); if (!skyz || typeof skyz !== 'object') skyz = {};
  skyz.moon = skyz.moon || {}; skyz.con = skyz.con || {};
  const save = () => lsSet(K, skyz);
  const total = () => MOONS.length + CONSTEL.length;
  const count = () => ({moon: MOONS.filter(m => skyz.moon[m[0]]).length, con: CONSTEL.filter(c => skyz.con[c[0]]).length});
  const md = d => d ? d.slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/') : '';

  // 今日の空（30日分）から星座を拾い直す
  function backfill() {
    let ch = false;
    try {
      Object.entries(skyDays.days).forEach(([d, D]) => (D && D.con || []).forEach(c => {
        if (!c || !c.id) return;
        const cur = skyz.con[c.id];
        if (!cur || (c.t && c.t < cur.t)) { skyz.con[c.id] = {t: c.t || Date.now(), d}; ch = true; }
      }));
    } catch (e) {}
    if (ch) save();
  }
  backfill();

  function toastAdd(txt) {
    const n = count();
    alertMsg(`${txt}　空の帳 ${n.moon + n.con}／${total()}`, null, false);
    $('toast').classList.add('con');
    tileStat();
    if ($('skyz') && $('skyz').style.display === 'block') render();
  }
  function addMoon(ph, t) {
    if (!MOONS.some(m => m[0] === ph)) return false;
    try { const D = dayGet(); D.moon = {ph, t}; daySave(true); } catch (e) {}   // ミルトコ（toko 版6）が数える方
    if (skyz.moon[ph]) return false;
    skyz.moon[ph] = {t, d: today()}; save();
    toastAdd(`月のカード「${ph}」が入った！`);
    return true;
  }
  function addCon(id, t) {
    if (skyz.con[id]) return false;
    skyz.con[id] = {t, d: today()}; save();
    return true;
  }
  const isNewMoonDay = t => moonPhaseName(t || Date.now()) === '新月';

  // ---------- 星座を見つけたとき ----------
  const conFoundBase = conFound;
  conFound = function (c, now) {
    const had = conFoundAt(c.id, now);
    conFoundBase(c, now);
    if (had) return;
    const added = addCon(c.id, now);
    if (added) { const n = count(); $('toast').textContent += `　空の帳 ${n.moon + n.con}／${total()}`; tileStat(); }
    if (isNewMoonDay(now) && !skyz.moon['新月']) setTimeout(() => addMoon('新月', now), 1200);
  };

  // ---------- 月・惑星に照準を合わせている間 ----------
  const hold = {moon: null, planet: null};
  function step(kind, now) {
    const h = hold[kind];
    if (!h || now - h.last > GAP) { hold[kind] = {t0: now, last: now, done: false}; return 0; }
    h.last = now;
    return Math.min(1, (now - h.t0) / HOLD);
  }
  const moonPhaseBase = moonPhaseName;
  moonPhaseName = function (t) {
    const name = moonPhaseBase(t);
    if (t !== undefined || !sky) return name;          // 引数なし＝空に向けた画面の月の表示
    const now = Date.now(), k = step('moon', now);
    if (skyz.moon[name]) return name + '・図鑑にあり';
    if (k >= 1) { if (!hold.moon.done) { hold.moon.done = true; addMoon(name, now); } return name; }
    return `${name}・図鑑に入れる ${Math.round(k * 100)}%`;
  };
  const brightRankBase = brightRank;
  brightRank = function (s) {
    const r = brightRankBase(s);
    if (sky && s && s.kind === 'planet' && isNewMoonDay() && !skyz.moon['新月']) {
      const now = Date.now(), k = step('planet', now);
      if (k >= 1 && !hold.planet.done) { hold.planet.done = true; addMoon('新月', now); }
    }
    return r;
  };

  // ---------- 画面 ----------
  const st = document.createElement('style');
  st.textContent = `
#skyz{display:none;position:fixed;top:0;left:0;right:0;bottom:0;z-index:20;background:#fff;overflow:auto;padding:12px;font-size:15px;line-height:1.55}
body.dark #skyz{background:var(--bg);color:var(--text)}
#skyz .sech{margin:14px 0 6px;font-weight:bold;color:var(--acc)}
#skyz .sech small{font-weight:normal;color:var(--sub,#777);margin-left:6px}
.szg{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.szc{position:relative;border:1px solid var(--line,#ddd);border-radius:12px;padding:8px 4px 6px;text-align:center;background:var(--card,#fff);line-height:1.35;font-size:12px;min-height:84px}
.szc .e{display:block;font-size:30px;line-height:1.2}
.szc .n{display:block;font-weight:bold;font-size:12.5px;margin-top:2px}
.szc .s{display:block;font-size:11px;color:var(--sub,#777)}
.szc.no{border-style:dashed;color:var(--sub,#777)}
.szc.no .e{filter:grayscale(1);opacity:.28}
.szc.no .n{font-weight:normal}
.szc.got{border-color:#d4a017;box-shadow:0 0 0 1px #f3d36b inset}
.szc .hard{color:#a12d22}
body.dark .szc .hard{color:#ff9b8f}
#skyzSum{font-size:14px;margin:4px 0 2px}
#skyzSum b{font-size:20px;color:var(--acc)}
.szTonight{margin:4px 0 0;padding:8px 10px;border-radius:10px;background:var(--card,#f5f7fb);border:1px solid var(--line,#ddd);font-size:13px}
body.dark .szTonight{background:#1a2440}
#tile-skyz .i{color:#1f3b73}`;
  document.head.appendChild(st);
  const box = document.createElement('div'); box.id = 'skyz';
  box.innerHTML = '<div class="ovh"><button id="skyzClose">← 閉じる</button><b>空の図鑑</b><span class="sp"></span></div>' +
    '<div id="skyzSum"></div><div class="small">空に向けた画面で、月に照準を2秒合わせると月のカードが、星座の線をとらえると星座のカードが入ります。見えない季節のカードは、その季節まで影のままです。</div>' +
    '<div id="skyzBody"></div>' +
    '<div class="ovfoot"><div class="small">記録の管理（消したものは元に戻せません）</div><button id="skyzReset" class="reset">空の図鑑を消す</button></div>';
  document.body.appendChild(box);

  // 次にその月齢になる日（Astronomy Engine。今の月齢なら「今夜」）
  function nextPhase(ang) {
    try {
      const now = new Date();
      if (moonPhaseBase(now.getTime()) === MOONS.find(m => m[2] === ang)[0]) return '今夜';
      const a = Astronomy.SearchMoonPhase(ang, now, 40);
      return a ? md(ymd(a.date)) : '';
    } catch (e) { return ''; }
  }
  function render() {
    const n = count();
    $('skyzSum').innerHTML = `空の帳 <b>${n.moon + n.con}</b>／${total()}　<span class="small">月 ${n.moon}／${MOONS.length}・星座 ${n.con}／${CONSTEL.length}</span>`;
    let h = '';
    // 今夜の月
    try {
      const ph = moonPhaseBase(Date.now()), got = skyz.moon[ph];
      h += `<div class="szTonight">今夜の月は <b>${esc(ph)}</b>${ph === '新月' ? '（見えません。今夜、星座か惑星を見つけるとカードが入ります）' : got ? '（カードはもうあります）' : '。空に向けて、月に照準を2秒合わせるとカードが入ります'}</div>`;
    } catch (e) {}
    h += `<div class="sech">月 <small>${n.moon}／${MOONS.length}</small></div><div class="szg">` + MOONS.map(([nm, e, ang]) => {
      const g = skyz.moon[nm];
      return g ? `<div class="szc got"><span class="e">${e}</span><span class="n">${esc(nm)}</span><span class="s">${md(g.d)}</span></div>`
        : `<div class="szc no"><span class="e">${e}</span><span class="n">${esc(nm)}</span><span class="s">${nextPhase(ang) ? '次は ' + nextPhase(ang) : ''}</span></div>`;
    }).join('') + '</div>';
    SEASONS.forEach(([sk, label]) => {
      const L = CONSTEL.filter(c => c[2] === sk), got = L.filter(c => skyz.con[c[0]]).length;
      h += `<div class="sech">${label} <small>${got}／${L.length}</small></div><div class="szg">` + L.map(c => {
        const g = skyz.con[c[0]], hard = c[3] === 1 ? '<span class="hard">むずかしい</span>' : '';
        return g ? `<div class="szc got"><span class="e">✨</span><span class="n">${esc(c[1])}</span><span class="s">${md(g.d)}</span></div>`
          : `<div class="szc no"><span class="e">✨</span><span class="n">${esc(c[1])}</span><span class="s">${sk === '北' ? '' : sk + 'に'}${hard ? (sk === '北' ? '' : '・') + hard : ''}</span></div>`;
      }).join('') + '</div>';
    });
    $('skyzBody').innerHTML = h;
  }
  const isOpen = () => box.style.display === 'block';
  const openBase = () => { render(); box.style.display = 'block'; box.scrollTop = 0; };
  const closeBase = () => { box.style.display = 'none'; };
  function open() { if (isOpen()) return; openBase(); try { navPush('skyz', isOpen, closeBase); } catch (e) {} }
  function close() { try { navClose('skyz', closeBase); } catch (e) { closeBase(); } }
  $('skyzClose').onclick = close;
  $('skyzReset').onclick = () => {
    if (!confirm('空の図鑑（月と星座のカード）をすべて消します。よろしいですか？')) return;
    skyz = {moon: {}, con: {}}; save(); render(); tileStat();
  };
  window.skyzOpen = open;   // ミルトコ（toko）から ?open=skyz で開くときに使う

  // 記録タブのタイル（ui.js のタイルの並びの、バッジの次）
  function tileStat() {
    const e = $('tileS-skyz'); if (!e) return;
    const n = count(); e.textContent = `月 ${n.moon}／${MOONS.length}・星座 ${n.con}／${CONSTEL.length}`;
  }
  function addTile() {
    const grid = document.querySelector('#tab-rec .tiles'); if (!grid || $('tile-skyz')) return;
    const t = document.createElement('div'); t.id = 'tile-skyz'; t.className = 'tile';
    t.innerHTML = '<div class="i">🌙</div><div class="n">空の図鑑</div><div class="s" id="tileS-skyz"></div>';
    t.onclick = open;
    const after = $('tile-badge'); if (after && after.nextSibling) grid.insertBefore(t, after.nextSibling); else grid.appendChild(t);
    tileStat();
  }
  addTile(); setTimeout(addTile, 1500);
  setInterval(tileStat, 5000);
  // ?open=skyz で開いたときは図鑑を出す
  try { if (/[?&]open=skyz/.test(location.search)) setTimeout(open, 800); } catch (e) {}
})();
