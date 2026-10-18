// SoraMiru の星座絵（v37）：空に向けた画面で、星座の線の下に星座絵を薄く重ねる
// 絵：Johan Meuris（Stellarium）、Free Art License（art/LICENSE-art.txt）。基準点：art/anchors.js（CC BY-SA）
// 位置合わせ：絵ごとの基準点3つ（絵の上の位置 → 星）を、星座の線と同じ toXY で画面に置き、3点が重なるように変形して描く
// app.js・ui.js・help.js・art/anchors.js のあとに読む。app.js の conLayer（星座の線）を包む。constellations.js は変えない
(window.SORA_FV = window.SORA_FV || {}).conart = 37;
(function () {
  if (typeof CONART === 'undefined' || typeof conLayer !== 'function') return;
  const A_ON = 0.30, A_CAM = 0.20, POP_MS = 8000, FADE_MS = 1200;
  let artOn = lsGet('sora_conart', true) !== false;
  const imgs = {}, artSky = {}; // 絵の画像（使うときに読む）、基準点の方位・高さ（2秒ごと）
  let artAt = 0;
  const img = id => {
    if (!imgs[id]) { const im = new Image(); im.decoding = 'async'; im.src = 'art/' + CONART[id][0] + '?v=37'; imgs[id] = im; }
    const im = imgs[id];
    return im.complete && im.naturalWidth ? im : null;
  };

  // 基準点の星を、その場所・時刻の方位と高さに直す（星座の線と同じ計算を2秒ごと）
  function artCalc() {
    if (!pos || typeof Astronomy === 'undefined') return;
    const d = new Date(), obs = new Astronomy.Observer(pos[1], pos[0], 100);
    conObjs.forEach(c => {
      const a = CONART[c.id]; if (!a) return;
      try { artSky[c.id] = a[2].map(p => { const h = Astronomy.Horizon(d, obs, p[2], p[3], 'normal'); return [p[0], p[1], h.azimuth, h.altitude]; }); } catch (e) {}
    });
    artAt = Date.now();
  }

  // 絵の3点 (u,v) が画面の3点 (x,y) に重なる変形（アフィン変換）で描く
  // 空の上の角度（度）
  const angDeg = (p, q) => { const D = Math.PI / 180, c = Math.sin(p[3] * D) * Math.sin(q[3] * D) + Math.cos(p[3] * D) * Math.cos(q[3] * D) * Math.cos((p[2] - q[2]) * D); return Math.acos(Math.max(-1, Math.min(1, c))) / D; };
  function drawArt(g, id, toXY, alpha, sc) {
    const P = artSky[id], im = P && img(id);
    if (!im || alpha <= 0.01) return;
    if (P.every(p => p[3] < -15)) return;
    const S = P.map(p => toXY(p[2], p[3]));
    // 天頂の近くなどで画面の上の形が大きくゆがむときは、絵を薄くして消す（線はそのまま）
    let dev = 1;
    [[0, 1], [0, 2], [1, 2]].forEach(([i, j]) => { const ang = angDeg(P[i], P[j]); if (ang < 1) return; const r = Math.hypot(S[i][0] - S[j][0], S[i][1] - S[j][1]) / (ang * sc); dev = Math.max(dev, r, 1 / Math.max(r, 1e-3)); });
    alpha *= Math.max(0, Math.min(1, (2.0 - dev) / 0.6));
    if (alpha <= 0.01) return;
    const [u0, v0] = P[0], du1 = P[1][0] - u0, dv1 = P[1][1] - v0, du2 = P[2][0] - u0, dv2 = P[2][1] - v0, det = du1 * dv2 - du2 * dv1;
    if (!det) return;
    const dx1 = S[1][0] - S[0][0], dy1 = S[1][1] - S[0][1], dx2 = S[2][0] - S[0][0], dy2 = S[2][1] - S[0][1];
    const a = (dx1 * dv2 - dx2 * dv1) / det, b = (dy1 * dv2 - dy2 * dv1) / det, c = (dx2 * du1 - dx1 * du2) / det, d = (dy2 * du1 - dy1 * du2) / det;
    const e = S[0][0] - a * u0 - c * v0, f = S[0][1] - b * u0 - d * v0;
    if (Math.hypot(a, b) * im.naturalWidth > 6000) return; // 照準の真上・真下などで極端に引きのばされるときは描かない
    const w = CONART[id][1][0], h = CONART[id][1][1], X = [e, a * w + e, c * h + e, a * w + c * h + e], Y = [f, b * w + f, d * h + f, b * w + d * h + f];
    const W = g.canvas.clientWidth || 9999, H = g.canvas.clientHeight || 9999;
    if (Math.max(...X) < 0 || Math.min(...X) > W || Math.max(...Y) < 0 || Math.min(...Y) > H) return; // 画面の外の絵は描かない
    g.save();
    g.transform(a, b, c, d, e, f);
    g.globalCompositeOperation = 'screen'; // 黒い地が見えなくなる重ね方（絵は加工しない）
    g.globalAlpha = alpha;
    g.drawImage(im, 0, 0, im.naturalWidth, im.naturalHeight, 0, 0, w, h);
    g.restore();
  }

  const conLayerV18 = conLayer;
  conLayer = function (g, toXY, dAz, off, W, H, cx, cy, sc) {
    if (artOn && conObjs.length) {
      if (Date.now() - artAt > 2000) artCalc();
      const now = Date.now(), base = camOn ? A_CAM : A_ON, hy = toXY(head || 0, 0)[1];
      g.save(); g.shadowBlur = 0;
      g.beginPath(); g.rect(0, 0, W, Math.max(0, Math.min(H, hy))); g.clip(); // 地平線より上だけ
      if (!conFind) conObjs.forEach(c => drawArt(g, c.id, toXY, base, sc));
      else {
        // 探す：見つけた星座だけ。見つけた直後の8秒は全体をふわっと出し、そのあとは照準のまわり（線と同じ輪の中）だけ
        const R = CON_R * sc;
        conObjs.forEach(c => {
          const f = conFoundAt(c.id, now); if (!f) return;
          const t = now - f.t;
          const pop = t < POP_MS ? Math.min(1, t / FADE_MS) * Math.min(1, (POP_MS - t) / FADE_MS) : 0;
          if (pop > 0) drawArt(g, c.id, toXY, base * 1.3 * pop, sc);
          if (pop < 1) { g.save(); g.beginPath(); g.arc(cx, cy, R, 0, 7); g.clip(); drawArt(g, c.id, toXY, base * (1 - pop), sc); g.restore(); }
        });
      }
      g.restore();
    }
    return conLayerV18(g, toXY, dAz, off, W, H, cx, cy, sc);
  };

  // 「星座絵」ボタン（空に向けた画面の下の操作の並び。星座が ON のときだけ）
  const btn = document.createElement('button'); btn.id = 'artBtn';
  $('conMode').after(btn);
  const showArtUi = () => {
    btn.style.display = conOn ? '' : 'none';
    btn.classList.toggle('on', artOn);
    btn.textContent = artOn ? '星座絵：ON' : '星座絵';
  };
  btn.onclick = () => { artOn = !artOn; lsSet('sora_conart', artOn); showArtUi(); };
  const showConUiV18 = showConUi;
  showConUi = function () { showConUiV18(); showArtUi(); };
  showArtUi();
  window.conArtOn = () => artOn;
})();
