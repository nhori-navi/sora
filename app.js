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
let realHome = () => pos || DEF; // 本当の現在地（v25 で、よその空にいても最後に分かった現在地を返すように切り替える）
const markers = new Map(), photos = new Map(), notified = new Set();

// ---------- 保存（スマホ内） ----------
function lsGet(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
// v31：図鑑の数え方を変えたので、開発中の記録を1回だけ消す（設定・現在地・ためた行き先は残す）
try {
  if (!localStorage.getItem('sora_reset_v31')) {
    ['sora_zukan_v1', 'sora_cities_v1', 'sora_day_v1', 'sora_catch_v1', 'sora_badge_v1', 'sora_yoso_v1', 'sora_seen_v1'].forEach(k => localStorage.removeItem(k));
    localStorage.setItem('sora_reset_v31', '1');
  }
} catch (e) {}
let routes = lsGet('sora_routes_v1', {}); if (!routes || typeof routes !== 'object') routes = {};
let zukan = lsGet('sora_zukan_v1', null); if (!zukan || !zukan.types || !zukan.seen) zukan = {types:{}, seen:{}};
// v31：表示範囲で見かけた回数（機種ごと。図鑑には出さず、レア度に使う）。図鑑に入れるのは10km以内を通った機体とキャッチした機体
let seenAll = lsGet('sora_seen_v1', null); if (!seenAll || !seenAll.types || !seenAll.seen) seenAll = {types:{}, seen:{}};
const ZK_KM = 10;
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
const routeWait = new Map(); // v27：中継が調べられなかった便 → もう一度中継に聞いてよい時刻（2分あと）
let relayRtFail = 0, relayRtOffUntil = 0, rtLastErr = ''; // v28：中継が続けて失敗した回数・中継を休む時刻・うまくいかない理由
let relaySkip = () => false; // v28：中継に聞かないとき（よその空・中継を休んでいる間）
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
  lat:+(+a.latitude).toFixed(3), lon:+(+a.longitude).toFixed(3), cc:a.country_iso_name || ''});
async function fetchRoutes(list) {
  if (routeBusy || relaySkip()) return false;
  const need = [...new Set(list.filter(p => !p.mil && /^[A-Z]{2,3}\d/.test(p.cs) && !routeEntry(p.cs) && !((routeWait.get(p.cs) || 0) > Date.now())).map(p => p.cs))].slice(0, 10);
  if (!need.length) return false;
  routeBusy = true;
  try {
    if (!RELAY_CF) return false;
    const r = await tfetch(`${RELAY_CF}/routes/${need.join(',')}`, 15000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(), now = Date.now();
    let nErr = 0;
    need.forEach(cs => {
      const fr = j[cs];
      if (fr && fr.origin && fr.destination) routes[cs] = {t:now, a:[apConv(fr.origin), apConv(fr.destination)]};
      else if (!fr) routes[cs] = {t:now, none:1};
      else { routeWait.set(cs, now + 120000); nErr++; rtLastErr = '中継：' + fr.error; } // 中継が調べられなかった便は2分あとに回す（v27）
    });
    if (nErr < need.length) { relayRtFail = 0; if (/^中継/.test(rtLastErr)) rtLastErr = ''; }
    else if (++relayRtFail >= 3) relayRtOffUntil = now + 600000; // 3回続けて全部だめなら10分間は中継を休む（v28）
    saveRoutes();
    return true;
  } catch (e) {
    need.forEach(cs => routeWait.set(cs, Date.now() + 120000)); rtLastErr = '中継：' + (e.name === 'AbortError' ? '応答なし' : e.message);
    if (++relayRtFail >= 3) relayRtOffUntil = Date.now() + 600000;
    showErr('行き先の取得に失敗：' + e.message + '（中継のコードを新しくしたか確認してください）'); return false; }
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
  const d = today();
  let changed = false, seenCh = false;
  list.forEach(p => {
    if (p.ground) return;
    const k = p.hex + '|' + d;
    if (!seenAll.seen[k]) { seenAll.seen[k] = d; seenCh = true; const c = p.type || '?'; seenAll.types[c] = (seenAll.types[c] || 0) + 1; }
    if (!(p.dist <= ZK_KM) && !p.zkCatch) return; // 図鑑に入れるのは10km以内を通った機体とキャッチした機体（v31）
    if (zukan.seen[k]) return;
    zukan.seen[k] = d; changed = true;
    const code = p.type || '?';
    let e = zukan.types[code];
    if (!e) {
      e = zukan.types[code] = {n:0, first:d, last:d, mil:0};
      if (p.type) dayNewType(p.type);
      if (p.type && !p.zkCatch) { // キャッチのときは、キャッチの知らせが出るので出さない（v31）
        const cnt = Object.keys(zukan.types).filter(x => x !== '?').length;
        alertMsg(`新しい機種を発見：${typeName(p)}（図鑑 ${cnt}種目）`, p.hex, false);
      }
    }
    e.n++; e.last = d; if (p.mil) e.mil = 1;
  });
  if (seenCh) {
    for (const k in seenAll.seen) if (seenAll.seen[k] !== d) delete seenAll.seen[k];
    lsSet('sora_seen_v1', seenAll);
  }
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
  o.el += offsetEl;
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
  const conAim = conLayer(g, toXY, dAz, off, W, H, cx, cy, sc);
  // 月・惑星・明るい星
  skyObjs.forEach(s => {
    if (s.el < -3) return;
    consider('sky', s, Math.hypot(dAz(s.az) * ce, s.el - elevNow), 8);
    const [x, y] = toXY(s.az, s.el);
    if (off(x, y)) return;
    const r = s.kind === 'moon' ? 10 : Math.max(1.6, 4.2 - s.mag * 0.9);
    g.fillStyle = s.kind === 'moon' ? '#fff6d0' : s.kind === 'planet' ? '#ffd98a' : '#dfe8ff';
    if (s.kind === 'moon' && s.frac != null) drawMoon(g, x, y, 11, s.frac, s.limb); else { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
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
  catchStep(g, toXY, off);
  if (!aim && conAim) conAim.hi();
  // 文字
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, W, 24); g.fillRect(0, H - 46, W, 46);
  g.fillStyle = '#fff'; g.font = '13px sans-serif';
  g.fillText(`向き：${dirName(head)} ${Math.round(head)}°　仰角 ${Math.round(elevNow)}°`, 8, 17);
  const say = (a1, a2, col) => {
    g.font = 'bold 15px sans-serif'; g.fillStyle = col; g.fillText(a1, 8, H - 26);
    g.font = '12px sans-serif'; g.fillStyle = '#fff'; g.fillText(a2, 8, H - 9);
  };
  if (!aim && conAim) conSay(conAim.c, say);
  else if (!aim) {
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
function showOffset() { const v = Math.round(offset); $('offVal').textContent = (v > 0 ? '+' : '') + v + '°'; }
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
  skyExtra(out, d, obs, sunEl);
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
  moonNight(items, now, obs);
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
  const home = realHome();
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
  const home = realHome();
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
  if (!citiesMap) citiesMap = new mapboxgl.Map({container:'citiesMap', style:'mapbox://styles/mapbox/light-v11', center:realHome(), zoom:1.5, projection:'globe'});
  renderCities();
};
$('citiesClose').onclick = () => {
  $('cities').style.display = 'none';
  if (citiesMap) { citiesMap.remove(); citiesMap = null; }
};
$('citiesReset').onclick = () => {
  if (!confirm('この空から行った都市の記録をすべて消します。よろしいですか？')) return;
  cities = {list:{}, seen:{}}; lsSet('sora_cities_v1', cities);
  if (citiesMap) { citiesMap.remove(); citiesMap = new mapboxgl.Map({container:'citiesMap', style:'mapbox://styles/mapbox/light-v11', center:realHome(), zoom:1.5, projection:'globe'}); }
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
    const meet = p.dist <= ZK_KM || p.zkCatch; // 今日の空の数も、10km以内を通った機体とキャッチした機体（v31）
    if (meet && !D.hx[p.hex]) {
      D.hx[p.hex] = 1; D.n++;
      const code = p.type || '?';
      D.ty[code] = (D.ty[code] || 0) + 1;
      if (p.mil) { D.milN++; D.mil[code] = (D.mil[code] || 0) + 1; }
    }
    if (meet && !s.hx[p.hex]) { s.hx[p.hex] = 1; s.n++; }
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
  if (!D.ct[id]) { D.ct[id] = {name, km:Math.round(gcKm(realHome(), [ap.lon, ap.lat]))}; daySave(false); }
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
    h += row('キャッチ', catchDayHtml(D));
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
// ---------- 方角を合わせる（v11） ----------
// カメラ画面の十字に本物の天体（月・惑星・1.5等より明るい星）を入れてボタンを押すと、
// 計算上の位置とのずれを左右（offset）と上下（offsetEl）の補正に入れる
let offsetEl = Number(lsGet('sora_offset_el', 0)) || 0, cal = lsGet('sora_cal', null), calUndo = null;
const CAL_MAX = 20, CAL_MIN_EL = 5, CAL_MAX_EL = 65, CAL_MAX_DAZ = 30;
const sgn = v => (v >= 0 ? '+' : '−') + Math.abs(Math.round(v));
function angSep(az1, el1, az2, el2) {
  const c = Math.sin(el1 * D2R) * Math.sin(el2 * D2R) + Math.cos(el1 * D2R) * Math.cos(el2 * D2R) * Math.cos((az1 - az2) * D2R);
  return Math.acos(Math.max(-1, Math.min(1, c))) / D2R;
}
function calTargets() {
  // 真上に近いと方角の数字が大きくぶれるので、高さ5〜65°の天体だけを使う
  return skyObjs.filter(s => s.el >= CAL_MIN_EL && s.el <= CAL_MAX_EL && (s.kind !== 'star' || s.mag <= 1.5));
}
function calibrate() {
  if (!camOn) { calMsg('カメラをオンにしてから押してください'); return; }
  if (head == null || !gotOri) { calMsg('方位センサーの値を待っています'); return; }
  let best = null;
  calTargets().forEach(s => { const d = angSep(head, elevNow, s.az, s.el); if (d <= CAL_MAX && (!best || d < best.d)) best = {s, d}; });
  if (!best) {
    calMsg(elevNow > CAL_MAX_EL ? `真上に近すぎます。高さ${CAL_MAX_EL}°より低い月・惑星・明るい星で合わせてください`
      : `照準の近く（${CAL_MAX}°以内）に合わせられる天体がありません。月・惑星・明るい星を十字に入れてください`);
    return;
  }
  const s = best.s, dAz = ((s.az - head + 540) % 360) - 180, dEl = s.el - elevNow;
  if (Math.abs(dAz) > CAL_MAX_DAZ) { calMsg(`${s.name}とのずれが大きすぎます（左右${sgn(dAz)}°）。十字に入れ直してから押してください`); return; }
  calUndo = {offset, offsetEl, cal};
  offset = Math.round((offset + dAz) * 10) / 10;
  offsetEl = Math.round((offsetEl + dEl) * 10) / 10;
  head = norm360(head + dAz); elevNow += dEl;
  cal = {t:Date.now(), name:s.name, dAz:Math.round(dAz * 10) / 10, dEl:Math.round(dEl * 10) / 10};
  lsSet('sora_offset', offset); lsSet('sora_offset_el', offsetEl); lsSet('sora_cal', cal);
  showOffset();
  calMsg(`${s.name}で合わせました：左右 ${sgn(dAz)}°、上下 ${sgn(dEl)}° 直しました`, true);
}
function calUndoDo() {
  if (!calUndo) return;
  const dAz = calUndo.offset - offset, dEl = calUndo.offsetEl - offsetEl;
  offset = calUndo.offset; offsetEl = calUndo.offsetEl; cal = calUndo.cal; calUndo = null;
  if (head != null) head = norm360(head + dAz);
  elevNow += dEl;
  lsSet('sora_offset', offset); lsSet('sora_offset_el', offsetEl); lsSet('sora_cal', cal);
  showOffset();
  calMsg('元に戻しました');
}
function calInfoText() {
  if (!cal) return '方角はまだ合わせていません（カメラをオンにすると、明るい天体で合わせられます）';
  const d = new Date(cal.t);
  return `方角は${d.getMonth() + 1}/${d.getDate()} ${hm(cal.t)}に${cal.name}で合わせました（上下の補正 ${sgn(offsetEl)}°）。場所が変わったら合わせ直してください`;
}
function calMsg(text, undo) {
  const el = $('calInfo');
  el.innerHTML = `<b>${esc(text)}</b>` + (undo ? ' <button id="calUndo">元に戻す</button>' : '') + '<br>' + esc(calInfoText());
  const u = $('calUndo'); if (u) u.onclick = calUndoDo;
}
$('calBtn').onclick = calibrate;
$('calInfo').textContent = calInfoText();

// ---------- キャッチ（v12） ----------
// 空に向けて、照準の円（半径10°）に機体を2秒入れ続けると「キャッチ」。同じ機体は1日1回
const CATCH_MS = 2000, CATCH_GAP = 500, CATCH_R = 10, CATCH_MIN_ELEV = 10, CATCH_MIN_AIM = 5, CATCH_LOG = 100;
let catchData = lsGet('sora_catch_v1', null);
if (!catchData || !catchData.types || !catchData.seen || !Array.isArray(catchData.log)) catchData = {types:{}, seen:{}, log:[], total:0};
let catchT = null;
let caughtToday = hex => !!catchData.seen[hex + '|' + today()]; // v24 でよその空のときに切り替える
function catchStep(g, toXY, off) {
  const now = Date.now();
  // 今日キャッチ済みの機体には印を付ける
  planes.forEach(p => {
    if (p.ground || !caughtToday(p.hex)) return;
    const [x, y] = toXY(p.dir, p.elev);
    if (off(x, y)) return;
    g.font = 'bold 13px sans-serif'; g.fillStyle = '#4cff9a'; g.textAlign = 'right'; g.fillText('✓', x - 7, y - 6); g.textAlign = 'left';
  });
  // 照準の円の中にいる、まだ捕まえていない機体のうち、いちばん真ん中に近いもの
  let best = null;
  if (elevNow >= CATCH_MIN_AIM) planes.forEach(p => {
    if (p.ground || p.elev < CATCH_MIN_ELEV || caughtToday(p.hex)) return;
    const d = angSep(head, elevNow, p.dir, p.elev);
    if (d <= CATCH_R && (!best || d < best.d)) best = {p, d};
  });
  if (best) {
    if (!catchT || (catchT.hex !== best.p.hex && now - catchT.lastIn > CATCH_GAP)) catchT = {hex:best.p.hex, t0:now, lastIn:now};
    if (catchT.hex === best.p.hex) catchT.lastIn = now;
  } else if (catchT && now - catchT.lastIn > CATCH_GAP) catchT = null;
  if (!catchT) return;
  const p = planes.find(x => x.hex === catchT.hex);
  if (!p || caughtToday(p.hex)) { catchT = null; return; }
  const k = Math.min(1, (now - catchT.t0) / CATCH_MS), [x, y] = toXY(p.dir, p.elev);
  if (!off(x, y)) {
    g.strokeStyle = 'rgba(76,255,154,.35)'; g.lineWidth = 5; g.beginPath(); g.arc(x, y, 22, 0, 7); g.stroke();
    g.strokeStyle = '#4cff9a'; g.beginPath(); g.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); g.stroke();
    g.font = 'bold 12px sans-serif'; g.fillStyle = '#4cff9a'; g.textAlign = 'center'; g.fillText('キャッチ中', x, y + 38); g.textAlign = 'left';
  }
  if (k >= 1 && best && best.p.hex === p.hex) { catchT = null; doCatch(p, now); }
}
function doCatch(p, now) {
  const d = today(), code = p.type || '?';
  catchData.seen[p.hex + '|' + d] = 1;
  for (const k in catchData.seen) if (!k.endsWith('|' + d)) delete catchData.seen[k];
  let e = catchData.types[code];
  const first = !e && code !== '?';
  if (!e) e = catchData.types[code] = {n:0, first:d, last:d, mil:0};
  e.n++; e.last = d; if (p.mil) e.mil = 1;
  catchData.total = (catchData.total || 0) + 1;
  const ri = routeInfo(p), rec = {t:now, hex:p.hex, cs:p.cs, reg:p.reg, ty:code, mil:p.mil ? 1 : 0,
    route:ri ? ri.text : '', km:Math.round(p.dist * 10) / 10, elev:Math.round(p.elev)};
  catchData.log.unshift(rec); catchData.log.splice(CATCH_LOG);
  lsSet('sora_catch_v1', catchData);
  // 今日の空にも残す
  const D = dayGet();
  D.catN = (D.catN || 0) + 1;
  (D.cat = D.cat || []).push({t:now, cs:p.cs || p.reg, ty:code, route:rec.route, mil:rec.mil});
  D.cat.splice(0, Math.max(0, D.cat.length - 30));
  daySave(true);
  // 知らせ
  const who = [p.cs || p.reg, typeName(p)].filter(Boolean).join(' ') + (ri ? ' ' + ri.text : '');
  const ntypes = Object.keys(catchData.types).filter(c => c !== '?').length;
  const msg = p.mil ? `軍用機をキャッチ！ ${who}` : first ? `キャッチ！ 初めての機種（${ntypes}機種目）${who}` : `キャッチ！ ${who}`;
  alertMsg(msg, p.hex, p.mil || first);
  $('toast').classList.add('catch');
  try { if (navigator.vibrate) navigator.vibrate(p.mil || first ? [80, 60, 80, 60, 240] : [80, 60, 160]); } catch (er) {}
  if ($('zukan').style.display === 'block') renderZukan();
}
// 知らせの色：キャッチのときだけ緑にする
const alertMsgBase = alertMsg;
alertMsg = function (text, hex, strong) { $('toast').classList.remove('catch'); alertMsgBase(text, hex, strong); };
// 図鑑に「捕」の列と、キャッチした機種の数を足す
const renderZukanBase = renderZukan;
renderZukan = function () {
  renderZukanBase();
  const ks = Object.keys(zukan.types).sort((a, b) => zukan.types[b].n - zukan.types[a].n);
  const rows = $('zukanBody').querySelectorAll('tr');
  if (ks.length && rows.length === ks.length) rows.forEach((tr, i) => {
    const c = catchData.types[ks[i]], td = document.createElement('td');
    td.textContent = c ? c.n : '';
    if (c) td.style.cssText = 'color:#1e8e5a;font-weight:bold';
    tr.insertBefore(td, tr.children[2] || null);
  });
  const nc = Object.keys(catchData.types).filter(c => c !== '?').length;
  $('zukanSum').textContent += `　うち${nc}機種をキャッチ（のべ${catchData.total || 0}機）`;
};
$('catchReset').onclick = () => {
  if (!confirm('キャッチの記録をすべて消します（図鑑の「見た」記録は残ります）。よろしいですか？')) return;
  catchData = {types:{}, seen:{}, log:[], total:0}; lsSet('sora_catch_v1', catchData); renderZukan();
};
// 今日の空のキャッチの行
function catchDayHtml(D) {
  if (!D || !D.catN) return 'なし<span class="small">（空に向けて、照準の円に機体を2秒入れるとキャッチ）</span>';
  const list = D.cat.slice(-10).reverse().map(c => `${hm(c.t)} ${c.mil ? '<b style="color:#c0392b">軍</b> ' : ''}${esc(c.cs || '')} ${esc(tyName(c.ty))}${c.route ? '　' + esc(c.route) : ''}`).join('<br>');
  return `${D.catN}機<br><span class="small">${list}</span>`;
}

// ---------- レア度とスコア（v13） ----------
// 点はキャッチしたときだけ。レア度は「自分の図鑑でその機種を何回見たか」で決める
const RARITY = [ // [図鑑で見た回数の上限, 名前, 点, 色]
  [2, '激レア', 80, '#ff6bd6'], [10, 'レア', 40, '#ffb347'], [30, 'ちょいレア', 20, '#9fd3ff'], [Infinity, 'ふつう', 10, '#cccccc']];
const LV_AT = [1, 3, 10, 30, 100], ISS_PT = 100;
function rarityOf(code) {
  if (!code || code === '?') return RARITY[3];
  const n = seenAll.types[code] || 0; // 表示範囲で見かけた回数（v31）
  return RARITY.find(r => n <= r[0]);
}
const lvOf = n => LV_AT.filter(v => n >= v).length;
function addScore(pt, now) {
  const D = dayGet();
  D.score = (D.score || 0) + pt;
  const b = catchData.best;
  if (!b || D.score > b.pt) catchData.best = {pt:D.score, d:today()};
  lsSet('sora_catch_v1', catchData); daySave(true);
  return D.score;
}
// キャッチに点を付ける（v12 の doCatch を包み直す）
const doCatchBase = doCatch;
doCatch = function (p, now) {
  const code = p.type || '?', firstType = code !== '?' && !catchData.types[code], rar = rarityOf(code);
  doCatchBase(p, now);
  const e = catchData.types[code], lv = lvOf(e.n), lvUp = e.n > 1 && LV_AT.includes(e.n);
  const parts = [], add = (t, v) => { parts.push(`${t}+${v}`); return v; };
  let pt = rar[2];
  if (p.mil) pt += add('軍用機', 50);
  if (firstType) pt += add('初めての機種', 50);
  if (p.sun) pt += add(p.sun.kind, 30);
  if (p.elev >= 70) pt += add('真上', 20);
  if (lvUp) pt += add(`Lv${lv}`, 30);
  if (catchData.log[0]) { catchData.log[0].pt = pt; catchData.log[0].rar = rar[1]; }
  const D = dayGet(); if (D.cat && D.cat.length) { const c = D.cat[D.cat.length - 1]; c.pt = pt; c.rar = rar[1]; }
  const total = addScore(pt, now);
  const ri = routeInfo(p), who = [typeName(p), p.cs || p.reg].filter(Boolean).join(' ') + (ri ? ' ' + ri.text : '');
  alertMsg(`${p.mil ? '軍用機を' : ''}キャッチ！ ${rar[1]} ${who}　+${pt}点${parts.length ? '（' + parts.join('・') + '）' : ''}` +
    (lvUp ? `　${typeName(p)}がLv${lv}になりました` : '') + `　今日 ${total}点`, p.hex, true);
  $('toast').classList.add('catch');
};
// 宇宙ステーションのキャッチ（肉眼で見えるときだけ、1日1回、100点）
let issCT = null;
function issCatchStep(g, toXY, off) {
  const now = Date.now();
  if (!issNow || caughtToday('ISS') || elevNow < CATCH_MIN_AIM || issNow.el < CATCH_MIN_ELEV || !issVisible(issNow, new Date(now))) { issCT = null; return; }
  const inR = angSep(head, elevNow, issNow.az, issNow.el) <= CATCH_R;
  if (inR) { if (!issCT) issCT = {t0:now, lastIn:now}; issCT.lastIn = now; }
  else if (issCT && now - issCT.lastIn > CATCH_GAP) issCT = null;
  if (!issCT) return;
  const k = Math.min(1, (now - issCT.t0) / CATCH_MS), [x, y] = toXY(issNow.az, issNow.el);
  if (!off(x, y)) {
    g.strokeStyle = 'rgba(76,255,154,.35)'; g.lineWidth = 5; g.beginPath(); g.arc(x, y, 22, 0, 7); g.stroke();
    g.strokeStyle = '#4cff9a'; g.beginPath(); g.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); g.stroke();
  }
  if (k < 1 || !inR) return;
  issCT = null;
  catchData.seen['ISS|' + today()] = 1;
  catchData.iss = {n:((catchData.iss && catchData.iss.n) || 0) + 1, last:today()};
  catchData.total = (catchData.total || 0) + 1;
  catchData.log.unshift({t:now, hex:'ISS', cs:'ISS', ty:'ISS', mil:0, route:'', km:Math.round(issNow.range), elev:Math.round(issNow.el), pt:ISS_PT, rar:'宇宙'});
  catchData.log.splice(CATCH_LOG);
  const D = dayGet();
  D.catN = (D.catN || 0) + 1;
  (D.cat = D.cat || []).push({t:now, cs:'ISS', ty:'ISS', route:'', mil:0, pt:ISS_PT, rar:'宇宙'});
  const total = addScore(ISS_PT, now);
  alertMsg(`宇宙ステーションをキャッチ！ 高度${Math.round(issNow.alt)}km・${Math.round(issNow.range)}km先　+${ISS_PT}点　今日 ${total}点`, null, true);
  $('toast').classList.add('catch');
  try { if (navigator.vibrate) navigator.vibrate([80, 60, 80, 60, 80, 60, 300]); } catch (er) {}
}
// スコープ：まだ捕まえていない機体にレア度の印、宇宙ステーションのキャッチ
const catchStepBase = catchStep;
catchStep = function (g, toXY, off) {
  planes.forEach(p => {
    if (p.ground || p.elev < CATCH_MIN_ELEV || caughtToday(p.hex)) return;
    const r = rarityOf(p.type);
    if (r[2] < 40) return; // レア以上だけ印を付ける
    const [x, y] = toXY(p.dir, p.elev);
    if (off(x, y)) return;
    g.font = 'bold 11px sans-serif'; g.fillStyle = r[3]; g.fillText(r[1], x + 9, y + 18);
  });
  catchStepBase(g, toXY, off);
  issCatchStep(g, toXY, off);
};
// 図鑑：「捕」にレベル、上に自己ベスト
const renderZukanV12 = renderZukan;
renderZukan = function () {
  renderZukanV12();
  const ks = Object.keys(zukan.types).sort((a, b) => zukan.types[b].n - zukan.types[a].n);
  const rows = $('zukanBody').querySelectorAll('tr');
  if (ks.length && rows.length === ks.length) rows.forEach((tr, i) => {
    const c = catchData.types[ks[i]], td = tr.children[2];
    if (c && td) td.innerHTML = `${c.n} <span style="font-size:11px">Lv${lvOf(c.n)}</span>`;
  });
  const b = catchData.best, iss = catchData.iss;
  $('zukanSum').textContent += (iss ? `　宇宙ステーション${iss.n}回` : '') + (b ? `　自己ベスト ${b.pt}点（${b.d.slice(5).replace('-', '/')}）` : '');
};
// 今日の空：スコアの行と、キャッチ一覧に点
catchDayHtml = function (D) {
  const b = catchData.best;
  const head = `<b>今日のスコア ${(D && D.score) || 0}点</b>` + (b ? `<span class="small">（自己ベスト ${b.pt}点・${b.d.slice(5).replace('-', '/')}）</span>` : '');
  if (!D || !D.catN) return head + '<br><span class="small">空に向けて、照準の円に機体を2秒入れるとキャッチ。珍しい機種ほど高い点です</span>';
  const list = D.cat.slice(-10).reverse().map(c => `${hm(c.t)} ${c.mil ? '<b style="color:#c0392b">軍</b> ' : ''}` +
    (c.ty === 'ISS' ? '宇宙ステーション' : `${esc(c.cs || '')} ${esc(tyName(c.ty))}${c.route ? '　' + esc(c.route) : ''}`) +
    (c.pt ? `　<b>${c.rar && c.rar !== '宇宙' ? esc(c.rar) + ' ' : ''}+${c.pt}</b>` : '')).join('<br>');
  return `${head}<br>キャッチ ${D.catN}機<br><span class="small">${list}</span>`;
};
// これまでの日の一覧に「点」の列
const renderDayV12 = renderDay;
renderDay = function (k) {
  renderDayV12(k);
  $('dayList').querySelectorAll('tr[data-k]').forEach(tr => {
    const E = skyDays.days[tr.dataset.k], td = document.createElement('td');
    td.textContent = E && E.score ? E.score + '点' : '';
    tr.appendChild(td);
  });
};

// ---------- バッジ（v15） ----------
// 記録からバッジを判定する。段階は 銅→銀→金→白金→ダイヤ。v15より前の記録で届いている分は、最初に黙って付ける
const MEDAL = ['銅', '銀', '金', '白金', 'ダイヤ'];
const AL_DOM = ['JAL', 'ANA', 'ADO', 'SKY', 'SFJ', 'SNJ', 'JJP', 'APJ', 'SJO', 'JTA', 'IBX', 'FDA', 'ZIP']; // 国内13社
const AL_DOM_ALL = AL_DOM.concat(['AKX', 'JLJ', 'NCA']), AL_MIL = ['RCH', 'CNV', 'PAT'];
const REGION = {
  'アジア':'KR KP CN TW HK MO MN PH VN TH SG MY ID BN KH LA MM IN LK MV NP BD PK BT TL KZ UZ KG TJ TM',
  '中東':'AE QA SA BH KW OM IL JO LB IR IQ SY YE',
  'ヨーロッパ':'GB IE FR DE NL BE LU CH AT IT ES PT DK SE NO FI IS PL CZ SK HU GR RO BG HR SI RS RU UA BY EE LV LT TR CY MT',
  '北米':'US CA MX PR',
  'オセアニア':'AU NZ GU MP PW FJ PG NC PF FM MH'};
const regionOf = cc => Object.keys(REGION).find(r => REGION[r].split(' ').includes(cc)) || '';
let badge = lsGet('sora_badge_v1', null);
const badgeFirst = !badge || !badge.got;
if (badgeFirst) badge = {got:{}, n:{mil:0, sun:0, night:0, top:0, srare:0}, al:{}, cc:{}, places:{}, days:{}};
const bSave = () => lsSet('sora_badge_v1', badge);
const homeP = () => realHome();
const BADGES = [ // [id, 分類, 名前, 段階, 値を出す関数, 単位]
  ['catch', 'キャッチ', 'キャッチした機数', [1, 10, 50, 100, 500], () => catchData.total || 0, '機'],
  ['ctype', 'キャッチ', 'キャッチした機種', [5, 15, 30], () => Object.keys(catchData.types).filter(c => c !== '?').length, '機種'],
  ['zukan', '図鑑', '見た機種', [20, 50, 100], () => Object.keys(zukan.types).filter(c => c !== '?').length, '機種'],
  ['srare', '珍しさ', '激レアをキャッチ', [1, 10], () => badge.n.srare, '回'],
  ['mil', '珍しさ', '軍用機をキャッチ', [1, 5, 20], () => badge.n.mil, '回'],
  ['sun', '空の様子', '夕日・朝日の機体をキャッチ', [1, 10], () => badge.n.sun, '回'],
  ['night', '空の様子', '夜にキャッチ', [1, 10], () => badge.n.night, '回'],
  ['top', '空の様子', '真上（見上げ角70°以上）でキャッチ', [1], () => badge.n.top, '回'],
  ['iss', '宇宙', '宇宙ステーションをキャッチ', [1, 5], () => (catchData.iss && catchData.iss.n) || 0, '回'],
  ['score', 'スコア', '1日のスコア', [300, 600, 1000], () => (catchData.best && catchData.best.pt) || 0, '点'],
  ['lv3', 'カード', 'Lv3の機種が生まれる', [1], () => Object.values(catchData.types).filter(t => t.n >= 10).length, '機種'],
  ['lv5', 'カード', 'Lv5の機種が生まれる', [1], () => Object.values(catchData.types).filter(t => t.n >= 100).length, '機種'],
  ['al', '航空会社', 'キャッチした航空会社', [5, 15, 30], () => Object.keys(badge.al).length, '社'],
  ['aldom', '航空会社', '国内13社をすべてキャッチ', [13], () => AL_DOM.filter(a => badge.al[a]).length, '社'],
  ['alint', '航空会社', '海外の航空会社をキャッチ', [5, 10, 20], () => Object.keys(badge.al).filter(a => !AL_DOM_ALL.includes(a)).length, '社'],
  ['city', '行き先', '上空を通った便の行き先の都市', [10, 30, 60], () => Object.keys(cities.list).length, '都市'],
  ['far', '行き先', 'いちばん遠い行き先', [2000, 5000, 8000, 10000], () => Math.round(Object.values(cities.list).reduce((m, c) => Math.max(m, gcKm(homeP(), [c.lon, c.lat])), 0)), 'km'],
  ['cc', '海外', '行き先の国', [5, 15], () => Object.keys(badge.cc).length, 'か国'],
  ['region', '海外', '世界の5地域へ（アジア・中東・欧州・北米・オセアニア）', [5], () => new Set(Object.keys(badge.cc).filter(c => c !== 'JP').map(regionOf).filter(Boolean)).size, '地域'],
  ['place', '場所', '空を見た市区町村', [5, 20], () => Object.keys(badge.places).length, 'か所'],
  ['days', '日数', 'アプリで空を見た日（通算）', [7, 30, 100], () => Object.keys(badge.days).length, '日'],
  ['cal', '方角', '方角合わせに成功', [1], () => cal ? 1 : 0, '回']];
const tierName = (b, i) => b[3].length > 1 ? MEDAL[i] : '';
// 今日の空の記録から、見た場所と日数を集める（記録は30日で消えるので、ここに残しておく）
function badgeCollect() {
  Object.keys(skyDays.days).forEach(k => {
    const D = skyDays.days[k];
    if (D.n) badge.days[k] = 1;
    (D.sp || []).forEach(s => { if (s.name && !s.u && s.name !== '地名なし' && s.name !== '位置未確認') badge.places[s.name] = 1; });
  });
}
let badgeQueue = [], badgeToastTimer = null;
function badgeCheck(quiet) {
  badgeCollect();
  const got = [];
  BADGES.forEach(b => {
    let v = 0; try { v = b[4](); } catch (e) {}
    const g = badge.got[b[0]] || (badge.got[b[0]] = {d:[]});
    for (let i = g.d.length; i < b[3].length && v >= b[3][i]; i++) {
      g.d.push(quiet ? 'v15より前' : today());
      if (!quiet) got.push(b[2] + (tierName(b, i) ? `（${tierName(b, i)}）` : ''));
    }
  });
  bSave();
  if (got.length) { badgeQueue = badgeQueue.concat(got); badgeShow(); }
  if ($('badge').style.display === 'block') renderBadges();
}
// キャッチの知らせと重ならないよう、表示中なら少し待ってから出す
function badgeShow() {
  clearTimeout(badgeToastTimer);
  badgeToastTimer = setTimeout(() => {
    if (!badgeQueue.length) return;
    alertMsg('バッジ獲得！ ' + badgeQueue.join('・'), null, true);
    $('toast').classList.add('badge');
    badgeQueue = [];
  }, $('toast').style.display === 'block' ? 3500 : 0);
}
const alertMsgV12 = alertMsg;
alertMsg = function (text, hex, strong) { $('toast').classList.remove('badge'); alertMsgV12(text, hex, strong); };
// キャッチのたびに、航空会社・軍用機・夕日・夜・真上・激レアを数える（v13 の doCatch を包み直す）
const doCatchV13 = doCatch;
doCatch = function (p, now) {
  const srare = rarityOf(p.type || '?')[1] === '激レア';
  doCatchV13(p, now);
  const al = (p.cs || '').slice(0, 3);
  if (/^[A-Z]{3}\d/.test(p.cs || '') && !AL_MIL.includes(al)) badge.al[al] = (badge.al[al] || 0) + 1;
  if (p.mil) badge.n.mil++;
  if (p.sun) badge.n.sun++;
  if (pos && sunAt(pos[1], pos[0], new Date(now)).el < -6) badge.n.night++;
  if (p.elev >= 70) badge.n.top++;
  if (srare) badge.n.srare++;
  badgeCheck(false);
};
// 行き先の国（v15 から apConv が国の記号 cc を残す）
const dayCityV8 = dayCity;
dayCity = function (id, name, ap) {
  dayCityV8(id, name, ap);
  if (ap && ap.cc && !badge.cc[ap.cc]) { badge.cc[ap.cc] = 1; badgeCheck(false); }
};
// 画面
function renderBadges() {
  let h = '', cat = '', nGot = 0, nAll = 0;
  BADGES.forEach(b => {
    let v = 0; try { v = b[4](); } catch (e) {}
    const g = badge.got[b[0]] || {d:[]}, k = g.d.length;
    nAll += b[3].length; nGot += k;
    if (b[1] !== cat) { cat = b[1]; h += `<div class="dhead">${esc(cat)}</div>`; }
    const tiers = b[3].map((t, i) => `<span class="bt${i < k ? ' on' : ''}" title="${esc(g.d[i] || '')}">${tierName(b, i) || '達成'}${b[3].length > 1 ? ' ' + t.toLocaleString() : ''}</span>`).join('');
    const next = b[3][k], last = g.d[k - 1];
    h += `<div class="bcard${k ? ' got' : ''}"><b>${esc(b[2])}</b><br>${tiers}<br><span class="small">` +
      (next != null ? `いま ${v.toLocaleString()}${b[5]}・あと ${(next - v).toLocaleString()}${b[5]}` : `すべて達成（${v.toLocaleString()}${b[5]}）`) +
      (last ? `　最後にもらった日：${esc(last)}` : '') + '</span></div>';
  });
  $('badgeSum').textContent = `${nGot} / ${nAll}`;
  $('badgeBody').innerHTML = h;
}
const badgeOpen = () => $('badge').style.display === 'block';
const badgeCloseBase = () => { $('badge').style.display = 'none'; };
$('badgeBtn').onclick = () => {
  if (badgeOpen()) return;
  badgeCheck(false); renderBadges(); $('badge').style.display = 'block'; $('badge').scrollTop = 0;
  navPush('badge', badgeOpen, badgeCloseBase);
};
$('badgeClose').onclick = () => navClose('badge', badgeCloseBase);
// 今日の空に「この日にもらったバッジ」
const renderDayV13 = renderDay;
renderDay = function (k) {
  renderDayV13(k);
  const list = [];
  BADGES.forEach(b => { const g = badge.got[b[0]]; if (g) g.d.forEach((d, i) => { if (d === k) list.push(b[2] + (tierName(b, i) ? `（${tierName(b, i)}）` : '')); }); });
  if (!list.length) return;
  const el = document.createElement('div'); el.className = 'drow';
  el.innerHTML = `<b>もらったバッジ</b>　${esc(list.join('、'))}`;
  const sp = [...$('dayBody').querySelectorAll('.dhead')].find(x => x.textContent === '見た場所');
  $('dayBody').insertBefore(el, sp || null);
};
badgeCheck(badgeFirst);
setInterval(() => { if (!document.hidden) badgeCheck(false); }, 15000);

// ---------- シェアカード（v16） ----------
// 今日の空のまとめを1枚の画像（1080×1350）にして、スマホの共有画面で送る。画像はスマホの中だけで作る
let sharePlace = lsGet('sora_share_place', false) === true, shareBlob = null;
const SKY_BG = { // 時間帯ごとの背景（上の色, 下の色）
  dawn:['#f2a57c', '#5d7fbf'], day:['#3f86d6', '#bfe2ff'], dusk:['#ff8a50', '#3a2a6b'], night:['#0b1430', '#22346b']};
function skyKind(t) {
  const h = new Date(t).getHours();
  return h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 16 ? 'day' : h >= 16 && h < 19 ? 'dusk' : 'night';
}
function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function fitText(g, s, max) { while (s.length > 1 && g.measureText(s).width > max) s = s.slice(0, -2) + '…'; return s; }
function drawShareCard(k) {
  const D = skyDays.days[k] || {n:0, ty:{}}, isToday = k === today();
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), F = 'sans-serif', home = realHome();
  const last = D.cat && D.cat.length ? D.cat[D.cat.length - 1].t : null;
  const bg = SKY_BG[skyKind(isToday ? Date.now() : (last || new Date(k + 'T12:00:00').getTime()))];
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, bg[0]); gr.addColorStop(1, bg[1]);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 8; g.textBaseline = 'alphabetic';
  // 見出し
  g.font = `bold 64px ${F}`; g.textAlign = 'left'; g.fillText('SoraMiru', 60, 110);
  const [y, m, d] = k.split('-').map(Number);
  g.font = `40px ${F}`; g.textAlign = 'right'; g.fillText(`${y}年${dateLabel(k)}`, W - 60, 105);
  const places = [...new Set((D.sp || []).filter(s => s.name && !s.u && s.name !== '地名なし').map(s => s.name))];
  if (sharePlace && places.length) { g.font = `34px ${F}`; g.fillText(places.slice(0, 3).join('・') + 'の空', W - 60, 155); }
  // スコア
  g.textAlign = 'center'; g.font = `40px ${F}`; g.fillText(isToday ? '今日のスコア' : 'この日のスコア', W / 2, 250);
  const sc = String(D.score || 0);
  g.font = `bold 150px ${F}`; const sw = g.measureText(sc).width; g.fillText(sc, W / 2 - 30, 400);
  g.font = `bold 60px ${F}`; g.textAlign = 'left'; g.fillText('点', W / 2 - 30 + sw / 2 + 10, 400);
  // 数字3つ
  const types = Object.keys(D.ty || {}).filter(t => t !== '?').length;
  [['キャッチ', `${D.catN || 0}`, '機'], ['見た機体', `${D.n || 0}`, '機'], ['機種', `${types}`, '']].forEach((s, i) => {
    const x = 60 + i * 330, bw = 300;
    g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,.18)'; rrect(g, x, 450, bw, 140, 24); g.fill();
    g.fillStyle = '#fff'; g.shadowBlur = 6; g.textAlign = 'center';
    g.font = `32px ${F}`; g.fillText(s[0], x + bw / 2, 500);
    g.font = `bold 64px ${F}`; g.fillText(s[1] + s[2], x + bw / 2, 570);
  });
  // いちばんの一機
  const best = (D.cat || []).filter(x => x.pt).sort((a, b) => b.pt - a.pt)[0];
  g.shadowBlur = 0; g.fillStyle = 'rgba(0,0,0,.22)'; rrect(g, 60, 620, W - 120, 170, 24); g.fill();
  g.fillStyle = '#fff'; g.shadowBlur = 6; g.textAlign = 'left';
  g.font = `30px ${F}`; g.fillText(isToday ? '今日のいちばんの一機' : 'この日のいちばんの一機', 90, 668);
  if (best) {
    const nm = best.ty === 'ISS' ? '国際宇宙ステーション' : tyName(best.ty) + (best.mil ? '（軍用機）' : '');
    g.font = `bold 46px ${F}`; g.fillText(fitText(g, `${best.rar && best.rar !== '宇宙' ? best.rar + ' ' : ''}${nm}`, W - 360), 90, 728);
    g.font = `30px ${F}`; g.fillText(fitText(g, [best.ty === 'ISS' ? '' : best.cs, best.route].filter(Boolean).join('　'), W - 360), 90, 772);
    g.font = `bold 60px ${F}`; g.textAlign = 'right'; g.fillText(`+${best.pt}`, W - 90, 745);
  } else { g.font = `36px ${F}`; g.fillText('まだキャッチがありません', 90, 735); }
  // この空から行った方向（中心＝ここ、向き＝実際の方角、長さ＝距離の対数）
  const cx = W / 2, cy = 1005, R = 160, maxKm = 12000;
  const rOf = km => R * Math.log10(1 + km / 100) / Math.log10(1 + maxKm / 100);
  g.shadowBlur = 0; g.textAlign = 'left'; g.font = `30px ${F}`; g.fillStyle = '#fff'; g.fillText('この空から行った方向', 60, 845);
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2;
  [1000, 3000, 10000].forEach(km => { g.beginPath(); g.arc(cx, cy, rOf(km), 0, 7); g.stroke(); });
  g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `22px ${F}`; g.textAlign = 'left';
  [1000, 3000, 10000].forEach(km => g.fillText(km.toLocaleString() + 'km', cx + rOf(km) * 0.71 + 4, cy + rOf(km) * 0.71 + 8));
  g.font = `bold 28px ${F}`; g.textAlign = 'center'; g.fillStyle = '#fff';
  [['北', 0], ['東', 90], ['南', 180], ['西', 270]].forEach(([s, a]) => { const r = R + 28; g.fillText(s, cx + r * Math.sin(a * D2R), cy - r * Math.cos(a * D2R) + 10); });
  const dests = Object.entries(D.ct || {}).map(([id, v]) => { const cc = cities.list[id]; return cc && {name:v.name, km:v.km, az:gcBrg(home, [cc.lon, cc.lat])}; })
    .filter(Boolean).sort((a, b) => b.km - a.km);
  if (!dests.length) { g.font = `28px ${F}`; g.fillText('この日の行き先の記録はありません', cx, cy + R + 80); }
  dests.forEach((p, i) => {
    const r = rOf(p.km), x = cx + r * Math.sin(p.az * D2R), y2 = cy - r * Math.cos(p.az * D2R);
    g.strokeStyle = i === 0 ? '#ffd54f' : 'rgba(255,255,255,.85)'; g.lineWidth = i === 0 ? 5 : 3;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y2); g.stroke();
    g.fillStyle = i === 0 ? '#ffd54f' : '#fff'; g.beginPath(); g.arc(x, y2, i === 0 ? 9 : 6, 0, 7); g.fill();
    if (i < 8) {
      g.font = `${i === 0 ? 'bold ' : ''}26px ${F}`; g.shadowBlur = 6;
      g.textAlign = Math.sin(p.az * D2R) >= 0 ? 'left' : 'right';
      g.fillText(p.name, x + (Math.sin(p.az * D2R) >= 0 ? 14 : -14), y2 + 9); g.shadowBlur = 0;
    }
  });
  g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, 10, 0, 7); g.fill();
  g.font = `bold 26px ${F}`; g.textAlign = 'center'; g.shadowBlur = 6; g.fillText('ここ', cx, cy + 40);
  // いちばん遠い行き先・バッジ・宇宙ステーション
  const notes = [];
  if (dests.length) notes.push(`いちばん遠い行き先：${dests[0].name}（${dests[0].km.toLocaleString()}km）`);
  const bl = []; if (typeof BADGES !== 'undefined') BADGES.forEach(b => { const gg = badge.got[b[0]]; if (gg) gg.d.forEach((dd, i) => { if (dd === k) bl.push(b[2] + (tierName(b, i) ? `（${tierName(b, i)}）` : '')); }); });
  if (bl.length) notes.push('もらったバッジ：' + bl.slice(0, 3).join('、') + (bl.length > 3 ? ` ほか${bl.length - 3}` : ''));
  if (D.iss) notes.push(`宇宙ステーションを見た：${hm(D.iss)}`);
  g.textAlign = 'left'; g.font = `26px ${F}`; g.fillStyle = '#fff';
  notes.slice(0, 3).forEach((s, i) => g.fillText(fitText(g, s, W - 120), 60, 1304 - (Math.min(3, notes.length) - 1 - i) * 36));
  g.shadowBlur = 0; g.font = `20px ${F}`; g.fillStyle = 'rgba(255,255,255,.75)'; g.textAlign = 'right';
  g.fillText('機体データ：adsb.lol（ODbL）　行き先：Virtual Radar Server', W - 60, H - 14);
  return c;
}
function renderShare() {
  const c = drawShareCard(dayView || today());
  $('shareImg').src = c.toDataURL('image/png');
  shareBlob = null; c.toBlob(b => { shareBlob = b; }, 'image/png');
  $('sharePlace').checked = sharePlace;
}
const shareOpen = () => $('share').style.display === 'block';
const shareCloseBase = () => { $('share').style.display = 'none'; };
$('shareBtn').onclick = () => { if (shareOpen()) return; renderShare(); $('share').style.display = 'block'; navPush('share', shareOpen, shareCloseBase); };
$('shareClose').onclick = () => navClose('share', shareCloseBase);
$('sharePlace').onchange = () => { sharePlace = $('sharePlace').checked; lsSet('sora_share_place', sharePlace); renderShare(); };
function shareFile() { return new File([shareBlob], `soramiru-${dayView || today()}.png`, {type:'image/png'}); }
function shareSave() {
  const a = document.createElement('a'); a.href = URL.createObjectURL(shareBlob); a.download = `soramiru-${dayView || today()}.png`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
$('shareSend').onclick = async () => {
  if (!shareBlob) return;
  const f = shareFile();
  if (navigator.canShare && navigator.canShare({files:[f]})) {
    try { await navigator.share({files:[f], title:'SoraMiru', text:'SoraMiru ' + dateLabel(dayView || today()) + 'の空'}); }
    catch (e) { if (e.name !== 'AbortError') $('shareMsg').textContent = '共有できませんでした：' + e.message; }
  } else { shareSave(); $('shareMsg').textContent = 'この端末では共有画面が使えないので、画像を保存しました'; }
};
$('shareDl').onclick = () => { if (shareBlob) shareSave(); };

// ---------- 写真リンク・10kmリング・図鑑の説明・画面の点滅（v17） ----------
// (1) キャッチした機体の写真ページ（Planespotters）を記録し、シェアの文章に付ける。写真そのものは画像に入れない
async function catchPhotoLink(hex, t) {
  try {
    if (!photos.has(hex) || photos.get(hex) === 'loading') await loadPhoto(hex);
    let ph = photos.get(hex);
    for (let i = 0; ph === 'loading' && i < 20; i++) { await new Promise(r => setTimeout(r, 300)); ph = photos.get(hex); }
    if (!ph || ph === 'loading') return;
    const L = catchData.log.find(r => r.t === t); if (L) { L.ph = ph.link; L.by = ph.by; lsSet('sora_catch_v1', catchData); }
    const D = dayGet(), c = (D.cat || []).find(x => x.t === t); if (c) { c.ph = ph.link; c.by = ph.by; daySave(true); }
  } catch (e) {}
}
const doCatchV15 = doCatch;
doCatch = function (p, now) { doCatchV15(p, now); catchPhotoLink(p.hex, now); };
function shareBest() { const D = skyDays.days[dayView || today()]; return D && (D.cat || []).filter(x => x.pt).sort((a, b) => b.pt - a.pt)[0]; }
const renderShareV16 = renderShare;
renderShare = function () {
  renderShareV16();
  const b = shareBest();
  $('sharePhoto').innerHTML = b && b.ph ? `いちばんの一機の写真：<a href="${esc(b.ph)}" target="_blank" rel="noopener">${esc(b.ty === 'ISS' ? '' : tyName(b.ty) + ' ' + (b.cs || ''))}</a>（Photo © ${esc(b.by || '')} / Planespotters.net）。共有の文章にこのリンクが付きます` : '';
};
$('shareSend').onclick = async () => {
  if (!shareBlob) return;
  const f = shareFile(), b = shareBest(), k = dayView || today(), D = skyDays.days[k] || {};
  let text = `SoraMiru ${dateLabel(k)}の空　${D.score || 0}点`;
  if (b) text += `\nいちばんの一機：${b.ty === 'ISS' ? '国際宇宙ステーション' : tyName(b.ty) + (b.cs ? ' ' + b.cs : '')}`;
  if (b && b.ph) text += `\n写真：${b.ph}（Photo © ${b.by || ''} / Planespotters.net）`;
  if (navigator.canShare && navigator.canShare({files:[f]})) {
    try { await navigator.share({files:[f], title:'SoraMiru', text}); }
    catch (e) { if (e.name !== 'AbortError') $('shareMsg').textContent = '共有できませんでした：' + e.message; }
  } else { shareSave(); $('shareMsg').textContent = 'この端末では共有画面が使えないので、画像を保存しました'; }
};
// (2) 地図に10kmのリング（行き先が記録される範囲）と、10km以内の機体の行き先・機種、キャッチできる機体の緑の光
function ring10Setup() {
  if (map.getSource('ring10')) return;
  const empty = {type:'FeatureCollection', features:[]};
  map.addSource('ring10', {type:'geojson', data:empty});
  map.addLayer({id:'ring10', type:'line', source:'ring10', filter:['==', ['geometry-type'], 'Polygon'],
    paint:{'line-color':'#e67e22', 'line-width':1.5, 'line-dasharray':[1, 2], 'line-opacity':0.8}});
  map.addLayer({id:'ring10lab', type:'symbol', source:'ring10', filter:['==', ['geometry-type'], 'Point'],
    layout:{'text-field':'10km（図鑑に入る範囲）', 'text-size':11, 'text-anchor':'bottom', 'text-offset':[0, -0.2]},
    paint:{'text-color':'#c0612b', 'text-halo-color':'#fff', 'text-halo-width':1.5}});
  drawRing10();
}
function drawRing10() {
  const s = map.getSource && map.getSource('ring10');
  if (!s || !pos) return;
  s.setData({type:'FeatureCollection', features:[circle(pos, 10), {type:'Feature', properties:{}, geometry:{type:'Point', coordinates:[pos[0], pos[1] + 10 / 110.57]}}]});
}
if (map.isStyleLoaded && map.isStyleLoaded()) ring10Setup(); else map.on('load', ring10Setup);
const drawRangeBase = drawRange;
drawRange = function () { drawRangeBase(); drawRing10(); };
const labMarkers = new Map();
const renderV13 = render;
render = function () {
  renderV13();
  const keep = new Set();
  planes.forEach(p => {
    const m = markers.get(p.hex);
    if (m) m.getElement().classList.toggle('catchable', !p.ground && p.elev >= CATCH_MIN_ELEV && !caughtToday(p.hex));
    if (p.ground || p.dist > 10) return;
    keep.add(p.hex);
    const ri = routeInfo(p), txt = [ri ? ri.destName + '行き' : (p.mil ? '軍用機' : ''), p.type || ''].filter(Boolean).join(' ');
    let L = labMarkers.get(p.hex);
    if (!L) {
      const el = document.createElement('div'); el.className = 'plab';
      L = new mapboxgl.Marker({element:el, anchor:'top', offset:[0, 14]}).setLngLat(p.p).addTo(map);
      labMarkers.set(p.hex, L);
    }
    L.getElement().textContent = txt || p.cs || p.reg || '';
    L.getElement().classList.toggle('mil', !!p.mil);
    L.setLngLat(p.p);
  });
  labMarkers.forEach((L, hex) => { if (!keep.has(hex)) { L.remove(); labMarkers.delete(hex); } });
};
setInterval(() => { if (document.hidden) return; labMarkers.forEach((L, hex) => { const p = planes.find(x => x.hex === hex); if (p && p.p) L.setLngLat(p.p); }); }, 500);
// (3) 図鑑：機種名を押すと、説明（Wikipedia）と、自分がキャッチした機体の実際の写真
const renderZukanV13 = renderZukan;
renderZukan = function () {
  renderZukanV13();
  const ks = Object.keys(zukan.types).sort((a, b) => zukan.types[b].n - zukan.types[a].n);
  const rows = [...$('zukanBody').querySelectorAll('tr')];
  if (!ks.length || rows.length !== ks.length) return;
  rows.forEach((tr, i) => {
    const code = ks[i], td = tr.children[0];
    if (code === '?' || !td) return;
    td.classList.add('zlink');
    td.onclick = () => zukanDetail(tr, code);
  });
};
function zukanDetail(tr, code) {
  const nx = tr.nextElementSibling;
  if (nx && nx.classList.contains('zdet')) { nx.remove(); return; }
  const name = TYPE[code] || code, det = document.createElement('tr'); det.className = 'zdet';
  const wiki = 'https://ja.wikipedia.org/w/index.php?search=' + encodeURIComponent(name);
  const mine = catchData.log.find(r => r.ty === code && r.hex && r.hex !== 'ISS');
  det.innerHTML = `<td colspan="${tr.children.length}"><a href="${wiki}" target="_blank" rel="noopener">${esc(name)}の説明（Wikipedia）</a>` +
    `<div class="zph">${mine ? '写真を探しています…' : 'この機種をキャッチすると、自分が捕まえた機体の写真がここに出ます'}</div></td>`;
  tr.after(det);
  if (!mine) return;
  const show = () => {
    const ph = photos.get(mine.hex), box = det.querySelector('.zph');
    if (ph === 'loading' || ph === undefined) return false;
    box.innerHTML = ph ? `<div class="small">あなたが ${esc(mine.t ? new Date(mine.t).toLocaleDateString('ja-JP') : '')} にキャッチした ${esc(mine.cs || mine.reg || '')}</div>` +
      `<a href="${esc(ph.link)}" target="_blank" rel="noopener"><img src="${esc(ph.src)}" alt="機体の写真"></a><div class="small">Photo © ${esc(ph.by)}（Planespotters.net）</div>`
      : 'この機体の写真は見つかりませんでした';
    return true;
  };
  if (!show()) { loadPhoto(mine.hex).then(() => { let n = 0; const iv = setInterval(() => { if (show() || ++n > 20) clearInterval(iv); }, 300); }); }
}
// (4) 画面を光らせる知らせ（振動しない設定でも気づけるように。強い知らせのときだけ）
const alertMsgV15 = alertMsg;
alertMsg = function (text, hex, strong) {
  alertMsgV15(text, hex, strong);
  if (!strong || !$('ntfFlash').checked) return;
  const f = $('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
};
{ const el = $('ntfFlash'), v = lsGet('sora_ntfFlash', null); if (v != null) el.checked = !!v; el.addEventListener('change', () => lsSet('sora_ntfFlash', el.checked)); }

// ---------- 真上カウントダウン・星座を探す（v18） ----------
// (0) 画面を光らせる知らせはやめて、振動だけにする（v17 の包みを外す）。星座を見つけた知らせは紺色
alertMsg = function (text, hex, strong) { $('toast').classList.remove('con'); alertMsgV15(text, hex, strong); };
// (1) 真上カウントダウン：10分以内に、見上げ角60°以上で近くを通る機体のうち、いちばん早いもの
const CD_MIN = 10, CD_EL = 60, CD_KEEP_EL = 50, CD_NOW_S = 20;
let cdOn = lsGet('sora_cd', true) !== false, cdT = null; // cdT = {hex, p, s:残り秒, km, el, now:真上の表示中, until}
const cdDone = new Set(); // 振動した印（'30|hex'・'0|hex'）と、真上を過ぎた機体（'end|hex'）
// 最接近のときの見上げ角（上昇・下降中は、高さの変わり方も少しだけ見込む）
function cdElAt(p) {
  if (p.ground || p.cpaT == null || p.cpaKm == null) return -1;
  const alt = Math.max(0, p.altM + (p.rate || 0) * 0.3048 * Math.min(Math.max(p.cpaT, 0), 5));
  return Math.atan2(alt, Math.max(p.cpaKm, 0.01) * 1000) / D2R;
}
const cdCand = p => !p.ground && p.cpaT != null && p.cpaT > 0 && p.cpaT <= CD_MIN && cdElAt(p) >= CD_EL;
const cdFill = (t, p) => { t.p = p; t.s = Math.max(0, Math.round(p.cpaT * 60)); t.km = p.cpaKm; t.el = Math.round(cdElAt(p)); return t; };
const mmss = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
function cdBuzz(k, hex, pat) {
  if (cdDone.has(k + '|' + hex)) return;
  cdDone.add(k + '|' + hex);
  try { if (navigator.vibrate) navigator.vibrate(pat); } catch (e) {}
}
function cdPick(now) {
  if (!cdOn || !pos || usingDef) return null;
  // 「いま真上！」の表示中（20秒）
  if (cdT && cdT.now) {
    if (now < cdT.until) { const p = planes.find(x => x.hex === cdT.hex); if (p) cdT.p = p; return cdT; }
    cdDone.add('end|' + cdT.hex); cdT = null;
  }
  // 追いかけている機体が最接近を過ぎたら「いま真上！」
  const cur = cdT && planes.find(x => x.hex === cdT.hex);
  if (cur && cur.cpaT != null && cur.cpaT <= 0 && cdT.s <= 60) {
    cdBuzz('0', cur.hex, [400, 150, 400, 150, 400]);
    return {hex:cur.hex, p:cur, s:0, km:cdT.km, el:cdT.el, now:true, until:now + CD_NOW_S * 1000};
  }
  // 追いかけ中の機体は、少し条件をゆるめて続ける（データの更新のゆれで消えないように）
  const keep = cur && cur.cpaT != null && cur.cpaT > 0 && cur.cpaT <= CD_MIN + 1 && cdElAt(cur) >= CD_KEEP_EL;
  const list = planes.filter(p => !cdDone.has('end|' + p.hex) && (cdCand(p) || (keep && p === cur))).sort((a, b) => a.cpaT - b.cpaT);
  if (!list.length) return null;
  const t = cdFill({hex:list[0].hex, now:false}, list[0]);
  if (t.s <= 30) cdBuzz('30', t.hex, [150, 100, 150]);
  return t;
}
function cdRender() {
  const el = $('cdBar');
  if (!cdT || !cdT.p) { el.style.display = 'none'; return; }
  const p = cdT.p, ri = routeInfo(p);
  const who = [p.cs || p.reg, ri ? ri.destName + '行き' : (p.mil ? '軍用機' : ''), p.type].filter(Boolean).join(' ');
  el.className = cdT.now ? 'now' : cdT.s <= 30 ? 'soon' : '';
  el.innerHTML = `<b>${cdT.now ? 'いま真上！ 見上げてください' : `あと${mmss(cdT.s)}で真上付近`}</b><br>` +
    `<span>${esc(who)}（最接近${cdT.km.toFixed(1)}km・見上げ角${cdT.el}°）</span>`;
  el.style.display = 'block';
}
$('cdBar').onclick = () => { if (cdT && sel !== cdT.hex && planes.some(p => p.hex === cdT.hex)) select(cdT.hex, true); };
setInterval(() => { if (document.hidden) return; cdT = cdPick(Date.now()); cdRender(); }, 1000);
{ const el = $('ntfCd'); el.checked = cdOn; el.addEventListener('change', () => { cdOn = el.checked; lsSet('sora_cd', cdOn); cdT = cdPick(Date.now()); cdRender(); }); }
// カウントダウン中の機体には、前からある「まもなく真上付近を通過」の知らせを出さない（振動が重なるので）
const notifyBase = notify;
notify = function (list) {
  if (cdOn) list.forEach(p => { if ((cdT && cdT.hex === p.hex) || cdCand(p)) notified.add('o' + p.hex); });
  notifyBase(list);
};
// 空に向けた画面：その機体に点線の輪。画面の外なら、端にその方向への矢印
function cdArrow(g, toXY) {
  if (!cdT || !cdT.p || cdT.p.elev == null) return;
  const box = $('scopeBox'), W = box.clientWidth, H = box.clientHeight, cx = W / 2, cy = H / 2;
  const p = cdT.p, [x, y] = toXY(p.dir, p.elev), col = cdT.now ? '#ff6b5b' : cdT.s <= 30 ? '#ffb347' : '#ffd54f';
  const lab = cdT.now ? 'いま真上！' : 'あと' + mmss(cdT.s);
  const X0 = 30, X1 = W - 30, Y0 = 90, Y1 = H - 70;
  g.save(); g.shadowBlur = 0; g.font = 'bold 13px sans-serif'; g.textAlign = 'center';
  if (x > 12 && x < W - 12 && y > 30 && y < H - 50) {
    const r = 16 + 3 * Math.sin(Date.now() / 180);
    g.strokeStyle = col; g.lineWidth = 2.5; g.setLineDash([5, 4]); g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); g.setLineDash([]);
    g.fillStyle = col; g.fillText(lab, Math.max(40, Math.min(W - 40, x)), y - r - 6);
  } else {
    const dx = x - cx, dy = y - cy, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const kx = ux > 0 ? (X1 - cx) / ux : ux < 0 ? (X0 - cx) / ux : Infinity;
    const ky = uy > 0 ? (Y1 - cy) / uy : uy < 0 ? (Y0 - cy) / uy : Infinity;
    const k = Math.max(0, Math.min(kx, ky)), ax = cx + ux * k, ay = cy + uy * k, a = Math.atan2(uy, ux);
    g.translate(ax, ay); g.rotate(a);
    g.fillStyle = col; g.beginPath(); g.moveTo(16, 0); g.lineTo(-8, -11); g.lineTo(-3, 0); g.lineTo(-8, 11); g.closePath(); g.fill();
    g.rotate(-a); g.translate(-ax, -ay);
    const tw = g.measureText(lab).width, d = 20 + Math.abs(ux) * tw / 2 + Math.abs(uy) * 8;
    g.fillText(lab, ax - ux * d, ay - uy * d + 4);
  }
  g.restore();
}
const catchStepV13 = catchStep;
catchStep = function (g, toXY, off) { catchStepV13(g, toXY, off); cdArrow(g, toXY); };
// (2) 星座を探す：照準のまわり25°だけ星座の線が見える。2秒とらえると名前と説明が出て「見つけた星座」に記録（点・バッジなし）
const CON_R = 25, CON_HOLD = 2000, CON_GAP = 500;
let conFind = lsGet('sora_con_mode', 'find') !== 'all', conHold = null;
// 今夜（12時間以内）にもう見つけた星座か
function conFoundAt(id, now) {
  for (const k of [today(), ymd(new Date(now - 86400000))]) {
    const D = skyDays.days[k], f = D && (D.con || []).find(x => x.id === id);
    if (f && now - f.t < 12 * 3600000) return f;
  }
  return null;
}
const conTonight = now => [today(), ymd(new Date(now - 86400000))].reduce((n, k) => n + ((skyDays.days[k] && skyDays.days[k].con) || []).filter(x => now - x.t < 12 * 3600000).length, 0);
const conLayerBase = conLayer;
conLayer = function (g, toXY, dAz, off, W, H, cx, cy, sc) {
  if (!conFind || !conObjs.length) { conHold = null; return conLayerBase(g, toXY, dAz, off, W, H, cx, cy, sc); }
  const now = Date.now(), R = CON_R * sc, all = conObjs;
  // 懐中電灯のような、うっすら明るい輪
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, R);
  gr.addColorStop(0, 'rgba(120,150,255,.12)'); gr.addColorStop(1, 'rgba(120,150,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
  // 輪の中だけ描く。まだ見つけていない星座は名前を隠す
  conObjs = all.map(c => conFoundAt(c.id, now) ? c : Object.assign({}, c, {lab:[0, -90]}));
  let r = null;
  g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip();
  try { r = conLayerBase(g, toXY, dAz, off, W, H, cx, cy, sc); } finally { g.restore(); conObjs = all; }
  if (!r) { conHold = null; return null; }
  const c = all.find(x => x.id === r.c.id) || r.c;
  return {c, hi:() => { if (conFoundAt(c.id, now)) r.hi(); else conHoldStep(g, c, cx, cy, now); }};
};
// 照準に星座の線を入れている間、照準のまわりに輪がたまっていく
function conHoldStep(g, c, cx, cy, now) {
  if (!conHold || conHold.id !== c.id || now - conHold.lastIn > CON_GAP) conHold = {id:c.id, t0:now, lastIn:now};
  conHold.lastIn = now;
  const k = Math.min(1, (now - conHold.t0) / CON_HOLD);
  g.save(); g.shadowBlur = 0; g.lineWidth = 4;
  g.strokeStyle = 'rgba(159,197,255,.3)'; g.beginPath(); g.arc(cx, cy, 20, 0, 7); g.stroke();
  g.strokeStyle = '#9fc5ff'; g.beginPath(); g.arc(cx, cy, 20, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); g.stroke();
  g.restore();
  if (k >= 1) conFound(c, now);
}
function conFound(c, now) {
  conHold = null;
  if (conFoundAt(c.id, now)) return;
  const D = dayGet();
  (D.con = D.con || []).push({id:c.id, name:c.name, t:now});
  daySave(true);
  const vis = conObjs.filter(o => o.lab[1] > 0).length;
  alertMsg(`星座を見つけた！ ${c.name}　今夜${conTonight(now)}つめ（いま見える星座 ${vis}）`, null, false);
  $('toast').classList.add('con');
  if ($('day').style.display === 'block') renderDay(dayView || today());
}
const conSayBase = conSay;
conSay = function (c, say) {
  if (!conFind || conFoundAt(c.id, Date.now())) return conSayBase(c, say);
  const k = conHold && conHold.id === c.id ? Math.min(1, (Date.now() - conHold.t0) / CON_HOLD) : 0;
  say('照準：星座の線をとらえました', `照準を動かさずに2秒で、星座の名前がわかります（${Math.round(k * 100)}%）`, '#9fc5ff');
};
// 「出し方」ボタン（星座がONのときだけ出す）
const showConUiBase = showConUi;
showConUi = function () {
  showConUiBase();
  const b = $('conMode');
  b.style.display = conOn ? '' : 'none';
  b.textContent = conFind ? '出し方：探す' : '出し方：全部';
};
$('conMode').onclick = () => { conFind = !conFind; conHold = null; lsSet('sora_con_mode', conFind ? 'find' : 'all'); showConUi(); };
// 今日の空に「見つけた星座」
const renderDayV15 = renderDay;
renderDay = function (k) {
  renderDayV15(k);
  const D = skyDays.days[k], L = (D && D.con) || [];
  if (!L.length) return;
  const el = document.createElement('div'); el.className = 'drow';
  el.innerHTML = `<b>${k === today() ? '今夜' : ''}見つけた星座</b>　${L.length}個<br><span class="small">${esc(L.map(x => hm(x.t) + ' ' + x.name).join('、'))}</span>`;
  const sp = [...$('dayBody').querySelectorAll('.dhead')].find(x => x.textContent === '見た場所');
  $('dayBody').insertBefore(el, sp || null);
};

// ---------- iPhone対応（v19） ----------
// iPhone（Safari・Chromeとも）は、向きのセンサーを使う前に、ボタンを押したその場で許可を求める決まりがある
const SKY_HINT = 'スマホを写真を撮るように機体へ向けてください。照準の機体をタップで詳細';
const oriDeniedText = '向きのセンサーが許可されていないため、空に向ける画面が使えません。このページを閉じて開き直し、もう一度「空に向ける」を押して「許可」を選んでください';
let oriPerm = ''; // ''＝まだ聞いていない、'asking'＝確認中、'granted'＝許可、'denied'＝不許可
const needOriPerm = () => typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
function askOri() {
  if (!needOriPerm() || oriPerm === 'granted' || oriPerm === 'asking') return;
  oriPerm = 'asking';
  $('skyInfo').textContent = '「動作と方向」へのアクセスを「許可」してください';
  DeviceOrientationEvent.requestPermission().then(r => {
    oriPerm = r === 'granted' ? 'granted' : 'denied';
    $('skyInfo').textContent = oriPerm === 'granted' ? SKY_HINT : oriDeniedText;
  }).catch(e => { oriPerm = 'denied'; $('skyInfo').textContent = oriDeniedText; });
}
// 「空に向ける」を押したとき（ボタンを押したその場で聞く必要があるので、画面の切り替えより先に聞く）
const setSkyV13 = setSky;
setSky = function (on) {
  if (on && !sky) askOri();
  setSkyV13(on);
  // 確認中・不許可のときは「この端末では方位センサーが使えないようです」を出さない
  if (on && needOriPerm()) setTimeout(() => { if (sky && oriPerm !== 'granted' && !gotOri) $('skyInfo').textContent = oriPerm === 'denied' ? oriDeniedText : '「動作と方向」へのアクセスを「許可」してください'; }, 1600);
};
// 許可されなかったときは、空の画面にも理由を出す（黙って止まらないように）
const drawScopeBase = drawScope;
drawScope = function () {
  drawScopeBase();
  // 向きの値が届いたら「使えないようです」の表示を元に戻す（許可の確認に時間がかかったとき）
  if (gotOri && $('skyInfo').textContent === 'この端末では方位センサーが使えないようです') $('skyInfo').textContent = SKY_HINT;
  if (head != null || !needOriPerm() || oriPerm === 'granted') return;
  const c = $('scope'), box = $('scopeBox'), g = c.getContext('2d'), W = box.clientWidth, H = box.clientHeight;
  g.save(); g.shadowBlur = 0;
  g.fillStyle = '#0d1b2a'; g.fillRect(0, 0, W, 150);
  g.fillStyle = '#fff'; g.font = '14px sans-serif'; g.textAlign = 'left';
  if (oriPerm === 'denied') {
    g.fillStyle = '#ffb3a7'; g.fillText('向きのセンサーが許可されていません', 10, 96);
    g.fillStyle = '#fff'; g.fillText('ページを開き直して、もう一度', 10, 118); g.fillText('「空に向ける」を押し「許可」を選んでください', 10, 140);
  } else {
    g.fillText('「動作と方向」へのアクセスを確認しています…', 10, 96);
    g.fillText('確認の画面が出たら「許可」を選んでください', 10, 118);
  }
  g.restore();
};

// ---------- 記録の書き出し・読み込み（v20） ----------
// 記録（sora_ で始まる保存）を1つのファイルにまとめて書き出し、別の端末や新しいアドレスで読み込めるようにする
const BK_SKIP = ['sora_routes_v1', 'sora_tle', 'sora_bk_last']; // 取り直せる一時保存と、書き出した日の印は入れない
let bkLock = false, lsWarnAt = 0;
// 保存に失敗したら知らせる（10分に1回まで）。読み込みの最中は、いまの記録で上書きしないよう保存を止める
lsSet = function (k, v) {
  if (bkLock) return;
  try { localStorage.setItem(k, JSON.stringify(v)); }
  catch (e) {
    if (Date.now() - lsWarnAt < 600000) return;
    lsWarnAt = Date.now();
    alertMsg('記録を保存できませんでした。保存場所がいっぱいかもしれません。画面の下の「記録を書き出す」でファイルに残してください', null, false);
  }
};
const bkKeys = () => Object.keys(localStorage).filter(k => k.startsWith('sora_') && !BK_SKIP.includes(k));
const ymdLabel = t => { const d = new Date(t); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
// 欄の説明（最後に書き出した日・保存量）
function bkInfo() {
  let bytes = 0;
  try { Object.keys(localStorage).forEach(k => { bytes += (k.length + (localStorage.getItem(k) || '').length) * 2; }); } catch (e) {}
  const last = lsGet('sora_bk_last', null);
  $('bkInfo').innerHTML = `最後に書き出した日：${last ? ymdLabel(last) : 'まだ書き出していません'}<br>` +
    `このサイトの保存量：約${(bytes / 1048576).toFixed(1)}MB／約5MB（同じアドレスのほかのアプリの分も含む）<br>` +
    'スマホを替えるときや、アドレスが変わるときは、書き出したファイルを新しいほうで読み込んでください';
}
// 書き出す
$('bkOut').onclick = () => {
  // 画面で使っている最新の記録を先に保存してから集める
  daySave(true);
  lsSet('sora_zukan_v1', zukan); lsSet('sora_cities_v1', cities); lsSet('sora_catch_v1', catchData); lsSet('sora_badge_v1', badge);
  const data = {};
  bkKeys().forEach(k => { data[k] = localStorage.getItem(k); });
  const t = Date.now(), file = JSON.stringify({app:'SoraMiru', kind:'kiroku', v:1, t, data});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([file], {type:'application/json'}));
  a.download = `soramiru-kiroku-${today()}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  lsSet('sora_bk_last', t);
  bkInfo();
};
// 読み込む
$('bkIn').onclick = () => { $('bkFile').value = ''; $('bkFile').click(); };
function bkSummary(o) {
  const P = k => { try { return JSON.parse(o.data[k]); } catch (e) { return null; } };
  const z = P('sora_zukan_v1'), c = P('sora_catch_v1'), d = P('sora_day_v1'), b = P('sora_badge_v1');
  const parts = [];
  if (z && z.types) parts.push(`図鑑${Object.keys(z.types).filter(x => x !== '?').length}機種`);
  if (c) parts.push(`キャッチ${c.total || 0}回`);
  if (d && d.days) parts.push(`記録した日${Object.keys(d.days).length}日`);
  if (b && b.got) parts.push(`バッジ${Object.values(b.got).reduce((n, g) => n + ((g && g.d) || []).length, 0)}個`);
  return `${o.t ? ymdLabel(o.t) + 'に書き出した' : ''}記録です。${parts.join('・') || '中身の記録はありません'}`;
}
$('bkFile').onchange = () => {
  const f = $('bkFile').files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    let o = null;
    try { o = JSON.parse(rd.result); } catch (e) {}
    const ok = o && o.app === 'SoraMiru' && o.kind === 'kiroku' && o.data && typeof o.data === 'object' &&
      Object.keys(o.data).length && Object.entries(o.data).every(([k, v]) => k.startsWith('sora_') && typeof v === 'string');
    if (!ok) { alert('このファイルは読み込めません（SoraMiru の記録のファイルではないか、壊れています）。いまの記録はそのままです'); return; }
    if (!confirm(bkSummary(o) + '\n\nいまの記録を、このファイルの内容に置き換えます。よろしいですか？\n（いまの記録は消えます。残したいときは、先に「記録を書き出す」をしてください）')) return;
    // 書き込みに失敗したら元に戻す
    const old = {};
    bkKeys().forEach(k => { old[k] = localStorage.getItem(k); });
    bkLock = true;
    try {
      Object.keys(old).forEach(k => localStorage.removeItem(k));
      Object.entries(o.data).forEach(([k, v]) => { if (!BK_SKIP.includes(k)) localStorage.setItem(k, v); });
    } catch (e) {
      try { bkKeys().forEach(k => localStorage.removeItem(k)); Object.entries(old).forEach(([k, v]) => localStorage.setItem(k, v)); } catch (e2) {}
      bkLock = false;
      alert('保存場所が足りず、読み込めませんでした。いまの記録はそのままです');
      return;
    }
    alert('記録を読み込みました。画面を読み込み直します');
    location.reload();
  };
  rd.onerror = () => alert('ファイルを開けませんでした');
  rd.readAsText(f);
};
bkInfo();
setInterval(() => { if (!document.hidden) bkInfo(); }, 300000);

// ---------- 行き先の食い違いを直す（v21） ----------
// ためてある行き先と機体のいまの位置を見比べ、「出発地→行き先」の線から大きく外れていたら調べ直す
// （経由便が別の区間を飛んでいるとき、同じ便名で行き先が変わった日など）。同じ便は30分に1回まで
const routeRecheck = new Map(); // 便名 → 最後に調べ直した時刻
function routeOff(p, r) {
  if (!r || r.none || !r.a || r.a.length < 2 || !p.p) return false;
  const o = [r.a[0].lon, r.a[0].lat], d = [r.a[1].lon, r.a[1].lat];
  const D = gcKm(o, d), detour = gcKm(o, p.p) + gcKm(p.p, d) - D;
  return detour > Math.max(200, D * 0.3);
}
const fetchRoutesV20 = fetchRoutes;
fetchRoutes = function (list) {
  const now = Date.now();
  list.forEach(p => {
    if (p.ground || p.mil || !p.cs || !routeOff(p, routes[p.cs])) return;
    if (now - (routeRecheck.get(p.cs) || 0) < 1800000) return;
    routeRecheck.set(p.cs, now);
    delete routes[p.cs];
  });
  return fetchRoutesV20(list);
};

// ---------- パソコンで開いたときと現在地の扱い（v22） ----------
// (1) 向きのセンサーがない端末（パソコン）では「空に向ける」を開かずに知らせる
// (2) 現在地の誤差が1kmを超えたら「粗い位置」として、真上カウントダウン・真上の知らせ・見た場所の地名を止める
// (3) 現在地が取れないときは南大沢を仮の中心にせず、地図で場所を選んでもらう（選んだ場所は sora_pick に覚える）
// (4) 記録は端末ごと、と説明に足す
// (5) 地図で選んだ場所が、いる場所（現在地）から離れているとき・現在地が分からないときは「よその空」：
//     図鑑・都市・今日の空・バッジに数えず（よその空ノートに記録＝v23）。真上カウントダウンと真上の知らせも出さない（v24）
const ROUGH_M = 1000, JAPAN = [137.5, 37.0];
const GEO_MSG = {1:'許可されていません。ブラウザの設定で位置情報を許可するか、「よその空に行く」で場所を選んでください',
  2:'現在地を取得できませんでした（電波や Wi-Fi の状態を確かめてください）', 3:'時間内に現在地が取れませんでした（しばらくして開き直してください）'};
const okPt = v => Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'number' && isFinite(x));
let posAcc = null, geoErr = '', lastGps = null, pickMode = false, pickCall = false;
let pickPos = okPt(lsGet('sora_pick', null)) ? lsGet('sora_pick', null) : null;
BK_SKIP.push('sora_pick'); // 地図で選んだ場所は端末ごとの設定なので、書き出しには入れない
const isRough = () => !pickPos && !usingSaved && !usingDef && posAcc != null && posAcc > ROUGH_M;
const posUnsure = () => viewOnly() || (!pickPos && (usingSaved || usingDef || isRough()));
const accKm = () => (posAcc / 1000).toFixed(posAcc < 10000 ? 1 : 0);
// 地図で選んだ場所が現在地の近く（誤差の範囲内、少なくとも5km以内）なら記録する。離れている・現在地が分からないなら「よその空」
const viewOnly = () => !!pickPos && !(lastGps && gcKm(pickPos, lastGps) <= Math.max(5, (posAcc || 0) / 1000));
// 位置情報の誤差（accuracy）を受け取り、エラーを日本語にする（起動処理の watchPosition の前に包む）
try {
  const geo = navigator.geolocation, wpBase = geo && geo.watchPosition && geo.watchPosition.bind(geo);
  if (wpBase) geo.watchPosition = function (ok, ng, opt) {
    return wpBase(g => {
      const vo = viewOnly();
      posAcc = g.coords && typeof g.coords.accuracy === 'number' ? g.coords.accuracy : null;
      geoErr = ''; lastGps = [g.coords.longitude, g.coords.latitude];
      ok(g); locUi();
      if (pickPos && vo !== viewOnly() && pos) render();
    }, e => {
      geoErr = GEO_MSG[e && e.code] || String((e && e.message) || '');
      if (ng) ng({code:e && e.code, message:geoErr});
      locUi(); if (pos) render();
    }, opt);
  };
} catch (e) {}
if (!navigator.geolocation) geoErr = 'この端末（ブラウザ）は位置情報に対応していません';
// 現在地の切り替え：地図で選んだ場所を使っている間は、現在地（GPS）が届いても切り替えない
const setPosV21 = setPos;
setPos = function (p, def, saved) {
  if (pickCall) { setPosV21(p, false, false); locUi(); return; }
  if (pickPos) { if (!pos) setPosV21(pickPos, false, false); locUi(); return; }
  if (def) { if (!pos) { pickMode = true; map.jumpTo({center:JAPAN, zoom:4.3}); } locUi(); return; }
  setPosV21(p, def, saved);
  locUi();
};
// 現在地が分かるまでは、地図を日本全体にしておく
if (!pickPos && !okPt(lsGet('sora_lastpos', null))) map.jumpTo({center:JAPAN, zoom:4.3});
// 「よその空に行く」の行（「〇機（半径30km）」の行の下）
{
  const bar = document.createElement('div');
  bar.id = 'locBar'; bar.className = 'small';
  bar.innerHTML = '<button id="pickBtn">よその空に行く</button><button id="backBtn" style="display:none">現在地に戻す</button> <span id="locInfo"></span>';
  $('head').after(bar);
}
function locUi() {
  const b = $('pickBtn'), info = $('locInfo');
  if (!b) return;
  b.style.display = pickMode && !pos ? 'none' : '';
  $('backBtn').style.display = pickPos && !pickMode ? '' : 'none';
  if (pickMode) {
    b.textContent = '選ぶのをやめる';
    info.textContent = '地図をタップして、空を見に行く場所を選んでください（拡大してから選ぶと正確です）';
  } else if (pickPos) {
    b.textContent = '別の場所へ';
    info.textContent = viewOnly() && !lastGps && !geoErr ? 'よその空かどうか、現在地を確認しています（確認できるまで記録しません）'
      : viewOnly() ? 'よその空です。' + (lastGps ? 'いる場所から離れている' : '現在地が分からない')
      + 'ので、いつもの図鑑・都市・今日の空・バッジには数えず、「よその空ノート」に記録します（空に向けると、その場所の空でキャッチできます）'
      + (lastGps ? '' : '。位置情報を許可して、今いる場所の近くを選ぶと、いつもの記録になります')
      : '地図で選んだ場所の空です（今いる場所の近くなので、いつもどおり記録します）';
  } else {
    b.textContent = 'よその空に行く';
    info.textContent = isRough() ? `現在地の誤差が大きい（約${accKm()}km）ため、真上カウントダウンと真上の知らせを止めています。「よその空に行く」で今いる場所を選び直すと正確にできます`
      : usingSaved && geoErr ? '現在地が取れないため、前回の場所で表示しています（' + geoErr + '）' : '';
  }
  if (!pos) $('head').textContent = pickMode ? (geoErr ? '現在地が取れません。' : '') + '地図をタップして、空を見る場所を選んでください' : '現在地を取得中…';
  if (window.yosoUiHook) window.yosoUiHook(); // よその空の地名（v23）
  try { map.getCanvas().style.cursor = pickMode ? 'crosshair' : ''; } catch (e) {}
}
map.on('click', e => {
  if (!pickMode) return;
  pickMode = false;
  const p = [+e.lngLat.lng.toFixed(4), +e.lngLat.lat.toFixed(4)];
  pickPos = p; lsSet('sora_pick', p);
  pickCall = true;
  try { setPos(p, false, false); } finally { pickCall = false; }
  setTimeout(tick, busy ? 1500 : 0);
});
$('pickBtn').onclick = () => {
  if (pickMode) { if (pos) { pickMode = false; locUi(); } return; }
  if (sky) setSky(false);
  pickMode = true; locUi();
};
$('backBtn').onclick = () => { // 現在地に戻す
  if (!pickPos) return;
  pickPos = null;
  try { localStorage.removeItem('sora_pick'); } catch (e) {}
  if (lastGps) {
    pickCall = true;
    try { setPos(lastGps, false, false); } finally { pickCall = false; }
    map.jumpTo({center:lastGps, zoom:9});
  } else usingSaved = true; // 現在地が届いたら切り替わる
  locUi(); render();
  setTimeout(tick, busy ? 1500 : 0);
};
// 「〇機（半径30km）」の行の注意書き
const renderV17 = render;
render = function () {
  renderV17();
  const note = pickPos ? (viewOnly() ? 'よその空（よその空ノートに記録中）' : '地図で選んだ場所') : isRough() ? `現在地の誤差 約${accKm()}km（真上の知らせは停止中）`
    : usingSaved && geoErr ? '前回の場所で表示中（現在地が取れません）' : '';
  if (note) $('head').textContent = $('head').textContent.replace(/　※.*$/, '') + '　※' + note;
};
// 粗い位置・前回の場所のときは、真上カウントダウンと真上通過の知らせを出さない（軍用機の知らせは続ける）
const cdPickV18 = cdPick;
cdPick = function (now) { return posUnsure() ? null : cdPickV18(now); };
const notifyV18 = notify;
notify = function (list) {
  if (!posUnsure()) return notifyV18(list);
  const el = $('ntfOver'), was = el.checked;
  el.checked = false;
  try { notifyV18(list); } finally { el.checked = was; }
};
// 粗い位置のときは、見た場所を「位置未確認」にまとめる（ずれた市区町村を記録しない）
const spotForV8 = spotFor;
spotFor = function (D, now) {
  if (!isRough()) return spotForV8(D, now);
  const b = usingSaved; usingSaved = true;
  try { return spotForV8(D, now); } finally { usingSaved = b; }
};
// 向きのセンサーがない端末（主な操作がマウス）では「空に向ける」を開かない
const noSensor = () => !gotOri && !(window.matchMedia && matchMedia('(pointer: coarse)').matches);
if (noSensor()) $('skyBtn').textContent = '空に向ける（スマホ用）';
$('skyBtn').onclick = () => {
  if (!sky && noSensor()) {
    alertMsg('「空に向ける」はスマホで開くと使えます（向きのセンサーが必要です）。キャッチ・星座を探す・方角合わせも、この画面の機能です', null, false);
    $('toast').classList.add('con');
    return;
  }
  setSky(!sky);
};
// よその空のときはいつもの記録に数えない（図鑑・都市の候補・今日の空・宇宙ステーションを見た時刻。バッジはこれらから数える）
const recordV8 = record, noteNearV8 = noteNear, dayRecordV8 = dayRecord, dayIssV8 = dayIss;
record = function (list) { if (!viewOnly()) recordV8(list); };
noteNear = function (list, now) { if (!viewOnly()) noteNearV8(list, now); };
dayRecord = function (list, now) { if (!viewOnly()) dayRecordV8(list, now); };
dayIss = function (now) { if (!viewOnly()) dayIssV8(now); };
// 記録は端末ごと
const bkInfoV20 = bkInfo;
bkInfo = function () {
  bkInfoV20();
  $('bkInfo').innerHTML += '<br>記録はこの端末のこのブラウザの中にあります。パソコンとスマホでは別々です';
};
bkInfo();
locUi();

// ---------- よその空ノート（v23） ----------
// 「よその空に行く」で、いる場所から離れた場所を選んだとき（よその空）に見た機体を、いつもの記録とは別のノートに集める
// 場所ごと：地名（OpenStreetMap の Nominatim で1回だけ調べる）・行った日・機体の数・機種・航空会社・軍用機。キャッチや点・バッジはなし
const YOSO_KM = 20, YOSO_MAX = 200;
let yoso = lsGet('sora_yoso_v1', null);
if (!yoso || !Array.isArray(yoso.pl) || !yoso.types) yoso = {pl:[], types:{}, seen:{}};
if (!yoso.seen) yoso.seen = {};
let yosoCur = null, yosoNameTry = 0, yosoOpenId = null;
const yosoSave = () => lsSet('sora_yoso_v1', yoso);
// 現在地の確認を待っている間（よその空かどうかまだ決まらない間）は記録しない
const yosoOn = () => viewOnly() && !!pos && (!!lastGps || !!geoErr);
// いま行っているよその空の場所（20km以内に前に行った場所があれば同じ場所として続ける）
function yosoPlace() {
  if (!pickPos) return null;
  if (yosoCur && gcKm(yosoCur.p, pickPos) <= YOSO_KM) return yosoCur;
  let best = null, bd = YOSO_KM;
  yoso.pl.forEach(x => { const d = gcKm(x.p, pickPos); if (d <= bd) { bd = d; best = x; } });
  if (!best) {
    best = {id:Date.now().toString(36), name:'', cc:'', ctry:'', p:[+pickPos[0].toFixed(2), +pickPos[1].toFixed(2)],
      first:today(), last:today(), d:[], n:0, ty:{}, al:{}, mil:0};
    yoso.pl.push(best);
    if (yoso.pl.length > YOSO_MAX) { yoso.pl.sort((a, b) => a.last.localeCompare(b.last)); yoso.pl.splice(0, yoso.pl.length - YOSO_MAX); }
    yosoSave();
  }
  yosoCur = best;
  return best;
}
// 地名（OpenStreetMap の Nominatim。1秒1回までの決まりがあるので、場所ごとに1回、失敗したら5分あけてやり直す）
async function yosoName(e) {
  if (!e || e.name || Date.now() - yosoNameTry < 300000) return;
  yosoNameTry = Date.now();
  try {
    const r = await tfetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${e.p[1]}&lon=${e.p[0]}&zoom=10&accept-language=ja`, 10000);
    const j = await r.json(), a = (j && j.address) || {};
    e.name = a.city || a.town || a.village || a.municipality || a.county || a.state || a.region || (j && j.error ? '地名なし（海の上など）' : '');
    e.ctry = a.country || ''; e.cc = (a.country_code || '').toUpperCase();
    if (!e.name) return;
    yosoNameTry = 0; yosoSave(); yosoUi();
    if (yosoIsOpen()) renderYoso();
  } catch (er) {}
}
const yosoLabel = e => e ? (e.name || '地名を調べ中') + (e.ctry ? `（${e.ctry}）` : '') : '';
// 機体を記録する（同じ場所・同じ日は1機1回）
function yosoRecord(list) {
  if (!yosoOn()) return;
  const e = yosoPlace(); if (!e) return;
  yosoName(e);
  const d = today();
  if (!e.d.includes(d)) e.d.push(d);
  e.last = d;
  list.forEach(p => {
    if (p.ground) return;
    const k = e.id + '|' + p.hex;
    if (yoso.seen[k] === d) return;
    yoso.seen[k] = d; e.n++;
    const code = p.type || '?';
    e.ty[code] = (e.ty[code] || 0) + 1;
    if (/^[A-Z]{3}\d/.test(p.cs || '')) { const al = p.cs.slice(0, 3); e.al[al] = (e.al[al] || 0) + 1; }
    if (p.mil) e.mil++;
    if (code === '?') return;
    if (!yoso.types[code]) yoso.types[code] = {n:0, first:d}; // 見かけた回数（レア度に使う。v31 から機種の一覧はキャッチした機種だけ）
    yoso.types[code].n++;
  });
  for (const k in yoso.seen) if (yoso.seen[k] !== d) delete yoso.seen[k];
  yosoSave();
  locUi();
  if (yosoIsOpen()) renderYoso();
}
const recordV22 = record;
record = function (list) { recordV22(list); yosoRecord(list); };
// 「よその空に行く」の行に、いまの場所の名前を出す
function yosoUi() {
  const info = $('locInfo');
  if (!info || pickMode || !pickPos || !yosoOn()) return;
  let e = yosoCur && gcKm(yosoCur.p, pickPos) <= YOSO_KM ? yosoCur : null;
  if (!e) yoso.pl.forEach(x => { if (gcKm(x.p, pickPos) <= YOSO_KM && (!e || gcKm(x.p, pickPos) < gcKm(e.p, pickPos))) e = x; });
  if (e) info.textContent = `よその空：${yosoLabel(e)}。` + info.textContent.replace(/^よその空(です|：[^。]*)。/, '');
}
window.yosoUiHook = yosoUi;
// 画面
{
  const st = document.createElement('style');
  st.textContent = '#yoso{display:none;position:fixed;top:0;left:0;right:0;bottom:0;z-index:20;background:#fff;overflow:auto;padding:12px}' +
    '.ycard{border:1px solid #ddd;border-left:6px solid #2e7d6b;border-radius:6px;padding:6px 8px;margin:6px 0;line-height:1.6;cursor:pointer}' +
    '.ycard.now{background:#eef8f5}.ynew{color:#2e7d6b;font-weight:bold}';
  document.head.appendChild(st);
  const box = document.createElement('div'); box.id = 'yoso';
  box.innerHTML = '<button id="yosoClose">閉じる</button> <b>よその空ノート</b>　<span id="yosoSum" class="small"></span><button id="yosoReset" class="reset">記録を消す</button>' +
    '<div id="yosoBody"></div><div class="small" style="margin-top:8px">「よその空に行く」で、いる場所から離れた場所を選んだときに見た機体です。いつもの図鑑・都市・今日の空・バッジとは別に数えます（同じ場所・同じ日は1機1回）。' +
    '機種の一覧は、よその空で空に向けてキャッチした機種です。<span class="ynew">★</span>は自分の空（いつもの図鑑）ではまだ出会っていない機種です。地名：© OpenStreetMap contributors（Nominatim）</div>';
  document.body.appendChild(box);
  const btn = document.createElement('button'); btn.id = 'yosoBtn'; btn.textContent = 'よその空ノート';
  $('badgeBtn').after(btn);
}
const yosoIsOpen = () => $('yoso').style.display === 'block';
function renderYoso() {
  const pl = yoso.pl.slice().sort((a, b) => b.last.localeCompare(a.last) || b.n - a.n);
  const nc = new Set(pl.map(e => e.cc).filter(Boolean)).size, ks = Object.keys((yoso.cat && yoso.cat.types) || {}).filter(c => c !== 'ISS');
  const newN = ks.filter(c => !zukan.types[c]).length;
  $('yosoSum').textContent = `${pl.length}か所・${nc}か国・キャッチ ${ks.length}機種（★ ${newN}）`;
  if (!pl.length) {
    $('yosoBody').innerHTML = '<div class="drow small">まだ記録がありません。「よその空に行く」を押して、地図で行ってみたい場所（海外でも）をタップしてください</div>';
    return;
  }
  const cur = yosoOn() && yosoCur;
  $('yosoBody').innerHTML = pl.map(e => {
    const cty = e.cty || {}, tys = Object.keys(cty).filter(c => c !== '?'); // キャッチした機種（v31）
    let h = `<div class="ycard${e === cur ? ' now' : ''}" data-id="${esc(e.id)}"><b>${esc(yosoLabel(e))}</b>${e === cur ? '　<span class="ynew">いまここ</span>' : ''}<br>` +
      `<span class="small">${esc(e.last.slice(5).replace('-', '/'))}・${e.d.length}日行った・見かけた機体 ${e.n}機${e.mil ? `・<b style="color:#c0392b">軍用機 ${e.mil}機</b>` : ''}・航空会社 ${Object.keys(e.al).length}社</span>`;
    if (yosoOpenId === e.id) {
      const list = tys.sort((a, b) => cty[b] - cty[a]).map(c => `${zukan.types[c] ? '' : '<span class="ynew">★</span>'}${esc(tyName(c))}${cty[c] > 1 ? '×' + cty[c] : ''}`);
      const als = Object.keys(e.al).sort((a, b) => e.al[b] - e.al[a]).map(a => esc(AIRLINE[a] || a));
      h += `<div class="small" style="margin-top:4px;color:#333">キャッチした機種：${list.join('、') || 'まだありません（空に向けてキャッチすると、ここに入ります）'}<br>見かけた航空会社：${als.join('、') || 'なし'}<br>行った日：${esc(e.d.map(x => x.slice(5).replace('-', '/')).join('、'))}</div>`;
    }
    return h + '</div>';
  }).join('');
  $('yosoBody').querySelectorAll('.ycard').forEach(c => c.onclick = () => { yosoOpenId = yosoOpenId === c.dataset.id ? null : c.dataset.id; renderYoso(); });
  pl.forEach(e => { if (!e.name) yosoName(e); });
}
const yosoCloseBase = () => { $('yoso').style.display = 'none'; if (window.yosoMapOff) window.yosoMapOff(); }; // 世界地図は v25
$('yosoBtn').onclick = () => {
  if (yosoIsOpen()) return;
  renderYoso(); $('yoso').style.display = 'block'; $('yoso').scrollTop = 0;
  navPush('yoso', yosoIsOpen, yosoCloseBase);
};
$('yosoClose').onclick = () => navClose('yoso', yosoCloseBase);
$('yosoReset').onclick = () => {
  if (!confirm('よその空ノートの記録をすべて消します（いつもの記録は残ります）。よろしいですか？')) return;
  yoso = {pl:[], types:{}, seen:{}}; yosoCur = null; yosoSave(); renderYoso(); locUi();
};
// 記録の読み込みの確認に、よその空ノートの場所の数も出す
const bkSummaryV20 = bkSummary;
bkSummary = function (o) {
  let t = bkSummaryV20(o);
  try { const y = JSON.parse(o.data.sora_yoso_v1 || 'null'); if (y && Array.isArray(y.pl) && y.pl.length) t += `・よその空${y.pl.length}か所`; } catch (e) {}
  return t;
};
// よその空を選んだまま開き直したときは、現在地を待たずにその場所で始める（記録は現在地が分かってから）
if (pickPos && !pos) { pickCall = true; try { setPos(pickPos, false, false); } finally { pickCall = false; } }
locUi();

// ---------- よその空で空に向ける・よその空スコア（v24） ----------
// よその空でも「空に向ける」を使える（その場所に立って同じ方向を向いたつもり。カメラは景色が合わないので使わない）
// キャッチ・宇宙ステーション・星座を探すは、いつもの記録には書かず、よその空ノートに記録する。点は「よその空スコア」として別に数える
if (!yoso.cat || !yoso.cat.seen) yoso.cat = {seen:{}, types:{}, day:{}, total:0, best:null};
yoso.pl.forEach(e => { e.cn = e.cn || 0; e.pt = e.pt || 0; e.log = e.log || []; e.con = e.con || []; });
const YOSO_LOG = 20;
const yosoPlaceV23 = yosoPlace;
yosoPlace = function () {
  const e = yosoPlaceV23();
  if (e) { e.cn = e.cn || 0; e.pt = e.pt || 0; e.log = e.log || []; e.con = e.con || []; }
  return e;
};
$('yosoReset').onclick = () => {
  if (!confirm('よその空ノートの記録（よその空スコアも）をすべて消します。いつもの記録は残ります。よろしいですか？')) return;
  yoso = {pl:[], types:{}, seen:{}, cat:{seen:{}, types:{}, day:{}, total:0, best:null}}; yosoCur = null; yosoSave(); renderYoso(); locUi();
};
const yosoCaught = hex => !!yoso.cat.seen[hex + '|' + today()];
// 「今日キャッチ済み」かどうか：よその空ではよその空の記録で見る（現在地を確認している間は、どれもキャッチしない）
const caughtTodayV12 = caughtToday;
caughtToday = hex => viewOnly() ? (!yosoOn() || yosoCaught(hex)) : caughtTodayV12(hex);
// レア度：よその空では、よその空ノートでその機種を見た回数で決める（段階と点はいつもと同じ）
const rarityOfV13 = rarityOf;
rarityOf = function (code) {
  if (!viewOnly()) return rarityOfV13(code);
  if (!code || code === '?') return RARITY[3];
  const n = (yoso.types[code] && yoso.types[code].n) || 0;
  return RARITY.find(r => n <= r[0]);
};
function yosoDayScore(pt) {
  const d = today(), c = yoso.cat;
  c.day[d] = (c.day[d] || 0) + pt;
  const cut = ymd(new Date(Date.now() - 30 * 86400000));
  Object.keys(c.day).forEach(k => { if (k < cut) delete c.day[k]; });
  if (!c.best || c.day[d] > c.best.pt) c.best = {pt:c.day[d], d};
  return c.day[d];
}
function yosoCatchRec(e, rec, pt) {
  const d = today();
  yoso.cat.seen[rec.hex + '|' + d] = 1;
  for (const k in yoso.cat.seen) if (!k.endsWith('|' + d)) delete yoso.cat.seen[k];
  yoso.cat.total = (yoso.cat.total || 0) + 1;
  e.cn++; e.pt += pt;
  e.log.unshift(rec); e.log.splice(YOSO_LOG);
  const total = yosoDayScore(pt);
  yosoSave();
  if (yosoIsOpen()) renderYoso();
  return total;
}
// 機体のキャッチ（いつもの doCatch の代わり）
function yosoCatch(p, now) {
  const e = yosoPlace(); if (!e) return;
  const code = p.type || '?', rar = rarityOf(code), parts = [], add = (t, v) => { parts.push(`${t}+${v}`); return v; };
  let pt = rar[2];
  if (p.mil) pt += add('軍用機', 50);
  if (code !== '?' && !yoso.cat.types[code]) pt += add('よその空で初めての機種', 50);
  if (code !== '?' && !zukan.types[code]) pt += add('★自分の空でまだ', 30);
  if (p.sun) pt += add(p.sun.kind, 30);
  if (p.elev >= 70) pt += add('真上', 20);
  if (code !== '?') { yoso.cat.types[code] = (yoso.cat.types[code] || 0) + 1; e.cty = e.cty || {}; e.cty[code] = (e.cty[code] || 0) + 1; } // キャッチした機種（v31）
  const ri = routeInfo(p);
  const total = yosoCatchRec(e, {t:now, hex:p.hex, cs:p.cs || p.reg, ty:code, mil:p.mil ? 1 : 0, route:ri ? ri.text : '', pt, rar:rar[1]}, pt);
  const who = [typeName(p), p.cs || p.reg].filter(Boolean).join(' ') + (ri ? ' ' + ri.text : '');
  alertMsg(`よその空でキャッチ！ ${yosoLabel(e)}　${rar[1]} ${who}　+${pt}点${parts.length ? '（' + parts.join('・') + '）' : ''}　今日のよその空 ${total}点`, p.hex, true);
  $('toast').classList.add('catch');
  try { if (navigator.vibrate) navigator.vibrate(p.mil ? [80, 60, 80, 60, 240] : [80, 60, 160]); } catch (er) {}
}
const doCatchV17 = doCatch;
doCatch = function (p, now) {
  if (!viewOnly()) return doCatchV17(p, now);
  if (yosoOn()) yosoCatch(p, now);
};
// 宇宙ステーションのキャッチ（よその空では、よその空の記録に。1日1回100点）
const issCatchStepV13 = issCatchStep;
issCatchStep = function (g, toXY, off) {
  if (!viewOnly()) return issCatchStepV13(g, toXY, off);
  const now = Date.now();
  if (!yosoOn() || !issNow || yosoCaught('ISS') || elevNow < CATCH_MIN_AIM || issNow.el < CATCH_MIN_ELEV || !issVisible(issNow, new Date(now))) { issCT = null; return; }
  const inR = angSep(head, elevNow, issNow.az, issNow.el) <= CATCH_R;
  if (inR) { if (!issCT) issCT = {t0:now, lastIn:now}; issCT.lastIn = now; }
  else if (issCT && now - issCT.lastIn > CATCH_GAP) issCT = null;
  if (!issCT) return;
  const k = Math.min(1, (now - issCT.t0) / CATCH_MS), [x, y] = toXY(issNow.az, issNow.el);
  if (!off(x, y)) {
    g.strokeStyle = 'rgba(76,255,154,.35)'; g.lineWidth = 5; g.beginPath(); g.arc(x, y, 22, 0, 7); g.stroke();
    g.strokeStyle = '#4cff9a'; g.beginPath(); g.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); g.stroke();
  }
  if (k < 1 || !inR) return;
  issCT = null;
  const e = yosoPlace(); if (!e) return;
  const total = yosoCatchRec(e, {t:now, hex:'ISS', cs:'ISS', ty:'ISS', mil:0, route:'', pt:ISS_PT, rar:'宇宙'}, ISS_PT);
  alertMsg(`よその空で宇宙ステーションをキャッチ！ ${yosoLabel(e)}　+${ISS_PT}点　今日のよその空 ${total}点`, null, true);
  $('toast').classList.add('catch');
  try { if (navigator.vibrate) navigator.vibrate([80, 60, 80, 60, 80, 60, 300]); } catch (er) {}
};
// 星座を探す：よその空では、見つけた星座をその場所の記録に残す（いつもの今日の空には入れない）
const conFoundAtV18 = conFoundAt;
conFoundAt = function (id, now) {
  if (!viewOnly()) return conFoundAtV18(id, now);
  const e = yosoOn() && yosoPlace();
  return e ? e.con.find(x => x.id === id && now - x.t < 12 * 3600000) || null : null;
};
const conFoundV18 = conFound;
conFound = function (c, now) {
  if (!viewOnly()) return conFoundV18(c, now);
  conHold = null;
  const e = yosoOn() && yosoPlace();
  if (!e || conFoundAt(c.id, now)) return;
  e.con.push({id:c.id, name:c.name, t:now}); e.con.splice(0, Math.max(0, e.con.length - 50));
  yosoSave();
  const n = e.con.filter(x => now - x.t < 12 * 3600000).length;
  alertMsg(`${yosoLabel(e)}の空で星座を見つけた！ ${c.name}　今夜${n}つめ`, null, false);
  $('toast').classList.add('con');
  if (yosoIsOpen()) renderYoso();
};
// カメラ：よその空では使わない（映るのは今いる場所の景色なので）
const startCamV11 = startCam;
startCam = function () {
  if (!viewOnly()) return startCamV11();
  $('skyInfo').textContent = 'よその空ではカメラは使えません（映るのは今いる場所の景色なので、よその空とは合いません）';
};
// 空の画面：上に「よその空：ロンドン（イギリス）」。よその空に切り替わったらカメラを止める
const drawScopeV19 = drawScope;
drawScope = function () {
  if (viewOnly() && camOn) stopCam();
  drawScopeV19();
  if (!viewOnly() || head == null) return;
  const c = $('scope'), box = $('scopeBox'), g = c.getContext('2d'), W = box.clientWidth;
  const e = yosoOn() && yosoPlace();
  g.save(); g.shadowBlur = 0; g.font = 'bold 13px sans-serif'; g.textAlign = 'right'; g.fillStyle = '#9fe0cf';
  g.fillText(fitText(g, 'よその空：' + (e ? yosoLabel(e) : '現在地を確認中'), Math.max(80, W - 200)), W - 8, 17);
  g.restore();
};
const skyBtnV22 = $('skyBtn').onclick;
$('skyBtn').onclick = () => {
  skyBtnV22();
  if (sky && viewOnly()) $('skyInfo').textContent = 'よその空です。その場所に立って同じ方向を向いたつもりで、スマホを空に向けてください。キャッチの点は「よその空スコア」になります';
  else if (sky && /^よその空/.test($('skyInfo').textContent)) $('skyInfo').textContent = SKY_HINT;
};
// よその空ノートの画面：スコアと、場所ごとのキャッチ・見つけた星座
{
  const sc = document.createElement('div'); sc.id = 'yosoScore'; sc.className = 'drow';
  $('yosoBody').before(sc);
}
const renderYosoV23 = renderYoso;
renderYoso = function () {
  renderYosoV23();
  const c = yoso.cat, td = c.day[today()] || 0, b = c.best;
  $('yosoScore').innerHTML = `<b>今日のよその空スコア ${td}点</b>` + (b ? `<span class="small">（自己ベスト ${b.pt}点・${b.d.slice(5).replace('-', '/')}）</span>` : '') +
    `<br><span class="small">キャッチ通算 ${c.total || 0}機。よその空で空に向けて、照準の円に機体を2秒入れるとキャッチ（いつものスコアとは別）</span>`;
  $('yosoBody').querySelectorAll('.ycard').forEach(card => {
    const e = yoso.pl.find(x => x.id === card.dataset.id); if (!e) return;
    const sm = card.querySelector('.small');
    if (sm && (e.cn || e.con.length)) sm.innerHTML += `・キャッチ ${e.cn}機・${e.pt}点` + (e.con.length ? `・星座 ${new Set(e.con.map(x => x.id)).size}` : '');
    if (yosoOpenId !== e.id) return;
    const det = document.createElement('div'); det.className = 'small'; det.style.cssText = 'margin-top:4px;color:#333';
    const cl = e.log.slice(0, 10).map(r => `${hm(r.t)} ${r.mil ? '<b style="color:#c0392b">軍</b> ' : ''}${r.ty === 'ISS' ? '宇宙ステーション' : esc((r.cs || '') + ' ' + tyName(r.ty))} <b>${r.rar && r.rar !== '宇宙' ? esc(r.rar) + ' ' : ''}+${r.pt}</b>`);
    const cons = [...new Set(e.con.map(x => x.name))];
    det.innerHTML = (cl.length ? `キャッチ：<br>${cl.join('<br>')}` : 'キャッチ：まだありません') + (cons.length ? `<br>見つけた星座：${esc(cons.join('、'))}` : '');
    card.appendChild(det);
  });
};
locUi();

// ---------- 都市の線を出発地→行き先に・世界の空港・よその空の世界地図（v25） ----------
// (1) 「本当の現在地」：よその空にいても、距離・バッジ・シェアカードの方向は、最後に分かった現在地から測る
// (2) 都市の地図の線は、記録した便の「出発地→行き先」で引く（v25 から出発地も記録。それより前の記録は行き先の点だけ）
// (3) 世界の空港ボタンで、有名な空港の近くの空へひと押しで行ける
// (4) よその空ノートに世界地図（v26 から地球儀）と「この空に行く」ボタン
realHome = () => {
  if (pickPos && !viewOnly()) return pickPos; // 今いる場所の近くを地図で選び直したとき
  const last = lsGet('sora_lastpos', null);
  return lastGps || (okPt(last) ? last : null) || (!pickPos && pos) || DEF;
};
// --- 都市：出発地と行き先の組を記録する（recordCities の中で記録した便を拾う）
const recordCitiesV8 = recordCities;
recordCities = function () {
  const before = new Map(nearCand);
  recordCitiesV8();
  const d = today(), rt = cities.rt || (cities.rt = {});
  let changed = false;
  before.forEach((v, hex) => {
    if (nearCand.has(hex)) return; // まだ行き先が分からない
    const r = routeEntry(v.cs);
    if (!r || r.none || !r.a || cities.seen[v.cs + '|' + d] !== d) return;
    const k = 'rt|' + v.cs + '|' + d;
    if (cities.seen[k]) return;
    cities.seen[k] = d;
    const o = r.a[0], ap = r.a[1], id = ap.iata || ap.name, key = (o.iata || o.name) + '>' + id;
    const e = rt[key] || (rt[key] = {o:{name:apName(o), lat:o.lat, lon:o.lon}, d:id, n:0, first:d, last:d});
    e.n++; e.last = d; changed = true;
  });
  if (changed) { lsSet('sora_cities_v1', cities); if ($('cities').style.display === 'block') renderCities(); }
};
// --- 都市の地図：線は出発地→行き先。行き先の点・出発地の小さな点・この空（現在地）
const wrapLon = (lon, ref) => { while (lon - ref > 180) lon -= 360; while (lon - ref < -180) lon += 360; return lon; };
drawCitiesMap = function (rows) {
  if (!citiesMap) return;
  const home = realHome(), ref = home[0], rt = Object.values(cities.rt || {});
  const fc = f => ({type:'FeatureCollection', features:f});
  const lines = [], origins = new Map();
  rt.forEach(e => {
    const c = cities.list[e.d]; if (!c) return;
    const o = [wrapLon(e.o.lon, ref), e.o.lat];
    lines.push({type:'Feature', properties:{n:e.n}, geometry:{type:'LineString', coordinates:gcLine(o, [c.lon, c.lat])}});
    origins.set(e.o.name, o);
  });
  // 出発地が分からない都市（v25 より前の記録など）は、今いる空から行き先へ線を引く（「線を消す」より前の都市は引かない）
  const withRt = new Set(rt.map(e => e.d));
  rows.forEach(r => {
    if (withRt.has(r.id) || cities.lineCut) return; // 「線を消す」のあとは、出発地が分かる便の線だけ
    lines.push({type:'Feature', properties:{n:r.n}, geometry:{type:'LineString', coordinates:gcLine(home, [r.lon, r.lat])}});
  });
  const pts = rows.map(r => ({type:'Feature', properties:{name:r.name, n:r.n}, geometry:{type:'Point', coordinates:[wrapLon(r.lon, ref), r.lat]}}));
  const ors = [...origins].filter(([nm]) => !rows.some(r => r.name === nm)).map(([nm, p]) => ({type:'Feature', properties:{name:nm}, geometry:{type:'Point', coordinates:p}}));
  const put = () => {
    if (!citiesMap.getSource('cl')) {
      citiesMap.addSource('cl', {type:'geojson', data:fc(lines)});
      citiesMap.addLayer({id:'cl', type:'line', source:'cl', paint:{'line-color':'#e67e22', 'line-opacity':0.7,
        'line-width':['interpolate', ['linear'], ['get', 'n'], 1, 1.2, 10, 3, 50, 5]}});
      citiesMap.addSource('co', {type:'geojson', data:fc(ors)});
      citiesMap.addLayer({id:'co', type:'circle', source:'co', paint:{'circle-color':'#888', 'circle-radius':3, 'circle-stroke-color':'#fff', 'circle-stroke-width':1}});
      citiesMap.addSource('cp', {type:'geojson', data:fc(pts)});
      citiesMap.addLayer({id:'cp', type:'circle', source:'cp', paint:{'circle-color':'#c0392b', 'circle-stroke-color':'#fff', 'circle-stroke-width':1,
        'circle-radius':['interpolate', ['linear'], ['get', 'n'], 1, 4, 10, 8, 50, 14]}});
      citiesMap.addLayer({id:'cn', type:'symbol', source:'cp', layout:{'text-field':['get', 'name'], 'text-size':12, 'text-offset':[0, 1.1], 'text-anchor':'top'},
        paint:{'text-color':'#333', 'text-halo-color':'#fff', 'text-halo-width':1.5}});
      citiesMap.addSource('home', {type:'geojson', data:fc([{type:'Feature', properties:{}, geometry:{type:'Point', coordinates:home}}])});
      citiesMap.addLayer({id:'home', type:'circle', source:'home', paint:{'circle-color':'#1e90ff', 'circle-radius':6, 'circle-stroke-color':'#fff', 'circle-stroke-width':2}});
    } else {
      citiesMap.getSource('cl').setData(fc(lines)); citiesMap.getSource('co').setData(fc(ors)); citiesMap.getSource('cp').setData(fc(pts));
      citiesMap.getSource('home').setData(fc([{type:'Feature', properties:{}, geometry:{type:'Point', coordinates:home}}]));
    }
    const b = new mapboxgl.LngLatBounds(home, home);
    pts.concat(ors).forEach(p => b.extend(p.geometry.coordinates));
    citiesMap.fitBounds(b, {padding:40, maxZoom:6, duration:0});
  };
  if (citiesMap.isStyleLoaded()) put(); else citiesMap.once('load', put);
};
const renderCitiesV8 = renderCities;
renderCities = function () {
  renderCitiesV8();
  const n = Object.keys(cities.rt || {}).length;
  if (Object.keys(cities.list).length) $('citiesSum').textContent += `　（出発地が分かる路線 ${n}）`;
};
// 都市の画面に「線を消す」（記録は残し、地図の線だけを消して描き直していく）
{
  const b = document.createElement('button'); b.id = 'citiesLineReset'; b.className = 'reset'; b.textContent = '線を消す';
  $('citiesReset').after(b);
  b.onclick = () => {
    if (!confirm('都市の地図の線をすべて消します（都市の記録と表は残ります）。これから記録した便の線がまた描かれていきます。よろしいですか？')) return;
    cities.rt = {}; cities.lineCut = today(); lsSet('sora_cities_v1', cities); renderCities();
  };
}
// --- 世界の空港（押すと、その空港の近くのよその空へ）
const AIRPORTS = [ // [名前, 国, 国の記号, 経度, 緯度]
  ['羽田空港', '日本', 'JP', 139.781, 35.553], ['成田空港', '日本', 'JP', 140.393, 35.772], ['関西空港', '日本', 'JP', 135.244, 34.434],
  ['仁川空港', '韓国', 'KR', 126.441, 37.460], ['香港空港', '中国（香港）', 'HK', 113.918, 22.308], ['シンガポール・チャンギ空港', 'シンガポール', 'SG', 103.991, 1.364],
  ['ドバイ空港', 'アラブ首長国連邦', 'AE', 55.365, 25.253], ['ロンドン・ヒースロー空港', 'イギリス', 'GB', -0.454, 51.470],
  ['パリ・シャルル・ド・ゴール空港', 'フランス', 'FR', 2.548, 49.010], ['フランクフルト空港', 'ドイツ', 'DE', 8.562, 50.038],
  ['ニューヨーク JFK空港', 'アメリカ合衆国', 'US', -73.778, 40.641], ['ロサンゼルス空港', 'アメリカ合衆国', 'US', -118.408, 33.942],
  ['ホノルル空港', 'アメリカ合衆国', 'US', -157.922, 21.318], ['シドニー空港', 'オーストラリア', 'AU', 151.177, -33.946]];
let yosoMeta = null; // 空港ボタンで行ったときの名前（地名を調べずにこの名前を使う）
const yosoPlaceV24 = yosoPlace;
yosoPlace = function () {
  const e = yosoPlaceV24();
  if (e && yosoMeta && !e.name && gcKm(yosoMeta.p, e.p) <= YOSO_KM) {
    e.name = yosoMeta.name; e.ctry = yosoMeta.ctry; e.cc = yosoMeta.cc; yosoSave();
  }
  return e;
};
// よその空へ行く（空港ボタン・ノートの「この空に行く」・世界地図の印から）
function yosoGo(p, meta) {
  pickMode = false;
  yosoMeta = meta ? {p, ...meta} : null;
  pickPos = [+p[0].toFixed(4), +p[1].toFixed(4)]; lsSet('sora_pick', pickPos);
  pickCall = true;
  try { setPos(pickPos, false, false); } finally { pickCall = false; }
  map.jumpTo({center:pickPos, zoom:9});
  $('airList').style.display = 'none';
  if (yosoIsOpen()) navClose('yoso', yosoCloseBase);
  locUi(); render();
  setTimeout(tick, busy ? 1500 : 0);
}
{
  const ab = document.createElement('button'); ab.id = 'airBtn'; ab.textContent = '世界の空港';
  $('pickBtn').after(ab);
  const al = document.createElement('div'); al.id = 'airList'; al.style.cssText = 'display:none;margin:4px 0';
  al.innerHTML = '<div class="small">押すと、その空港の近くの「よその空」へ行けます（離着陸の機体が低く通るので、キャッチしやすい場所です）</div>' +
    AIRPORTS.map((a, i) => `<button data-i="${i}" style="font-size:13px">${esc(a[0])}</button>`).join('');
  $('locBar').appendChild(al);
  al.querySelectorAll('button').forEach(b => b.onclick = () => {
    const a = AIRPORTS[+b.dataset.i];
    if (sky) setSky(false);
    yosoGo([a[3], a[4]], {name:a[0], ctry:a[1], cc:a[2]});
  });
  ab.onclick = () => { al.style.display = al.style.display === 'none' ? 'block' : 'none'; };
}
const locUiV22 = locUi;
locUi = function () {
  locUiV22();
  const ab = $('airBtn'); if (!ab) return;
  ab.style.display = pickMode ? 'none' : '';
  if (pickMode) $('airList').style.display = 'none';
};
// --- よその空ノート：世界地図と「この空に行く」
let yosoMap = null, yosoMapFit = false;
{
  const m = document.createElement('div'); m.id = 'yosoMap'; m.style.cssText = 'height:35vh;margin:8px 0;border-radius:6px';
  $('yosoScore').after(m);
}
function yosoMapDraw() {
  if (!yosoMap) return;
  const ref = realHome()[0];
  const fc = {type:'FeatureCollection', features:yoso.pl.map(e => ({type:'Feature', properties:{id:e.id, name:e.name || '（地名を調べ中）', n:e.n},
    geometry:{type:'Point', coordinates:[wrapLon(e.p[0], ref), e.p[1]]}}))};
  const put = () => {
    if (!yosoMap.getSource('yp')) {
      yosoMap.addSource('yp', {type:'geojson', data:fc});
      yosoMap.addLayer({id:'yp', type:'circle', source:'yp', paint:{'circle-color':'#2e7d6b', 'circle-stroke-color':'#fff', 'circle-stroke-width':1.5,
        'circle-radius':['interpolate', ['linear'], ['get', 'n'], 0, 5, 20, 8, 100, 12]}});
      yosoMap.addLayer({id:'ypn', type:'symbol', source:'yp', layout:{'text-field':['get', 'name'], 'text-size':12, 'text-offset':[0, 1.1], 'text-anchor':'top'},
        paint:{'text-color':'#1f4f45', 'text-halo-color':'#fff', 'text-halo-width':1.5}});
      yosoMap.on('click', 'yp', ev => {
        const f = ev.features && ev.features[0], e = f && yoso.pl.find(x => x.id === f.properties.id);
        if (e && confirm(`${yosoLabel(e)}の空に行きますか？`)) yosoGo(e.p);
      });
    } else yosoMap.getSource('yp').setData(fc);
    if (yoso.pl.length && !yosoMapFit) {
      yosoMapFit = true;
      const b = new mapboxgl.LngLatBounds(fc.features[0].geometry.coordinates, fc.features[0].geometry.coordinates);
      fc.features.forEach(f => b.extend(f.geometry.coordinates));
      yosoMap.fitBounds(b, {padding:40, maxZoom:5, duration:0});
    }
  };
  if (yosoMap.isStyleLoaded()) put(); else yosoMap.once('load', put);
}
window.yosoMapOff = () => { if (yosoMap) { yosoMap.remove(); yosoMap = null; } };
const yosoBtnV23 = $('yosoBtn').onclick;
$('yosoBtn').onclick = () => { yosoBtnV23(); yosoMapFit = false; renderYoso(); }; // 画面を開いてから地図を作る
const renderYosoV24 = renderYoso;
renderYoso = function () {
  renderYosoV24();
  if (!yosoMap && yosoIsOpen()) yosoMap = new mapboxgl.Map({container:'yosoMap', style:'mapbox://styles/mapbox/light-v11', center:[realHome()[0], 25], zoom:0.6, projection:'globe'});
  yosoMapDraw();
  $('yosoBody').querySelectorAll('.ycard').forEach(card => {
    const e = yoso.pl.find(x => x.id === card.dataset.id); if (!e) return;
    const b = document.createElement('button'); b.textContent = 'この空に行く'; b.style.cssText = 'float:right;font-size:13px;margin:0 0 4px 6px';
    b.onclick = ev => { ev.stopPropagation(); if (sky) setSky(false); yosoGo(e.p); };
    card.insertBefore(b, card.firstChild);
  });
};
locUi();

// ---------- 地球儀と、よその空の路線の線（v26） ----------
// よその空で見た機体のうち、出発地と行き先が分かった便を、よその空ノートの地球儀に「出発地→行き先」の線で描く
// 同じ組み合わせは1本だけ（見た回数で少し太く）。「線を消す」で線だけ消せる（場所やスコアの記録は残る）
const YRT_MAX = 400;
if (!yoso.rt) yoso.rt = {};
if (!yoso.rtSeen) yoso.rtSeen = {};
function yosoRoutes(list) {
  if (!yosoOn()) return;
  const d = today(), now = Date.now();
  let changed = false;
  list.forEach(p => {
    if (p.ground || p.mil || !p.cs) return;
    const r = routeEntry(p.cs);
    if (!r || r.none || !r.a || r.a.length < 2) return;
    const sk = p.hex + '|' + d;
    if (yoso.rtSeen[sk]) return;
    yoso.rtSeen[sk] = d;
    const o = r.a[0], a = r.a[1], key = (o.iata || o.name) + '>' + (a.iata || a.name);
    const e = yoso.rt[key] || (yoso.rt[key] = {o:{name:apName(o), lat:o.lat, lon:o.lon}, d:{name:apName(a), lat:a.lat, lon:a.lon}, n:0, first:d});
    e.n++; e.last = d; e.t = now; changed = true;
  });
  if (!changed) return;
  for (const k in yoso.rtSeen) if (yoso.rtSeen[k] !== d) delete yoso.rtSeen[k];
  const ks = Object.keys(yoso.rt);
  if (ks.length > YRT_MAX) ks.sort((x, y) => (yoso.rt[x].t || 0) - (yoso.rt[y].t || 0)).slice(0, ks.length - YRT_MAX).forEach(k => delete yoso.rt[k]);
  yosoSave();
  if (yosoIsOpen()) yosoMapDraw();
}
// 行き先は記録のあとに届くので、行き先を調べ終わったときにも線を足す
const fetchRoutesV21 = fetchRoutes;
fetchRoutes = function (list) {
  const r = fetchRoutesV21(list);
  Promise.resolve(r).then(ch => { if (ch) yosoRoutes(planes); });
  return r;
};
const recordV23 = record;
record = function (list) { recordV23(list); yosoRoutes(list); };
// 地球儀に線と空港の点を描く
const yosoMapDrawV25 = yosoMapDraw;
yosoMapDraw = function () {
  yosoMapDrawV25();
  if (!yosoMap) return;
  const rts = Object.values(yoso.rt || {}), aps = new Map();
  const lines = rts.map(e => {
    aps.set(e.o.name, [e.o.lon, e.o.lat]); aps.set(e.d.name, [e.d.lon, e.d.lat]);
    return {type:'Feature', properties:{n:e.n}, geometry:{type:'LineString', coordinates:gcLine([e.o.lon, e.o.lat], [e.d.lon, e.d.lat])}};
  });
  const fc = f => ({type:'FeatureCollection', features:f});
  const apf = fc([...aps].map(([name, p]) => ({type:'Feature', properties:{name}, geometry:{type:'Point', coordinates:p}})));
  const put = () => {
    if (!yosoMap.getSource('yr')) {
      yosoMap.addSource('yr', {type:'geojson', data:fc(lines)});
      yosoMap.addLayer({id:'yr', type:'line', source:'yr', paint:{'line-color':'#e67e22', 'line-opacity':0.75,
        'line-width':['interpolate', ['linear'], ['get', 'n'], 1, 1.2, 5, 2.5, 20, 4]}}, 'yp');
      yosoMap.addSource('ya', {type:'geojson', data:apf});
      yosoMap.addLayer({id:'ya', type:'circle', source:'ya', paint:{'circle-color':'#c0392b', 'circle-radius':2.5, 'circle-stroke-color':'#fff', 'circle-stroke-width':0.8}}, 'yp');
      yosoMap.addLayer({id:'yan', type:'symbol', source:'ya', minzoom:2.5, layout:{'text-field':['get', 'name'], 'text-size':11, 'text-offset':[0, 0.9], 'text-anchor':'top'},
        paint:{'text-color':'#7a3b12', 'text-halo-color':'#fff', 'text-halo-width':1.2}});
    } else { yosoMap.getSource('yr').setData(fc(lines)); yosoMap.getSource('ya').setData(apf); }
  };
  if (yosoMap.getSource('yp')) put(); else yosoMap.once('load', () => setTimeout(put, 0));
};
// よその空ノート：線の数と「線を消す」
const renderYosoV25 = renderYoso;
renderYoso = function () {
  renderYosoV25();
  const n = Object.keys(yoso.rt || {}).length;
  $('yosoScore').innerHTML += `<br><span class="small">地球儀の線：よその空でキャッチした便の出発地→行き先 ${n}路線（同じ路線は1本）</span>`;
};
{
  const b = document.createElement('button'); b.id = 'yosoLineReset'; b.className = 'reset'; b.textContent = '線を消す';
  $('yosoReset').after(b);
  b.onclick = () => {
    if (!confirm('地球儀の線をすべて消します（よその空の場所やスコアの記録は残ります）。よろしいですか？')) return;
    yoso.rt = {}; yoso.rtSeen = {}; yosoSave(); renderYoso();
  };
}
// 「記録を消す」（v24）は線も消す
const yosoResetV24 = $('yosoReset').onclick;
$('yosoReset').onclick = () => { yosoResetV24(); if (!yoso.rt) { yoso.rt = {}; yoso.rtSeen = {}; yosoSave(); renderYoso(); } };

// ---------- 行き先の調べ方の改善（v27） ----------
// 調べられなかった便は2分あとに回す（routeWait。fetchRoutes の中を直した）
// 「更新 〇時〇分」の行に、行き先を待っている機体の数を出す（v28 で、うまくいかない理由も出す）
{
  const sp = document.createElement('span'); sp.id = 'rtWait';
  $('upd').after(sp);
}
function rtWaitShow() {
  const n = new Set(planes.filter(p => !p.mil && /^[A-Z]{2,3}\d/.test(p.cs || '') && !routeEntry(p.cs)).map(p => p.cs)).size;
  const now = Date.now(), how = now < directOffUntil ? '・中継で' : viewOnly() || now < relayRtOffUntil ? '・スマホから直接' : '';
  const why = [rtLastErr, directLastErr].filter(Boolean).join('・');
  $('rtWait').textContent = n ? `　行き先を調べ中 ${n}機${how}${why ? '（' + why + '）' : ''}` : '';
}
setInterval(() => { if (!document.hidden) rtWaitShow(); }, 2000);

// ---------- 行き先をスマホから直接調べる（v28） ----------
// adsb.lol の行き先の窓口（routeset）はブラウザから直接呼べる。1回に100機まで受け付けるので、50機ずつまとめて聞く
// いつもの空：中継で10機ずつ → 中継が調べられなかった便は直接。中継が3回続けて失敗したら10分間は直接だけ
// よその空：最初から直接（中継の負担を増やさず、いつもの空の行き先に響かないように）
const RT_DIRECT = 'https://api.adsb.lol/api/0/routeset', RT_DIRECT_MAX = 50;
const directWait = new Map(); // 直接でも調べられなかった便 → もう一度調べてよい時刻
let directBusy = false, directFail = 0, directOffUntil = 0, directLastErr = ''; // v29：直接が続けて失敗した回数・直接を休む時刻
const apConvVrs = a => ({iata:a.iata || '', name:a.name || '', loc:a.location || '',
  lat:+(+a.lat).toFixed(3), lon:+(+a.lon).toFixed(3), cc:a.countryiso2 || ''});
// 経由便のとき、機体の位置からみて遠回りがいちばん少ない区間を選ぶ
function pickLegAt(aps, p) {
  if (aps.length === 2 || !p || !p.p) return [aps[0], aps[1]];
  let best = 0, bestV = Infinity;
  for (let i = 0; i < aps.length - 1; i++) {
    const a = [aps[i].lon, aps[i].lat], b = [aps[i + 1].lon, aps[i + 1].lat];
    const v = gcKm(a, p.p) + gcKm(p.p, b) - gcKm(a, b);
    if (v < bestV) { bestV = v; best = i; }
  }
  return [aps[best], aps[best + 1]];
}
async function routesDirect(list) {
  if (directBusy) return false;
  const now = Date.now(), direct = viewOnly() || now < relayRtOffUntil;
  if (now < directOffUntil) return false; // 直接を休んでいる間（v29）
  const need = [...new Set(list.filter(p => !p.mil && /^[A-Z]{2,3}\d/.test(p.cs) && !routeEntry(p.cs)
    && (direct || routeWait.has(p.cs)) && !((directWait.get(p.cs) || 0) > now)).map(p => p.cs))].slice(0, RT_DIRECT_MAX);
  if (!need.length) return false;
  directBusy = true;
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 15000);
  try {
    const body = need.map(cs => { const p = list.find(x => x.cs === cs); return {callsign:cs, lat:p && p.p ? +p.p[1].toFixed(3) : 0, lng:p && p.p ? +p.p[0].toFixed(3) : 0}; });
    const r = await fetch(RT_DIRECT, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({planes:body}), signal:ctl.signal});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const arr = await r.json(), got = new Map((Array.isArray(arr) ? arr : []).map(x => [x.callsign, x])), t = Date.now();
    need.forEach(cs => {
      const x = got.get(cs);
      const aps = x && x.airport_codes !== 'unknown' ? (x._airports || []).filter(a => a && a.lat != null && a.lon != null) : [];
      if (aps.length >= 2) { const [o, d] = pickLegAt(aps, list.find(p => p.cs === cs)); routes[cs] = {t, a:[apConvVrs(o), apConvVrs(d)]}; }
      else routes[cs] = {t, none:1};
      routeWait.delete(cs); directWait.delete(cs);
    });
    saveRoutes();
    directFail = 0;
    directLastErr = '';
    return true;
  } catch (e) {
    need.forEach(cs => directWait.set(cs, Date.now() + 120000));
    directLastErr = '直接：' + (e.name === 'AbortError' ? '応答なし' : /HTTP/.test(e.message) ? e.message : 'つながらない（' + e.message + '）');
    if (++directFail >= 1) directOffUntil = Date.now() + 600000; // だめなら10分間は直接を休み、中継で調べる（v29）
    return false;
  } finally { clearTimeout(tm); directBusy = false; }
}
relaySkip = () => Date.now() < relayRtOffUntil || (viewOnly() && Date.now() >= directOffUntil); // よその空は直接。ただし直接を休んでいる間は中継で（v29）
const fetchRoutesV26b = fetchRoutes;
fetchRoutes = async function (list) {
  const a = await fetchRoutesV26b(list); // 中継（よその空・中継を休んでいる間は、中で何もしない）
  const b = await routesDirect(list);
  if (b && viewOnly()) yosoRoutes(planes);
  return a || b;
};

// ---------- 地図の右の白い壁を直す（v29） ----------
// 地図の上に右寄せのボタン（記録を消す・線を消す）があると、地図が作られた瞬間だけ幅が狭くなり、右に白い帯が残っていた
// index.html で地図を右寄せのボタンの下に回し（clear:both）、開いたあとにも幅を測り直す
const mapFit = m => { if (m) { try { m.resize(); } catch (e) {} } };
const citiesBtnV14 = $('citiesBtn').onclick;
$('citiesBtn').onclick = () => { citiesBtnV14(); setTimeout(() => mapFit(citiesMap), 50); setTimeout(() => mapFit(citiesMap), 400); };
const yosoBtnV25 = $('yosoBtn').onclick;
$('yosoBtn').onclick = () => { yosoBtnV25(); setTimeout(() => mapFit(yosoMap), 50); setTimeout(() => mapFit(yosoMap), 400); };
window.addEventListener('resize', () => { mapFit(citiesMap); mapFit(yosoMap); });

// ---------- まとめて聞く窓口がだめなら1便ずつ聞く（v30） ----------
// adsb.lol の「まとめて聞く窓口」（POST routeset）が中継からもスマホからもつながらないことがあった（2026-10-13）
// 「1便ずつ聞く窓口」（GET /api/0/route/便名/緯度/経度）は答えるので、まとめてがだめなら1便ずつ聞く（10秒に最大20便、同時に5便まで）
const RT_ONE = 'https://api.adsb.lol/api/0/route/', RT_ONE_MAX = 10, RT_ONE_PAR = 3; // v31 でゆっくりに（20便・5同時 → 10便・3同時）
let postOffUntil = 0; // まとめて聞く窓口を休む時刻（だめだったら10分）
function directApply(cs, x, list, t) {
  const aps = x && x.airport_codes !== 'unknown' ? (x._airports || []).filter(a => a && a.lat != null && a.lon != null) : [];
  if (aps.length >= 2) { const [o, d] = pickLegAt(aps, list.find(p => p.cs === cs)); routes[cs] = {t, a:[apConvVrs(o), apConvVrs(d)]}; }
  else routes[cs] = {t, none:1};
  routeWait.delete(cs); directWait.delete(cs);
}
const posOf = (cs, list) => { const p = list.find(x => x.cs === cs); return p && p.p ? [+p.p[1].toFixed(3), +p.p[0].toFixed(3)] : [0, 0]; };
async function tfetchOne(url, ms) {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, {signal:ctl.signal}); } finally { clearTimeout(tm); }
}
const errText = e => e.name === 'AbortError' ? '応答なし' : /HTTP/.test(e.message) ? e.message : 'つながらない（' + e.message + '）';
routesDirect = async function (list) {
  if (directBusy) return false;
  const now = Date.now(), direct = viewOnly() || now < relayRtOffUntil;
  if (now < directOffUntil) return false;
  const one = now < postOffUntil;
  const need = [...new Set(list.filter(p => !p.mil && /^[A-Z]{2,3}\d/.test(p.cs) && !routeEntry(p.cs)
    && (direct || routeWait.has(p.cs)) && !((directWait.get(p.cs) || 0) > now)).map(p => p.cs))].slice(0, one ? RT_ONE_MAX : RT_DIRECT_MAX);
  if (!need.length) return false;
  directBusy = true;
  try {
    let got = null, why = '';
    if (!one) { // まとめて聞く
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 15000);
      try {
        const body = need.map(cs => { const [la, lo] = posOf(cs, list); return {callsign:cs, lat:la, lng:lo}; });
        const r = await fetch(RT_DIRECT, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({planes:body}), signal:ctl.signal});
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const arr = await r.json();
        got = new Map((Array.isArray(arr) ? arr : []).map(x => [x.callsign, x]));
      } catch (e) { why = 'まとめて：' + errText(e); postOffUntil = Date.now() + 600000; }
      finally { clearTimeout(tm); }
    }
    if (got) { const t = Date.now(); need.forEach(cs => directApply(cs, got.get(cs), list, t)); }
    else { // 1便ずつ聞く
      const todo = need.slice(0, RT_ONE_MAX), done = [];
      let lastErr = null;
      for (let i = 0; i < todo.length; i += RT_ONE_PAR) {
        await Promise.all(todo.slice(i, i + RT_ONE_PAR).map(async cs => {
          try {
            const [la, lo] = posOf(cs, list);
            const r = await tfetchOne(`${RT_ONE}${encodeURIComponent(cs)}/${la}/${lo}`, 10000);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            directApply(cs, await r.json(), list, Date.now()); done.push(cs);
          } catch (e) { lastErr = e; directWait.set(cs, Date.now() + 120000); }
        }));
      }
      if (!done.length) throw lastErr || new Error('つながらない');
      if (lastErr) why = (why ? why + '・' : '') + '1便ずつ：' + errText(lastErr);
    }
    saveRoutes();
    directFail = 0; directLastErr = why;
    return true;
  } catch (e) {
    need.forEach(cs => directWait.set(cs, Date.now() + 120000));
    directLastErr = '直接：' + errText(e);
    if (++directFail >= 1) directOffUntil = Date.now() + 600000; // だめなら10分間は直接を休み、中継で調べる
    return false;
  } finally { directBusy = false; }
};
const rtWaitShowV27 = rtWaitShow;
rtWaitShow = function () {
  rtWaitShowV27();
  if ($('rtWait').textContent && Date.now() < postOffUntil && Date.now() >= directOffUntil) $('rtWait').textContent = $('rtWait').textContent.replace('・スマホから直接', '・スマホから1便ずつ');
};

// ---------- 図鑑は10km以内とキャッチだけ（v31） ----------
// 図鑑・今日の空の数は「10km以内を通った機体」と「空に向けてキャッチした機体」だけ（record・dayRecord の中を直した）
// よその空ノートの機種の一覧は「キャッチした機種」だけ。レア度は表示範囲で見かけた回数（seenAll、図鑑には出さない）
BK_SKIP.push('sora_reset_v31');
const doCatchV30 = doCatch;
doCatch = function (p, now) {
  doCatchV30(p, now);
  if (viewOnly()) return;
  const q = Object.assign({}, p, {zkCatch:true});
  recordV8([q]); dayRecordV8([q], now); // キャッチした機体は、遠くても図鑑と今日の空に入れる
};
// 1便ずつ聞くときは、ゆっくり（10秒に最大10便、同時3便）。断られたら（429）2分は直接を休み、中継で聞く
const routesDirectV30 = routesDirect;
routesDirect = async function (list) {
  const r = await routesDirectV30(list);
  if (/429/.test(directLastErr) && Date.now() >= directOffUntil) directOffUntil = Date.now() + 120000;
  return r;
};

// ---------- 都市と地球儀の線はキャッチした便だけ（v32） ----------
// いつもの空：都市（行き先と出発地→行き先の線）に入れるのは、空に向けてキャッチした旅客機で、出発地と行き先が分かった便だけ（10km以内を通っただけの便は入れない）
// よその空：地球儀の線も、よその空でキャッチした便だけ
const CATCH_RT_KEEP = 1800000; // キャッチしたあと行き先を待つ時間（30分）
noteNear = function () {}; // 10km以内を通っただけでは都市の候補にしない
const yosoCaughtCs = new Map(); // よその空でキャッチした便名 → 時刻
const doCatchV31 = doCatch;
doCatch = function (p, now) {
  doCatchV31(p, now);
  if (viewOnly() || p.mil || !/^[A-Z]{2,3}\d/.test(p.cs || '')) return;
  nearCand.forEach((x, k) => { if (now - x.t > CATCH_RT_KEEP) nearCand.delete(k); });
  nearCand.set(p.hex, {cs:p.cs, t:now}); // 行き先が分かっていればすぐ、まだなら分かった時点で都市に入る
  recordCities();
};
const yosoCatchV24 = yosoCatch;
yosoCatch = function (p, now) {
  yosoCatchV24(p, now);
  if (p.mil || !p.cs) return;
  yosoCaughtCs.set(p.cs, now);
  yosoRoutes(planes);
};
const yosoRoutesV26 = yosoRoutes;
yosoRoutes = function (list) {
  const now = Date.now();
  yosoCaughtCs.forEach((t, cs) => { if (now - t > CATCH_RT_KEEP) yosoCaughtCs.delete(cs); });
  yosoRoutesV26(list.filter(p => p.cs && yosoCaughtCs.has(p.cs)));
};

const savedPos = lsGet('sora_lastpos', null);
// ---------- 戻る操作（v14） ----------
// 空に向ける・図鑑・都市・今日の空・機窓ビューを開くたびにブラウザの履歴を1つ積み、
// スマホの「戻る」操作で、アプリを閉じずにその画面だけを閉じる
const navStack = [];
function navPush(name, isOpen, close) {
  try { history.pushState({sora:name}, ''); } catch (e) { return; }
  navStack.push({name, isOpen, close});
}
// 画面のボタンで閉じるとき：履歴が積んであれば「戻る」と同じ扱いにして、履歴を余らせない
function navClose(name, close) {
  const top = navStack[navStack.length - 1];
  if (top && top.name === name && history.state && history.state.sora === name) history.back();
  else close();
}
window.addEventListener('popstate', () => {
  const e = navStack.pop();
  if (e && e.isOpen()) e.close();
});
// 空に向ける
const setSkyBase = setSky;
setSky = function (on) {
  if (on && !sky) { setSkyBase(true); navPush('sky', () => sky, () => setSkyBase(false)); }
  else if (!on && sky) navClose('sky', () => setSkyBase(false));
};
$('skyBack').onclick = e => { e.stopPropagation(); setSky(false); };
// 図鑑・都市・今日の空
[['zukan', 'zukanBtn', 'zukanClose'], ['cities', 'citiesBtn', 'citiesClose'], ['day', 'dayBtn', 'dayClose']].forEach(([id, ob, cb]) => {
  const open = $(ob).onclick, close = $(cb).onclick;
  const isOpen = () => $(id).style.display === 'block';
  $(ob).onclick = () => { const was = isOpen(); open(); if (!was && isOpen()) navPush(id, isOpen, close); };
  $(cb).onclick = () => navClose(id, close);
});
// この便に乗る（機窓ビュー）
const openRideBase = openRide, closeRideBase = closeRide;
const rideOpen = () => $('ride').style.display === 'block';
openRide = function (hex) { const was = rideOpen(); openRideBase(hex); if (!was && rideOpen()) navPush('ride', rideOpen, closeRideBase); };
closeRide = function () { navClose('ride', closeRideBase); };
$('rideExit').onclick = closeRide;

// ---------- 星座と月の形（v10） ----------
// 星座の線は constellations.js（CONSTEL）。空が暗いとき（太陽が地平線の下6°以下）だけ出す
let conOn = lsGet('sora_con', true) !== false, conObjs = [];
function skyExtra(out, d, obs, sunEl) {
  // 月の満ち欠け（輝いている割合）と、光っている側の向き（太陽の方向）
  const m = out.find(o => o.kind === 'moon');
  if (m) {
    try {
      m.frac = Astronomy.Illumination('Moon', d).phase_fraction;
      const se = Astronomy.Equator('Sun', d, obs, true, true), sh = Astronomy.Horizon(d, obs, se.ra, se.dec, 'normal');
      m.limb = limbAngle(m.az, m.el, sh.azimuth, sh.altitude);
    } catch (e) {}
  }
  // 星座の線（地平線より上にかかるものだけ）
  conObjs = [];
  if (!conOn || sunEl >= -6 || typeof CONSTEL === 'undefined') return;
  const hz = (ra, dec) => { const h = Astronomy.Horizon(d, obs, ra, dec, 'normal'); return [h.azimuth, h.altitude]; };
  CONSTEL.forEach(c => {
    try {
      const segs = c[6].map(a => { const pts = []; for (let i = 0; i < a.length; i += 2) pts.push(hz(a[i], a[i + 1])); return pts; });
      if (segs.every(sg => sg.every(p => p[1] < 0))) return;
      conObjs.push({id:c[0], name:c[1], season:c[2], star:c[3], desc:c[4], lab:hz(c[5][0], c[5][1]), segs});
    } catch (e) {}
  });
}
// 月から見た太陽の方向を、画面上の角度（右が0、下向きが正）にする
function limbAngle(az, el, saz, sel) {
  const a = az * D2R, e = el * D2R, sa = saz * D2R, se = sel * D2R;
  const S = [Math.cos(se) * Math.sin(sa), Math.cos(se) * Math.cos(sa), Math.sin(se)];
  const dx = S[0] * Math.cos(a) - S[1] * Math.sin(a);
  const dy = -S[0] * Math.sin(e) * Math.sin(a) - S[1] * Math.sin(e) * Math.cos(a) + S[2] * Math.cos(e);
  return Math.atan2(-dy, dx);
}
// 月を満ち欠けの形で描く（frac：輝いている割合、ang：光っている側の向き）
function drawMoon(g, x, y, r, frac, ang) {
  const k = Math.max(0, Math.min(1, frac || 0)), rx = r * Math.abs(2 * k - 1);
  g.save(); g.translate(x, y); g.rotate(ang || 0);
  g.fillStyle = 'rgba(70,76,92,.85)'; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  g.fillStyle = '#fff6d0'; g.beginPath();
  g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
  if (k >= 0.5) g.ellipse(0, 0, rx, r, 0, Math.PI / 2, Math.PI * 1.5, false);
  else g.ellipse(0, 0, rx, r, 0, Math.PI / 2, -Math.PI / 2, true);
  g.closePath(); g.fill();
  g.restore();
}
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)) : 0;
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}
// スコープに星座を描き、照準にいちばん近い星座を返す（hi() で強調して描き直す）
function conLayer(g, toXY, dAz, off, W, H, cx, cy, sc) {
  if (!conObjs.length) return null;
  const vis = p => p[1] >= -2 && Math.abs(dAz(p[0])) < 100;
  const draw = (c, hi) => {
    let best = 1e9;
    g.strokeStyle = hi ? 'rgba(255,213,79,.9)' : 'rgba(150,180,255,.5)'; g.lineWidth = hi ? 1.8 : 1;
    g.fillStyle = hi ? '#ffe9a6' : 'rgba(205,218,255,.85)';
    c.segs.forEach(sg => {
      for (let i = 1; i < sg.length; i++) {
        const a = sg[i - 1], b = sg[i];
        if (!vis(a) || !vis(b) || (a[1] < 0 && b[1] < 0)) continue;
        const [x1, y1] = toXY(a[0], a[1]), [x2, y2] = toXY(b[0], b[1]);
        if ((x1 < 0 && x2 < 0) || (x1 > W && x2 > W) || (y1 < 0 && y2 < 0) || (y1 > H && y2 > H)) continue;
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        best = Math.min(best, segDist(cx, cy, x1, y1, x2, y2));
      }
      sg.forEach(p => {
        if (p[1] < 0 || !vis(p)) return;
        const [x, y] = toXY(p[0], p[1]);
        if (!off(x, y)) { g.beginPath(); g.arc(x, y, hi ? 2.2 : 1.6, 0, 7); g.fill(); }
      });
    });
    if (c.lab[1] > 0 && vis(c.lab)) {
      const [x, y] = toXY(c.lab[0], c.lab[1]);
      if (!off(x, y)) {
        g.font = (hi ? 'bold ' : '') + '12px sans-serif'; g.textAlign = 'center';
        g.fillStyle = hi ? '#ffd54f' : 'rgba(170,200,255,.9)'; g.fillText(c.name, x, y); g.textAlign = 'left';
      }
    }
    return best;
  };
  let pick = null;
  conObjs.forEach(c => { const d = draw(c, false); if (d < 8 * sc && (!pick || d < pick.d)) pick = {c, d}; });
  g.textAlign = 'left';
  return pick && {c:pick.c, hi:() => draw(pick.c, true)};
}
function conSay(c, say) {
  const st = '★'.repeat(c.star) + '☆'.repeat(3 - c.star);
  say(`照準：${c.name}（${c.season === '北' ? '北の空' : c.season + 'の星座'}）${st}`, c.desc, '#ffd54f');
}
function showConUi() { $('conBtn').classList.toggle('on', conOn); $('conBtn').textContent = conOn ? '星座：ON' : '星座'; }
$('conBtn').onclick = () => { conOn = !conOn; lsSet('sora_con', conOn); showConUi(); if (pos) skyObjs = calcSky(Date.now()); };
showConUi();
// 今夜の空：月の行を、月齢・月の出・月の入りつきに置き換える
function moonNight(items, now, obs) {
  try {
    const i = items.findIndex(x => x.text.startsWith('月（')), old = i >= 0 ? items.splice(i, 1)[0] : null;
    const d = new Date(now), nm = Astronomy.SearchMoonPhase(0, d, -35);
    const age = nm ? ((now - nm.date.getTime()) / 86400000).toFixed(1) : null;
    const day = t => { const a = new Date(t); return a.getDate() !== d.getDate() ? '明日' : ''; };
    const ev = [];
    const r = Astronomy.SearchRiseSet('Moon', obs, +1, d, 1), s = Astronomy.SearchRiseSet('Moon', obs, -1, d, 1);
    if (r) ev.push({t:r.date.getTime(), k:'月の出'});
    if (s) ev.push({t:s.date.getTime(), k:'月の入り'});
    ev.sort((a, b) => a.t - b.t);
    const see = old ? old.text.replace(/^月（[^）]*）：/, '') : '今夜は見えにくい';
    const text = `月（${moonPhaseName(now)}${age ? '・月齢' + age : ''}）：${see}　` + ev.map(e => `${e.k} ${day(e.t)}${hm(e.t)}`).join('　');
    items.unshift({s:old ? old.s : now, text});
  } catch (e) {}
}
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
