/* 서비스 워커: 아래 목록의 "앱 화면 파일"만 캐시합니다.
   사용자 자료(IndexedDB, 가져온 JSON·CSV, 백업 파일)는 캐시에 넣지 않으며, 목록에 없는 요청은 건드리지 않습니다. */
const CACHE = 'mw-shell-v7';
const FILES = ['./', 'index.html', 'offline.html', 'css/style.css', 'css/components.css', 'css/responsive.css',
  'js/db.js', 'js/security.js', 'js/importer.js', 'js/search.js', 'js/archive.js', 'js/tasks.js', 'js/editor.js', 'js/docs.js', 'js/routine.js', 'js/sync.js', 'js/calendar.js', 'js/pdb.js', 'js/personal.js', 'js/gsync.js', 'js/gsync-ui.js', 'sync.html', 'js/app.js',
  'demo-data/demo-data.js', 'manifest.webmanifest', 'assets/icon-192.png', 'assets/icon-512.png'];
const SHELL = new Set(FILES.map(f => new URL(f, self.registration.scope).href));
const key = req => { const u = new URL(req.url); u.search = ''; u.hash = ''; return u.href; };
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !SHELL.has(key(req))) return;           // 앱 화면 파일이 아니면 캐시하지도, 가로채지도 않음
  e.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(key(req), copy)); } return r; })
    .catch(() => caches.match(key(req)).then(r => r || (req.mode === 'navigate' ? caches.match(new URL('offline.html', self.registration.scope).href) : Response.error()))));
});
