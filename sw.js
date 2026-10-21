/* ScopeTracker Pro — Service Worker */
'use strict';

const VERSION = 'scopetracker-pro-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './offline.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './favicon.svg'
];
const OPTIONAL_ASSETS = [
  './favicon.ico',
  './apple-touch-icon.png',
  './icons/favicon-16x16.png',
  './icons/favicon-32x32.png',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(CORE_ASSETS);
    // Icons are generated separately; a missing icon must never break installation.
    await Promise.all(OPTIONAL_ASSETS.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res && res.ok) await cache.put(url, res);
      } catch (err) { /* icon not present yet */ }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION && k.startsWith('scopetracker-pro-')).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (err) { /* unsupported */ }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation: network-first, fall back to cached shell, then offline.html
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = event.preloadResponse ? await event.preloadResponse : null;
        const fresh = preload || await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch (err) {
        const cache = await caches.open(VERSION);
        return (await cache.match(req, { ignoreSearch: true }))
          || (await cache.match('./index.html'))
          || (await cache.match('./offline.html'))
          || Response.error();
      }
    })());
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    const res = await network;
    return res || new Response('', { status: 504, statusText: 'Offline' });
  })());
});

self.addEventListener('push', (event) => {
  let data = { title: 'ScopeTracker Pro', body: 'You have a new project alert.', url: './index.html' };
  try { if (event.data) data = Object.assign(data, event.data.json()); }
  catch (err) { if (event.data) data.body = event.data.text(); }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-96.png',
    tag: data.tag || 'scopetracker-alert',
    data: { url: data.url }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './index.html';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { await c.focus(); if ('navigate' in c) { try { await c.navigate(target); } catch (e) { /* ignore */ } } return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
