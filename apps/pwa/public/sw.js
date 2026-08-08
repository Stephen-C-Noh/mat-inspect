// Installability only. This service worker does NOT implement offline support.
//
// ADR 0025 rejects offline-first for the operator PWA: caching checklist templates or other API
// responses risks an inspection performed against a stale template, an OHS compliance issue. Do
// not add a Cache Storage read/write path here without first amending that ADR.
//
// Chrome gates the install prompt on a service worker with a fetch handler (DEV-144). This one
// exists to satisfy that criterion and nothing else: every request passes straight through to the
// network, uncached, unmodified. A network failure surfaces to the page as a normal fetch
// rejection, the same as if this file did not exist.

self.addEventListener('install', () => {
  // Activate immediately rather than waiting for all tabs of the previous version to close: there
  // is no cached content whose lifecycle needs coordinating.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Chrome internally issues requests with cache: 'only-if-cached' paired with mode other than
  // 'same-origin' (prefetch and similar); re-issuing that combination via fetch() inside a
  // service worker throws, per spec, even though the browser's own network stack handles it
  // fine outside one. Falling through here (not calling respondWith) leaves the browser's
  // default handling in place, same as if this file did not exist (DEV-144 review).
  if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') return;
  event.respondWith(fetch(event.request));
});
