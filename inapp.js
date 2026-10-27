// TenMiru：v40（v41：MichiMiru 版23 の「戻る帯」があるときは 🚶 を出さない）MichiMiru の Android アプリの中で、MichiMiru の上に重ねて開いているときだけ動く部分（Chrome では何もしない）
// ・左上に「🚶」（MichiMiru に戻る）。スマホの「戻る」は、中の画面を閉じてから MichiMiru に戻る
// ・書き出し・シェアカードの画像の保存は、MichiMiru に頼んでスマホの「Documents」フォルダーへ（アプリの中ではダウンロードが使えないため）
// ・宇宙ステーションの「見える通過」を計算したら、MichiMiru に渡してスマホの通知を予約する（アプリを閉じていても時刻に出る）
(window.SORA_FV = window.SORA_FV || {}).inapp = 41;
const IN_MICHI = (() => { try { return window.parent !== window && typeof window.parent.miruClose === 'function'; } catch (e) { return false; } })();
(function () {
  if (!IN_MICHI) return;
  const P = window.parent;
  const say = m => { try { alertMsg(m, null, false); } catch (e) {} };
  // 🚶 MichiMiru に戻る（地図の左上。空に向ける・図鑑などの画面より下に置くので、その画面を開いている間は隠れる）
  const st = document.createElement('style');
  st.textContent = '#miruBack{position:fixed;left:10px;top:calc(env(safe-area-inset-top,0px) + 10px);z-index:6;width:44px;height:44px;border-radius:22px;border:0;' +
    'background:#1e7e34;color:#fff;font-size:21px;box-shadow:0 1px 5px rgba(0,0,0,.35)}';
  document.head.appendChild(st);
  const b = document.createElement('button');
  b.id = 'miruBack'; b.type = 'button'; b.title = 'MichiMiru に戻る'; b.textContent = '🚶';
  b.onclick = () => { try { P.miruClose(); } catch (e) {} };
  if (!P.miruStrip) document.body.appendChild(b); // v41：MichiMiru 版23 からは画面の上の緑の帯で戻る
  // ダウンロード（書き出し・シェアカードの画像）を MichiMiru の保存に回す
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && /^blob:/.test(this.href) && typeof P.nativeSaveFile === 'function') {
      const a = this, name = a.download;
      fetch(a.href).then(r => r.blob()).then(bl => { if (!P.nativeSaveFile(name, bl, (ok, m) => say(m))) click.call(a); }).catch(() => click.call(a));
      return;
    }
    return click.call(this);
  };
  // 宇宙ステーション：見える通過を計算し直したら、通知の予約を入れ直す
  if (typeof computePasses === 'function' && typeof P.miruIssSchedule === 'function') {
    const base = computePasses;
    computePasses = async function () {
      await base.apply(this, arguments);
      try { P.miruIssSchedule(issPasses.map(p => ({s: p.s, e: p.e, max: p.max, from: dirName(p.saz), to: dirName(p.eaz)}))); } catch (e) {}
    };
  }
  // 設定の「ホーム画面のアプリ」の欄
  const appLine = () => {
    const s = document.getElementById('appState'), a = document.getElementById('appAdd'), h = document.getElementById('appHow');
    if (s) s.textContent = '📱 MichiMiru アプリの中で開いています（' + (P.miruStrip ? '画面の上の緑の帯' : '左上の「🚶」') + 'で MichiMiru に戻ります）。宇宙ステーションの通過は、スマホの通知で予約します';
    if (a) a.style.display = 'none';
    if (h) h.style.display = 'none';
  };
  appLine(); setTimeout(appLine, 1000);
})();
