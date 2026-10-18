// SoraMiru の使い方（v34 → v37）：はじめての紹介・使い方ナビ（レクチャー）・ヘルプ（「使い方」と各欄の「？」）
// app.js のあとに読む。app.js の変数（sky・sel・pos・catchData・yoso など）をそのまま使う
(window.SORA_FV = window.SORA_FV || {}).help = 37;
(function () {
  const H = lsGet('sora_help_v1', null) || {};
  H.done = H.done || {}; H.ev = H.ev || {};
  if (H.on == null) H.on = true;
  const hSave = () => lsSet('sora_help_v1', H);
  BK_SKIP.push('sora_help_v1'); // 使い方の進み具合は端末ごと（書き出さない）

  // ---------- 見た目 ----------
  const st = document.createElement('style');
  st.textContent = `
#helpRow{display:flex;align-items:center;gap:6px;margin:0 0 4px}
#helpRow label{font-size:13px;margin:0}
#helpAll{font-size:13px;padding:3px 10px;background:#1f3b73;color:#fff;border:none;border-radius:12px}
#tip{display:none;position:sticky;top:-8px;z-index:6;margin:0 -10px 6px;padding:8px 34px 8px 10px;background:#fff4c2;border-bottom:2px solid #f0c419;font-size:14px;line-height:1.5;box-shadow:0 2px 6px rgba(0,0,0,.15)}
#tip b{color:#7a5a00}
#tipX{position:absolute;top:4px;right:4px;border:none;background:none;font-size:18px;padding:2px 8px;margin:0}
.hl{outline:3px solid #f0c419 !important;outline-offset:2px;animation:hlp 1.2s ease-in-out infinite}
@keyframes hlp{0%,100%{outline-color:#f0c419}50%{outline-color:rgba(240,196,25,.25)}}
.qb{display:inline-block;width:22px;height:22px;line-height:20px;padding:0;margin:0 0 0 4px;font-size:13px;font-weight:bold;text-align:center;border:1px solid #1f6fd1;color:#1f6fd1;background:#fff;border-radius:50%;vertical-align:middle}
#helpBox,#intro{display:none;position:fixed;top:0;left:0;right:0;bottom:0;z-index:45;background:#fff;overflow:auto;padding:12px;line-height:1.7;font-size:15px}
#helpBox details{border-bottom:1px solid #e3e3e3;padding:4px 0}
#helpBox summary{font-weight:bold;color:#1f3b73;padding:6px 0;cursor:pointer}
#helpBox details[open] summary{color:#c0392b}
#helpBox .hb{padding:0 4px 8px}
#helpBox ul{margin:4px 0;padding-left:20px}
#helpBox .tag{display:inline-block;font-size:12px;font-weight:bold;padding:0 6px;border-radius:10px;color:#fff}
#intro{background:linear-gradient(#1f3b73,#4a7fd0);color:#fff;display:none;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:24px}
#intro .ic{font-size:64px;line-height:1.2}
#intro h2{margin:12px 0 8px;font-size:22px}
#intro p{max-width:460px;margin:0 auto;font-size:16px;line-height:1.8}
#intro .dots{margin:18px 0}
#intro .dots span{display:inline-block;width:9px;height:9px;margin:0 4px;border-radius:50%;background:rgba(255,255,255,.35)}
#intro .dots span.on{background:#fff}
#intro button{font-size:16px;padding:8px 18px;margin:4px;border-radius:20px;border:none}
#introNext{background:#ffd54f;color:#333;font-weight:bold}
#introSkip,#introPrev{background:rgba(255,255,255,.2);color:#fff}`;
  document.head.appendChild(st);

  // ---------- 使い方ナビの行と吹き出し ----------
  const row = document.createElement('div'); row.id = 'helpRow';
  row.innerHTML = '<label><input type="checkbox" id="helpChk">使い方ナビ</label><button id="helpAll">？ 使い方</button>';
  const tip = document.createElement('div'); tip.id = 'tip';
  tip.innerHTML = '<div id="tipText"></div><button id="tipX" aria-label="閉じる">×</button>';
  $('panel').prepend(tip);
  if ($('helpSlot')) $('helpSlot').appendChild(row); else $('panel').prepend(row); // v35：設定タブの「使い方」に置く
  $('helpChk').checked = !!H.on;
  $('helpChk').onchange = () => { H.on = $('helpChk').checked; if (H.on && H.done.finish) { H.done = {}; } hSave(); tipKey = ''; closedKey = ''; helpTick(); };

  // ---------- ヘルプの中身 ----------
  const tag = (t, c) => `<span class="tag" style="background:${c}">${t}</span>`;
  const SEC = [
    ['about', 'SoraMiru とは', `<p>見上げた空の飛行機が「どこから来て、どこへ行くのか」がすぐ分かるアプリです。飛行機に加えて、月・惑星・星座・宇宙ステーションまで、いまの空を楽しめます。</p>
<p>スマホを空に向けて飛行機を照準に入れると「キャッチ」でき、点数と図鑑が集まります。世界の空港の空へ「よその空」として遊びに行くこともできます。</p>`],
    ['screen', '画面の見方', `<ul><li>画面の下のボタン：<b>空</b>（機体の一覧）／<b>記録</b>（図鑑・都市・今日の空・バッジ・よその空ノート・シェア）／真ん中の<b>空に向ける</b>／<b>よその空</b>／<b>設定</b>（知らせ・使い方・記録の保存）。</li>
<li>上は地図、下は近くの機体の一覧です。一覧は「近い順」か「これから来る順」に並べられます。今夜の空と宇宙ステーションは、一覧の上の1行を押すと開きます。</li>
<li><b>地図と一覧の境目</b>：一覧の上の端の短い横棒（つまみ）を指で上下に動かすと、地図と一覧の広さを変えられます。つまみを2回タップすると元に戻ります（スマホの画面だけ）。</li>
<li><b>画面の明るさ</b>：「設定」で、自動（今いる場所の日の入りから日の出までは暗い画面）・いつも明るい・いつも暗い を選べます。</li>
<li><b>範囲</b>：何km先までの機体を出すか。遠くの機体まで見たいときは広くします（図鑑に入るのは10km以内とキャッチした機体だけです）。</li>
<li><b>地上も</b>：空港の地上にいる機体も出します。</li>
<li>地図の点線の輪は「10km（図鑑に入る範囲）」です。10km以内の機体には行き先と機種の名前が付きます。</li>
<li>機体の色：青＝旅客機など、${tag('赤', '#c0392b')}＝軍用機、${tag('黄', '#e6a700')}＝夕日・朝日を浴びている機体。緑に光る機体は、いまキャッチできる機体です。</li></ul>`],
    ['detail', '機体の詳細と「この便に乗る」', `<ul><li>一覧や地図の機体をタップすると、写真（Planespotters.net）、行き先、高さ、速さ、窓から見える景色が出ます。</li>
<li><b>この便に乗る</b>：その便の窓から見た景色を3Dで見られます。「左窓」「前方」「右窓」で向きを変え、「降りる」で戻ります。</li></ul>`],
    ['sky', '空に向ける', `<ul><li>下の真ん中の「空に向ける」を押し、スマホを写真を撮るように空へ向けます。カメラ・星座・補正などのボタンは、空の画面の下の端に並んでいます（横にずらせます）。画面の照準（真ん中の円）の方向にある機体・月・惑星・星の名前が出ます。</li>
<li>照準の機体をタップすると詳細が出ます。</li>
<li><b>カメラ</b>：カメラの映像に重ねて表示します。<b>画角</b>はカメラの写る広さに合わせる調整です。</li>
<li><b>補正（±5°）</b>：表示の方角がずれているときに直します。<b>方角を合わせる</b>（カメラON）：月や明るい星を十字に入れて押すと、自動で合わせます。</li>
<li>方角が動かないときは、スマホを8の字に数回振ると直ることがあります。iPhone では、最初に「動作と方向」へのアクセスを「許可」してください。</li>
<li>パソコンには向きのセンサーがないので、この画面はスマホで使ってください。</li></ul>`],
    ['catch', 'キャッチと点数', `<ul><li><b>キャッチの仕方</b>：空に向けて、照準の円に機体を2秒入れ続けます（飛んでいる機体、見上げ角10°以上、スマホを5°以上上に向ける）。同じ機体は1日1回です。</li>
<li><b>レア度</b>：その機種を、自分の空のあたりで見かけた回数で決まります。${tag('激レア', '#d63fa6')} 80点（2回以下）、${tag('レア', '#e08a00')} 40点（10回以下）、${tag('ちょいレア', '#4a90d9')} 20点（30回以下）、ふつう 10点。</li>
<li><b>ボーナス</b>：軍用機+50、初めてキャッチした機種+50、新都市+30、新路線+20、夕日・朝日+30、真上（見上げ角70°以上）+20、Lvアップ+30。宇宙ステーションは1日1回100点。</li>
<li><b>Lv</b>：同じ機種をキャッチした回数で上がります（1・3・10・30・100回）。</li></ul>`],
    ['marks', '印と色の意味', `<ul><li>${tag('新都市', '#d63fa6')}：行き先の都市を、まだキャッチしたことがない便。キャッチで+30点。</li>
<li>${tag('新路線', '#e08a00')}：その出発地→行き先の組を、まだキャッチしたことがない便。キャッチで+20点。</li>
<li>空に向けた画面の「激レア」「レア」：キャッチしたときのレア度です。✓は今日キャッチ済みの機体です。</li>
<li>知らせの色：赤＝軍用機・真上、緑＝キャッチ、金＝バッジ、紺＝星座・よその空など。</li></ul>`],
    ['cd', '真上カウントダウンと知らせ', `<ul><li>見上げ角60°以上で真上近くを通る機体が10分以内に来ると、地図の左上に「あと1:40で真上付近」と出ます。残り30秒でオレンジ、真上を過ぎると赤の「いま真上！」になり、振動で知らせます（iPhone は振動しません）。</li>
<li>帯を押すと、その機体を選びます。</li>
<li>現在地の誤差が大きいとき（1km超）や、よその空にいるときは出しません。</li>
<li>「設定」の「軍用機を知らせる」「真上通過を知らせる」「真上カウントダウン」で、それぞれ入・切できます。</li></ul>`],
    ['night', '夜の空（月・惑星・星座・宇宙ステーション）', `<ul><li>「空に向ける」の画面に、月（満ち欠けの形）、惑星、明るい星が出ます。空が暗くなると星座も出ます。</li>
<li><b>星座</b>：「出し方：探す」では照準のまわりだけ線が見えます。線を照準に入れたまま2秒で名前が分かり、「見つけた星座」に記録されます（点はありません）。「全部」にすると全部の星座が出ます。</li>
<li><b>宇宙ステーション</b>：位置と、肉眼で見える時刻を一覧の上に出し、5分前に知らせます。</li>
<li><b>星座絵</b>：空に向けた画面で、星座の線の下に星座の絵（オリオン座なら狩人の姿）を薄く重ねます。「星座絵」ボタンで出す・出さないを切り替えます。「出し方：探す」では、見つけた星座の絵が8秒ほど全体に出て、そのあとは照準のまわりだけに出ます。「全部」では見えている星座の絵を全部出します。絵：Johan Meuris（Stellarium、Free Art License）。</li>
<li><b>今夜の空</b>：今夜見える月・惑星と時刻です。よその空にいる間は、いまから何時間後かで出します（現地の時刻ではありません）。</li></ul>`],
    ['notes', '図鑑・都市・今日の空・バッジ・シェア', `<ul><li><b>図鑑</b>：10km以内を通った機体と、キャッチした機体の機種です。「捕」はキャッチした回数とLv。機種名を押すと説明と、自分がキャッチした機体の写真が出ます。</li>
<li><b>都市</b>：キャッチした旅客機の行き先の都市と、出発地→行き先の線（地球儀）。「線を消す」で線だけを消して描き直せます。</li>
<li><b>今日の空</b>：今日のスコア、キャッチ、見た機体、見つけた星座、見た場所。30日分さかのぼれます。</li>
<li><b>バッジ</b>：22種類。段階は 銅→銀→金→白金→ダイヤ。</li>
<li><b>シェア</b>：今日の空の「シェア」から、まとめの画像を LINE や X に送れます。正確な位置は入りません。</li></ul>`],
    ['yoso', 'よその空', `<ul><li><b>世界の空港</b>：押すと有名な空港の近くの空へ行けます。<b>よその空に行く</b>：地図をタップした場所の空へ行けます。よその空ノートの「この空に行く」や地球儀の印からも行けます。</li>
<li>よその空にいる間は、「空」の一番上に緑の帯（場所の名前と、現地がいま昼か夜か）が出て、下の「よその空」のボタンに緑の点が付きます。帯の「別の場所へ」「現在地に戻す」で移れます。</li>
<li>星と星座は、現地の空が暗いときだけ出ます（日本の夜は、ヨーロッパではお昼です）。明るいときは、空に向けた画面に暗くなるまでの時間が出ます。</li>
<li>よその空でも「空に向ける」でキャッチできます（その場所に立って同じ方向を向いたつもりで）。カメラは使えません。</li>
<li>よその空のキャッチと点数は、いつもの図鑑・スコアとは別に「よその空ノート」に入ります。キャッチした便の出発地→行き先は、ノートの地球儀に線で描かれます。</li>
<li>${tag('★', '#2e7d6b')}は、自分の空ではまだ出会っていない機種です（キャッチで+30点）。</li>
<li>「現在地に戻す」でいつもの空に戻ります。今いる場所の近くを選んだときは、いつもどおり記録します。</li></ul>`],
    ['loc', '現在地と記録の保存', `<ul><li>現在地の誤差が大きいとき（パソコンなど）は、真上の知らせを止めます。「よその空に行く」で今いる場所を選び直すと正確になります。</li>
<li>記録はこの端末のこのブラウザの中にあります。パソコンとスマホでは別々です。ブラウザの「サイトデータを削除」で消えます。</li>
<li><b>記録を書き出す／読み込む</b>：スマホを替えるときやアドレスが変わるときは、書き出したファイルを新しいほうで読み込んでください。</li></ul>`],
    ['trouble', 'うまくいかないとき', `<ul><li><b>行き先が「調べ中」のまま</b>：画面下の「行き先を調べ中 〇機」のあとの（　）に理由が出ます。混んでいるときは少し待つと減っていきます。データに登録のない便は「行き先不明」になります。</li>
<li><b>機体が出ない</b>：電波の状態を確かめ、少し待ってください。前の表示を続けながら、3秒ごとにやり直します。</li>
<li><b>方角がずれる</b>：スマホを8の字に振る、「方角を合わせる」、「補正」で直してください。</li></ul>
<p class="small">機体データ：adsb.lol（ODbL）／行き先：Virtual Radar Server（CC0）／写真：Planespotters.net／地名：国土地理院・© OpenStreetMap contributors／天体：Astronomy Engine／星座の線：d3-celestial／星座絵：Johan Meuris（Stellarium・Free Art License、<a href="https://artlibre.org/licence/lal/en/" target="_blank" rel="noopener">ライセンス</a>）・基準点：Stellarium（CC BY-SA）</p>
<p class="small" id="helpVer"></p>`]];
  const box = document.createElement('div'); box.id = 'helpBox';
  box.innerHTML = '<div class="ovh"><button id="helpClose">← 閉じる</button><b>SoraMiru の使い方</b></div>' +
    SEC.map(s => `<details id="h-${s[0]}"><summary>${s[1]}</summary><div class="hb">${s[2]}</div></details>`).join('') +
    '<div style="margin:14px 0"><button id="helpIntro">はじめての紹介をもう一度</button><button id="helpRestart">使い方ナビを最初から</button></div>';
  document.body.appendChild(box);
  const helpOpen = () => box.style.display === 'block';
  const helpCloseBase = () => { box.style.display = 'none'; };
  window.openHelp = function (id) {
    box.querySelectorAll('details').forEach(d => { d.open = !!id && d.id === 'h-' + id; });
    if (!helpOpen()) { box.style.display = 'block'; navPush('help', helpOpen, helpCloseBase); }
    const d = id && $('h-' + id);
    if (d) setTimeout(() => d.scrollIntoView({block:'start'}), 0); else box.scrollTop = 0;
  };
  $('helpAll').onclick = () => openHelp(null);
  $('helpClose').onclick = () => navClose('help', helpCloseBase);
  $('helpRestart').onclick = () => { H.done = {}; H.ev = {}; H.on = true; $('helpChk').checked = true; hSave(); navClose('help', helpCloseBase); tipKey = ''; closedKey = ''; helpTick(); };
  $('helpIntro').onclick = () => { navClose('help', helpCloseBase); setTimeout(() => showIntro(0), 50); };

  // ---------- 各欄の「？」 ----------
  const qb = (id, sec, place) => {
    const el = typeof id === 'string' ? $(id) : id; if (!el) return;
    const b = document.createElement('button'); b.className = 'qb'; b.textContent = '？'; b.title = '説明';
    b.onclick = e => { e.stopPropagation(); openHelp(sec); };
    if (place === 'in') el.appendChild(b); else el.after(b);
  };
  qb($('ground').parentNode, 'screen');
  qb('yosoBtn', 'notes');
  qb($('ntfCd').parentNode, 'cd');
  qb('skyInfo', 'sky');
  qb('pickBtn', 'yoso');
  qb('conMode', 'night');
  qb(document.querySelector('.bk b'), 'loc');
  qb(document.querySelector('#zukan b'), 'notes');
  qb(document.querySelector('#cities b'), 'notes');
  qb('dayTitle', 'notes');
  qb(document.querySelector('#badge b'), 'notes');
  qb(document.querySelector('#yoso b'), 'yoso');
  qb('rtWait', 'trouble');

  // ---------- はじめての紹介 ----------
  const CARDS = [
    ['✈️', '見上げた飛行機が、どこへ行くか分かる', 'いま空を飛んでいる飛行機の出発地と行き先、機種が地図と一覧に出ます。'],
    ['🎯', 'スマホを空に向けて「キャッチ」', '「空に向ける」を押してスマホを空にかざし、照準の円に飛行機を2秒入れるとキャッチ。珍しい機種や新しい行き先ほど高い点です。'],
    ['⏱️', '真上に来る便を知らせます', '真上近くを通る便は、到着までカウントダウン。その時刻に見上げてみてください。'],
    ['🌙', '夜は月・惑星・星座も', '空に向けた画面で、月や惑星、星座を探せます。宇宙ステーションが見える時刻も分かります。'],
    ['🌏', '世界の空へ「よその空」', '「世界の空港」から、ロンドンやニューヨークの空へ遊びに行けます。位置情報は、周りの飛行機を探すためだけに使います。']];
  const intro = document.createElement('div'); intro.id = 'intro';
  document.body.appendChild(intro);
  let introI = 0;
  function showIntro(i) {
    introI = i; const c = CARDS[i], last = i === CARDS.length - 1;
    intro.innerHTML = `<div class="ic">${c[0]}</div><h2>${esc(c[1])}</h2><p>${esc(c[2])}</p>` +
      `<div class="dots">${CARDS.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div>` +
      `<div>${i ? '<button id="introPrev">戻る</button>' : ''}<button id="introNext">${last ? 'はじめる' : '次へ'}</button></div>` +
      (last ? '' : '<div><button id="introSkip">飛ばす</button></div>');
    intro.style.display = 'flex';
    $('introNext').onclick = () => { if (last) endIntro(); else showIntro(i + 1); };
    if ($('introPrev')) $('introPrev').onclick = () => showIntro(i - 1);
    if ($('introSkip')) $('introSkip').onclick = endIntro;
  }
  function endIntro() { intro.style.display = 'none'; H.intro = 1; hSave(); helpTick(); }
  if (!H.intro) showIntro(0);

  // ---------- 使い方ナビ（レクチャー） ----------
  const night = () => { try { return pos && sunAt(pos[1], pos[0], new Date()).el < -6; } catch (e) { return false; } };
  const vis = el => el && el.offsetParent !== null;
  const caughtAny = () => (catchData.total || 0) + ((yoso.cat && yoso.cat.total) || 0) > 0;
  // 手順（上から順に、まだ終わっていない最初のものを出す）。t：文、el：光らせる場所、ok：終わった印を付ける条件、on：出してよい条件
  const STEPS = [
    {id:'select', t:'<b>一覧の機体をタップ</b>してみましょう。写真・行き先・窓から見える景色が出ます。', el:() => document.querySelector('#list .card'), ok:() => !!sel, on:() => planes.length > 0},
    {id:'sky', t:'下の真ん中の<b>「空に向ける」</b>を押して、スマホを写真を撮るように空へ向けてみましょう。', el:() => $('skyFab'), ok:() => sky, on:() => !noSensor()},
    {id:'catch', t:'飛行機を<b>照準の円に2秒</b>入れるとキャッチ！ 緑に光る機体（地図）が狙い目です。見上げ角10°以上の機体ならキャッチできます。', el:() => sky ? $('scopeBox') : $('skyFab'), ok:caughtAny, on:() => !noSensor()},
    {id:'zukan', t:'<b>「記録」→「図鑑」</b>を開いてみましょう。10km以内を通った機体とキャッチした機体の機種が集まります。', el:() => $('tile-zukan') || $('zukanBtn'), ok:() => H.done.zukanOpen, on:() => !sky},
    {id:'day', t:'<b>「記録」→「今日の空」</b>で、今日のスコアとキャッチのまとめが見られます。', el:() => $('tile-day') || $('dayBtn'), ok:() => H.done.dayOpen, on:() => !sky},
    {id:'con', t:'空が暗くなりました。<b>「空に向ける」→「星座」</b>で、照準のまわりの星座を探してみましょう。線を照準に入れて2秒で名前が分かります。', el:() => sky ? $('conBtn') : $('skyFab'), ok:() => H.done.conFound, on:() => night() && !noSensor() && !viewOnly()},
    {id:'yoso', t:'<b>「よその空」→「世界の空港」</b>から、世界の空港の空へ遊びに行けます。', el:() => (document.querySelector('#airList button') || $('airBtn')), ok:() => viewOnly(), on:() => !sky},
    {id:'back', t:'よその空でも「空に向ける」でキャッチできます（点数は「よその空ノート」に）。戻るときは「空」の一番上の緑の帯の<b>「現在地に戻す」</b>。', el:() => ($('bandBack') || $('backBtn')), ok:() => H.done.yoso && !viewOnly() && !pickPos, on:() => !sky}];
  let tipKey = '', closedKey = '', hlEl = null, finishAt = 0;
  // 見えないタブの中の部品なら、そのタブのボタンを光らせる（v35）
  const reach = el => { const s = el && el.closest && el.closest('.tabsec'); return s && !s.classList.contains('cur') && $('tb-' + s.dataset.tab) ? $('tb-' + s.dataset.tab) : el; };
  function setTip(key, html, el) {
    el = reach(el);
    if (hlEl && hlEl !== el) { hlEl.classList.remove('hl'); hlEl = null; }
    if (!key || key === closedKey) { tip.style.display = 'none'; tipKey = key || ''; return; }
    if (key !== tipKey) { $('tipText').innerHTML = html; tipKey = key; if (el && vis(el) && !sky && el.closest && el.closest('#panel')) el.scrollIntoView({block:'nearest'}); }
    tip.style.display = 'block';
    if (el && vis(el)) { el.classList.add('hl'); hlEl = el; }
  }
  // ×：レクチャーの手順なら、その手順は飛ばして次へ（v35）
  $('tipX').onclick = () => { if (tipKey.startsWith('s:')) { H.done[tipKey.slice(2)] = 1; hSave(); } else closedKey = tipKey; setTip('', ''); };
  // 終わった印（画面を開いた・星座を見つけた）
  $('zukanBtn').addEventListener('click', () => { H.done.zukanOpen = 1; hSave(); });
  $('dayBtn').addEventListener('click', () => { H.done.dayOpen = 1; hSave(); });
  const anyCon = () => Object.values(skyDays.days || {}).some(D => D.con && D.con.length) || (yoso.pl || []).some(e => e.con && e.con.length);
  function helpTick() {
    if (intro.style.display === 'flex' || helpOpen()) return;
    // いつでも出すもの（ナビ OFF でも）：場所を選んでいる間
    if (pickMode) return setTip('pick', '<b>地図をタップ</b>して、空を見る場所を選んでください。拡大してから選ぶと正確です。', $('map'));
    if (!H.on) return setTip('', '');
    if (!pos) return setTip('pos', '現在地を探しています。位置情報の確認が出たら<b>「許可」</b>を選んでください（周りの飛行機を探すためだけに使います）。', $('head'));
    // その場の出来事
    if ($('cdBar').style.display === 'block' && (H.ev.cd || 0) < 3) {
      if (tipKey !== 'cd') { H.ev.cd = (H.ev.cd || 0) + 1; hSave(); }
      return setTip('cd', '<b>真上に来る便があります！</b> 帯の時間になったら見上げてください。帯を押すとその機体を選べます。', $('cdBar'));
    }
    const nvCard = document.querySelector('#list .nv');
    const listCur = !$('tab-list') || $('tab-list').classList.contains('cur');
    if (nvCard && !H.ev.nv && !sky && H.done.catch && !listCur && H.ev.nvAt) { H.ev.nv = 1; hSave(); } // 一度出たあとほかのタブへ移ったら終わり（v35）
    if (nvCard && !H.ev.nv && !sky && H.done.catch && listCur) { // キャッチを覚えたあとに1回だけ（8秒）
      if (!H.ev.nvAt) H.ev.nvAt = Date.now();
      if (Date.now() - H.ev.nvAt > 8000) { H.ev.nv = 1; hSave(); }
      return setTip('nv', '<b>「新都市」「新路線」</b>の印は、まだキャッチしたことのない行き先・路線の便です。キャッチするとボーナス点！', nvCard.closest('.card'));
    }
    // レクチャー
    if (viewOnly()) { H.done.yoso = 1; }
    if (anyCon()) H.done.conFound = 1;
    let step = null;
    for (const s of STEPS) {
      if (H.done[s.id]) continue;
      if (s.ok()) { H.done[s.id] = 1; hSave(); continue; }
      if (s.on()) { step = s; break; }
    }
    if (step) return setTip('s:' + step.id, step.t, step.el());
    // 全部終わった（夜だけの星座が残っていても、ほかが終わればいったん完了）
    const must = s => s.id !== 'con' && !(noSensor() && (s.id === 'sky' || s.id === 'catch')); // 星座は夜だけ、空に向けるはスマホだけ
    if (!H.done.finish && STEPS.every(s => H.done[s.id] || !must(s))) {
      if (!finishAt) finishAt = Date.now();
      if (Date.now() - finishAt > 10000) { H.done.finish = 1; H.on = false; $('helpChk').checked = false; hSave(); return setTip('', ''); }
      return setTip('finish', '<b>レクチャー完了！</b> いつでも「設定」→「？ 使い方」で説明を見られます。使い方ナビはまもなく自動で OFF になります。', $('helpAll'));
    }
    setTip('', '');
  }
  setInterval(() => { if (!document.hidden) helpTick(); }, 1000);
  helpTick();
})();
