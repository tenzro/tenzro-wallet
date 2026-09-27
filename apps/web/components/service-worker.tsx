'use client';

import * as React from 'react';

/** Registers the service worker in production builds. */
export function ServiceWorker() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Without it the wallet still works; it just will not open offline.
    });
  }, []);
  return null;
}
