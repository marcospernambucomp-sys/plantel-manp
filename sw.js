const CACHE = 'plantel-manp-v4';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './data-seed.js',
  './manifest.webmanifest',
  './assets/logo-haras.jpeg',
  './assets/logo-abccmm-black.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first: always try to get the latest file from the server first,
// only falling back to the cached copy when offline. Keeps the app usable
// without internet while still picking up every update immediately when online.
self.addEventListener('fetch', (e)=>{
  if(e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res=>{
      const copy = res.clone();
      caches.open(CACHE).then(c=>c.put(e.request, copy));
      return res;
    }).catch(()=> caches.match(e.request))
  );
});
