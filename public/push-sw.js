/**
 * Web Push handlers — imported INTO the generated Workbox service worker
 * (vite.config.ts → workbox.importScripts). Loaded at SW startup, so these
 * top-level listeners are registered every time the browser wakes the worker,
 * including the closed-tab cold start that delivers the push.
 *
 * Message contract with the page (NotificationCenter.tsx):
 *   SW → page: { type: 'PUSH_RECEIVED', payload } when a client is visible —
 *   the page shows its in-app toast; the SW then SKIPS the system notification
 *   to avoid the user seeing the same event twice.
 */
 

self.addEventListener('push', (event) => {
  let payload = null;
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (_) {
    // Malformed payload — fall through to the generic notification below.
  }

  const title = (payload && payload.title) || '🔔 إشعار جديد من منصة أحمد الباز';
  const body = (payload && payload.message) || 'حلقة أو ملف جديد بانت لك — افتح المنصة وشوف كل جديد.';
  const data = {
    url: (payload && payload.url) || '/',
    channelUrl: (payload && payload.channelUrl) || null,
    eventId: (payload && payload.eventId) || String(Date.now()),
  };

  event.waitUntil(
    (async () => {
      // Visible, focused client? Let the page render its own toast instead of
      // stacking an OS notification on top of an open app.
      try {
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const visibleClient = clientList.find((client) => client.visibilityState === 'visible');
        if (visibleClient) {
          visibleClient.postMessage({ type: 'PUSH_RECEIVED', payload });
          return;
        }
      } catch (_) {
        // Client probe failed — show the system notification (safe default).
      }

      await self.registration.showNotification(title, {
        body,
        icon: '/logo.png',
        badge: '/logo.png',
        tag: data.eventId, // same event never stacks twice
        renotify: true,
        dir: 'rtl',
        lang: 'ar',
        requireInteraction: false,
        data,
        actions: [
          { action: 'open', title: 'افتح' },
          { action: 'close', title: 'إغلاق' },
        ],
      });
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') return;

  let target = (event.notification.data && event.notification.data.url) || '/';
  // Absolute YouTube links open as-is; site paths resolve against the origin.
  if (target.startsWith('/')) {
    target = new URL(target, self.location.origin).href;
  }

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reuse an open tab of the app instead of spawning a duplicate.
      for (const client of clientList) {
        if ('focus' in client) {
          await client.focus();
          client.postMessage({ type: 'NOTIFICATION_CLICKED', url: target });
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
