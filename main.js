// Pano: Claude ajanlarını tek pencereden yöneten Electron uygulaması.
'use strict';
const { app, BrowserWindow, ipcMain, Menu, Notification, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const pty = require('node-pty');

const EV = os.homedir();
const PANO_DIR = path.join(EV, '.claude', 'pano');          // CLI ve hook betiği buraya kopyalanır
const KAYNAK = __dirname.replace('app.asar', 'app.asar.unpacked');
const JETON = crypto.randomBytes(16).toString('hex');
const TAMPON_SINIRI = 400 * 1024;
const VARSAYILAN_KLASOR = [process.env.PANO_KLASOR, EV].find(p => p && fs.existsSync(p)); // yeni ajanların varsayılan klasörü

let win = null;
let PORT = 0;
let sayac = 0;
const ajanlar = new Map(); // id -> ajan

/* ---------------- yardımcılar ---------------- */
function kur() {
  // CLI ve hook betiğini sabit bir yere kopyala: paketlenmiş uygulamada da yol değişmesin.
  fs.mkdirSync(path.join(PANO_DIR, 'bin'), { recursive: true });
  for (const [kaynak, hedef] of [['bin/pano', 'bin/pano'], ['hooks/durum.sh', 'durum.sh']]) {
    const h = path.join(PANO_DIR, hedef);
    fs.copyFileSync(path.join(KAYNAK, kaynak), h);
    fs.chmodSync(h, 0o755);
  }
}

// Pano bir Claude oturumundan başlatılırsa o oturumun işaretleri ajanlara geçmesin (yoksa konuşma kaydı kapanır).
function temizOrtam() {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k.startsWith('PANO_')) delete e[k];
  return e;
}

const tirnak = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

function sistemNotu(ad) {
  return [
    `Bu oturum Pano uygulamasında "${ad}" adlı ajan olarak çalışıyor.`,
    'İşi ayrı bir Claude penceresine (alt ajana) devretmek istersen Bash ile şunu çalıştır:',
    '  pano yeni <AD> "<görev metni>" [--klasor <yol>]',
    'Alt ajan senin altında, ayrı bir terminalde açılır ve kullanıcı onu Pano\'da görür.',
    'Diğer komutlar: "pano liste" (ajanları ve durumlarını gösterir), "pano gonder <AD> \\"<mesaj>\\"" (bir ajana mesaj yazar).',
  ].join('\n');
}

function ozet(a) {
  return {
    id: a.id, ad: a.ad, gorev: a.gorev, ebeveynId: a.ebeveynId, klasor: a.klasor,
    durum: a.durum, son: a.son, oturum: a.oturum, acildi: a.acildi,
  };
}
function yayinla() {
  if (win && !win.isDestroyed()) win.webContents.send('ajanlar', [...ajanlar.values()].map(ozet));
  const bekleyen = [...ajanlar.values()].filter(a => a.durum === 'bekliyor').length;
  if (app.dock) app.dock.setBadge(bekleyen ? String(bekleyen) : '');
}
function adBul(ad) {
  return [...ajanlar.values()].find(a => a.ad.toLowerCase() === String(ad).toLowerCase() && a.durum !== 'kapali');
}

/* ---------------- ajan başlatma ---------------- */
function baslat({ ad, gorev = '', klasor, ebeveynId = null, devam = null, id = null }) {
  ad = String(ad || '').trim();
  if (!ad) throw new Error('Ajanın bir adı olmalı.');
  if (adBul(ad)) throw new Error(`"${ad}" adlı açık bir ajan zaten var.`);
  klasor = klasor && fs.existsSync(klasor) ? klasor : (ajanlar.get(ebeveynId)?.klasor || VARSAYILAN_KLASOR);
  id = id || 'a' + (++sayac);

  let komut = `export PATH=${tirnak(path.join(PANO_DIR, 'bin'))}:"$PATH"; exec claude --append-system-prompt ${tirnak(sistemNotu(ad))}`;
  if (devam) komut += ` --resume ${tirnak(devam)}`;
  else if (gorev) komut += ` ${tirnak(gorev)}`;

  const p = pty.spawn('/bin/zsh', ['-lic', komut], {
    name: 'xterm-256color', cols: 120, rows: 36, cwd: klasor,
    env: {
      ...temizOrtam(), TERM: 'xterm-256color', COLORTERM: 'truecolor',
      PANO_AGENT_ID: id, PANO_AJAN_ADI: ad, PANO_PORT: String(PORT), PANO_JETON: JETON,
    },
  });
  const a = { id, ad, gorev, klasor, ebeveynId, pty: p, durum: devam ? 'bitti' : gorev ? 'calisiyor' : 'bitti', son: devam ? '↺ kaldığı yerden açıldı' : gorev ? 'görev verildi' : 'hazır, komut bekliyor', oturum: devam, tampon: '', acildi: Date.now() };
  ajanlar.set(id, a);

  p.onData(veri => {
    a.tampon += veri;
    if (a.tampon.length > TAMPON_SINIRI) a.tampon = a.tampon.slice(-TAMPON_SINIRI * 0.75);
    if (win && !win.isDestroyed()) win.webContents.send('veri', id, veri);
  });
  p.onExit(({ exitCode }) => {
    if (a.pty !== p) return;
    a.durum = 'kapali'; a.son = `süreç kapandı (kod ${exitCode})`; a.pty = null;
    const not = `\r\n\x1b[90m[Pano] ${ad} kapandı. Üstteki "Yeniden başlat" ile devam ettirebilirsin.\x1b[0m\r\n`;
    a.tampon += not;
    if (win && !win.isDestroyed()) win.webContents.send('veri', id, not);
    yayinla();
  });
  yayinla();
  return a;
}

function yenidenBaslat(id) {
  const a = ajanlar.get(id); if (!a) return;
  if (a.pty) { const eski = a.pty; a.pty = null; try { eski.kill(); } catch (_) {} }
  ajanlar.delete(id);
  if (win && !win.isDestroyed()) win.webContents.send('sifirla', id);
  // Aynı kimlikle yeniden aç ki soy ağacındaki oklar bozulmasın. Oturum biliniyorsa kaldığı yerden devam eder.
  return baslat({ ad: a.ad, gorev: a.oturum ? '' : a.gorev, klasor: a.klasor, ebeveynId: a.ebeveynId, devam: a.oturum, id });
}

function kaldir(id) {
  const a = ajanlar.get(id); if (!a) return;
  if (a.pty) { try { a.pty.kill(); } catch (_) {} }
  for (const c of ajanlar.values()) if (c.ebeveynId === id) c.ebeveynId = a.ebeveynId;
  ajanlar.delete(id);
  yayinla();
}

function mesajGonder(a, mesaj) {
  if (!a.pty) throw new Error(`${a.ad} kapalı.`);
  a.pty.write(mesaj);
  setTimeout(() => a.pty && a.pty.write('\r'), 200);
}

/* ---------------- Terminal'deki oturumları bulma ve taşıma ---------------- */
const OTURUMLAR = path.join(EV, '.claude', 'sessions');
const PROJELER = path.join(EV, '.claude', 'projects');
const yasiyor = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function konusmaDosyasi(oturum) {
  try {
    for (const d of fs.readdirSync(PROJELER)) {
      const f = path.join(PROJELER, d, oturum + '.jsonl');
      if (fs.existsSync(f)) return f;
    }
  } catch (_) {}
  return null;
}
function ilkMesaj(dosya) {
  try {
    const fd = fs.openSync(dosya, 'r'); const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
    for (const satir of buf.toString('utf8', 0, n).split('\n')) {
      let o; try { o = JSON.parse(satir); } catch (_) { continue; }
      if (o.type !== 'user') continue;
      let c = o.message && o.message.content;
      if (Array.isArray(c)) c = c.map(x => (x && x.text) || '').join(' ');
      if (typeof c === 'string' && c.trim() && !c.startsWith('<')) return c.trim();
    }
  } catch (_) {}
  return '';
}

function disOturumlar() {
  const bizim = new Set([...ajanlar.values()].filter(a => a.pty).map(a => a.pty.pid));
  const liste = [];
  let dosyalar = [];
  try { dosyalar = fs.readdirSync(OTURUMLAR).filter(f => /^\d+\.json$/.test(f)); } catch (_) {}
  for (const f of dosyalar) {
    let o; try { o = JSON.parse(fs.readFileSync(path.join(OTURUMLAR, f), 'utf8')); } catch (_) { continue; }
    if (!o.pid || !o.sessionId || o.kind !== 'interactive' || bizim.has(o.pid) || !yasiyor(o.pid)) continue;
    if ([...ajanlar.values()].some(a => a.oturum === o.sessionId)) continue;
    const dosya = konusmaDosyasi(o.sessionId);
    const ilk = dosya ? ilkMesaj(dosya) : '';
    let sonHareket = o.startedAt || 0;
    try { if (dosya) sonHareket = fs.statSync(dosya).mtimeMs; } catch (_) {}
    const pencere = /Sen\s+(\S+?)\s+pencere/i.exec(ilk);
    liste.push({
      pid: o.pid, oturum: o.sessionId, klasor: o.cwd, ilk: kisalt(ilk, 220), sonHareket,
      konusmaVar: !!dosya,
      pencereAdi: pencere ? pencere[1].replace(/[^\p{L}\p{N}_-]/gu, '') : null,
    });
  }
  // Pencere olmayanlar yönetici adayıdır; aynı klasördeki en eski olan pencerelerin üstü sayılır.
  const yoneticiler = liste.filter(x => !x.pencereAdi);
  for (const x of liste) {
    if (x.pencereAdi) {
      x.ad = x.pencereAdi;
      const y = yoneticiler.filter(m => m.klasor === x.klasor).sort((a, b) => a.pid - b.pid)[0];
      x.ustPid = y ? y.pid : null;
    } else {
      x.ad = yoneticiler.filter(m => m.klasor === x.klasor).length > 1 ? `Yönetici-${x.pid}` : (x.klasor === VARSAYILAN_KLASOR ? 'Yönetici' : path.basename(x.klasor));
      x.ustPid = null;
    }
    x.mesgul = Date.now() - x.sonHareket < 15000; // son 15 sn içinde yazmışsa muhtemelen çalışıyor
  }
  return liste.sort((a, b) => (a.ustPid === null ? 0 : 1) - (b.ustPid === null ? 0 : 1) || a.pid - b.pid);
}

const bekle = ms => new Promise(r => setTimeout(r, ms));
async function oturumuKapat(pid) {
  try { process.kill(pid, 'SIGINT'); } catch (_) {}   // Claude'u nazikçe durdur
  await bekle(300);
  try { process.kill(pid, 'SIGTERM'); } catch (_) {}
  for (let i = 0; i < 50 && yasiyor(pid); i++) await bekle(100);
  if (yasiyor(pid)) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} await bekle(300); }
  return !yasiyor(pid);
}

async function tasi(secilenler) {
  const bulunan = new Map(disOturumlar().map(x => [x.pid, x]));
  const pidToId = new Map(), sonuc = [];
  // Önce üstler, sonra pencereler taşınsın ki oklar doğru kurulsun
  const sirali = secilenler.map(p => bulunan.get(p)).filter(Boolean).sort((a, b) => (a.ustPid === null ? 0 : 1) - (b.ustPid === null ? 0 : 1));
  for (const x of sirali) {
    let ad = x.ad;
    // Pano'nun açılışta açtığı boş Yönetici hiç kullanılmadıysa, Terminal'deki yönetici onun yerine geçer
    if (!x.ustPid && ad === 'Yönetici') {
      const bos = [...ajanlar.values()].find(a => a.ad === 'Yönetici' && !a.gorev && !a.oturum && ![...ajanlar.values()].some(c => c.ebeveynId === a.id));
      if (bos) kaldir(bos.id);
    }
    while (adBul(ad)) ad = ad + "'";
    const kapandi = await oturumuKapat(x.pid);
    if (!kapandi) { sonuc.push({ ad, ok: false, hata: 'Terminal\'deki süreç kapanmadı.' }); continue; }
    try {
      const ebeveynId = x.ustPid ? pidToId.get(x.ustPid) || null : null;
      const a = baslat({ ad, gorev: x.konusmaVar ? x.ilk : '', klasor: x.klasor, ebeveynId, devam: x.konusmaVar ? x.oturum : null });
      if (x.konusmaVar) a.oturum = x.oturum;
      pidToId.set(x.pid, a.id);
      sonuc.push({ ad, ok: true, id: a.id });
    } catch (e) { sonuc.push({ ad, ok: false, hata: e.message }); }
  }
  return sonuc;
}

/* ---------------- hook olayları ---------------- */
function kisalt(s, n = 90) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function aracOzeti(ad, girdi = {}) {
  const hedef = girdi.file_path ? path.basename(girdi.file_path) : girdi.command || girdi.description || girdi.pattern || girdi.url || '';
  return `⏺ ${ad}${hedef ? ' · ' + kisalt(hedef, 70) : ''}`;
}

function olay(id, govde) {
  const a = ajanlar.get(id); if (!a) return;
  let o = {}; try { o = JSON.parse(govde); } catch (_) { return; }
  if (o.session_id) a.oturum = o.session_id;
  const onceki = a.durum;
  switch (o.hook_event_name) {
    case 'UserPromptSubmit': a.durum = 'calisiyor'; a.son = '› ' + kisalt(o.prompt); break;
    case 'PreToolUse': a.durum = 'calisiyor'; a.son = aracOzeti(o.tool_name, o.tool_input); break;
    case 'PostToolUseFailure': a.durum = 'hata'; a.son = `✗ ${o.tool_name || 'araç'} hata verdi`; break;
    case 'Notification':
      if (/permission|izin|approve|onay/i.test(o.message || '')) { a.durum = 'bekliyor'; a.son = '? ' + kisalt(o.message); }
      else if (a.durum !== 'bitti') { a.durum = 'bekliyor'; a.son = '? ' + kisalt(o.message || 'yanıt bekliyor'); }
      break;
    case 'Stop': a.durum = 'bitti'; a.son = '✓ sıra sende'; break;
    default: return;
  }
  if (a.durum === 'bekliyor' && onceki !== 'bekliyor') bildir(a, `${a.ad} seni bekliyor`, a.son.replace(/^\? /, ''));
  if (a.durum === 'bitti' && onceki !== 'bitti' && !odakta(a)) bildir(a, `${a.ad} işini bitirdi`, kisalt(a.gorev || 'Sıra sende', 120));
  yayinla();
}

let seciliId = null;
const odakta = a => win && win.isFocused() && seciliId === a.id;
function bildir(a, baslik, govde) {
  if (odakta(a) || !Notification.isSupported()) return;
  const n = new Notification({ title: baslik, body: govde, silent: true });
  n.on('click', () => { if (win) { win.show(); win.focus(); win.webContents.send('sec', a.id); } });
  n.show();
}

/* ---------------- yerel komut sunucusu ---------------- */
function sunucu() {
  return new Promise(res => {
    const s = http.createServer((req, rsp) => {
      const cevap = (kod, veri) => { rsp.writeHead(kod, { 'Content-Type': 'text/plain; charset=utf-8' }); rsp.end(typeof veri === 'string' ? veri : JSON.stringify(veri, null, 2)); };
      if (req.headers['x-pano-jeton'] !== JETON) return cevap(403, 'Jeton geçersiz.');
      let govde = '';
      req.on('data', d => { govde += d; if (govde.length > 1e6) req.destroy(); });
      req.on('end', () => {
        const kimden = req.headers['x-pano-ajan'] || null;
        const f = Object.fromEntries(new URLSearchParams(govde));
        try {
          if (req.method === 'POST' && req.url === '/olay') { olay(kimden, govde); return cevap(200, 'ok'); }
          if (req.method === 'POST' && req.url === '/ajan') {
            const a = baslat({ ad: f.ad, gorev: f.gorev, klasor: f.klasor, ebeveynId: ajanlar.has(kimden) ? kimden : null });
            return cevap(200, `${a.ad} açıldı (${a.klasor}). Kullanıcı onu Pano'da görebilir.`);
          }
          if (req.method === 'POST' && req.url === '/gonder') {
            const a = adBul(f.ad); if (!a) return cevap(404, `"${f.ad}" adlı açık ajan yok.`);
            mesajGonder(a, f.mesaj || ''); return cevap(200, `${a.ad} ajanına gönderildi.`);
          }
          if (req.method === 'GET' && req.url === '/ajanlar') {
            const satirlar = [...ajanlar.values()].map(a => {
              const eb = ajanlar.get(a.ebeveynId);
              return `${a.ad.padEnd(12)} ${a.durum.padEnd(10)} üst: ${eb ? eb.ad : '-'}  ${kisalt(a.son, 60)}`;
            });
            return cevap(200, satirlar.join('\n') || 'Ajan yok.');
          }
          if (req.method === 'POST' && req.url === '/ekran') { // test için: pencerenin görüntüsünü kaydet
            win.webContents.capturePage().then(img => { fs.writeFileSync(f.yol, img.toPNG()); cevap(200, f.yol); });
            return;
          }
          cevap(404, 'Bilinmeyen komut.');
        } catch (e) { cevap(400, e.message); }
      });
    });
    s.listen(0, '127.0.0.1', () => res(s.address().port));
  });
}

/* ---------------- pencere ve menü ---------------- */
function menu() {
  const gonder = (...a) => () => win && win.webContents.send(...a);
  const sablon = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'Ajanlar',
      submenu: [
        { label: 'Yeni ajan…', accelerator: 'CmdOrCtrl+N', click: gonder('kisayol', 'yeni') },
        { type: 'separator' },
        { label: 'Terminali göster / gizle', accelerator: 'CmdOrCtrl+J', click: gonder('kisayol', 'gizle') },
        { label: 'Terminali tam ekran yap / küçült', accelerator: 'CmdOrCtrl+Shift+F', click: gonder('kisayol', 'tam') },
        { type: 'separator' },
        { label: 'Üst ajana çık', accelerator: 'CmdOrCtrl+Up', click: gonder('kisayol', 'ust') },
        { label: 'Alt ajana in', accelerator: 'CmdOrCtrl+Down', click: gonder('kisayol', 'alt') },
        { label: 'Önceki kardeş', accelerator: 'CmdOrCtrl+Left', click: gonder('kisayol', 'sol') },
        { label: 'Sonraki kardeş', accelerator: 'CmdOrCtrl+Right', click: gonder('kisayol', 'sag') },
        { type: 'separator' },
        ...Array.from({ length: 9 }, (_, i) => ({ label: `${i + 1}. ajan`, accelerator: `CmdOrCtrl+${i + 1}`, click: gonder('kisayol', 'no', i) })),
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(sablon));
}

function pencere() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 760, minHeight: 520,
    backgroundColor: '#0c1017', titleBarStyle: 'hiddenInset', title: 'Pano',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('focus', () => yayinla());
  win.webContents.on('console-message', (e) => { const m = e.message ?? e; if (e.level === 'error' || e.level === 3 || /error/i.test(String(m))) console.error('[arayüz]', m, e.sourceId || '', e.lineNumber || ''); });
  win.webContents.on('preload-error', (_, yol, hata) => console.error('[preload]', yol, hata));
}

ipcMain.handle('liste', () => ({ ajanlar: [...ajanlar.values()].map(ozet), varsayilanKlasor: VARSAYILAN_KLASOR }));
ipcMain.handle('tampon', (_, id) => ajanlar.get(id)?.tampon || '');
ipcMain.handle('baslat', (_, o) => { try { return { ok: true, id: baslat(o).id }; } catch (e) { return { ok: false, hata: e.message }; } });
ipcMain.handle('yeniden', (_, id) => { yenidenBaslat(id); return true; });
ipcMain.handle('kapat', (_, id) => { const a = ajanlar.get(id); if (a?.pty) a.pty.kill(); return true; });
ipcMain.handle('kaldir', (_, id) => { kaldir(id); return true; });
ipcMain.handle('disOturumlar', () => disOturumlar());
ipcMain.handle('tasi', (_, pids) => tasi(pids));
ipcMain.handle('klasorSec', async (_, varsayilan) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: varsayilan || VARSAYILAN_KLASOR });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.on('yaz', (_, id, veri) => { const a = ajanlar.get(id); if (a?.pty) a.pty.write(veri); });
ipcMain.on('boyut', (_, id, cols, rows) => { const a = ajanlar.get(id); if (a?.pty && cols > 0 && rows > 0) { try { a.pty.resize(cols, rows); } catch (_) {} } });
ipcMain.on('secildi', (_, id) => { seciliId = id; });

app.whenReady().then(async () => {
  kur();
  PORT = await sunucu();
  menu();
  pencere();
  win.webContents.once('did-finish-load', () => {
    if (ajanlar.size === 0) baslat({ ad: 'Yönetici', klasor: VARSAYILAN_KLASOR });
  });
});

let cikisOnaylandi = false;
app.on('before-quit', e => {
  const acik = [...ajanlar.values()].filter(a => a.pty);
  if (cikisOnaylandi || acik.length === 0) return;
  const r = dialog.showMessageBoxSync(win, {
    type: 'warning', buttons: ['Hepsini kapat ve çık', 'Vazgeç'], defaultId: 1, cancelId: 1,
    message: `${acik.length} ajan hâlâ açık.`,
    detail: 'Çıkarsan hepsi kapanır. Konuşmalar kaybolmaz; Claude\'da /resume ile geri açabilirsin.',
  });
  if (r !== 0) { e.preventDefault(); return; }
  cikisOnaylandi = true;
  for (const a of acik) { try { a.pty.kill(); } catch (_) {} }
});
app.on('window-all-closed', () => app.quit());
// Pano nasıl kapanırsa kapansın (⌘Q, zorla kapatma, sistem kapanışı) içindeki ajanlar sahipsiz kalmasın
function hepsiniKapat() { for (const a of ajanlar.values()) if (a.pty) { try { a.pty.kill(); } catch (_) {} } }
app.on('will-quit', hepsiniKapat);
for (const sinyal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sinyal, () => { cikisOnaylandi = true; hepsiniKapat(); app.exit(0); });
