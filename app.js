// 見上げアプリの動き（中継のアドレスは config.js、辞書は data.js）
const RELAYS = [typeof RELAY === 'string' ? RELAY : '', typeof RELAY2 === 'string' ? RELAY2 : '']
  .map(u => u.trim().replace(/\/+$/, '')).filter(u => /^https:\/\//.test(u) && !u.includes('〇'));
const RELAY_CF = RELAYS.find(u => !u.includes('script.google.com')) || '';
const TOKEN = 'pk.eyJ1IjoiaG9yaWhha28iLCJhIjoiY211djd0ejljMDA5ZjMycHYxaTY3M3BsdSJ9.a1yefJYynC4k_YvllM5DVw';
mapboxgl.accessToken = TOKEN;
const DEF = [139.38, 35.61]; // 現在地が取れないときの中心（南大沢付近）
const $ = id => document.getElementById(id);
const map = new mapboxgl.Map({container:'map', style:'mapbox://styles/mapbox/light-v11', center:DEF, zoom:9});
map.addControl(new mapboxgl.NavigationControl(), 'top-right');

let pos = null, usingDef = false, sel = null, planes = [], timer = null, busy = false, routeBusy = false, meMarker = null;
let sky = false, head = null, elevNow = 0, sx = 0, sy = 0, gotOri = false, aimHex = null, toastHex = null, toastTimer = null;
let usingSaved = false, retryTimer = null, relayIdx = 0, allList = [], camOn = false, camStream = null;
const markers = new Map(), photos = new Map(), notified = new Set();

// ---------- 保存（スマホ内） ----------
function lsGet(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
let routes = lsGet('sora_routes_v1', {}); if (!routes || typeof routes !== 'object') routes = {};
let zukan = lsGet('sora_zukan_v1', null); if (!zukan || !zukan.types || !zukan.seen) zukan = {types:{}, seen:{}};
let offset = Number(lsGet('sora_offset', 0)) || 0;
let fovCam = Number(lsGet('sora_fov', 28)) || 28;
let cities = lsGet('sora_cities_v1', null); if (!cities || !cities.list || !cities.seen) cities = {list:{}, seen:{}};
['rad', 'sort', 'ground', 'ntfMil', 'ntfOver'].forEach(id => {
  const el = $(id), v = lsGet('sora_' + id, null);
  if (v != null) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; }
  el.addEventListener('change', () => lsSet('sora_' + id, el.type === 'checkbox' ? el.checked : el.value));
});

// ---------- 共通 ----------
function showErr(m) { $('err').textContent = new Date().toLocaleTimeString('ja-JP', {hour:'2-digit', minute:'2-digit'}) + ' ' + m; }
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const norm360 = a => ((a % 360) + 360) % 360;
const DIRS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
const dirName = d => DIRS[Math.round(norm360(d) / 45) % 8];
function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function circle(c, km) {
  const pts = [], kx = 111.32 * Math.cos(c[1] * Math.PI / 180);
  for (let i = 0; i <= 64; i++) { const a = i / 64 * 2 * Math.PI; pts.push([c[0] + km / kx * Math.sin(a), c[1] + km / 110.57 * Math.cos(a)]); }
  return {type:'Feature', properties:{}, geometry:{type:'Polygon', coordinates:[pts]}};
}
const line = (a, b, k) => ({type:'Feature', properties:{k}, geometry:{type:'LineString', coordinates:[a, b]}});
function setData(id, f) { const s = map.getSource(id); if (s) s.setData({type:'FeatureCollection', features:f}); }
const PLANE = 'M12 2 L13.6 9 L22 13.5 L22 15.5 L13.6 13 L13 19 L15.5 21 L15.5 22.5 L12 21.5 L8.5 22.5 L8.5 21 L11 19 L10.4 13 L2 15.5 L2 13.5 L10.4 9 Z';
const planeSvg = (c, big) => `<svg width="${big ? 36 : 26}" height="${big ? 36 : 26}" viewBox="0 0 24 24"><path d="${PLANE}" fill="${c}" stroke="#fff" stroke-width="1"/></svg>`;

// ---------- 距離・方位・太陽 ----------
const D2R = Math.PI / 180, RE = 6371;
function gcKm(a, b) {
  const dLat = (b[1] - a[1]) * D2R, dLon = (b[0] - a[0]) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * RE * Math.asin(Math.sqrt(h));
}
function gcBrg(a, b) {
  const dl = (b[0] - a[0]) * D2R, y = Math.sin(dl) * Math.cos(b[1] * D2R);
  const x = Math.cos(a[1] * D2R) * Math.sin(b[1] * D2R) - Math.sin(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.cos(dl);
  return norm360(Math.atan2(y, x) / D2R);
}
// 太陽の位置（簡易式。精度は0.01°程度）
function sunCore(date) {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.528 + 0.9856003 * n) * D2R;
  const lam = (280.460 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  return {n, lam, eps, ra:Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), dec:Math.asin(Math.sin(eps) * Math.sin(lam))};
}
function sunAt(lat, lon, date) { // 高度（度）と時角（度、正なら午後）
  const s = sunCore(date), gmst = 280.46061837 + 360.98564736629 * s.n;
  const H = ((gmst + lon - s.ra / D2R) % 360 + 540) % 360 - 180;
  const el = Math.asin(Math.sin(lat * D2R) * Math.sin(s.dec) + Math.cos(lat * D2R) * Math.cos(s.dec) * Math.cos(H * D2R)) / D2R;
  return {el, H};
}
function destPt(p, az, km) { // pから方位az・距離kmの地点
  const la1 = p[1] * D2R, lo1 = p[0] * D2R, a = az * D2R, dr = km / RE;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(dr) + Math.cos(la1) * Math.sin(dr) * Math.cos(a));
  const lo2 = lo1 + Math.atan2(Math.sin(a) * Math.sin(dr) * Math.cos(la1), Math.cos(dr) - Math.sin(la1) * Math.sin(la2));
  return [lo2 / D2R, la2 / D2R];
}
function sunVec(date) { const s = sunCore(date); return [Math.cos(s.lam), Math.cos(s.eps) * Math.sin(s.lam), Math.sin(s.eps) * Math.sin(s.lam)]; }

// ---------- 機窓から見える目印（一覧は data.js） ----------
let markList = null;
function getMarks() {
  if (markList) return markList;
  markList = MARKS.map(m => ({name:m[0], p:[m[2], m[1]], h:m[3], w:m[4]}));
  // 山座同定アプリで保存した百名山があれば足す（同じサイト内なので読める）
  const y = lsGet('yama_peaks_v2', null), names = new Set(markList.map(m => m.name));
  if (y && Array.isArray(y.list)) y.list.forEach(v => {
    if (v[4] === 1 && !names.has(v[0])) { names.add(v[0]); markList.push({name:v[0], p:[v[1], v[2]], h:v[3] || 0, w:1.2}); }
  });
  return markList;
}
function windowView(p) {
  if (p.ground || p.altM < 300) return null;
  const hp = p.altM, cap = hp < 3000 ? 60 : 250, sides = {右:[], 左:[], 前:[], 後:[]};
  getMarks().forEach(m => {
    const d = gcKm(p.p, m.p);
    if (d < 3 || d > cap || d > 3.57 * (Math.sqrt(hp) + Math.sqrt(Math.max(0, m.h)))) return;
    const rb = norm360(gcBrg(p.p, m.p) - p.track);
    let side, sub;
    if (rb >= 20 && rb <= 160) { side = '右'; sub = rb < 70 ? '右前方' : rb > 110 ? '右後方' : '右真横'; }
    else if (rb >= 200 && rb <= 340) { side = '左'; sub = rb > 290 ? '左前方' : rb < 250 ? '左後方' : '左真横'; }
    else if (rb < 20 || rb > 340) { side = '前'; sub = '正面'; }
    else { side = '後'; sub = '真後ろ'; }
    sides[side].push({name:m.name, sub, d, score:Math.sqrt(d) / (m.w * m.w)});
  });
  Object.values(sides).forEach(a => a.sort((x, y) => x.score - y.score).splice(3));
  const all = [...sides.右, ...sides.左].sort((x, y) => x.score - y.score);
  return {sides, best:all[0] || null};
}
// 機体に夕日（朝日）が当たっているか
function sunlit(p, now) {
  if (p.ground || p.altM < 500) return null;
  const dip = Math.acos(RE / (RE + p.altM / 1000)) / D2R + 0.57;
  const lit = t => sunAt(p.p[1], p.p[0], t).el > -dip && sunAt(pos[1], pos[0], t).el < -0.83;
  if (!lit(new Date(now))) return null;
  let m = 1;
  while (m <= 90 && lit(new Date(now + m * 60000))) m++;
  return {kind:sunAt(pos[1], pos[0], new Date(now)).H > 0 ? '夕日' : '朝日', mins:m - 1};
}

// ---------- 地図 ----------
map.on('load', () => {
  const empty = {type:'FeatureCollection', features:[]};
  map.addSource('range', {type:'geojson', data:empty});
  map.addLayer({id:'range', type:'line', source:'range',
    paint:{'line-color':'#1f6fd1', 'line-width':1.5, 'line-dasharray':[2, 2], 'line-opacity':0.6}});
  map.addSource('route', {type:'geojson', data:empty});
  map.addLayer({id:'routeFrom', type:'line', source:'route', filter:['==', ['get', 'k'], 'from'],
    paint:{'line-color':'#999', 'line-width':2}});
  map.addLayer({id:'routeTo', type:'line', source:'route', filter:['==', ['get', 'k'], 'to'],
    paint:{'line-color':'#e67e22', 'line-width':3, 'line-dasharray':[2, 1]}});
  drawRange(); drawSel();
});
function drawRange() { if (pos) setData('range', [circle(pos, Number($('rad').value))]); }

// ---------- 現在地 ----------
function setPos(p, def, saved) {
  const first = !pos; pos = p; usingDef = def; usingSaved = !!saved;
  if (!meMarker) {
    const el = document.createElement('div');
    el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#1e90ff;border:3px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.5)';
    meMarker = new mapboxgl.Marker({element:el}).setLngLat(p).addTo(map);
  } else meMarker.setLngLat(p);
  drawRange();
  if (first) { map.jumpTo({center:p, zoom:9}); start(); }
}
// ---------- 機体データ ----------
function start() { clearInterval(timer); tick(); timer = setInterval(tick, 10000); }
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { if (pos) start(); } else clearInterval(timer);
});
$('rad').addEventListener('change', () => { drawRange(); tick(); });
$('ground').addEventListener('change', () => tick());
$('sort').addEventListener('change', () => { sortPlanes(); render(); });

async function tfetch(url, ms) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, {signal:ctl.signal}); } finally { clearTimeout(t); }
}
// 中継が2本あるときは交互に使い、片方がだめならもう片方で取る
async function getAc(la, lo, nm) {
  const errs = [];
  for (let k = 0; k < RELAYS.length; k++) {
    const i = (relayIdx + k) % RELAYS.length, base = RELAYS[i], gas = base.includes('script.google.com');
    const name = gas ? 'Google' : 'Cloudflare';
    try {
      const r = await tfetch(gas ? `${base}?lat=${la}&lon=${lo}&nm=${nm}` : `${base}/ac/${la}/${lo}/${nm}`, 8000);
      const text = await r.text();
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + text.slice(0, 60));
      const j = JSON.parse(text);
      if (j.error) throw new Error(j.error);
      relayIdx = (i + 1) % RELAYS.length;
      return {j, name, stale:r.headers.get('X-Stale') === '1'};
    } catch (e) { errs.push(name + '：' + (e.name === 'AbortError' ? '応答なし' : e.message)); }
  }
  throw new Error(errs.join(' ／ '));
}
function norm(a, now) {
  const ground = a.alt_baro === 'ground';
  const ft = typeof a.alt_geom === 'number' ? a.alt_geom : (typeof a.alt_baro === 'number' ? a.alt_baro : 0);
  return {hex:a.hex, cs:(a.flight || '').trim(), reg:a.r || '', type:a.t || '', lat:a.lat, lon:a.lon, ground,
    altM:ground ? 0 : Math.max(0, Math.round(ft * 0.3048)), track:a.track ?? a.true_heading ?? 0, gs:a.gs || 0,
    mil:!!(a.dbFlags & 1), rate:a.baro_rate ?? a.geom_rate ?? 0, kmh:a.gs ? Math.round(a.gs * 1.852) : null,
    t0:now - (a.seen_pos || 0) * 1000};
}
// 速度と向きから「いまの位置」と「最接近」を計算する
function place(p, now) {
  const dt = Math.min(60, Math.max(0, (now - p.t0) / 1000)), tr = p.track * Math.PI / 180;
  const dkm = p.ground ? 0 : p.gs * 1.852 / 3600 * dt;
  const lat = p.lat + dkm * Math.cos(tr) / 110.57, lon = p.lon + dkm * Math.sin(tr) / (111.32 * Math.cos(p.lat * Math.PI / 180));
  p.p = [lon, lat];
  const kx = 111.32 * Math.cos(pos[1] * Math.PI / 180), e = (lon - pos[0]) * kx, n = (lat - pos[1]) * 110.57;
  p.dist = Math.hypot(e, n);
  p.dir = norm360(Math.atan2(e, n) * 180 / Math.PI);
  p.elev = Math.atan2(p.altM, p.dist * 1000) * 180 / Math.PI;
  const v = p.gs * 1.852 / 60; // km/分
  p.cpaT = null; p.cpaKm = null;
  if (!p.ground && v > 1) {
    const ve = v * Math.sin(tr), vn = v * Math.cos(tr), t = -(e * ve + n * vn) / (v * v), tt = Math.max(0, t);
    p.cpaT = t; p.cpaKm = Math.hypot(e + ve * tt, n + vn * tt);
  }
}
function sortPlanes() {
  if ($('sort').value === 'come') {
    const key = p => (p.cpaT != null && p.cpaT > 0 && p.cpaKm <= 10) ? p.cpaT : 1e6 + p.dist;
    planes.sort((a, b) => key(a) - key(b));
  } else planes.sort((a, b) => a.dist - b.dist);
}
async function tick() {
  if (!pos || busy) return;
  if (!RELAYS.length) { showErr('中継のアドレスが未設定です（config.js を確認してください）'); return; }
  busy = true; clearTimeout(retryTimer);
  const km = Number($('rad').value), nm = Math.ceil(km / 1.852) + 1;
  try {
    const got = await getAc(pos[1].toFixed(2), pos[0].toFixed(2), nm), j = got.j, now = Date.now();
    const base = typeof j.now === 'number' && Math.abs(j.now - now) < 600000 ? j.now : now;
    const list = (j.ac || j.aircraft || []).filter(a => a.lat != null && a.lon != null).map(a => norm(a, base));
    list.forEach(p => place(p, now));
    allList = list;
    planes = list.filter(p => p.dist <= km && ($('ground').checked || !p.ground));
    planes.forEach(p => { p.sun = sunlit(p, now); p.win = windowView(p); });
    sortPlanes();
    record(planes);
    dayRecord(planes, now);
    noteNear(planes, now);
    notify(planes);
    render();
    $('upd').textContent = `更新 ${new Date().toLocaleTimeString('ja-JP')}（${got.name}経由${got.stale ? '・少し前のデータ' : ''}）`;
    $('err').textContent = '';
    fetchRoutes(planes).then(changed => { if (changed) { render(); recordCities(); } });
    recordCities();
  } catch (e) {
    showErr('機体データの取得に失敗（前の表示を続け、3秒後にやり直します）：' + e.message);
    retryTimer = setTimeout(tick, 3000);
  }
  finally { busy = false; }
}

// ---------- 行き先（スマホに覚えておく） ----------
const ROUTE_DAYS = 30, NONE_HOURS = 12;
function routeEntry(cs) {
  const r = cs && routes[cs];
  if (!r) return null;
  const age = Date.now() - r.t;
  return (r.none ? age > NONE_HOURS * 3600000 : age > ROUTE_DAYS * 86400000) ? null : r;
}
let saveTimer = null;
function saveRoutes() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const ks = Object.keys(routes);
    if (ks.length > 3000) ks.sort((a, b) => routes[a].t - routes[b].t).slice(0, ks.length - 3000).forEach(k => delete routes[k]);
    lsSet('sora_routes_v1', routes);
  }, 1000);
}
const apConv = a => ({iata:a.iata_code || '', name:a.name || '', loc:a.municipality || '',
  lat:+(+a.latitude).toFixed(3), lon:+(+a.longitude).toFixed(3)});
async function fetchRoutes(list) {
  if (routeBusy) return false;
  const need = [...new Set(list.filter(p => !p.mil && /^[A-Z]{2,3}\d/.test(p.cs) && !routeEntry(p.cs)).map(p => p.cs))].slice(0, 10);
  if (!need.length) return false;
  routeBusy = true;
  try {
    if (!RELAY_CF) return false;
    const r = await tfetch(`${RELAY_CF}/routes/${need.join(',')}`, 15000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(), now = Date.now();
    need.forEach(cs => {
      const fr = j[cs];
      if (fr && fr.origin && fr.destination) routes[cs] = {t:now, a:[apConv(fr.origin), apConv(fr.destination)]};
      else if (!fr) routes[cs] = {t:now, none:1};
    });
    saveRoutes();
    return true;
  } catch (e) { showErr('行き先の取得に失敗：' + e.message + '（中継のコードを新しくしたか確認してください）'); return false; }
  finally { routeBusy = false; }
}
function apName(ap) { return JA_AP[ap.iata] || ap.loc || ap.name || ap.iata || '?'; }
function routeInfo(p) {
  const r = routeEntry(p.cs);
  if (!r || r.none || !r.a) return null;
  return {text:r.a.map(apName).join(' → '), destName:apName(r.a[1]), orig:[r.a[0].lon, r.a[0].lat], dest:[r.a[1].lon, r.a[1].lat]};
}
function routeText(p) {
  const ri = routeInfo(p);
  if (ri) return ri.text;
  if (p.mil) return '行き先不明（軍用機）';
  return /^[A-Z]{2,3}\d/.test(p.cs) && !routeEntry(p.cs) ? '行き先を調べ中…' : '行き先不明';
}
const typeName = p => TYPE[p.type] || p.type || '機種不明';
const infoText = p => [typeName(p), AIRLINE[p.cs.slice(0, 3)] || '', p.cs || p.reg].filter(Boolean).join('・');
function nearText(p) {
  if (p.cpaT == null) return '';
  if (p.cpaT <= 0) return '遠ざかり中';
  if (p.cpaT > 20) return '';
  return (p.cpaT < 0.5 ? 'まもなく' : `あと${Math.round(p.cpaT)}分で`) + `最接近（${p.cpaKm.toFixed(1)}km）`;
}

// ---------- 一覧と地図の表示 ----------
function cardHtml(p) {
  const rate = p.rate > 500 ? '上昇中' : p.rate < -500 ? '下降中' : '';
  const alt = p.ground ? '地上' : `高度 ${p.altM.toLocaleString()}m ${rate}`;
  const nt = nearText(p), hot = p.cpaT != null && p.cpaT > 0 && p.cpaKm <= 5;
  const extra = [p.sun ? `<span class="sunt">${p.sun.kind}を浴びています（あと${p.sun.mins}分）</span>` : '',
    p.win && p.win.best ? esc(p.win.best.sub.slice(0, 1) + '窓に' + p.win.best.name) : ''].filter(Boolean).join('　');
  return `<div class="card${p.mil ? ' mil' : p.sun ? ' sun' : ''}${p.hex === sel ? ' sel' : ''}" id="c_${esc(p.hex)}" data-hex="${esc(p.hex)}">
    <div class="where">${p.mil ? '<b style="color:#c0392b">軍用機</b>　' : ''}${dirName(p.dir)} ${p.dist.toFixed(1)}km・見上げ角 ${Math.round(p.elev)}°</div>
    <div class="route">${esc(routeText(p))}</div>
    <div class="info">${esc(infoText(p))}</div>
    <div class="small">${alt}${p.kmh ? '・時速' + p.kmh + 'km' : ''}${nt ? `　<span class="${hot ? 'near' : ''}">${nt}</span>` : ''}</div>
    ${extra ? `<div class="small">${extra}</div>` : ''}</div>`;
}
function render() {
  $('head').textContent = `${planes.length}機（半径${$('rad').value}km）` + (usingDef ? '　※現在地が取れないため南大沢付近を中心にしています'
    : usingSaved ? '　※前回の場所で表示中（現在地を確認しています）' : '');
  const shown = planes.slice(0, 60);
  $('list').innerHTML = shown.length ? shown.map(cardHtml).join('') + (planes.length > 60 ? `<div class="small">ほか${planes.length - 60}機は地図に表示しています</div>` : '')
    : '<div class="small">いま範囲内に飛んでいる機体はありません</div>';
  $('list').querySelectorAll('.card').forEach(c => c.onclick = () => select(c.dataset.hex, false));
  const keep = new Set();
  planes.forEach(p => {
    keep.add(p.hex);
    let m = markers.get(p.hex);
    if (!m) {
      const el = document.createElement('div'); el.className = 'plane';
      el.onclick = e => { e.stopPropagation(); select(p.hex, true); };
      m = new mapboxgl.Marker({element:el, rotationAlignment:'map'}).setLngLat(p.p).addTo(map);
      markers.set(p.hex, m);
    }
    m.setLngLat(p.p).setRotation(p.track || 0);
    m.getElement().innerHTML = planeSvg(p.mil ? '#c0392b' : p.sun ? '#e6a700' : '#1f6fd1', p.hex === sel);
  });
  markers.forEach((m, hex) => { if (!keep.has(hex)) { m.remove(); markers.delete(hex); } });
  if (sel && !keep.has(sel)) sel = null;
  drawSel(); renderDetail(false);
}
// 更新と更新のあいだも機体を動かす
setInterval(() => {
  if (!pos || !planes.length || document.hidden) return;
  const now = Date.now();
  planes.forEach(p => { place(p, now); const m = markers.get(p.hex); if (m) m.setLngLat(p.p); });
  drawSel();
}, 500);
function select(hex, scroll) {
  sel = sel === hex ? null : hex;
  if (sel) loadPhoto(sel);
  render(); renderDetail(true);
  const p = planes.find(x => x.hex === sel);
  if (!p) return;
  map.fitBounds(new mapboxgl.LngLatBounds(pos, pos).extend(p.p), {padding:60, maxZoom:12});
  if (scroll) { const c = $('c_' + hex); if (c) c.scrollIntoView({behavior:'smooth', block:'nearest'}); }
}
function drawSel() {
  const p = planes.find(x => x.hex === sel), ri = p && routeInfo(p);
  if (!ri) { setData('route', []); return; }
  setData('route', [line(ri.orig, p.p, 'from'), line(p.p, ri.dest, 'to')]);
}

// ---------- 写真（Planespotters.net） ----------
async function loadPhoto(hex) {
  if (photos.has(hex)) return;
  photos.set(hex, 'loading');
  let ph = null;
  try {
    const r = await fetch('https://api.planespotters.net/pub/photos/hex/' + encodeURIComponent(hex));
    if (r.ok) {
      const x = ((await r.json()).photos || [])[0], src = x && (x.thumbnail_large || x.thumbnail);
      if (src && /^https:\/\//.test(src.src) && /^https:\/\//.test(x.link)) ph = {src:src.src, link:x.link, by:x.photographer || ''};
    }
  } catch (e) {}
  photos.set(hex, ph);
  if (sel === hex) renderDetail(true);
}
function renderDetail(full) {
  const d = $('detail'), p = planes.find(x => x.hex === sel);
  if (!p) { d.style.display = 'none'; d.dataset.hex = ''; return; }
  d.style.display = 'block';
  if (full || d.dataset.hex !== sel) {
    d.dataset.hex = sel;
    const ph = photos.get(sel);
    const photoHtml = (ph === 'loading' || ph === undefined) ? '<div class="small">写真を探しています…</div>'
      : ph ? `<a href="${esc(ph.link)}" target="_blank" rel="noopener"><img src="${esc(ph.src)}" alt="機体の写真"></a><div class="small">Photo © ${esc(ph.by)}（Planespotters.net）</div>`
      : '<div class="small">この機体の写真は見つかりませんでした</div>';
    d.innerHTML = `<div class="route" id="dRoute"></div><div class="info" id="dInfo"></div><div class="small" id="dSub"></div><div class="small" id="dWin" style="color:#333"></div>`
      + (p.ground ? '' : '<button id="rideBtn" class="rideBtn">この便に乗る（機窓ビュー）</button>') + photoHtml;
    const rb = $('rideBtn');
    if (rb) rb.onclick = e => { e.stopPropagation(); openRide(sel); };
  }
  $('dRoute').textContent = routeText(p);
  $('dInfo').textContent = infoText(p);
  $('dSub').textContent = [p.reg && '登録記号 ' + p.reg, p.ground ? '地上' : `高度 ${p.altM.toLocaleString()}m`, p.kmh && '時速' + p.kmh + 'km', nearText(p),
    p.sun && `${p.sun.kind}を浴びています（あと${p.sun.mins}分）`].filter(Boolean).join('・');
  const w = p.win, fmt = a => a.map(x => `${x.name}（${x.sub} ${Math.round(x.d)}km）`).join('、');
  $('dWin').innerHTML = !w ? '' : ['右', '左', '前', '後'].filter(k => w.sides[k].length)
    .map(k => `<b>${{右:'右の窓', 左:'左の窓', 前:'正面', 後:'後方'}[k]}</b>：${esc(fmt(w.sides[k]))}`).join('<br>')
    + (w.best ? '<br><span class="small">機窓の景色（雲がなければ）</span>' : '<span class="small">機窓から見える目印はありません</span>');
}

// ---------- 知らせ ----------
function alertMsg(text, hex, strong) {
  const el = $('toast');
  el.textContent = text; el.style.display = 'block'; toastHex = hex;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.style.display = 'none'; }, 7000);
  try { if (navigator.vibrate) navigator.vibrate(strong ? [200, 100, 200] : [60]); } catch (e) {}
}
$('toast').onclick = () => { $('toast').style.display = 'none'; if (toastHex && planes.some(p => p.hex === toastHex) && sel !== toastHex) select(toastHex, true); };
function notify(list) {
  list.forEach(p => {
    if (p.ground) return;
    if ($('ntfMil').checked && p.mil && !notified.has('m' + p.hex)) {
      notified.add('m' + p.hex);
      alertMsg(`軍用機が範囲に入りました：${typeName(p)}（${dirName(p.dir)} ${p.dist.toFixed(0)}km）`, p.hex, true);
    }
    const over = (p.cpaT != null && p.cpaT > 0 && p.cpaT <= 1 && p.cpaKm <= 3) || p.dist <= 2;
    if ($('ntfOver').checked && over && !notified.has('o' + p.hex)) {
      notified.add('o' + p.hex);
      alertMsg(`まもなく真上付近を通過：${routeText(p)}（${typeName(p)}）`, p.hex, true);
    }
  });
}

// ---------- 機種図鑑 ----------
function record(list) {
  const d = today(), wasEmpty = Object.keys(zukan.types).length === 0;
  let changed = false;
  list.forEach(p => {
    if (p.ground) return;
    const k = p.hex + '|' + d;
    if (zukan.seen[k]) return;
    zukan.seen[k] = d; changed = true;
    const code = p.type || '?';
    let e = zukan.types[code];
    if (!e) {
      e = zukan.types[code] = {n:0, first:d, last:d, mil:0};
      if (p.type) dayNewType(p.type);
      if (p.type && !wasEmpty) {
        const cnt = Object.keys(zukan.types).filter(x => x !== '?').length;
        alertMsg(`新しい機種を発見：${typeName(p)}（図鑑 ${cnt}種目）`, p.hex, false);
      }
    }
    e.n++; e.last = d; if (p.mil) e.mil = 1;
  });
  if (!changed) return;
  for (const k in zukan.seen) if (zukan.seen[k] !== d) delete zukan.seen[k];
  lsSet('sora_zukan_v1', zukan);
  if ($('zukan').style.display === 'block') renderZukan();
}
function renderZukan() {
  const ks = Object.keys(zukan.types).sort((a, b) => zukan.types[b].n - zukan.types[a].n);
  const total = ks.reduce((s, k) => s + zukan.types[k].n, 0);
  $('zukanSum').textContent = `${ks.filter(k => k !== '?').length}機種・のべ${total}機`;
  $('zukanBody').innerHTML = ks.length ? ks.map(k => {
    const e = zukan.types[k], nm = k === '?' ? '機種不明' : (TYPE[k] ? `${TYPE[k]}（${k}）` : k);
    return `<tr><td>${e.mil ? '<b style="color:#c0392b">軍</b> ' : ''}${esc(nm)}</td><td>${e.n}</td><td>${esc(e.first)}</td><td>${esc(e.last)}</td></tr>`;
  }).join('') : '<tr><td colspan="4">まだ記録がありません</td></tr>';
}
$('zukanBtn').onclick = () => { renderZukan(); $('zukan').style.display = 'block'; };
$('zukanClose').onclick = () => { $('zukan').style.display = 'none'; };
$('zukanReset').onclick = () => {
  if (!confirm('機種図鑑の記録をすべて消します。よろしいですか？')) return;
  zukan = {types:{}, seen:{}}; lsSet('sora_zukan_v1', zukan); renderZukan();
};

// ---------- 空に向ける ----------
// 背面カメラが向いている方角と仰角
function orient(a, b, g) {
  const r = Math.PI / 180, cA = Math.cos(a * r), sA = Math.sin(a * r), cB = Math.cos(b * r), sB = Math.sin(b * r),
    cG = Math.cos(g * r), sG = Math.sin(g * r);
  const vx = -(cG * sA * sB + cA * sG), vy = -(sA * sG - cA * cG * sB), vz = -cB * cG;
  return {az:norm360(Math.atan2(vx, vy) / r), el:Math.asin(Math.max(-1, Math.min(1, vz))) / r};
}
function onOri(e) {
  if (e.alpha == null && e.webkitCompassHeading == null) return;
  let o;
  if (e.webkitCompassHeading != null) { o = orient(0, e.beta || 0, e.gamma || 0); o.az = e.webkitCompassHeading; }
  else if (e.type === 'deviceorientationabsolute' || e.absolute) o = orient(e.alpha, e.beta || 0, e.gamma || 0);
  else return;
  const r = Math.PI / 180;
  if (!gotOri) { sx = Math.sin(o.az * r); sy = Math.cos(o.az * r); elevNow = o.el; }
  gotOri = true;
  sx = sx * 0.8 + Math.sin(o.az * r) * 0.2; sy = sy * 0.8 + Math.cos(o.az * r) * 0.2;
  elevNow = elevNow * 0.8 + o.el * 0.2;
  head = norm360(Math.atan2(sx, sy) / r + offset);
}
if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOri);
else window.addEventListener('deviceorientation', onOri);
const FOV = 35; // 照準の中心から画面の端までの角度（カメラなしのとき）
function drawScope() {
  const c = $('scope'), box = $('scopeBox'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = box.clientWidth, H = box.clientHeight;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (camOn) { g.clearRect(0, 0, W, H); g.shadowColor = 'rgba(0,0,0,.9)'; g.shadowBlur = 4; }
  else { g.fillStyle = '#0d1b2a'; g.fillRect(0, 0, W, H); g.shadowBlur = 0; }
  g.fillStyle = '#fff'; g.font = '14px sans-serif'; g.textAlign = 'left';
  if (head == null) {
    aimHex = null;
    g.fillText('方位センサーの値を待っています…', 10, 24);
    g.fillText('動かない場合は、スマホを8の字に数回振ってください', 10, 46);
    return;
  }
  const cx = W / 2, cy = H / 2, sc = Math.min(W, H) / 2 / (camOn ? fovCam : FOV);
  const ce = Math.cos(Math.min(80, Math.abs(elevNow)) * Math.PI / 180);
  const dAz = az => ((az - head + 540) % 360) - 180;
  const toXY = (az, el) => [cx + dAz(az) * ce * sc, cy - (el - elevNow) * sc];
  // 地面と地平線、方角
  const hy = cy + elevNow * sc;
  if (hy < H) {
    if (!camOn) { g.fillStyle = '#1c2b1c'; g.fillRect(0, Math.max(0, hy), W, H - Math.max(0, hy)); }
    g.strokeStyle = '#6b8e6b'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, hy); g.lineTo(W, hy); g.stroke();
  }
  g.font = 'bold 14px sans-serif'; g.textAlign = 'center'; g.fillStyle = '#9fc59f';
  for (let k = 0; k < 8; k++) { const [x] = toXY(k * 45, 0); if (x > -20 && x < W + 20) g.fillText(DIRS[k], x, Math.min(H - 40, Math.max(16, hy + 16))); }
  // 照準
  g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1;
  g.beginPath(); g.arc(cx, cy, 10 * sc, 0, 7); g.stroke();
  g.beginPath(); g.moveTo(cx - 12, cy); g.lineTo(cx + 12, cy); g.moveTo(cx, cy - 12); g.lineTo(cx, cy + 12); g.stroke();
  // 天体・機体・宇宙ステーションのうち、照準にいちばん近いものを選ぶ
  let aim = null;
  const consider = (t, o, ang, lim) => { if (ang < lim && (!aim || ang < aim.ang)) aim = {t, o, ang}; };
  const off = (x, y) => x < -60 || x > W + 60 || y < -20 || y > H + 20;
  g.textAlign = 'left';
  // 月・惑星・明るい星
  skyObjs.forEach(s => {
    if (s.el < -3) return;
    consider('sky', s, Math.hypot(dAz(s.az) * ce, s.el - elevNow), 8);
    const [x, y] = toXY(s.az, s.el);
    if (off(x, y)) return;
    const r = s.kind === 'moon' ? 10 : Math.max(1.6, 4.2 - s.mag * 0.9);
    g.fillStyle = s.kind === 'moon' ? '#fff6d0' : s.kind === 'planet' ? '#ffd98a' : '#dfe8ff';
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.fillStyle = s.kind === 'star' ? '#9fb3d9' : '#ffe9b0'; g.font = (s.kind === 'star' ? '' : 'bold ') + '12px sans-serif';
    g.fillText(s.name, x + r + 4, y + 4);
  });
  // 機体
  planes.forEach(p => {
    if (p.ground) return;
    consider('plane', p, Math.hypot(dAz(p.dir) * ce, p.elev - elevNow), 12);
    const [x, y] = toXY(p.dir, p.elev);
    if (off(x, y)) return;
    g.fillStyle = p.mil ? '#ff6b5b' : p.sun ? '#ffc93c' : '#5bb8ff';
    g.beginPath(); g.arc(x, y, p.hex === sel ? 7 : 5, 0, 7); g.fill();
    const ri = routeInfo(p);
    g.fillStyle = '#fff'; g.font = '12px sans-serif';
    g.fillText((p.cs || p.reg || '?') + (ri ? ' ' + ri.destName + '行き' : p.mil ? ' 軍用機' : ''), x + 9, y + 4);
  });
  // 宇宙ステーション
  if (issNow && issNow.el > -5) {
    consider('iss', issNow, Math.hypot(dAz(issNow.az) * ce, issNow.el - elevNow), 12);
    const [x, y] = toXY(issNow.az, issNow.el);
    if (!off(x, y)) {
      g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(x, y - 8); g.lineTo(x + 8, y); g.lineTo(x, y + 8); g.lineTo(x - 8, y); g.closePath(); g.fill();
      g.font = 'bold 12px sans-serif'; g.fillText('ISS 国際宇宙ステーション', x + 11, y + 4);
    }
  }
  aimHex = aim && aim.t === 'plane' ? aim.o.hex : null;
  if (aim) {
    const o = aim.o, [x, y] = aim.t === 'plane' ? toXY(o.dir, o.elev) : toXY(o.az, o.el);
    g.strokeStyle = '#ffd54f'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 15, 0, 7); g.stroke();
  }
  // 文字
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, W, 24); g.fillRect(0, H - 46, W, 46);
  g.fillStyle = '#fff'; g.font = '13px sans-serif';
  g.fillText(`向き：${dirName(head)} ${Math.round(head)}°　仰角 ${Math.round(elevNow)}°`, 8, 17);
  const say = (a1, a2, col) => {
    g.font = 'bold 15px sans-serif'; g.fillStyle = col; g.fillText(a1, 8, H - 26);
    g.font = '12px sans-serif'; g.fillStyle = '#fff'; g.fillText(a2, 8, H - 9);
  };
  if (!aim) {
    g.font = '13px sans-serif'; g.fillStyle = '#ccc';
    g.fillText('照準の近くに機体や星はありません', 8, H - 18);
  } else if (aim.t === 'plane') {
    const b = aim.o;
    say('照準：' + routeText(b), `${infoText(b)}・高度${b.altM.toLocaleString()}m・${b.dist.toFixed(1)}km（タップで詳細）`, b.mil ? '#ff8a7a' : '#ffd54f');
  } else if (aim.t === 'iss') {
    const vis = issVisible(issNow, new Date());
    say('照準：国際宇宙ステーション', `高度${Math.round(issNow.alt)}km・${Math.round(issNow.range)}km先・${vis ? '肉眼で見えます' : '肉眼では見えない条件です'}`, '#ffffff');
  } else {
    const s = aim.o, where = `${dirName(s.az)}・高さ${Math.round(s.el)}°`;
    if (s.kind === 'moon') say(`照準：月（${moonPhaseName()}）`, `${where}・明るさ ${s.mag.toFixed(1)}等`, '#fff6d0');
    else if (s.kind === 'planet') say(`照準：${s.name}（惑星）`, `${where}・明るさ ${s.mag.toFixed(1)}等・いま見えている中で${brightRank(s)}番目に明るい`, '#ffd98a');
    else say(`照準：${s.name}`, `${s.desc}・${where}・${s.mag.toFixed(1)}等`, '#dfe8ff');
  }
}
function scopeLoop() { if (!sky) return; drawScope(); requestAnimationFrame(scopeLoop); }
function setSky(on) {
  sky = on;
  document.body.classList.toggle('skyOn', on);
  $('skyBtn').classList.toggle('on', on);
  $('skyBtn').textContent = on ? '空に向ける：ON' : '空に向ける';
  $('skyCtl').style.display = on ? 'block' : 'none';
  if (on) {
    requestAnimationFrame(scopeLoop);
    setTimeout(() => { if (sky && !gotOri) $('skyInfo').textContent = 'この端末では方位センサーが使えないようです'; }, 1500);
  } else { stopCam(); map.resize(); }
}
$('skyBtn').onclick = () => setSky(!sky);
$('scope').onclick = () => { if (aimHex && sel !== aimHex) select(aimHex, true); };
function showOffset() { $('offVal').textContent = (offset > 0 ? '+' : '') + offset + '°'; }
function changeOffset(d) { offset += d; showOffset(); lsSet('sora_offset', offset); }
$('offMinus').onclick = () => changeOffset(-5);
$('offPlus').onclick = () => changeOffset(5);
showOffset();
// ---------- カメラ越しの空 ----------
async function startCam() {
  try {
    camStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}}, audio:false});
    const v = $('cam'); v.srcObject = camStream; v.style.display = 'block';
    try { await v.play(); } catch (e) {}
    camOn = true;
  } catch (e) { camOn = false; $('skyInfo').textContent = 'カメラを使えませんでした（' + e.message + '）'; }
  showCamUi();
}
function stopCam() {
  if (camStream) camStream.getTracks().forEach(t => t.stop());
  camStream = null; camOn = false;
  const v = $('cam'); v.srcObject = null; v.style.display = 'none';
  showCamUi();
}
function showCamUi() {
  $('camBtn').classList.toggle('on', camOn);
  $('camBtn').textContent = camOn ? 'カメラ：ON' : 'カメラ';
  $('fovCtl').style.display = camOn ? 'inline' : 'none';
}
$('camBtn').onclick = () => { if (camOn) stopCam(); else startCam(); };
function changeFov(d) { fovCam = Math.max(10, Math.min(60, fovCam + d)); lsSet('sora_fov', fovCam); }
$('fovMinus').onclick = () => changeFov(-2);
$('fovPlus').onclick = () => changeFov(2);

// ---------- 国際宇宙ステーション ----------
let issRec = null, issNow = null, issPasses = [], issPassAt = null, issPassPos = null, issBusy = false, issMsg = '', issMarker = null;
const issNotified = new Set(), WDAY = ['日', '月', '火', '水', '木', '金', '土'];
async function loadTle() {
  const c = lsGet('sora_tle', null);
  if (c && Date.now() - c.t < 12 * 3600000) return c;
  const lines = t => t.trim().split(/\r?\n/).map(s => s.trim()).filter(s => /^[12] 25544/.test(s));
  const srcs = [
    async () => { const j = await (await tfetch('https://api.wheretheiss.at/v1/satellites/25544/tles', 8000)).json(); return [j.line1, j.line2]; },
    async () => lines(await (await tfetch('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE', 8000)).text()),
    async () => { if (!RELAY_CF) return []; return lines(await (await tfetch(RELAY_CF + '/tle', 10000)).text()); }
  ];
  for (const f of srcs) {
    try {
      const [l1, l2] = await f();
      if (/^1 25544/.test(l1 || '') && /^2 25544/.test(l2 || '')) { const o = {t:Date.now(), l1, l2}; lsSet('sora_tle', o); return o; }
    } catch (e) {}
  }
  return c; // 取れなければ古いものを使う
}
function issLook(date) {
  const pv = satellite.propagate(issRec, date);
  if (!pv || !pv.position) return null;
  const gmst = satellite.gstime(date), ecf = satellite.eciToEcf(pv.position, gmst);
  const la = satellite.ecfToLookAngles({longitude:pos[0] * D2R, latitude:pos[1] * D2R, height:0.1}, ecf);
  const gd = satellite.eciToGeodetic(pv.position, gmst);
  return {az:norm360(la.azimuth / D2R), el:la.elevation / D2R, range:la.rangeSat, alt:gd.height,
    lat:satellite.degreesLat(gd.latitude), lon:satellite.degreesLong(gd.longitude), eci:pv.position};
}
function issLit(r, date) { // 宇宙ステーションに日が当たっているか（地球の影の外か）
  const s = sunVec(date), dot = r.x * s[0] + r.y * s[1] + r.z * s[2];
  if (dot > 0) return true;
  return Math.hypot(r.x - dot * s[0], r.y - dot * s[1], r.z - dot * s[2]) > RE;
}
const issVisible = (L, d) => L.el > 10 && sunAt(pos[1], pos[0], d).el < -6 && issLit(L.eci, d);
async function computePasses() {
  if (!issRec || !pos || issBusy) return;
  issBusy = true;
  const start = Date.now(), step = 20000, end = start + 72 * 3600000, passes = [];
  let cur = null, k = 0;
  for (let t = start; t < end; t += step, k++) {
    const d = new Date(t), L = issLook(d);
    if (L && issVisible(L, d)) {
      if (!cur) cur = {s:t, saz:L.az, max:L.el, e:t, eaz:L.az};
      else { cur.e = t; cur.eaz = L.az; if (L.el > cur.max) cur.max = L.el; }
    } else if (cur) { passes.push(cur); cur = null; if (passes.length >= 4) break; }
    if (k % 400 === 0) await new Promise(r => setTimeout(r));
  }
  if (cur) passes.push(cur);
  issPasses = passes.filter(p => p.e - p.s >= 40000);
  issPassAt = Date.now(); issPassPos = pos.slice(); issBusy = false;
  renderIss();
}
const hm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const md = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}（${WDAY[d.getDay()]}）`; };
function renderIss() {
  const el = $('iss');
  if (issMsg) { el.textContent = '国際宇宙ステーション：' + issMsg; return; }
  if (!issRec) { el.textContent = '国際宇宙ステーション：軌道データを読み込み中…'; return; }
  const now = Date.now(), lines = [];
  if (issNow && issNow.el > 0) {
    const vis = issVisible(issNow, new Date(now));
    lines.push(`<b>いま地平線の上</b>：${dirName(issNow.az)} 仰角${Math.round(issNow.el)}°・${Math.round(issNow.range)}km先${vis ? '　<b style="color:#c0392b">肉眼で見えます！</b>' : '（空が明るいか地球の影の中で、肉眼では見えません）'}`);
  }
  const next = issPasses.find(p => p.e > now);
  if (next) {
    const on = next.s <= now;
    lines.push(`${on ? '<b style="color:#c0392b">いま通過中</b>' : '次に見えるのは'}　${md(next.s)} ${hm(next.s)}〜${hm(next.e)}　${dirName(next.saz)}から${dirName(next.eaz)}へ　最大の高さ${Math.round(next.max)}°`);
  } else if (issPassAt) lines.push('3日以内に肉眼で見える通過はありません');
  else lines.push('見える時刻を計算中…');
  el.innerHTML = '<b>国際宇宙ステーション</b>　' + lines.join('<br>');
}
function issTick() {
  if (!issRec || !pos) return;
  const now = Date.now();
  issNow = issLook(new Date(now));
  if (issNow && issNow.el > 0 && issVisible(issNow, new Date(now))) dayIss(now);
  if (issNow) {
    if (!issMarker) {
      const e = document.createElement('div'); e.className = 'iss'; e.textContent = 'ISS';
      issMarker = new mapboxgl.Marker({element:e}).setLngLat([issNow.lon, issNow.lat]).addTo(map);
    } else issMarker.setLngLat([issNow.lon, issNow.lat]);
  }
  if (!issPassAt || now - issPassAt > 1800000 || (issPassPos && gcKm(issPassPos, pos) > 30)
      || (issPasses[0] && issPasses[0].e < now)) computePasses();
  const next = issPasses.find(p => p.e > now);
  if (next && next.s - now <= 300000 && next.s - now > -60000 && !issNotified.has(next.s)) {
    issNotified.add(next.s);
    alertMsg(`まもなく宇宙ステーションが見えます：${hm(next.s)}から ${dirName(next.saz)}の空`, null, true);
  }
  renderIss();
}
async function startIss() {
  if (typeof satellite === 'undefined') { issMsg = '計算の部品を読み込めませんでした'; renderIss(); return; }
  renderIss();
  const tle = await loadTle();
  if (!tle) { issMsg = '軌道データを取得できませんでした（あとで開き直してください）'; renderIss(); return; }
  issRec = satellite.twoline2satrec(tle.l1, tle.l2);
  issTick();
  setInterval(() => { if (!document.hidden) issTick(); }, 2000);
}

// ---------- この便に乗る（機窓ビュー） ----------
let ride = null, rideHex = null, rideView = 'right', rideLast = null, rideRaf = null, rideInfoAt = 0;
let rideStd = true, ridePreset = '', rideFallbackTimer = null;
const FOG = {
  day:{color:'rgb(220,232,245)', 'high-color':'#5d93d9', 'space-color':'#3c6fbf', 'horizon-blend':0.06, 'star-intensity':0},
  dawn:{color:'#f2c3a0', 'high-color':'#6f7fb8', 'space-color':'#23305e', 'horizon-blend':0.12, 'star-intensity':0.1},
  dusk:{color:'#f0a46e', 'high-color':'#7a4f8f', 'space-color':'#1d2346', 'horizon-blend':0.14, 'star-intensity':0.25},
  night:{color:'#1a2233', 'high-color':'#0b1026', 'space-color':'#000008', 'horizon-blend':0.05, 'star-intensity':0.7}
};
function lightFor(p) { // 機体の高さでの空の明るさ
  const s = sunAt(p.p[1], p.p[0], new Date()), dip = Math.acos(RE / (RE + Math.max(0, p.altM) / 1000)) / D2R;
  const el = s.el + dip;
  if (el > 8) return 'day';
  if (el > -5) return s.H > 0 ? 'dusk' : 'dawn';
  return 'night';
}
function applyLight(p) {
  if (!ride || !p || !ride.isStyleLoaded()) return;
  const pr = lightFor(p);
  if (pr === ridePreset) return;
  ridePreset = pr;
  if (rideStd) { try { ride.setConfigProperty('basemap', 'lightPreset', pr); } catch (e) {} }
  try { ride.setFog(FOG[pr]); } catch (e) {}
  $('rideTint').className = rideStd ? '' : 'tint-' + pr;
}
function setupRideStyle() {
  try {
    if (!ride.getSource('dem')) ride.addSource('dem', {type:'raster-dem', url:'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize:512, maxzoom:14});
    ride.setTerrain({source:'dem', exaggeration:1.2});
  } catch (e) {}
  ridePreset = ''; applyLight(rideLast);
}
function useFallbackStyle() { // 立体衛星写真の地図が使えないときは、従来の衛星写真の地図に切り替える
  if (!ride || !rideStd) return;
  rideStd = false; ride.setStyle('mapbox://styles/mapbox/satellite-streets-v12');
}
function openRide(hex) {
  const p = planes.find(x => x.hex === hex) || allList.find(x => x.hex === hex);
  if (!p || p.ground) return;
  rideHex = hex; rideLast = p;
  $('ride').style.display = 'block';
  setRideView(rideView);
  if (!ride) {
    rideStd = true;
    ride = new mapboxgl.Map({container:'rideMap', style:'mapbox://styles/mapbox/standard-satellite', center:p.p, zoom:10, pitch:80,
      maxPitch:85, interactive:false});
    ride.on('style.load', setupRideStyle);
    ride.on('error', () => { if (rideStd && !ride.isStyleLoaded()) useFallbackStyle(); });
    clearTimeout(rideFallbackTimer);
    rideFallbackTimer = setTimeout(() => { if (ride && rideStd && !ride.isStyleLoaded()) useFallbackStyle(); }, 10000);
  }
  cancelAnimationFrame(rideRaf); rideInfoAt = 0; rideLoop();
}
function closeRide() {
  rideHex = null; cancelAnimationFrame(rideRaf); clearTimeout(rideFallbackTimer);
  $('ride').style.display = 'none';
  if (ride) { ride.remove(); ride = null; }
}
function setRideView(v) {
  rideView = v; rideInfoAt = 0;
  document.querySelectorAll('#rideBtns button[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('rideFrame').style.display = v === 'front' ? 'none' : 'block';
}
function rideCam(p) {
  const az = norm360(p.track + {left:-90, front:0, right:90}[rideView]);
  const alt = Math.max(300, p.altM), down = rideView === 'front' ? 6 : 12;
  const tgt = destPt(p.p, az, Math.min(150, alt / 1000 / Math.tan(down * D2R)));
  const cam = ride.getFreeCameraOptions();
  cam.position = mapboxgl.MercatorCoordinate.fromLngLat({lng:p.p[0], lat:p.p[1]}, alt);
  cam.lookAtPoint({lng:tgt[0], lat:tgt[1]});
  ride.setFreeCameraOptions(cam);
}
function rideLoop() {
  if (!rideHex) return;
  const now = Date.now(), live = allList.find(x => x.hex === rideHex);
  if (live) rideLast = live;
  const q = rideLast;
  if (q) {
    place(q, now);
    if (ride) { try { rideCam(q); } catch (e) {} }
    if (now - rideInfoAt > 1000) { rideInfoAt = now; renderRide(q, !!live && now - q.t0 < 30000); applyLight(q); }
  }
  rideRaf = requestAnimationFrame(rideLoop);
}
function renderRide(q, live) {
  $('rideTitle').textContent = routeText(q);
  $('rideSub').textContent = [infoText(q), `高度 ${q.altM.toLocaleString()}m`, q.kmh && `時速${q.kmh}km`,
    live ? '' : '※機体を見失いました（最後の位置から予測中）'].filter(Boolean).join('・');
  const w = windowView(q), side = {left:'左', front:'前', right:'右'}[rideView];
  const list = w ? w.sides[side] : [];
  $('rideMarks').textContent = (rideView === 'front' ? '正面に見える目印：' : side + '窓に見える目印：')
    + (list.length ? list.map(x => `${x.name}（${x.sub} ${Math.round(x.d)}km）`).join('、') : 'この方向に目印はありません');
}
document.querySelectorAll('#rideBtns button[data-v]').forEach(b => b.onclick = () => setRideView(b.dataset.v));
$('rideExit').onclick = closeRide;

// ---------- 月・惑星・明るい星 ----------
let skyObjs = [], nightAt = 0, nightPos = null;
function calcSky(now) {
  if (typeof Astronomy === 'undefined' || !pos) return [];
  const d = new Date(now), obs = new Astronomy.Observer(pos[1], pos[0], 100), sunEl = sunAt(pos[1], pos[0], d).el, out = [];
  Object.keys(BODY_JA).forEach(b => {
    const minSun = b === 'Moon' ? 99 : b === 'Venus' ? 0 : -3; // 空が明るいと見えないものは出さない
    if (sunEl > minSun) return;
    try {
      const eq = Astronomy.Equator(b, d, obs, true, true), h = Astronomy.Horizon(d, obs, eq.ra, eq.dec, 'normal');
      out.push({kind:b === 'Moon' ? 'moon' : 'planet', name:BODY_JA[b], az:h.azimuth, el:h.altitude, mag:Astronomy.Illumination(b, d).mag});
    } catch (e) {}
  });
  if (sunEl < -6) STARS.forEach(s => {
    try { const h = Astronomy.Horizon(d, obs, s[1], s[2], 'normal'); out.push({kind:'star', name:s[0], az:h.azimuth, el:h.altitude, mag:s[3], desc:s[4]}); } catch (e) {}
  });
  return out;
}
function brightRank(s) { return skyObjs.filter(o => o.el > 0 && o.mag < s.mag).length + 1; }
function moonPhaseName(t) {
  if (typeof Astronomy === 'undefined') return '';
  const a = Astronomy.MoonPhase(new Date(t || Date.now()));
  const names = ['新月', '三日月', '上弦の月', '十三夜', '満月', '寝待月', '下弦の月', '有明の月'];
  return names[Math.floor(((a + 22.5) % 360) / 45)];
}
// 今夜見える月・惑星（これから16時間のうち、暗くて高さ10°以上の時間帯）
function renderNight() {
  if (typeof Astronomy === 'undefined' || !pos) { $('night').textContent = ''; return; }
  const now = Date.now(), obs = new Astronomy.Observer(pos[1], pos[0], 100), items = [];
  Object.keys(BODY_JA).forEach(b => {
    let s = null, e = null, az = 0;
    for (let t = now; t < now + 16 * 3600000; t += 600000) {
      const d = new Date(t), sunEl = sunAt(pos[1], pos[0], d).el;
      let ok = false, h = null;
      if (sunEl < (b === 'Moon' ? 0 : b === 'Venus' || b === 'Mercury' ? -3 : -6)) {
        try { const eq = Astronomy.Equator(b, d, obs, true, true); h = Astronomy.Horizon(d, obs, eq.ra, eq.dec, 'normal'); ok = h.altitude > 10; } catch (er) {}
      }
      if (ok) { if (s == null) { s = t; az = h.azimuth; } e = t; }
      else if (s != null) break;
    }
    if (s == null) return;
    const label = b === 'Moon' ? `月（${moonPhaseName(s)}）` : BODY_JA[b];
    items.push({s, text:`${label}：${s <= now + 60000 ? 'いま' : hm(s) + 'から'}${dirName(az)}の空（〜${hm(e)}）`});
  });
  items.sort((x, y) => x.s - y.s);
  $('night').innerHTML = '<b>今夜の空</b>　' + (items.length ? items.map(i => esc(i.text)).join('<br>') : '今夜は月や惑星が見えにくい夜です');
  nightAt = now; nightPos = pos.slice();
}
function skyTick() {
  if (!pos || document.hidden) return;
  skyObjs = calcSky(Date.now());
  if (!nightAt || Date.now() - nightAt > 600000 || (nightPos && gcKm(nightPos, pos) > 30)) renderNight();
}
function startSky() {
  if (typeof Astronomy === 'undefined') { $('night').textContent = '今夜の空：計算の部品を読み込めませんでした'; return; }
  skyTick();
  setInterval(skyTick, 2000);
}

// ---------- この空から行った都市 ----------
const nearCand = new Map(); // 10km以内を通った便（行き先が分かったら記録する）
let citiesMap = null;
function noteNear(list, now) {
  list.forEach(p => { if (!p.ground && !p.mil && p.dist <= 10 && /^[A-Z]{2,3}\d/.test(p.cs)) nearCand.set(p.hex, {cs:p.cs, t:now}); });
  nearCand.forEach((v, k) => { if (now - v.t > 1800000) nearCand.delete(k); });
}
function recordCities() {
  if (!nearCand.size) return;
  const d = today(), wasEmpty = Object.keys(cities.list).length === 0;
  let changed = false;
  nearCand.forEach((v, hex) => {
    const r = routeEntry(v.cs);
    if (!r) return;               // まだ行き先を調べていない
    nearCand.delete(hex);
    if (r.none || !r.a) return;   // 行き先が分からない便
    const key = v.cs + '|' + d;
    if (cities.seen[key]) return;
    cities.seen[key] = d; changed = true;
    const ap = r.a[1], id = ap.iata || ap.name;
    let c = cities.list[id];
    if (!c) {
      c = cities.list[id] = {name:apName(ap), lat:ap.lat, lon:ap.lon, n:0, first:d, last:d};
      if (!wasEmpty) alertMsg(`新しい行き先：${c.name}（${Object.keys(cities.list).length}都市目）`, null, false);
    }
    c.n++; c.last = d;
    dayCity(id, c.name, ap);
  });
  if (!changed) return;
  for (const k in cities.seen) if (cities.seen[k] !== d) delete cities.seen[k];
  lsSet('sora_cities_v1', cities);
  if ($('cities').style.display === 'block') renderCities();
}
function gcLine(a, b) { // 大圏コース（地球上の最短経路）の線
  const pts = [], d = gcKm(a, b), az = gcBrg(a, b), n = Math.max(2, Math.ceil(d / 100));
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const p = destPt(a, az, d * i / n);
    if (prev) { while (p[0] - prev[0] > 180) p[0] -= 360; while (p[0] - prev[0] < -180) p[0] += 360; }
    pts.push(p); prev = p;
  }
  pts[pts.length - 1] = [b[0] + Math.round((pts[pts.length - 1][0] - b[0]) / 360) * 360, b[1]];
  return pts;
}
function cityRows() {
  const home = pos || DEF;
  return Object.entries(cities.list).map(([id, c]) => ({id, ...c, d:gcKm(home, [c.lon, c.lat])}))
    .sort((x, y) => y.n - x.n || y.last.localeCompare(x.last));
}
function renderCities() {
  const rows = cityRows();
  if (!rows.length) {
    $('citiesSum').textContent = 'まだ記録がありません。近くを旅客機が通ると、行き先がここにたまっていきます';
    $('citiesBody').innerHTML = '';
  } else {
    const far = rows.reduce((m, r) => r.d > m.d ? r : m, rows[0]);
    $('citiesSum').textContent = `この空から${rows.length}都市へ　いちばん遠いのは${far.name}（${Math.round(far.d).toLocaleString()}km）`;
    $('citiesBody').innerHTML = rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.n}</td><td>${esc(r.first)}</td><td>${Math.round(r.d).toLocaleString()}km</td></tr>`).join('');
  }
  drawCitiesMap(rows);
}
function drawCitiesMap(rows) {
  if (!citiesMap) return;
  const home = pos || DEF;
  const lines = rows.map(r => ({type:'Feature', properties:{}, geometry:{type:'LineString', coordinates:gcLine(home, [r.lon, r.lat])}}));
  const pts = rows.map(r => {
    const g = gcLine(home, [r.lon, r.lat]), end = g[g.length - 1];
    return {type:'Feature', properties:{name:r.name, n:r.n}, geometry:{type:'Point', coordinates:end}};
  });
  const put = () => {
    const fc = f => ({type:'FeatureCollection', features:f});
    if (!citiesMap.getSource('cl')) {
      citiesMap.addSource('cl', {type:'geojson', data:fc(lines)});
      citiesMap.addLayer({id:'cl', type:'line', source:'cl', paint:{'line-color':'#e67e22', 'line-width':1.5, 'line-opacity':0.7}});
      citiesMap.addSource('cp', {type:'geojson', data:fc(pts)});
      citiesMap.addLayer({id:'cp', type:'circle', source:'cp', paint:{'circle-color':'#c0392b', 'circle-stroke-color':'#fff', 'circle-stroke-width':1,
        'circle-radius':['interpolate', ['linear'], ['get', 'n'], 1, 4, 10, 8, 50, 14]}});
      citiesMap.addLayer({id:'cn', type:'symbol', source:'cp', layout:{'text-field':['get', 'name'], 'text-size':12, 'text-offset':[0, 1.1], 'text-anchor':'top'},
        paint:{'text-color':'#333', 'text-halo-color':'#fff', 'text-halo-width':1.5}});
      citiesMap.addSource('home', {type:'geojson', data:fc([{type:'Feature', properties:{}, geometry:{type:'Point', coordinates:home}}])});
      citiesMap.addLayer({id:'home', type:'circle', source:'home', paint:{'circle-color':'#1e90ff', 'circle-radius':6, 'circle-stroke-color':'#fff', 'circle-stroke-width':2}});
    } else { citiesMap.getSource('cl').setData(fc(lines)); citiesMap.getSource('cp').setData(fc(pts)); }
    const b = new mapboxgl.LngLatBounds(home, home);
    pts.forEach(p => b.extend(p.geometry.coordinates));
    citiesMap.fitBounds(b, {padding:40, maxZoom:6, duration:0});
  };
  if (citiesMap.isStyleLoaded()) put(); else citiesMap.once('load', put);
}
$('citiesBtn').onclick = () => {
  $('cities').style.display = 'block';
  if (!citiesMap) citiesMap = new mapboxgl.Map({container:'citiesMap', style:'mapbox://styles/mapbox/light-v11', center:pos || DEF, zoom:1.5});
  renderCities();
};
$('citiesClose').onclick = () => {
  $('cities').style.display = 'none';
  if (citiesMap) { citiesMap.remove(); citiesMap = null; }
};
$('citiesReset').onclick = () => {
  if (!confirm('この空から行った都市の記録をすべて消します。よろしいですか？')) return;
  cities = {list:{}, seen:{}}; lsSet('sora_cities_v1', cities);
  if (citiesMap) { citiesMap.remove(); citiesMap = new mapboxgl.Map({container:'citiesMap', style:'mapbox://styles/mapbox/light-v11', center:pos || DEF, zoom:1.5}); }
  renderCities();
};

// ---------- 起動：前回の場所ですぐ始め、現在地が取れたら切り替える ----------
// ---------- 今日の空のまとめ ----------
// 1日ごとに30日分を残す。その日のうちは機体番号を覚えて同じ機体を数え直さないようにし、
// 日が変わったら機体番号と座標は消して、数と地名だけを残す
const DAY_KEEP = 30, SPOT_KM = 5, SPOT_MIN_MS = 180000, PAGE_T0 = Date.now();
let skyDays = lsGet('sora_day_v1', null); if (!skyDays || !skyDays.days || typeof skyDays.days !== 'object') skyDays = {days:{}};
let curSpot = null, daySaveTimer = null, dayView = null, muniP = null;
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function compactDays() {
  const td = today(), cut = ymd(new Date(Date.now() - DAY_KEEP * 86400000));
  Object.keys(skyDays.days).forEach(k => {
    if (k < cut) { delete skyDays.days[k]; return; }
    if (k === td) return;
    const D = skyDays.days[k];
    delete D.hx; delete D.sx;
    (D.sp || []).forEach(s => { delete s.hx; delete s.p; delete s.try; });
  });
}
compactDays();
function dayGet() {
  const td = today();
  let D = skyDays.days[td];
  if (!D) {
    compactDays();
    D = skyDays.days[td] = {n:0, hx:{}, ty:{}, nt:[], mil:{}, milN:0, ct:{}, near:null, sun:null, sx:{}, iss:0, sp:[]};
    curSpot = null;
  }
  if (!D.hx) D.hx = {};
  if (!D.sx) D.sx = {};
  return D;
}
function daySave(force) {
  if (force) { clearTimeout(daySaveTimer); daySaveTimer = null; lsSet('sora_day_v1', skyDays); return; }
  if (daySaveTimer) return;
  daySaveTimer = setTimeout(() => { daySaveTimer = null; lsSet('sora_day_v1', skyDays); }, 20000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') daySave(true); });
window.addEventListener('pagehide', () => daySave(true));

// いまいる「見た場所」を決める（前の場所から5km以上離れたら新しい場所）
function spotFor(D, now) {
  const unconf = usingDef || usingSaved;
  let s = null;
  if (unconf) s = D.sp.find(x => x.u) || null;
  else {
    let bd = SPOT_KM;
    D.sp.forEach(x => { if (x.u || !x.p) return; const d = gcKm(x.p, pos); if (d <= bd) { bd = d; s = x; } });
  }
  if (!s) {
    s = {name:unconf ? '位置未確認' : '', u:unconf ? 1 : 0, p:[+pos[0].toFixed(2), +pos[1].toFixed(2)], from:now, to:now, n:0, hx:{}, near:null};
    D.sp.push(s);
  }
  if (curSpot && curSpot !== s && D.sp.includes(curSpot)) {
    const c = curSpot; // 移動中に3分未満通っただけの場所は、場所ごとの欄から外す（合計には残る）
    if (!c.u && c.to - c.from < SPOT_MIN_MS && now - c.to < 60000) D.sp.splice(D.sp.indexOf(c), 1);
  }
  curSpot = s;
  if (!s.hx) s.hx = {};
  if (!s.u && !s.name && now - (s.try || 0) > 300000) { s.try = now; spotName(s, pos.slice()); }
  return s;
}
const nearRec = (p, now) => ({cs:p.cs, reg:p.reg, ty:p.type, km:Math.round(p.dist * 10) / 10, alt:p.altM, t:now});
function dayRecord(list, now) {
  if (!pos) return;
  // 起動直後は前回の場所で表示していることが多いので、1分は現在地が取れるのを待つ
  if ((usingDef || usingSaved) && now - PAGE_T0 < 60000) return;
  const D = dayGet(), s = spotFor(D, now);
  s.to = now;
  list.forEach(p => {
    if (p.ground) return;
    if (!D.hx[p.hex]) {
      D.hx[p.hex] = 1; D.n++;
      const code = p.type || '?';
      D.ty[code] = (D.ty[code] || 0) + 1;
      if (p.mil) { D.milN++; D.mil[code] = (D.mil[code] || 0) + 1; }
    }
    if (!s.hx[p.hex]) { s.hx[p.hex] = 1; s.n++; }
    if (!s.near || p.dist < s.near.km) s.near = nearRec(p, now);
    if (!s.u && (!D.near || p.dist < D.near.km)) D.near = nearRec(p, now);
    if (p.sun && !D.sx[p.hex]) {
      D.sx[p.hex] = 1;
      if (!D.sun) D.sun = {n:0, t0:now, t1:now, k:p.sun.kind};
      D.sun.n++; D.sun.t1 = now; D.sun.k = p.sun.kind;
    }
  });
  daySave(false);
  if ($('day').style.display === 'block' && dayView === today()) renderDay(dayView);
}
function dayNewType(code) { const D = dayGet(); if (!D.nt.includes(code)) { D.nt.push(code); daySave(false); } }
function dayCity(id, name, ap) {
  const D = dayGet();
  if (!D.ct[id]) { D.ct[id] = {name, km:Math.round(gcKm(pos || DEF, [ap.lon, ap.lat]))}; daySave(false); }
}
function dayIss(now) { const D = dayGet(); if (!D.iss) { D.iss = now; daySave(false); } }

// 地名（市区町村）は国土地理院の仕組みで調べる（保存してよい）
function loadMuni() {
  if (muniP) return muniP;
  muniP = new Promise((res, rej) => {
    window.GSI = window.GSI || {};
    const sc = document.createElement('script');
    sc.src = 'https://maps.gsi.go.jp/js/muni.js';
    sc.onload = () => res(window.GSI.MUNI_ARRAY || {});
    sc.onerror = () => { muniP = null; rej(new Error('市区町村の一覧を読み込めません')); };
    document.head.appendChild(sc);
  });
  return muniP;
}
async function spotName(s, pt) {
  try {
    const r = await tfetch(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${pt[1].toFixed(5)}&lon=${pt[0].toFixed(5)}`, 10000);
    const j = await r.json(), cd = String((j && j.results && j.results.muniCd) || '');
    if (!cd) { s.name = '地名なし'; return; }
    const M = await loadMuni(), v = M[cd] || M[cd.padStart(5, '0')] || M[cd.replace(/^0+/, '')];
    if (!v) return;
    s.name = String(v).split(',')[3].replace(/\s+/g, '');
    daySave(false);
    if ($('day').style.display === 'block' && dayView === today()) renderDay(dayView);
  } catch (e) {} // 取れなければ5分後にやり直す
}

// 画面
function dateLabel(k) { const [y, m, d] = k.split('-').map(Number); return `${m}月${d}日（${WDAY[new Date(y, m - 1, d).getDay()]}）`; }
const tyName = c => c === '?' ? '機種不明' : (TYPE[c] || c);
function csRoute(cs) { const r = routeEntry(cs); return r && !r.none && r.a ? r.a.map(apName).join(' → ') : ''; }
function nearHtml(n) {
  if (!n) return 'なし';
  const who = [n.cs || n.reg, n.ty ? tyName(n.ty) : ''].filter(Boolean).join('・'), rt = n.cs ? csRoute(n.cs) : '';
  return `${esc(who)}${rt ? '　' + esc(rt) : ''}<br><span class="small">${n.km.toFixed(1)}km先・高度${n.alt.toLocaleString()}m（${hm(n.t)}）</span>`;
}
function issDayText(D, isToday) {
  const t = [];
  if (D && D.iss) t.push(`肉眼で見える時間にアプリを開いていました（${hm(D.iss)}）`);
  if (isToday) {
    const until = new Date(); until.setDate(until.getDate() + 1); until.setHours(6, 0, 0, 0);
    const ps = issPasses.filter(p => p.e > Date.now() && p.s < until.getTime());
    if (ps.length) t.push('今夜の見える通過：' + ps.map(p => `${hm(p.s)}〜${hm(p.e)} ${dirName(p.saz)}から${dirName(p.eaz)}へ（最大${Math.round(p.max)}°）`).join('、'));
    else if (issPassAt) t.push('今夜は肉眼で見える通過はありません');
  }
  return t.length ? t.join('<br>') : 'なし';
}
function renderDay(k) {
  dayView = k;
  const D = skyDays.days[k], isToday = k === today();
  $('dayTitle').textContent = (isToday ? '今日の空　' : '') + dateLabel(k) + (isToday ? '' : 'の空');
  const row = (t, v) => `<div class="drow"><b>${t}</b>　${v}</div>`;
  let h = '';
  if (!D || !D.n) h = '<div class="drow small">この日の記録はまだありません。アプリを開いている間に見えた機体がここにたまっていきます</div>';
  else {
    const types = Object.keys(D.ty).filter(c => c !== '?');
    const cts = Object.values(D.ct || {}), far = cts.reduce((m, c) => !m || c.km > m.km ? c : m, null);
    const mils = Object.entries(D.mil || {}).sort((a, b) => b[1] - a[1]).map(([c, n]) => tyName(c) + (n > 1 ? `×${n}` : ''));
    h += `<div class="dbig">見た機体 ${D.n}機・${types.length}機種</div>`;
    h += row('図鑑に初登場', D.nt.length ? esc(D.nt.map(tyName).join('、')) : 'なし');
    h += row('行き先', cts.length ? `${cts.length}都市　いちばん遠いのは${esc(far.name)}（${far.km.toLocaleString()}km）` : 'なし');
    h += row('軍用機', D.milN ? `${D.milN}機（${esc(mils.join('、'))}）` : 'なし');
    h += row('いちばん近くを通った機体', nearHtml(D.near));
    h += row('夕日・朝日', D.sun ? `${D.sun.k}を浴びた機体 ${D.sun.n}機（${hm(D.sun.t0)}〜${hm(D.sun.t1)}）` : 'なし');
  }
  h += row('宇宙ステーション', issDayText(D, isToday));
  const sp = (D && D.sp) || [];
  if (sp.length) {
    h += '<div class="dhead">見た場所</div>' + sp.map((s, i) => {
      const nm = s.name || (s.u ? '位置未確認' : `場所${i + 1}（地名を調べ中）`);
      const nr = s.near ? `${esc(s.near.cs || s.near.reg || tyName(s.near.ty))}（${s.near.km.toFixed(1)}km）` : 'なし';
      return `<div class="dspot"><b>${esc(nm)}</b>　${hm(s.from)}〜${hm(s.to)}　${s.n}機<br><span class="small">いちばん近く：${nr}</span></div>`;
    }).join('');
  }
  $('dayBody').innerHTML = h;
  const ks = Object.keys(skyDays.days).sort().reverse();
  $('dayList').innerHTML = ks.length ? ks.map(x => {
    const E = skyDays.days[x];
    return `<tr data-k="${esc(x)}"${x === k ? ' class="dsel"' : ''}><td>${dateLabel(x)}</td><td>${E.n}機</td><td>${Object.keys(E.ty || {}).filter(c => c !== '?').length}機種</td><td>${(E.sp || []).length}か所</td></tr>`;
  }).join('') : '<tr><td colspan="4">まだ記録がありません</td></tr>';
  $('dayList').querySelectorAll('tr[data-k]').forEach(tr => tr.onclick = () => { renderDay(tr.dataset.k); $('day').scrollTop = 0; });
}
$('dayBtn').onclick = () => { renderDay(today()); $('day').style.display = 'block'; $('day').scrollTop = 0; };
$('dayClose').onclick = () => { $('day').style.display = 'none'; dayView = null; };
$('dayReset').onclick = () => {
  if (!confirm('今日の空の記録（30日分）をすべて消します。よろしいですか？')) return;
  skyDays = {days:{}}; curSpot = null; daySave(true); renderDay(today());
};
const savedPos = lsGet('sora_lastpos', null);
if (Array.isArray(savedPos) && savedPos.length === 2 && savedPos.every(v => typeof v === 'number' && isFinite(v))) setPos(savedPos, false, true);
if ('geolocation' in navigator) {
  navigator.geolocation.watchPosition(
    g => {
      const p = [g.coords.longitude, g.coords.latitude], wasSaved = usingSaved || usingDef;
      setPos(p, false, false);
      lsSet('sora_lastpos', [+p[0].toFixed(3), +p[1].toFixed(3)]);
      if (wasSaved) setTimeout(tick, busy ? 1500 : 0);
    },
    e => { if (!pos) setPos(DEF, true); showErr('位置情報：' + e.message); },
    {enableHighAccuracy:false, maximumAge:30000, timeout:20000});
} else if (!pos) setPos(DEF, true);
startIss();
startSky();
