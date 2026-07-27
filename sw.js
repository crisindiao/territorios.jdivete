// ── SERVICE WORKER — Território Jardim Ivete ──
// 1) Cacheia o "app shell" (index.html, manifest, ícones) pra abrir offline.
// 2) Cacheia de verdade os tiles do mapa (OSM, satélite Esri/Google, labels CartoDB)
//    com estratégia cache-first, pra funcionar em saída de campo sem internet.
// 3) Deixa passar direto (sem cache) qualquer request do Firebase/Firestore,
//    Cloudinary, OpenCage e /api/* — esses precisam sempre de dados frescos.
// 4) Mostra notificações locais disparadas pelo próprio app (reg.showNotification).
//    Push de verdade, vindo do servidor mesmo com o app fechado, exigiria configurar
//    chaves VAPID + um endpoint que envie os pushes — não incluído aqui.

const VERSION = 'v1';
const SHELL_CACHE = `territorio-shell-${VERSION}`;
const TILE_CACHE = `territorio-tiles-${VERSION}`;
const CDN_CACHE = `territorio-cdn-${VERSION}`;
const MAX_TILES = 4000; // limite de tiles guardados (evita estourar o storage do navegador)

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-180.png',
  './favicon.ico',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => Promise.all(SHELL_FILES.map((f) => cache.add(f).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => ![SHELL_CACHE, TILE_CACHE, CDN_CACHE].includes(k))
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isTileRequest(url) {
  return (
    /(^|\.)tile\.openstreetmap\.org\//.test(url) ||
    /server\.arcgisonline\.com\/.*\/tile\//.test(url) ||
    /basemaps\.cartocdn\.com\/.*rastertiles/.test(url) ||
    /\.google\.com\/vt\?/.test(url)
  );
}
function isCdnRequest(url) {
  return /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url);
}
function isDynamicRequest(url) {
  return (
    /firestore\.googleapis\.com|firebaseapp\.com|identitytoolkit\.googleapis\.com|firebaseinstallations/.test(url) ||
    /opencagedata\.com/.test(url) ||
    /cloudinary\.com/.test(url) ||
    /\/api\//.test(url)
  );
}

// Remove as entradas mais antigas quando o cache de tiles passa do limite.
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxItems) return;
  const excesso = keys.length - maxItems;
  for (let i = 0; i < excesso; i++) {
    await cache.delete(keys[i]);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = req.url;

  // Dados dinâmicos (Firestore, geocoding, upload, funções serverless): sempre rede, sem cache.
  if (isDynamicRequest(url)) return;

  // Tiles do mapa: cache-first — se já baixou uma vez, funciona sem internet depois.
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const resp = await fetch(req);
          if (resp && resp.status === 200) {
            cache.put(req, resp.clone());
            trimCache(TILE_CACHE, MAX_TILES);
          }
          return resp;
        } catch (e) {
          return cached || new Response('', { status: 504, statusText: 'Offline e tile não cacheado ainda' });
        }
      })
    );
    return;
  }

  // Bibliotecas de CDN (Leaflet, html2canvas, QRCode, fontes): stale-while-revalidate.
  if (isCdnRequest(url)) {
    event.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const networkFetch = fetch(req)
          .then((resp) => { if (resp && resp.status === 200) cache.put(req, resp.clone()); return resp; })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // Navegação / app shell: tenta rede primeiro (pra sempre ver a versão mais nova
  // quando está online), cai pro cache quando estiver offline.
  if (req.mode === 'navigate' || SHELL_FILES.some((f) => url.endsWith(f.replace('./', '')))) {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200) {
            caches.open(SHELL_CACHE).then((c) => c.put(req, resp.clone()));
          }
          return resp;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
  }
});

// ── Notificações ──
// Mensagens vindas da própria página (ex.: skip waiting após atualização).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Clique na notificação: foca a aba já aberta ou abre uma nova.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const aberta = clientsArr.find((c) => 'focus' in c);
      if (aberta) return aberta.focus();
      return self.clients.openWindow('./');
    })
  );
});

// Push de verdade (só funciona se um backend enviar com chaves VAPID configuradas).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'Território Jardim Ivete';
  const options = {
    body: data.body || '',
    icon: './icon-180.png',
    badge: './icon-180.png',
    tag: data.tag || 'territorio-push',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
