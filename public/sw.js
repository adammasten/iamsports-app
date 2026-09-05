/* IamSports service worker — Web Push for the web app and the mobile browser.
 *
 * Served from the site root because Expo's static web export copies `public/`
 * verbatim into `dist/`. The scope must be "/" so a notification click can focus
 * or open any route.
 *
 * Deliberately NOT a caching/offline worker. It only handles push, so it can
 * never serve a stale bundle — offline film caching is a separate concern with
 * its own rules (see lib/native/video-cache.ts).
 */

// Take over immediately on install/update so a new push handler goes live on the
// next page load rather than waiting for every tab to close.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  // The sender always posts JSON, but never trust it: a malformed or empty
  // payload must still show something rather than throwing inside the worker
  // (a thrown push handler shows the browser's generic "site updated" notice).
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_e) {
    try {
      payload = { body: event.data ? event.data.text() : '' };
    } catch (_e2) {
      payload = {};
    }
  }

  const title = payload.title || 'IamSports';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || undefined,      // same tag replaces rather than stacks
    renotify: Boolean(payload.tag),
    data: { url: payload.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Prefer focusing a tab that's already open — opening a second copy of the
    // app is disorienting and loses in-progress work (an upload, a tagging pass).
    for (const client of all) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client && target !== '/') {
          try { await client.navigate(target); } catch (_e) { /* stay put */ }
        }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
