// sw.js — offline-first app shell. A crisis app must work with zero signal,
// but users must still receive updates: stale-while-revalidate serves the
// cached copy instantly and refreshes it in the background for next time.

const CACHE = 'override-v11';
const ASSETS = [
  '.',
  'index.html',
  'css/style.css',
  'js/main.js',
  'js/ui.js',
  'js/store.js',
  'js/audio.js',
  'js/haptics.js',
  'js/speech.js',
  'js/brain.js',
  'js/game.js',
  'js/defib.js',
  'js/retrace.js',
  'js/stepper.js',
  'js/dump.js',
  'js/ai.js',
  'js/mind.js',
  'js/copilot.js',
  'js/notes.js',
  'js/file.js',
  'js/sleep.js',
  'js/reads.js',
  'js/live.js',
  'js/voice.js',
  'js/gcal.js',
  'js/urge.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' bypasses the HTTP cache so a new SW never precaches stale files
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      const refresh = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            const put = caches.open(CACHE).then(c => c.put(e.request, clone));
            try { e.waitUntil(put); } catch { put.catch(() => {}); }
          }
          return res;
        })
        .catch(() => cached || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined));
      // serve instantly from cache, refresh in the background
      return cached ? (e.waitUntil(refresh.catch(() => {})), cached) : refresh;
    })
  );
});
