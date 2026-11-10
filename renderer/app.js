'use strict';
const $ = id => document.getElementById(id);
const DURUM_ADI = { calisiyor: 'çalışıyor', bekliyor: 'seni bekliyor', bitti: 'bitti, sıra sende', hata: 'hata', kapali: 'kapalı' };

let ajanlar = [];
let secili = null;
let varsayilanKlasor = '';

// Yerleşim tercihleri (tarayıcı deposu yoksa varsayılanlarla çalışır)
const sakla = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
const oku = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
let mod = ['normal', 'tam', 'gizli'].includes(oku('pano.mod')) ? oku('pano.mod') : 'normal';
let agacH = +oku('pano.agacH') || 300;
const terminaller = new Map(); // id -> { term, fit, el, hazir, kuyruk }

/* ---------------- ağaç yapısı ---------------- */
const byId = id => ajanlar.find(a => a.id === id);
const cocuklar = id => ajanlar.filter(a => a.ebeveynId === id || (id === null && a.ebeveynId && !byId(a.ebeveynId)));
function sirali() { // derinlik öncelikli sıra: ⌘1…9 numaraları buna göre
  const out = [];
  const gez = a => { out.push(a); ajanlar.filter(c => c.ebeveynId === a.id).forEach(gez); };
  cocuklar(null).forEach(gez);
  return out;
}

// Ağaç yapısı (kim kimin altında) değişmedikçe kartlar yeniden kurulmaz, yalnız içerikleri güncellenir.
// Böylece sık gelen durum olaylarında kaydırma ve üzerine gelme bozulmaz.
let yapiImzasi = '';
const kartlar = new Map();
function kartDoldur(k, a, no) {
  const sinif = `kart ${a.durum}${a.id === secili ? ' secili' : ''}`;
  if (k.className !== sinif) k.className = sinif;
  k.querySelector('.nokta').className = 'nokta ' + a.durum;
  const yaz = (sec, metin) => { const el = k.querySelector(sec); if (el.textContent !== metin) el.textContent = metin; };
  yaz('.ad', a.ad);
  yaz('.no', no <= 9 ? '⌘' + no : '');
  yaz('.gorev', a.gorev ? a.gorev.split('\n')[0] : 'serbest oturum');
  yaz('.son', a.son || DURUM_ADI[a.durum]);
}
function agaciCiz() {
  const sira = sirali();
  const imza = sira.map(a => a.id + '<' + (a.ebeveynId || '')).join('|');
  if (imza !== yapiImzasi) {
    yapiImzasi = imza;
    kartlar.clear();
    const kok = $('agacIcerik'); kok.textContent = '';
    const dugum = a => {
      const d = document.createElement('div'); d.className = 'dugum';
      const k = document.createElement('button');
      k.dataset.id = a.id;
      k.innerHTML = '<span class="ust-satir"><span class="nokta"></span><span class="ad"></span><span class="no"></span></span><span class="gorev"></span><span class="son"></span>';
      k.addEventListener('click', () => sec(a.id));
      kartlar.set(a.id, k);
      d.appendChild(k);
      const cs = ajanlar.filter(c => c.ebeveynId === a.id);
      if (cs.length) { const r = document.createElement('div'); r.className = 'cocuklar'; cs.forEach(c => r.appendChild(dugum(c))); d.appendChild(r); }
      return d;
    };
    const satir = document.createElement('div'); satir.className = 'cocuklar';
    cocuklar(null).forEach(a => satir.appendChild(dugum(a)));
    kok.appendChild(satir);
    sira.forEach((a, i) => kartDoldur(kartlar.get(a.id), a, i + 1));
    sahneGuncelle();
    oklariCiz();
  } else {
    sira.forEach((a, i) => kartDoldur(kartlar.get(a.id), a, i + 1));
    okSiniflari();
  }
  const aktifler = ajanlar.filter(a => a.durum !== 'kapali').length;
  const bekleyen = ajanlar.filter(a => a.durum === 'bekliyor').length;
  $('sayim').textContent = `${aktifler} ajan açık${bekleyen ? ` · ${bekleyen} seni bekliyor` : ''}`;
  seritleriCiz(sira);
}

function seritleriCiz(sira) { // tam ekrandayken ajanlar arasında geçiş için küçük haplar
  const kutu = $('seritler'); kutu.textContent = '';
  sira.forEach((a, i) => {
    const b = document.createElement('button');
    b.className = 'serit' + (a.id === secili ? ' secili' : '');
    b.innerHTML = `<span class="nokta ${a.durum}"></span><span></span>`;
    b.lastChild.textContent = a.ad;
    b.title = `${a.ad} · ${DURUM_ADI[a.durum] || ''}${i < 9 ? ` (⌘${i + 1})` : ''}`;
    b.addEventListener('click', () => sec(a.id));
    kutu.appendChild(b);
  });
  const sec_ = kutu.querySelector('.secili'); if (sec_) sec_.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

// Oklar ağacın kendi koordinatlarında çizilir ve ağaçla birlikte kayar/ölçeklenir:
// kaydırırken ya da yakınlaştırırken yeniden çizilmez.
function oklariCiz() {
  const agac = $('agac'), svg = $('oklar');
  const ar = agac.getBoundingClientRect(), z = yakinlik;
  svg.setAttribute('width', agac.offsetWidth); svg.setAttribute('height', agac.offsetHeight);
  const nokta = (el, alt) => {
    const r = el.getBoundingClientRect();
    return { x: (r.left - ar.left + r.width / 2) / z, y: ((alt ? r.bottom : r.top) - ar.top) / z };
  };
  let html = '';
  for (const a of ajanlar) {
    if (!a.ebeveynId) continue;
    const pe = kartlar.get(a.ebeveynId), ce = kartlar.get(a.id);
    if (!pe || !ce) continue;
    const p = nokta(pe, true), c = nokta(ce, false);
    const my = (p.y + c.y) / 2, ucY = c.y - 2, v = `data-p="${a.ebeveynId}" data-c="${a.id}"`;
    html += `<path ${v} d="M${p.x},${p.y} C${p.x},${my} ${c.x},${my} ${c.x},${ucY - 6}"/>`;
    html += `<polygon ${v} points="${c.x - 4.5},${ucY - 7} ${c.x + 4.5},${ucY - 7} ${c.x},${ucY}"/>`;
  }
  svg.innerHTML = html;
  okSiniflari();
}
function okSiniflari() {
  $('oklar').querySelectorAll('[data-c]').forEach(el => el.classList.toggle('aktif', el.dataset.c === secili || el.dataset.p === secili));
}

/* ---------------- terminaller ---------------- */
function terminalAl(id) {
  if (terminaller.has(id)) return terminaller.get(id);
  const el = document.createElement('div'); el.className = 'term'; el.hidden = true;
  $('terminaller').appendChild(el);
  const term = new Terminal({
    fontFamily: '"SF Mono", Menlo, monospace', fontSize: 13, lineHeight: 1.15, scrollback: 8000,
    macOptionIsMeta: true, cursorBlink: true, allowProposedApi: true,
    theme: { background: '#0c1017', foreground: '#e4e9f1', cursor: '#7f9dff', selectionBackground: '#2c3a55' },
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(el);
  term.onData(d => pano.yaz(id, d));
  const t = { term, fit, el, hazir: false, kuyruk: [] };
  terminaller.set(id, t);
  pano.tampon(id).then(eski => {
    if (eski) term.write(eski);
    t.kuyruk.forEach(v => term.write(v)); t.kuyruk = [];
    t.hazir = true;
  });
  return t;
}

function sigdir() {
  const t = terminaller.get(secili); if (!t || t.el.hidden) return;
  try { t.fit.fit(); pano.boyut(secili, t.term.cols, t.term.rows); } catch (_) {}
}

function sec(id) {
  if (!byId(id)) return;
  secili = id;
  if (mod === 'gizli') modAyarla('normal');
  for (const [k, t] of terminaller) t.el.hidden = k !== id;
  const t = terminalAl(id);
  t.el.hidden = false;
  pano.secildi(id);
  requestAnimationFrame(() => { sigdir(); t.term.focus(); });
  basligiGuncelle();
  agaciCiz();
  const kart = document.querySelector(`.kart[data-id="${id}"]`);
  if (kart && mod !== 'tam') kart.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

function basligiGuncelle() {
  const a = byId(secili);
  $('tbAd').textContent = a ? a.ad : '—';
  $('tbNokta').className = 'nokta ' + (a ? a.durum : '');
  $('tbGorev').textContent = a ? `${DURUM_ADI[a.durum] || ''}${a.gorev ? ' · ' + a.gorev.split('\n')[0] : ''}` : '';
  $('tbKlasor').textContent = a ? a.klasor.replace(/^\/Users\/[^/]+/, '~') : '';
  $('kapatBtn').textContent = a && a.durum === 'kapali' ? 'Kartı kaldır' : 'Ajanı kapat';
  ['kapatBtn', 'yenidenBtn', 'altAjanBtn'].forEach(b => { $(b).disabled = !a; });
  $('acNokta').className = 'nokta ' + (a ? a.durum : '');
  $('acMetin').textContent = a ? `${a.ad} terminali gizli · ${DURUM_ADI[a.durum] || ''}` : 'Terminal gizli';
}

/* ---------------- olaylar ---------------- */
pano.on('veri', (id, veri) => {
  const t = terminaller.get(id); if (!t) return;
  if (t.hazir) t.term.write(veri); else t.kuyruk.push(veri);
});
pano.on('sifirla', id => { const t = terminaller.get(id); if (t) t.term.reset(); });
pano.on('ajanlar', liste => {
  const ilk = ajanlar.length === 0;
  ajanlar = liste;
  for (const [id, t] of terminaller) if (!byId(id)) { t.term.dispose(); t.el.remove(); terminaller.delete(id); }
  if (!byId(secili)) secili = null;
  if ((ilk || !secili) && ajanlar.length) { sec(sirali()[0].id); return; }
  agaciCiz(); basligiGuncelle();
});
pano.on('sec', id => sec(id));
pano.on('kisayol', (ne, n) => {
  const a = byId(secili);
  if (ne === 'yeni') return yeniAc(secili);
  if (ne === 'tam') return modAyarla(mod === 'tam' ? 'normal' : 'tam');
  if (ne === 'gizle') return modAyarla(mod === 'gizli' ? 'normal' : 'gizli');
  if (ne === 'no') { const s = sirali()[n]; if (s) sec(s.id); return; }
  if (!a) return;
  if (ne === 'ust' && a.ebeveynId && byId(a.ebeveynId)) sec(a.ebeveynId);
  if (ne === 'alt') { const c = ajanlar.find(x => x.ebeveynId === a.id); if (c) sec(c.id); }
  if (ne === 'sol' || ne === 'sag') {
    const kardesler = ajanlar.filter(x => x.ebeveynId === a.ebeveynId || (!byId(x.ebeveynId) && !byId(a.ebeveynId)));
    const i = kardesler.indexOf(a), j = i + (ne === 'sag' ? 1 : -1);
    if (kardesler[j]) sec(kardesler[j].id);
  }
});

new ResizeObserver(() => sigdir()).observe($('terminaller'));
new ResizeObserver(() => { sahneGuncelle(); tasmaKontrol(); }).observe($('agacAlani'));

/* ---------------- ağacı harita gibi gezme ve yakınlaştırma ---------------- */
let yakinlik = +oku('pano.yakinlik') || 1;
const YK_MIN = 0.35, YK_MAX = 1.6;

// Ölçek GPU'da (transform) uygulanır; kaydırma alanının boyu ölçekli boyuta göre ayarlanır.
function sahneGuncelle() {
  const alan = $('agacAlani'), sahne = $('agacSahne'), agac = $('agac');
  const w = agac.offsetWidth * yakinlik, h = agac.offsetHeight * yakinlik;
  const bos = Math.max(0, alan.clientWidth - 40);
  sahne.style.width = Math.max(w, bos) + 'px';
  sahne.style.height = h + 'px';
  agac.style.transform = `translate(${Math.max(0, (bos - w) / 2)}px, 0) scale(${yakinlik})`;
}

function yakinlikAyarla(z, odak) {
  const alan = $('agacAlani'), agac = $('agac');
  z = Math.round(Math.max(YK_MIN, Math.min(YK_MAX, z)) * 1000) / 1000;
  if (z === yakinlik) return;
  const ar = alan.getBoundingClientRect();
  const fx = odak ? odak.x : ar.left + alan.clientWidth / 2, fy = odak ? odak.y : ar.top + alan.clientHeight / 2;
  const once = agac.getBoundingClientRect();
  const px = (fx - once.left) / yakinlik, py = (fy - once.top) / yakinlik; // odaktaki noktanın ağaçtaki yeri
  yakinlik = z;
  sahneGuncelle();
  const sonra = agac.getBoundingClientRect();
  alan.scrollLeft += sonra.left + px * z - fx; // o nokta imlecin altında kalsın
  alan.scrollTop += sonra.top + py * z - fy;
  $('ykOran').textContent = Math.round(z * 100) + '%';
  clearTimeout(yakinlikAyarla.t);
  yakinlikAyarla.t = setTimeout(() => { sakla('pano.yakinlik', yakinlik); tasmaKontrol(); }, 250);
}
function sigdir_() {
  const alan = $('agacAlani'), agac = $('agac');
  const z = Math.min(1, (alan.clientWidth - 40) / agac.offsetWidth, (alan.clientHeight - 38) / agac.offsetHeight);
  yakinlikAyarla(Math.max(YK_MIN, z));
  alan.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
}
function tasmaKontrol() { // içerik taşıyorsa bir kez "sürükleyerek gez" ipucunu göster
  const alan = $('agacAlani');
  const tasiyor = alan.scrollWidth > alan.clientWidth + 4 || alan.scrollHeight > alan.clientHeight + 4;
  if (tasiyor && !oku('pano.haritaIpucu')) {
    const ip = $('haritaIpucu'); ip.hidden = false;
    sakla('pano.haritaIpucu', '1');
    setTimeout(() => { ip.style.opacity = '0'; setTimeout(() => { ip.hidden = true; ip.style.opacity = ''; }, 300); }, 3500);
  }
}
$('ykArti').addEventListener('click', () => yakinlikAyarla(yakinlik * 1.2));
$('ykEksi').addEventListener('click', () => yakinlikAyarla(yakinlik / 1.2));
$('ykOran').addEventListener('click', () => yakinlikAyarla(1));
$('ykSigdir').addEventListener('click', sigdir_);
$('ykOran').textContent = Math.round(yakinlik * 100) + '%';

(() => {
  const alan = $('agacAlani');
  let atalet = 0;
  const ataletiDurdur = () => { cancelAnimationFrame(atalet); atalet = 0; };

  // Trackpad sıkıştırma (Chromium bunu ctrl+wheel olarak gönderir) ve ⌘/Ctrl + tekerlek.
  // Olaylar biriktirilip kare başına bir kez uygulanır.
  let bekleyenCarpan = 1, sonOdak = null, kare = 0;
  alan.addEventListener('wheel', e => {
    ataletiDurdur();
    if (!e.ctrlKey && !e.metaKey) return; // normal iki parmak kaydırması tarayıcının kendi akıcı kaydırması
    e.preventDefault();
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    bekleyenCarpan *= Math.exp(-d * 0.0045);
    sonOdak = { x: e.clientX, y: e.clientY };
    if (!kare) kare = requestAnimationFrame(() => { kare = 0; const c = bekleyenCarpan; bekleyenCarpan = 1; yakinlikAyarla(yakinlik * c, sonOdak); });
  }, { passive: false });

  // Boş alandan tutup sürükleyerek gez; bırakınca hızına göre süzülerek durur.
  let gez = null;
  alan.addEventListener('pointerdown', e => {
    ataletiDurdur();
    if (e.button !== 0 || e.target.closest('.kart')) return;
    gez = { x: e.clientX, y: e.clientY, sl: alan.scrollLeft, st: alan.scrollTop, id: e.pointerId, oynadi: false, vx: 0, vy: 0, sx: e.clientX, sy: e.clientY, st_: performance.now() };
  });
  alan.addEventListener('pointermove', e => {
    if (!gez || e.pointerId !== gez.id) return;
    const dx = e.clientX - gez.x, dy = e.clientY - gez.y;
    if (!gez.oynadi && Math.hypot(dx, dy) < 4) return;
    if (!gez.oynadi) { gez.oynadi = true; alan.setPointerCapture(e.pointerId); alan.classList.add('gezme'); if (window.ipucuGizle) ipucuGizle(); }
    alan.scrollLeft = gez.sl - dx; alan.scrollTop = gez.st - dy;
    const now = performance.now(), dt = Math.max(1, now - gez.st_);
    gez.vx = 0.8 * ((e.clientX - gez.sx) / dt) + 0.2 * gez.vx; // px/ms, yumuşatılmış
    gez.vy = 0.8 * ((e.clientY - gez.sy) / dt) + 0.2 * gez.vy;
    gez.sx = e.clientX; gez.sy = e.clientY; gez.st_ = now;
  });
  const bitir = e => {
    if (!gez || e.pointerId !== gez.id) return;
    if (alan.hasPointerCapture(e.pointerId)) alan.releasePointerCapture(e.pointerId);
    alan.classList.remove('gezme');
    let { vx, vy, oynadi, st_ } = gez; gez = null;
    if (!oynadi || performance.now() - st_ > 80) return; // durup bıraktıysa süzülme yok
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let son = performance.now();
    const adim = now => {
      const dt = Math.min(32, now - son); son = now;
      alan.scrollLeft -= vx * dt; alan.scrollTop -= vy * dt;
      const surtunme = Math.pow(0.992, dt); vx *= surtunme; vy *= surtunme;
      atalet = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(adim) : 0;
    };
    atalet = requestAnimationFrame(adim);
  };
  alan.addEventListener('pointerup', bitir);
  alan.addEventListener('pointercancel', bitir);
})();

/* ---------------- yerleşim: ayırıcı, tam ekran, gizleme ---------------- */
const AGAC_MIN = 90, TERM_MIN = 140;

function agacSinir(h) {
  const toplam = document.body.clientHeight - document.querySelector('.ust').offsetHeight;
  return Math.max(AGAC_MIN, Math.min(h, toplam - TERM_MIN));
}
function yuksekligiUygula() { document.body.style.setProperty('--agac-h', agacSinir(agacH) + 'px'); }

function modAyarla(m) {
  if (window.ipucuGizle) ipucuGizle();
  mod = m; sakla('pano.mod', m);
  document.body.classList.toggle('mod-tam', m === 'tam');
  document.body.classList.toggle('mod-gizli', m === 'gizli');
  $('altCubuk').hidden = m !== 'gizli';
  $('buyutBtn').title = m === 'tam' ? 'Küçült (⌘⇧F)' : 'Tam ekran (⌘⇧F)';
  $('buyutBtn').setAttribute('aria-label', m === 'tam' ? 'Terminali küçült' : 'Terminali tam ekran yap');
  $('buyutIkon').innerHTML = m === 'tam'
    ? '<path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4"/>'
    : '<path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/>';
  yuksekligiUygula();
  requestAnimationFrame(() => {
    sigdir(); sahneGuncelle();
    const t = terminaller.get(secili); if (t && m !== 'gizli') t.term.focus();
  });
}

(() => {
  const ay = $('ayirici');
  let basY = 0, basH = 0;
  ay.addEventListener('pointerdown', e => {
    e.preventDefault(); ay.setPointerCapture(e.pointerId);
    basY = e.clientY; basH = $('agacAlani').offsetHeight;
    ay.classList.add('suruklu'); document.body.classList.add('suruklu');
  });
  ay.addEventListener('pointermove', e => {
    if (!ay.hasPointerCapture(e.pointerId)) return;
    const ham = basH + (e.clientY - basY);
    const toplam = document.body.clientHeight - document.querySelector('.ust').offsetHeight;
    document.body.style.setProperty('--agac-h', Math.max(0, Math.min(ham, toplam - 40)) + 'px');
    sahneGuncelle();
  });
  const birak = e => {
    if (!ay.hasPointerCapture(e.pointerId)) return;
    ay.releasePointerCapture(e.pointerId);
    ay.classList.remove('suruklu'); document.body.classList.remove('suruklu');
    const ham = basH + (e.clientY - basY);
    const toplam = document.body.clientHeight - document.querySelector('.ust').offsetHeight;
    if (ham < AGAC_MIN - 40) return modAyarla('tam');          // en üste çekildi: terminal tam ekran
    if (ham > toplam - TERM_MIN + 60) return modAyarla('gizli'); // en alta çekildi: terminal gizlenir
    agacH = agacSinir(ham); sakla('pano.agacH', agacH);
    yuksekligiUygula(); sigdir();
  };
  ay.addEventListener('pointerup', birak);
  ay.addEventListener('pointercancel', birak);
  ay.addEventListener('dblclick', () => { agacH = 300; sakla('pano.agacH', agacH); yuksekligiUygula(); requestAnimationFrame(() => { sigdir(); sahneGuncelle(); }); });
  ay.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    agacH = agacSinir(agacH + (e.key === 'ArrowDown' ? 24 : -24)); sakla('pano.agacH', agacH);
    yuksekligiUygula(); requestAnimationFrame(() => { sigdir(); sahneGuncelle(); });
  });
})();

$('buyutBtn').addEventListener('click', () => modAyarla(mod === 'tam' ? 'normal' : 'tam'));
$('gizleBtn').addEventListener('click', () => modAyarla('gizli'));
$('altCubuk').addEventListener('click', () => modAyarla('normal'));
window.addEventListener('resize', () => { yuksekligiUygula(); });
modAyarla(mod);

/* ---------------- kart bilgi kutusu ---------------- */
(() => {
  const ip = $('ipucu');
  let zamanlayici = 0, hedef = null;
  const kisaYol = k => (k || '').replace(/^\/Users\/[^/]+/, '~');
  function goster(kart) {
    const a = byId(kart.dataset.id); if (!a) return;
    const eb = byId(a.ebeveynId);
    const cocukSay = ajanlar.filter(x => x.ebeveynId === a.id).length;
    ip.innerHTML = `<div class="ip-bas"><span class="nokta ${a.durum}"></span><b></b><span class="ip-durum"></span></div><div class="ip-gorev"></div><div class="ip-alt"><span class="ip-son"></span><span class="ip-klasor"></span><span class="ip-aile"></span></div>`;
    ip.querySelector('b').textContent = a.ad;
    ip.querySelector('.ip-durum').textContent = DURUM_ADI[a.durum] || a.durum;
    const g = ip.querySelector('.ip-gorev');
    if (a.gorev) g.textContent = a.gorev; else { g.textContent = 'Görev verilmedi, serbest oturum.'; g.classList.add('bos'); }
    ip.querySelector('.ip-son').textContent = 'Son: ' + (a.son || '—');
    ip.querySelector('.ip-klasor').textContent = 'Klasör: ' + kisaYol(a.klasor);
    ip.querySelector('.ip-aile').textContent = `Üst: ${eb ? eb.ad : '—'} · Alt ajan: ${cocukSay}`;
    ip.hidden = false; ip.classList.remove('acik');
    const r = kart.getBoundingClientRect(), w = ip.offsetWidth, h = ip.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.bottom + 8;
    if (y + h > window.innerHeight - 8) y = r.top - h - 8;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    ip.style.left = x + 'px'; ip.style.top = Math.max(8, y) + 'px';
    requestAnimationFrame(() => ip.classList.add('acik'));
  }
  function gizle() { clearTimeout(zamanlayici); hedef = null; ip.classList.remove('acik'); ip.hidden = true; }
  window.ipucuGizle = gizle;
  $('agac').addEventListener('pointerover', e => {
    const kart = e.target.closest('.kart'); if (!kart || kart === hedef) return;
    clearTimeout(zamanlayici); hedef = kart;
    zamanlayici = setTimeout(() => goster(kart), ip.hidden ? 350 : 60);
  });
  $('agac').addEventListener('pointerout', e => {
    const kart = e.target.closest('.kart');
    if (kart && !kart.contains(e.relatedTarget)) gizle();
  });
  $('agacAlani').addEventListener('scroll', gizle);
  $('agac').addEventListener('pointerdown', gizle);
  window.addEventListener('blur', gizle);
})();

/* ---------------- yeni ajan formu ---------------- */
const dlg = $('yeniDlg');
function sonrakiAd() {
  const adlar = new Set(ajanlar.map(a => a.ad.toUpperCase()));
  for (let i = 1; i < 100; i++) if (!adlar.has('A' + i)) return 'A' + i;
  return '';
}
function yeniAc(ebeveynId) {
  const sel = $('fEbeveyn'); sel.textContent = '';
  sel.appendChild(new Option('— yok (en üstte) —', ''));
  sirali().forEach(a => sel.appendChild(new Option(a.ad, a.id)));
  sel.value = ebeveynId || '';
  $('fAd').value = sonrakiAd();
  $('fGorev').value = '';
  $('fKlasor').value = (byId(ebeveynId) || {}).klasor || varsayilanKlasor;
  $('fHata').textContent = '';
  dlg.showModal();
  $('fAd').select();
}
$('fVazgec').addEventListener('click', () => dlg.close());
$('fKlasorSec').addEventListener('click', async () => { const k = await pano.klasorSec($('fKlasor').value); if (k) $('fKlasor').value = k; });
$('yeniForm').addEventListener('submit', async e => {
  e.preventDefault();
  const r = await pano.baslat({ ad: $('fAd').value.trim(), gorev: $('fGorev').value.trim(), klasor: $('fKlasor').value.trim(), ebeveynId: $('fEbeveyn').value || null });
  if (!r.ok) { $('fHata').textContent = r.hata; return; }
  dlg.close();
  setTimeout(() => sec(r.id), 50);
});
$('fGorev').addEventListener('keydown', e => { if (e.key === 'Enter' && e.metaKey) $('yeniForm').requestSubmit(); });

/* ---------------- Terminal'den taşı ---------------- */
(() => {
  const dlg = $('tasiDlg');
  let bulunan = [];
  const once = ms => { const d = Math.round((Date.now() - ms) / 60000); return d < 1 ? 'az önce' : d < 60 ? `${d} dk önce` : `${Math.round(d / 60)} sa önce`; };
  const kisaYol = k => (k || '').replace(/^\/Users\/[^/]+/, '~');
  function secimiGuncelle() {
    const n = $('tListe').querySelectorAll('input:checked').length;
    $('tTasi').disabled = n === 0;
    $('tTasi').textContent = n ? `${n} oturumu taşı` : 'Taşı';
    $('tTumu').checked = n > 0 && n === bulunan.length;
    $('tTumu').indeterminate = n > 0 && n < bulunan.length;
  }
  async function doldur() {
    $('tHata').textContent = '';
    $('tListe').innerHTML = '<div class="tasi-bos">Oturumlar aranıyor…</div>';
    bulunan = await pano.disOturumlar();
    const liste = $('tListe'); liste.textContent = '';
    if (!bulunan.length) { liste.innerHTML = '<div class="tasi-bos">Terminal\'de açık bir Claude oturumu bulunamadı.</div>'; secimiGuncelle(); return; }
    const adOf = pid => (bulunan.find(x => x.pid === pid) || {}).ad;
    for (const x of bulunan) {
      const l = document.createElement('label');
      l.className = 'tasi-satir' + (x.ustPid ? ' alt' : '');
      l.innerHTML = `<input type="checkbox" value="${x.pid}"><div class="ts-ust"><b></b><span class="ts-etiket ts-ustu"></span><span class="ts-etiket mesgul" hidden>şu an çalışıyor olabilir</span></div><div class="ts-ilk"></div><div class="ts-alt"><span class="k"></span><span class="z"></span><span>PID ${x.pid}</span></div>`;
      l.querySelector('b').textContent = x.ad;
      const ust = l.querySelector('.ts-ustu');
      if (x.ustPid) ust.textContent = 'üst: ' + adOf(x.ustPid); else ust.textContent = 'en üstte';
      l.querySelector('.mesgul').hidden = !x.mesgul;
      l.querySelector('.ts-ilk').textContent = x.ilk || '(henüz mesaj yok)';
      l.querySelector('.k').textContent = kisaYol(x.klasor);
      l.querySelector('.z').textContent = 'son hareket ' + once(x.sonHareket);
      l.querySelector('input').checked = !x.mesgul; // çalışanlar yarıda kalmasın diye varsayılan olarak seçili değil
      l.querySelector('input').addEventListener('change', secimiGuncelle);
      liste.appendChild(l);
    }
    secimiGuncelle();
  }
  $('tasiBtn').addEventListener('click', () => { dlg.showModal(); doldur(); });
  $('tYenile').addEventListener('click', doldur);
  $('tVazgec').addEventListener('click', () => dlg.close());
  $('tTumu').addEventListener('change', e => { $('tListe').querySelectorAll('input').forEach(i => { i.checked = e.target.checked; }); secimiGuncelle(); });
  $('tTasi').addEventListener('click', async () => {
    const pids = [...$('tListe').querySelectorAll('input:checked')].map(i => +i.value);
    const mesgul = bulunan.filter(x => pids.includes(x.pid) && x.mesgul).map(x => x.ad);
    if (mesgul.length && !$('tTasi').dataset.onay) {
      $('tHata').textContent = `${mesgul.join(', ')} şu an çalışıyor olabilir; taşırsan o anki adımı yarıda kalır. Yine de taşımak için tekrar bas.`;
      $('tTasi').dataset.onay = '1'; $('tTasi').textContent = 'Yine de taşı';
      return;
    }
    delete $('tTasi').dataset.onay;
    $('tTasi').disabled = true; $('tTasi').textContent = 'Taşınıyor…';
    const sonuc = await pano.tasi(pids);
    const hatalar = sonuc.filter(r => !r.ok);
    if (hatalar.length) {
      $('tHata').innerHTML = '';
      hatalar.forEach(h => { const p = document.createElement('div'); p.textContent = `${h.ad}: ${h.hata}`; $('tHata').appendChild(p); });
      doldur();
      return;
    }
    dlg.close();
    const ilk = sonuc.find(r => r.ok); if (ilk) setTimeout(() => sec(ilk.id), 80);
  });
})();

/* ---------------- açılış ---------------- */
function yukle() {
  pano.liste().then(r => {
    varsayilanKlasor = r.varsayilanKlasor;
    if (ajanlar.length) return;
    if (r.ajanlar.length) { ajanlar = r.ajanlar; sec(sirali()[0].id); }
    else setTimeout(yukle, 400); // yönetici henüz açılmadıysa biraz sonra tekrar bak
  });
}
yukle();
