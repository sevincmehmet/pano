'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pano', {
  liste: () => ipcRenderer.invoke('liste'),
  tampon: id => ipcRenderer.invoke('tampon', id),
  baslat: o => ipcRenderer.invoke('baslat', o),
  yeniden: id => ipcRenderer.invoke('yeniden', id),
  kapat: id => ipcRenderer.invoke('kapat', id),
  kaldir: id => ipcRenderer.invoke('kaldir', id),
  klasorSec: v => ipcRenderer.invoke('klasorSec', v),
  disOturumlar: () => ipcRenderer.invoke('disOturumlar'),
  tasi: pids => ipcRenderer.invoke('tasi', pids),
  yaz: (id, veri) => ipcRenderer.send('yaz', id, veri),
  boyut: (id, c, r) => ipcRenderer.send('boyut', id, c, r),
  secildi: id => ipcRenderer.send('secildi', id),
  on: (kanal, fn) => {
    const izinli = ['veri', 'ajanlar', 'sec', 'kisayol', 'sifirla'];
    if (izinli.includes(kanal)) ipcRenderer.on(kanal, (_, ...a) => fn(...a));
  },
});
