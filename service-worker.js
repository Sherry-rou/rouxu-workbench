/* ==========================================================================
   柔序工作台 — Service Worker（离线缓存）
   策略：页面导航「网络优先，离线回退缓存」；静态资源「缓存优先」。
   ========================================================================== */

const CACHE_NAME = 'rouxu-workbench-v24';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/logo.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/maskable-512.png',
  './icons/modules/module-checkin.png',
  './icons/modules/module-accounting.png',
  './icons/modules/module-eatwell.png',
  './icons/modules/module-wheel.png',
  './icons/modules/module-countdown.png',
  './icons/modules/module-diet.png',
  './icons/modules/module-period.png',
  './icons/modules/module-wishlist.png',
  './icons/modules/module-focus.png',
  './icons/modules/module-settings.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(ASSETS);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) {
            return key !== CACHE_NAME;
          })
          .map(function (key) {
            return caches.delete(key);
          })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') {
    return;
  }

  // 页面导航：网络优先，离线时回退到缓存的首页
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(function (response) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put('./index.html', clone);
          });
          return response;
        })
        .catch(function () {
          return caches.match('./index.html');
        })
    );
    return;
  }

  // 静态资源：缓存优先，未命中再走网络并缓存
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) {
        return cached;
      }

      return fetch(event.request)
        .then(function (response) {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(function () {
          return new Response('', { status: 503, statusText: 'Offline' });
        });
    })
  );
});
