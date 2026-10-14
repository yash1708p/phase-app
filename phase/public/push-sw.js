/*
 * Push notifications for Phase (loaded into the service worker).
 * Each message was encrypted on this device before being uploaded, and the
 * browser decrypts it here — the Phase server never sees the text.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Phase';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.key || undefined,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        if ('focus' in w) return w.focus();
      }
      return self.clients.openWindow('/');
    })(),
  );
});
