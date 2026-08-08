'use client';

import { useEffect } from 'react';

// Registers /public/sw.js, an installability-only service worker (DEV-144, ADR 0025: no offline
// caching). Client-side effect, not the metadata API's `other` field, because
// navigator.serviceWorker only exists in the browser.
export const ServiceWorkerRegister = (): null => {
  useEffect(() => {
    // npm run dev is a secure context too (localhost), so without this gate the worker installs
    // during local development, intercepts HMR's EventSource and Next's own asset requests, and
    // outlives the dev session: it stays registered against localhost:3000 for whatever project
    // next uses that port after this one (DEV-144 review).
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installability degrades gracefully without a service worker (iOS Add to Home Screen does
      // not require one at all); nothing here blocks the app from working as a normal web page.
    });
  }, []);

  return null;
};
