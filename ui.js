// SoraMiru の画面の骨組み（v35 → v36）：下のタブ（空・記録・空に向ける・よその空・設定）、空に向けた画面の操作の並べ替え、見た目
// v36：よその空の帯を「空」タブの一番上へ／夜は暗い画面（設定で 自動・いつも明るい・いつも暗い）／地図と一覧の境目を指でずらす／
//      記録の画面の見出しを固定・「記録を消す」を下へ
// app.js のあと、help.js の前に読む。部品の id は変えずに置き場所だけを動かすので、app.js の動きはそのまま
(function () {
  const el = (tag, attrs, html) => { const e = document.createElement(tag); Object.assign(e, attrs || {}); if (html != null) e.innerHTML = html; return e; };
  const panel = $('panel');

  // ---------- 見た目 ----------
  document.head.appendChild(el('style', {}, `
:root{--navy:#1f3b73;--acc:#1f3b73;--blue:#1f6fd1;--line:#d5dceb;--bg:#f4f6fa;--card:#fff;--text:#222;--sub:#667;--tab:64px;--split:42%}
body{background:var(--bg)}
#map{height:var(--split)}
#panel{top:var(--split);bottom:var(--tab);background:var(--bg);padding:14px 10px 14px;border-top:none;box-shadow:0 -2px 8px rgba(0,0,0,.12)}
#panel button,#zukan button,#cities button,#day button,#badge button,#yoso button,#share button,#helpBox button{min-height:38px;padding:7px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;color:#223;font-size:15px}
#panel button.on{background:#c0392b;color:#fff;border-color:#c0392b}
#panel button.pri,.ovh button.pri{background:var(--navy);color:#fff;border-color:var(--navy)}
#panel .qb,.qb{min-height:0 !important;width:24px;height:24px;padding:0 !important;border-radius:50% !important}
#panel select{min-height:34px;border:1px solid var(--line);border-radius:17px;background:#fff;padding:3px 10px}
#panel label{display:inline-flex;align-items:center;gap:4px;min-height:36px;margin-right:10px}
#panel input[type=checkbox]{width:20px;height:20px}
.card{border-radius:12px;border-color:var(--line);border-left-color:var(--blue);box-shadow:0 1px 3px rgba(0,0,0,.06)}
#toast{top:6px;padding:7px 14px;border-radius:18px;font-size:14px;line-height:1.45;max-width:88%}
/* 下のタブ */
#tabbar{position:fixed;left:0;right:0;bottom:0;height:var(--tab);z-index:15;display:grid;grid-template-columns:repeat(5,1fr);align-items:end;background:#fff;border-top:1px solid var(--line);box-shadow:0 -2px 8px rgba(0,0,0,.08);padding-bottom:env(safe-area-inset-bottom)}
#tabbar button{position:relative;border:none;background:none;height:var(--tab);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:11px;color:#667;padding:0;margin:0}
#tabbar button .i{font-size:22px;line-height:1}
#tabbar button.cur{color:var(--acc);font-weight:bold}
#tabbar button.cur .i{transform:scale(1.1)}
#tb-yoso.away::after{content:'';position:absolute;top:9px;left:calc(50% + 7px);width:10px;height:10px;border-radius:50%;background:#2ecc71;border:2px solid #fff}
#skyFab{position:relative}
#skyFab .fab{width:62px;height:62px;margin-top:-26px;border-radius:50%;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;box-shadow:0 3px 10px rgba(31,59,115,.45);border:3px solid #fff}
#skyFab .t{font-size:11px;color:var(--acc);font-weight:bold}
body.skyOn #skyFab .fab{background:#c0392b}
body.skyOn #skyFab .t{color:#c0392b}
.tabsec{display:none}
.tabsec.cur{display:block}
body.skyOn .tabsec{display:none !important}
#oldBtns{display:none}
/* 地図と一覧の境目のつまみ */
#grip{position:absolute;left:50%;width:120px;margin-left:-60px;top:calc(var(--split) - 12px);height:24px;z-index:7;display:flex;align-items:center;justify-content:center;touch-action:none;cursor:ns-resize}
#grip span{width:46px;height:6px;border-radius:3px;background:#aab4c8;box-shadow:0 0 0 3px rgba(255,255,255,.85)}
#grip.drag span{background:var(--blue)}
body.skyOn #grip{display:none}
/* 空タブ */
#sumRow{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:2px 0 4px}
#sumRow #head{flex:1 1 100%;font-size:13px;color:#445}
#sumRow .lab{font-size:13px;color:var(--sub)}
#skyNow{background:var(--card);border:1px solid var(--line);border-radius:12px;margin:6px 0;padding:0 10px}
#skyNow summary{padding:8px 0;font-size:14px;color:var(--acc);cursor:pointer;list-style:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#skyNow summary::-webkit-details-marker{display:none}
#skyNow summary::after{content:' ▾';color:#889}
#skyNow[open] summary::after{content:' ▴'}
#skyNow #iss,#skyNow #night{margin:0 0 8px}
/* よその空の帯（空タブの一番上） */
#yosoRow{display:none;align-items:center;flex-wrap:wrap;gap:4px 8px;margin:0 0 6px;padding:6px 8px 6px 10px;background:#2e7d6b;color:#fff;border-radius:12px;font-size:13px;line-height:1.4}
#yosoRow.on{display:flex}
#yosoRow.near{background:#e6edf8;color:var(--navy)}
#yrT{flex:1 1 160px}
#yrT b{font-size:14px}
#yosoRow .yrB{display:flex;gap:6px;margin-left:auto}
#panel #yosoRow button{min-height:30px;padding:3px 10px;font-size:13px;border:none;border-radius:14px;background:#fff;color:#2e7d6b;font-weight:bold}
#panel #yosoRow.near button{background:var(--navy);color:#fff}
/* 記録タブ */
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0}
.tile{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;text-align:left;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.tile .i{font-size:26px}
.tile .n{font-size:16px;font-weight:bold;color:var(--acc);margin-top:2px}
.tile .s{font-size:12px;color:#778;margin-top:2px}
.sech{font-weight:bold;color:var(--acc);margin:12px 0 4px;font-size:15px}
.box{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 10px;margin:6px 0}
/* よその空タブ */
#tab-yoso #airList{display:block !important}
#tab-yoso #airList button{margin:3px 4px 3px 0}
/* 記録の画面（図鑑・都市・今日の空・バッジ・よその空ノート・シェア・使い方）：見出しを上に固定、「記録を消す」は下に */
#zukan,#cities,#day,#badge,#yoso,#share,#helpBox{font-size:15px;line-height:1.55}
.ovh{position:sticky;top:-12px;z-index:5;display:flex;align-items:center;gap:6px;margin:-12px -12px 8px;padding:8px 12px;background:#fff;border-bottom:1px solid var(--line);box-shadow:0 2px 6px rgba(0,0,0,.05)}
.ovh b{font-size:17px;color:var(--acc);min-width:0}
.ovh button{white-space:nowrap;flex:0 0 auto}
#day .ovh button.pri{background:var(--navy);color:#fff;border-color:var(--navy)}
.ovh .sp{flex:1}
#helpBox details{scroll-margin-top:64px}
.ovh button{margin:0 !important}
.ovfoot{margin:24px 0 8px;padding-top:10px;border-top:1px dashed var(--line);display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ovfoot .small{width:100%}
.ovfoot button.reset{float:none;margin:0;color:#c0392b !important;border-color:#e6b3ad !important;background:#fff !important}
/* 空に向けた画面 */
body.skyOn #scopeBox{height:calc(100% - var(--tab) - 150px)}
body.skyOn #panel{top:calc(100% - var(--tab) - 150px)}
#skyCtl{position:absolute;left:0;right:0;bottom:50px;z-index:3;gap:6px;overflow-x:auto;padding:4px 8px;white-space:nowrap;align-items:center;-webkit-overflow-scrolling:touch}
body.skyOn #skyCtl{display:flex !important}
body:not(.skyOn) #skyCtl{display:none !important}
#skyCtl button{flex:0 0 auto;min-height:34px;padding:5px 11px;margin:0;font-size:13px;color:#fff;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.55);border-radius:17px}
#skyCtl button.on{background:#c0392b;border-color:#c0392b}
#skyCtl #offVal{color:#fff;font-size:13px;min-width:28px;text-align:center}
#skyCtl #fovCtl{display:inline-flex;gap:6px;align-items:center}
#skyCtl .qb{background:rgba(255,255,255,.9)}
#skyTextBox{display:none;font-size:13px;line-height:1.5;margin:4px 0}
body.skyOn #skyTextBox{display:block}
@media (min-width:900px){
  #map{height:auto}
  #panel{top:0;bottom:var(--tab);padding-top:8px}
  #tabbar{left:auto;width:420px}
  #grip{display:none}
  body.skyOn #scopeBox{height:auto}
  body.skyOn #panel{top:0}
}
/* ---------- 暗い画面（v36） ---------- */
body.dark{--bg:#0e1626;--card:#172238;--text:#e2e8f3;--sub:#9aa8c0;--line:#2c3a55;--acc:#9dbcff;--navy:#2c4f94;color:var(--text);color-scheme:dark}
body.dark #panel{color:var(--text);box-shadow:0 -2px 8px rgba(0,0,0,.5)}
body.dark #panel button,body.dark #zukan button,body.dark #cities button,body.dark #day button,body.dark #badge button,body.dark #yoso button,body.dark #share button,body.dark #helpBox button{background:#22304a;color:var(--text);border-color:var(--line)}
body.dark #panel button.pri,body.dark .ovh button.pri{background:var(--navy);color:#fff;border-color:var(--navy)}
body.dark #panel button.on{background:#c0392b;color:#fff;border-color:#c0392b}
body.dark #panel select{background:#22304a;color:var(--text);border-color:var(--line)}
body.dark #sumRow #head{color:var(--sub)}
body.dark .small{color:var(--sub)}
body.dark .where{color:#aab6cc}
body.dark .near{color:#ff9f43}
body.dark .sunt{color:#f0c050}
body.dark #err{color:#ff8a80 !important}
body.dark .card{background:var(--card);color:var(--text);border-color:var(--line);border-left-color:#4d8ff0}
body.dark .card.mil{background:#3a1d22;border-left-color:#e05545}
body.dark .card.sun{background:#36301a;border-left-color:#e6a700}
body.dark .card.sel{outline-color:#cfd8ea}
body.dark #iss{background:#1a2742;color:var(--text)}
body.dark #night{background:#221e3a;color:var(--text)}
body.dark #detail{background:var(--card);border-color:#8fa3c8;color:var(--text)}
body.dark .tile .s{color:var(--sub)}
body.dark #tabbar{background:#121c2e;border-top-color:var(--line);box-shadow:0 -2px 8px rgba(0,0,0,.4)}
body.dark #tabbar button{color:#8d9ab3}
body.dark #tabbar button.cur{color:var(--acc)}
body.dark #skyFab .fab{border-color:#121c2e;background:#2c4f94}
body.dark.skyOn #skyFab .fab{background:#c0392b}
body.dark.skyOn #skyFab .t{color:#ff8a7a}
body.dark #tb-yoso.away::after{border-color:#121c2e}
body.dark #grip span{background:#5d6b86;box-shadow:0 0 0 3px rgba(14,22,38,.85)}
body.dark #yosoRow.near{background:#1b2a45;color:var(--acc)}
body.dark #panel #yosoRow.near button{background:var(--navy);color:#fff}
body.dark #zukan,body.dark #cities,body.dark #day,body.dark #badge,body.dark #yoso,body.dark #share,body.dark #helpBox{background:var(--bg);color:var(--text)}
body.dark .ovh{background:var(--bg);box-shadow:0 2px 6px rgba(0,0,0,.4)}
body.dark .ovfoot button.reset{background:transparent !important;color:#ff8a7a !important;border-color:#7a3a35 !important}
body.dark #zukan td,body.dark #zukan th,body.dark #cities td,body.dark #cities th,body.dark #day td,body.dark #day th{border-bottom-color:var(--line)}
body.dark #dayList tr.dsel{background:#22304a}
body.dark .zdet td{background:#1b2a45}
body.dark .zlink{color:#8ab4ff}
body.dark .drow{border-bottom-color:var(--line)}
body.dark .dhead{color:var(--acc)}
body.dark .dspot{border-color:var(--line);border-left-color:#4d8ff0}
body.dark .bcard{border-color:var(--line);border-left-color:#4a5670;color:#7d8aa2}
body.dark .bcard.got{border-left-color:#d4a017;color:var(--text)}
body.dark .bt{background:#2a3550;color:#8090a8}
body.dark .ycard{border-color:var(--line);border-left-color:#2e9d85}
body.dark .ycard.now{background:#173a33}
body.dark .ynew{color:#5fd0b0}
body.dark [style*="color:#333"]{color:var(--text) !important}
body.dark b[style*="color:#c0392b"]{color:#ff8a7a !important}
body.dark #helpBox summary{color:var(--acc)}
body.dark #helpBox details{border-bottom-color:var(--line)}
body.dark #helpBox details[open] summary{color:#ff8a7a}
body.dark .qb{background:var(--card) !important;color:#8ab4ff !important;border-color:#8ab4ff !important}
body.dark #tip{background:#3d3410;color:#ffeeb0;border-bottom-color:#b8921a}
body.dark #tip b{color:#ffd54f}
body.dark #tipX{color:#ffeeb0}
body.dark .plab{background:rgba(18,28,46,.92);color:#a9c6ff;border-color:#3d6fc0}
body.dark .plab.mil{color:#ff8a7a;border-color:#c0392b}
body.dark #map .mapboxgl-canvas,body.dark #citiesMap .mapboxgl-canvas,body.dark #yosoMap .mapboxgl-canvas{filter:invert(.9) hue-rotate(180deg) brightness(.95)}
body.dark #map .mapboxgl-ctrl-group,body.dark #citiesMap .mapboxgl-ctrl-group,body.dark #yosoMap .mapboxgl-ctrl-group{filter:invert(.88) hue-rotate(180deg)}
body.dark .mapboxgl-ctrl-attrib{background:rgba(14,22,38,.75) !important}
body.dark .mapboxgl-ctrl-attrib a{color:#aab6cc !important}`));

  // ---------- 部品を集める ----------
  const rowA = $('rad').parentNode, rowB = $('skyBtn').parentNode;
  const hold = el('div', {id:'oldBtns'});
  ['skyBtn', 'zukanBtn', 'citiesBtn', 'dayBtn', 'badgeBtn', 'yosoBtn'].forEach(id => hold.appendChild($(id)));
  document.body.appendChild(hold);

  const sec = (id, tab) => { const s = el('div', {id, className:'tabsec'}); s.dataset.tab = tab; return s; };
  const tList = sec('tab-list', 'list'), tRec = sec('tab-rec', 'rec'), tYoso = sec('tab-yoso', 'yoso'), tSet = sec('tab-set', 'set');

  // 空に向けた画面の説明（パネルの上）と、選んだ機体の詳細（どのタブでも）
  const skyText = el('div', {id:'skyTextBox'});
  skyText.appendChild($('skyInfo')); skyText.appendChild(el('br')); skyText.appendChild($('calInfo'));
  // 空に向けた画面の操作は、空の画面の下の端に並べる
  const ctl = $('skyCtl');
  [...ctl.childNodes].forEach(n => { if (n.nodeType === 3 || n.nodeName === 'BR') n.remove(); });
  ctl.insertBefore(el('span', {style:'color:#fff;font-size:13px'}, '補正'), $('offMinus'));
  [...$('fovCtl').childNodes].forEach(n => { if (n.nodeType === 3) n.remove(); });
  $('scopeBox').appendChild(ctl);

  // 空タブ：よその空の帯（v36）→ 件数の行（範囲・並び）→ 今夜の空と宇宙ステーション（たたむ）→ 一覧
  const yrow = el('div', {id:'yosoRow'}, '<div id="yrT"></div><div class="yrB"><button id="bandMove">別の場所へ</button><button id="bandBack">現在地に戻す</button></div>');
  tList.appendChild(yrow);
  yrow.querySelector('#bandBack').onclick = e => { e.stopPropagation(); $('backBtn').click(); };
  yrow.querySelector('#bandMove').onclick = e => { e.stopPropagation(); showTab('yoso'); };
  const sum = el('div', {id:'sumRow'});
  sum.appendChild($('head'));
  sum.appendChild(el('span', {className:'lab'}, '範囲')); sum.appendChild($('rad'));
  sum.appendChild(el('span', {className:'lab'}, 'km')); sum.appendChild($('sort'));
  tList.appendChild(sum);
  const skyNow = el('details', {id:'skyNow'});
  const skySum = el('summary', {}, '🌙 今夜の空・宇宙ステーション');
  skyNow.appendChild(skySum); skyNow.appendChild($('night')); skyNow.appendChild($('iss'));
  try { skyNow.open = localStorage.getItem('sora_skynow') === '1'; } catch (e) {}
  skyNow.addEventListener('toggle', () => { try { localStorage.setItem('sora_skynow', skyNow.open ? '1' : '0'); } catch (e) {} });
  tList.appendChild(skyNow);
  tList.appendChild($('list')); tList.appendChild($('err')); tList.appendChild($('upd').parentNode);
  // 今夜の空の1行の要約
  function skySummary() {
    const n = $('night').innerText.replace(/^今夜の空(（[^）]*）)?\s*/, '').split('\n').map(s => s.split('：')[0]).filter(Boolean).slice(0, 4).join('・');
    const iss = /肉眼で見えます|いま通過中/.test($('iss').innerText) ? '　🛰 宇宙ステーションが見えます' : '';
    skySum.textContent = '🌙 今夜の空' + (n ? '：' + n : '・宇宙ステーション') + iss;
  }
  setInterval(skySummary, 5000); setTimeout(skySummary, 1500);

  // 記録タブ：タイル
  const TILES = [['zukan', '📖', '図鑑', 'zukanBtn'], ['cities', '🌏', '都市', 'citiesBtn'], ['day', '☀️', '今日の空', 'dayBtn'],
    ['badge', '🏅', 'バッジ', 'badgeBtn'], ['yoso', '🗺️', 'よその空ノート', 'yosoBtn'], ['share', '📤', 'シェア', 'shareBtn']];
  tRec.appendChild(el('div', {className:'sech'}, '記録'));
  const grid = el('div', {className:'tiles'});
  TILES.forEach(([k, ic, name, btn]) => {
    const t = el('div', {id:'tile-' + k, className:'tile'}, `<div class="i">${ic}</div><div class="n">${name}</div><div class="s" id="tileS-${k}"></div>`);
    t.onclick = () => { if (k === 'share') { const D = skyDays.days[today()]; if (!D || !D.n) { alertMsg('今日の記録がまだないので、シェアカードは記録が入ってから作れます', null, false); return; } dayView = today(); } $(btn).click(); };
    grid.appendChild(t);
  });
  tRec.appendChild(grid);
  function tileStats() {
    const S = (k, t) => { const e = $('tileS-' + k); if (e) e.textContent = t; };
    const zt = Object.keys(zukan.types).filter(c => c !== '?').length, ct = catchData.total || 0;
    S('zukan', `${zt}機種・キャッチ ${ct}機`);
    S('cities', `${Object.keys(cities.list).length}都市・${Object.keys(cities.rt || {}).length}路線`);
    const D = skyDays.days[today()] || {};
    S('day', `今日 ${D.score || 0}点・${D.n || 0}機`);
    let got = 0, all = 0; try { BADGES.forEach(b => { all += b[3].length; got += ((badge.got[b[0]] || {}).d || []).length; }); } catch (e) {}
    S('badge', `${got} / ${all}`);
    S('yoso', `${(yoso.pl || []).length}か所・${(yoso.cat && yoso.cat.day && yoso.cat.day[today()]) || 0}点`);
    S('share', '今日の空を画像で送る');
  }
  tileStats(); setInterval(() => { if (tRec.classList.contains('cur')) tileStats(); }, 3000);

  // よその空タブ
  tYoso.appendChild(el('div', {className:'sech'}, 'よその空へ行く'));
  tYoso.appendChild(el('div', {className:'small', style:'margin-bottom:6px'}, '世界の空港を押すか、「よその空に行く」で地図をタップした場所の空へ行けます。よその空のキャッチと点数は、いつもの記録とは別に「よその空ノート」（記録のタブ）に入ります。星と星座が見えるのは、現地の空が暗いときだけです。'));
  const lb = $('locBar'); lb.className = '';
  tYoso.appendChild(lb);

  // 設定タブ
  tSet.appendChild(el('div', {className:'sech'}, '表示と知らせ'));
  const setBox = el('div', {id:'setBox', className:'box'});
  const thRow = el('div', {id:'themeRow'}, '<label for="themeSel">画面の明るさ</label><select id="themeSel"><option value="auto">自動（夜は暗く）</option><option value="light">いつも明るい</option><option value="dark">いつも暗い</option></select>' +
    '<div class="small">自動：今いる場所の日の入りから日の出まで、暗い画面にします（よその空にいても、今いる場所の時刻で決めます）</div>');
  setBox.appendChild(thRow);
  setBox.appendChild($('ground').parentNode); setBox.appendChild(el('br'));
  ['ntfMil', 'ntfOver', 'ntfCd'].forEach(id => { setBox.appendChild($(id).parentNode); setBox.appendChild(el('br')); });
  setBox.appendChild($('ntfFlash'));
  tSet.appendChild(setBox);
  tSet.appendChild(el('div', {className:'sech'}, '使い方'));
  tSet.appendChild(el('div', {id:'helpSlot', className:'box'}));
  tSet.appendChild(el('div', {className:'sech'}, '記録の保存'));
  const bk = document.querySelector('.bk'); bk.querySelector('b').remove(); bk.querySelector('br') && bk.querySelector('br').remove(); bk.classList.add('box');
  tSet.appendChild(bk);
  tSet.appendChild(el('div', {className:'sech'}, 'このアプリについて'));
  const src = [...panel.children].find(x => /機体データ：adsb\.lol/.test(x.textContent)); if (src) { src.classList.add('box'); tSet.appendChild(src); }

  rowA.remove(); rowB.remove();
  panel.appendChild(skyText); panel.appendChild($('detail'));
  [tList, tRec, tYoso, tSet].forEach(s => panel.appendChild(s));

  // ---------- 記録の画面：見出しを上に固定し、「記録を消す」などは一番下へ（v36） ----------
  [['zukan', 'zukanClose'], ['cities', 'citiesClose'], ['day', 'dayClose'], ['badge', 'badgeClose'], ['yoso', 'yosoClose'], ['share', 'shareClose']].forEach(([id, cb]) => {
    const box = $(id), c = $(cb); if (!box || !c) return;
    const t = id === 'day' ? $('dayTitle') : box.querySelector(':scope > b');
    const h = el('div', {className:'ovh'});
    c.textContent = '← 閉じる'; h.appendChild(c); if (t) h.appendChild(t);
    if (id === 'day' && $('shareBtn')) { h.appendChild(el('span', {className:'sp'})); $('shareBtn').classList.add('pri'); h.appendChild($('shareBtn')); }
    box.insertBefore(h, box.firstChild);
    const rs = [...box.querySelectorAll(':scope > .reset')];
    if (rs.length) {
      const f = el('div', {className:'ovfoot'}, '<div class="small">記録の管理（消したものは元に戻せません）</div>');
      rs.reverse().forEach(r => f.appendChild(r));
      box.appendChild(f);
    }
  });

  // ---------- 下のタブ ----------
  const bar = el('div', {id:'tabbar'});
  const tb = (id, ic, t) => el('button', {id}, `<span class="i">${ic}</span><span>${t}</span>`);
  bar.appendChild(tb('tb-list', '✈️', '空'));
  bar.appendChild(tb('tb-rec', '📖', '記録'));
  bar.appendChild(el('button', {id:'skyFab'}, '<span class="fab">🔭</span><span class="t">空に向ける</span>'));
  bar.appendChild(tb('tb-yoso', '🌏', 'よその空'));
  bar.appendChild(tb('tb-set', '⚙️', '設定'));
  document.body.appendChild(bar);
  let curTab = 'list';
  try { curTab = localStorage.getItem('sora_tab') || 'list'; } catch (e) {}
  window.showTab = function (k) {
    if (sky) setSky(false);
    curTab = k;
    [tList, tRec, tYoso, tSet].forEach(s => s.classList.toggle('cur', s.dataset.tab === k));
    ['list', 'rec', 'yoso', 'set'].forEach(x => $('tb-' + x).classList.toggle('cur', x === k));
    try { localStorage.setItem('sora_tab', k); } catch (e) {}
    if (k === 'rec') tileStats();
    panel.scrollTop = 0;
  };
  ['list', 'rec', 'yoso', 'set'].forEach(k => { $('tb-' + k).onclick = () => showTab(k); });
  $('skyFab').onclick = () => $('skyBtn').click();
  const fabText = () => { $('skyFab').querySelector('.t').textContent = sky ? '戻る' : noSensor() ? '空に向ける（スマホ）' : '空に向ける'; $('skyFab').querySelector('.fab').textContent = sky ? '✕' : '🔭'; };
  showTab(curTab === 'set' || curTab === 'rec' || curTab === 'yoso' ? curTab : 'list');

  // よその空へ行ったら、どこから行っても（空港・地図・よその空ノート）「空」タブへ（v36）
  const yosoGoV25 = yosoGo;
  yosoGo = function (p, meta) { yosoGoV25(p, meta); showTab('list'); };

  // ---------- 地図と一覧の境目を指でずらす（v36、スマホの幅だけ） ----------
  BK_SKIP.push('sora_split'); // 画面の高さは端末ごと（書き出さない）
  const SPLIT0 = 42, grip = el('div', {id:'grip', title:'上下に動かすと地図と一覧の広さが変わります（2回タップで元に戻る）'}, '<span></span>');
  document.body.appendChild(grip);
  let split = SPLIT0, gDrag = null, gLastUp = 0, gRaf = 0;
  const setSplit = v => { split = Math.min(75, Math.max(20, v)); document.documentElement.style.setProperty('--split', split.toFixed(1) + '%'); };
  const mapResize = () => { try { map.resize(); } catch (e) {} };
  setSplit(Number(lsGet('sora_split', SPLIT0)) || SPLIT0);
  grip.addEventListener('pointerdown', e => { gDrag = {y:e.clientY, s:split, moved:false}; try { grip.setPointerCapture(e.pointerId); } catch (er) {} e.preventDefault(); });
  grip.addEventListener('pointermove', e => {
    if (!gDrag) return;
    const dy = e.clientY - gDrag.y;
    if (!gDrag.moved && Math.abs(dy) < 5) return;
    gDrag.moved = true; grip.classList.add('drag');
    setSplit(gDrag.s + dy / window.innerHeight * 100);
    if (!gRaf) gRaf = requestAnimationFrame(() => { gRaf = 0; mapResize(); });
  });
  const gEnd = () => {
    if (!gDrag) return;
    const d = gDrag; gDrag = null; grip.classList.remove('drag');
    if (d.moved) { lsSet('sora_split', Math.round(split * 10) / 10); mapResize(); return; }
    const now = Date.now();
    if (now - gLastUp < 450) { gLastUp = 0; setSplit(SPLIT0); lsSet('sora_split', SPLIT0); mapResize(); } // 2回タップで元の高さ
    else gLastUp = now;
  };
  grip.addEventListener('pointerup', gEnd); grip.addEventListener('pointercancel', gEnd);

  // ---------- 暗い画面（v36）：自動（今いる場所の日の入り〜日の出）／いつも明るい／いつも暗い ----------
  const themeSel = $('themeSel');
  themeSel.value = ['auto', 'light', 'dark'].includes(lsGet('sora_theme', 'auto')) ? lsGet('sora_theme', 'auto') : 'auto';
  function nightHere() { try { const h = realHome(); return sunAt(h[1], h[0], new Date()).el < -0.83; } catch (e) { return false; } }
  function applyTheme() {
    const m = themeSel.value, dark = m === 'dark' || (m === 'auto' && nightHere());
    if (document.body.classList.contains('dark') !== dark) document.body.classList.toggle('dark', dark);
  }
  themeSel.onchange = () => { lsSet('sora_theme', themeSel.value); applyTheme(); };
  applyTheme(); setInterval(applyTheme, 60000);
  window.applyTheme = applyTheme;

  // ---------- 状態に合わせて ----------
  let lastSel = sel, lastPick = JSON.stringify(pickPos), lastSky = sky, lastRow = '', lastHome = '';
  const phase = p => { const s = sunAt(p[1], p[0], new Date()); return s.el > 0 ? '昼' : s.el > -6 ? (s.H > 0 ? '夕方' : '明け方') : '夜'; };
  setInterval(() => {
    // 地図や空の画面で機体を選んだら、空タブに切り替える
    if (sel && sel !== lastSel && curTab !== 'list' && !sky) showTab('list');
    lastSel = sel;
    // よその空へ行った・戻ったら、どのタブにいても空タブへ（v36）
    const pk = JSON.stringify(pickPos);
    if (pk !== lastPick && !pickMode) { if (curTab !== 'list') showTab('list'); lastPick = pk; }
    if (sky !== lastSky) { lastSky = sky; fabText(); setTimeout(mapResize, 50); }
    // よその空の帯（空タブの一番上）と、下のタブの緑の点
    const vo = !!pickPos && !pickMode && viewOnly();
    let row = '';
    if (pickPos && !pickMode && pos) {
      if (vo) { const e = typeof yosoPlace === 'function' && yosoOn() ? yosoPlace() : null; row = `🌏 <b>${esc(e ? yosoLabel(e) : 'よその空')}</b>・現地は${phase(pos)}`; }
      else row = '📍 <b>地図で選んだ場所の空</b>（今いる場所の近くなので、いつもどおり記録します）';
    }
    if (row !== lastRow) {
      lastRow = row;
      yrow.classList.toggle('on', !!row); yrow.classList.toggle('near', !!row && !vo);
      $('yrT').innerHTML = row; $('bandMove').style.display = vo ? '' : 'none';
    }
    $('tb-yoso').classList.toggle('away', vo);
    // 現在地がはじめて分かったら、自動の明るさを決め直す
    const hk = JSON.stringify(realHome());
    if (hk !== lastHome) { lastHome = hk; applyTheme(); }
  }, 500);
  fabText();
  setTimeout(mapResize, 300);
})();
