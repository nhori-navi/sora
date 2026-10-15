// SoraMiru の画面の骨組み（v35）：下のタブ（空・記録・空に向ける・よその空・設定）、空に向けた画面の操作の並べ替え、見た目
// app.js のあと、help.js の前に読む。部品の id は変えずに置き場所だけを動かすので、app.js の動きはそのまま
(function () {
  const el = (tag, attrs, html) => { const e = document.createElement(tag); Object.assign(e, attrs || {}); if (html != null) e.innerHTML = html; return e; };
  const panel = $('panel');

  // ---------- 見た目 ----------
  document.head.appendChild(el('style', {}, `
:root{--navy:#1f3b73;--blue:#1f6fd1;--line:#d5dceb;--bg:#f4f6fa;--tab:64px}
body{background:var(--bg)}
#map{height:42%}
#panel{top:42%;bottom:var(--tab);background:var(--bg);padding:6px 10px 14px;border-top:none;box-shadow:0 -2px 8px rgba(0,0,0,.12)}
#panel button,#zukan button,#cities button,#day button,#badge button,#yoso button,#share button,#helpBox button{min-height:38px;padding:7px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;color:#223;font-size:15px}
#panel button.on{background:#c0392b;color:#fff;border-color:#c0392b}
#panel button.pri{background:var(--navy);color:#fff;border-color:var(--navy)}
#panel .qb,.qb{min-height:0 !important;width:24px;height:24px;padding:0 !important;border-radius:50% !important}
#panel select{min-height:34px;border:1px solid var(--line);border-radius:17px;background:#fff;padding:3px 10px}
#panel label{display:inline-flex;align-items:center;gap:4px;min-height:36px;margin-right:10px}
#panel input[type=checkbox]{width:20px;height:20px}
.card{border-radius:12px;border-color:var(--line);box-shadow:0 1px 3px rgba(0,0,0,.06)}
#toast{top:6px;padding:7px 14px;border-radius:18px;font-size:14px;line-height:1.45;max-width:88%}
/* 下のタブ */
#tabbar{position:fixed;left:0;right:0;bottom:0;height:var(--tab);z-index:15;display:grid;grid-template-columns:repeat(5,1fr);align-items:end;background:#fff;border-top:1px solid var(--line);box-shadow:0 -2px 8px rgba(0,0,0,.08);padding-bottom:env(safe-area-inset-bottom)}
#tabbar button{border:none;background:none;height:var(--tab);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:11px;color:#667;padding:0;margin:0}
#tabbar button .i{font-size:22px;line-height:1}
#tabbar button.cur{color:var(--navy);font-weight:bold}
#tabbar button.cur .i{transform:scale(1.1)}
#skyFab{position:relative}
#skyFab .fab{width:62px;height:62px;margin-top:-26px;border-radius:50%;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;box-shadow:0 3px 10px rgba(31,59,115,.45);border:3px solid #fff}
#skyFab .t{font-size:11px;color:var(--navy);font-weight:bold}
body.skyOn #skyFab .fab{background:#c0392b}
body.skyOn #skyFab .t{color:#c0392b}
.tabsec{display:none}
.tabsec.cur{display:block}
body.skyOn .tabsec{display:none !important}
#oldBtns{display:none}
/* 空タブ */
#sumRow{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin:2px 0 4px}
#sumRow #head{flex:1 1 100%;font-size:13px;color:#445}
#sumRow .lab{font-size:13px;color:#667}
#skyNow{background:#fff;border:1px solid var(--line);border-radius:12px;margin:6px 0;padding:0 10px}
#skyNow summary{padding:8px 0;font-size:14px;color:var(--navy);cursor:pointer;list-style:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#skyNow summary::-webkit-details-marker{display:none}
#skyNow summary::after{content:' ▾';color:#889}
#skyNow[open] summary::after{content:' ▴'}
#skyNow #iss,#skyNow #night{margin:0 0 8px}
/* 記録タブ */
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0}
.tile{background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px;text-align:left;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.tile .i{font-size:26px}
.tile .n{font-size:16px;font-weight:bold;color:var(--navy);margin-top:2px}
.tile .s{font-size:12px;color:#778;margin-top:2px}
.sech{font-weight:bold;color:var(--navy);margin:12px 0 4px;font-size:15px}
.box{background:#fff;border:1px solid var(--line);border-radius:12px;padding:8px 10px;margin:6px 0}
/* よその空タブ */
#tab-yoso #airList{display:block !important}
#tab-yoso #airList button{margin:3px 4px 3px 0}
#yosoBand{display:none;position:absolute;left:8px;right:56px;bottom:28px;z-index:3;background:rgba(46,125,107,.95);color:#fff;border-radius:12px;padding:6px 8px;font-size:13px;line-height:1.4;box-shadow:0 2px 8px rgba(0,0,0,.3)}
#yosoBand b{font-size:14px}
#yosoBand button{font-size:13px;padding:4px 10px;margin:4px 6px 0 0;border:none;border-radius:14px;background:#fff;color:#2e7d6b;font-weight:bold}
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
  #panel{top:0;bottom:var(--tab)}
  #tabbar{left:auto;width:420px}
  body.skyOn #scopeBox{height:auto}
  body.skyOn #panel{top:0}
}`));

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

  // 空タブ：件数の行（範囲・並び）→ 今夜の空と宇宙ステーション（たたむ）→ 一覧
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
    const n = $('night').innerText.replace(/^今夜の空\s*/, '').split('\n').map(s => s.split('：')[0]).filter(Boolean).slice(0, 4).join('・');
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
  tYoso.appendChild(el('div', {className:'small', style:'margin-bottom:6px'}, '世界の空港を押すか、「よその空に行く」で地図をタップした場所の空へ行けます。よその空のキャッチと点数は「よその空ノート」に入ります。'));
  const lb = $('locBar'); lb.className = '';
  tYoso.appendChild(lb);
  // 地図の下のほうに、よその空にいる間の帯
  const band = el('div', {id:'yosoBand'}, '<div id="bandT"></div><button id="bandMove">別の場所へ</button><button id="bandBack">現在地に戻す</button>');
  $('map').appendChild(band);
  $('bandBack').onclick = e => { e.stopPropagation(); $('backBtn').click(); };
  $('bandMove').onclick = e => { e.stopPropagation(); showTab('yoso'); };

  // 設定タブ
  tSet.appendChild(el('div', {className:'sech'}, '表示と知らせ'));
  const setBox = el('div', {id:'setBox', className:'box'});
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

  // ---------- 状態に合わせて ----------
  let lastSel = sel, lastPick = JSON.stringify(pickPos), lastSky = sky;
  setInterval(() => {
    // 地図や空の画面で機体を選んだら、空タブに切り替える
    if (sel && sel !== lastSel && curTab !== 'list' && !sky) showTab('list');
    lastSel = sel;
    // よその空へ行った・戻ったら、空タブへ
    const pk = JSON.stringify(pickPos);
    if (pk !== lastPick && !pickMode) { if (curTab === 'yoso') showTab('list'); lastPick = pk; }
    if (sky !== lastSky) { lastSky = sky; fabText(); setTimeout(() => { try { map.resize(); } catch (e) {} }, 50); }
    // よその空の帯
    if (pickPos && !pickMode) {
      const e = viewOnly() && typeof yosoPlace === 'function' && yosoOn() ? yosoPlace() : null;
      $('bandT').innerHTML = viewOnly() ? `<b>よその空：${esc(e ? yosoLabel(e) : '…')}</b>　キャッチは「よその空ノート」へ` : '<b>地図で選んだ場所の空</b>（今いる場所の近く）';
      band.style.display = 'block';
    } else band.style.display = 'none';
  }, 500);
  fabText();
  setTimeout(() => { try { map.resize(); } catch (e) {} }, 300);
})();
