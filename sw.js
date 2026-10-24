/* alarmwake service worker: offline shell cache. Ringing happens in the page, not here. */
const CACHE = 'aw-v3';
const CORE = ['/', '/app.css', '/app.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('/')))
  );
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => { if (cs.length) return cs[0].focus(); return self.clients.openWindow('/?ring=1'); }));
});
/* Backup push: the server only says "now"; alarm details come from this device's IndexedDB. */
function idbGet(k) { return new Promise((res) => { try { const r = indexedDB.open('alarmwake', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { const t = r.result.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result); t.onerror = () => res(null); }; r.onerror = () => res(null); } catch (e) { res(null); } }); }
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const alarms = (await idbGet('alarms')) || [];
    const habits = (await idbGet('habits')) || [];
    const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const hsched = (h, dateStr) => { const [y, mo, d] = dateStr.split('-').map(Number); const dt = new Date(y, mo - 1, d); const [sy, sm, sd] = h.start.split('-').map(Number); const n = Math.round((dt - new Date(sy, sm - 1, sd)) / 86400000); if (n < 0) return false; if (h.end && dateStr > h.end) return false; const wd = dt.getDay(); switch (h.sched) { case 'daily': return true; case 'alt': return n % 2 === 0; case 'weekdays': return wd >= 1 && wd <= 5; case 'weekends': return wd === 0 || wd === 6; case 'custom': return (h.days || []).includes(wd); case 'every': return n % (h.every || 2) === 0; } return true; };
    const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
    const hdue = habits.filter(h => !h.paused && hsched(h, ymd(now)) && (h.times || []).some(t => { const [hh, mm] = t.split(':').map(Number); return Math.abs(hh * 60 + mm - nowMin) <= 2; })).map(h => ({ h: now.getHours(), m: now.getMinutes(), label: h.name + (h.why ? ' · ' + h.why : ''), on: true }));
    const due = hdue.concat(alarms.filter(a => a.on && Math.abs((a.h * 60 + a.m) - nowMin) <= 2 && (!a.days || !a.days.length || a.days.includes(now.getDay()))));
    const a = due[0];
    const h12 = a ? ((a.h % 12) || 12) + ':' + String(a.m).padStart(2, '0') + (a.h < 12 ? ' AM' : ' PM') : '';
    const title = a ? '⏰ ' + h12 + (a.label ? ' · ' + a.label : '') : '⏰ alarmwake';
    const body = a ? 'Your alarm is ringing. Open alarmwake to stop it.' : 'An alarm you set is due. Open alarmwake.';
    await self.registration.showNotification(title, { body, tag: 'aw-push', renotify: true, requireInteraction: true, icon: '/icon-192.png', badge: '/icon-192.png', vibrate: [500, 200, 500, 200, 500, 200, 500], data: { url: '/?ring=1' } });
  })());
});
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => cs.forEach(c => c.postMessage({ type: 'resubscribe' }))));
});
