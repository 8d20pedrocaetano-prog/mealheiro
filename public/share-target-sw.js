/*
 * Android share target (ARCHITECTURE §5). Chrome POSTs a statement shared from the CGD app here; the
 * file is kept in a local cache for the Import screen, which reads and deletes it. Nothing leaves the
 * device. Loaded into the Workbox service worker with importScripts, so it runs before Workbox's routes.
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  event.respondWith(
    (async () => {
      const scope = self.registration.scope;
      try {
        const form = await event.request.formData();
        const file = form.get('file');
        if (file && typeof file !== 'string') {
          const cache = await caches.open('mealheiro-share');
          await cache.put(
            new URL('shared-file', scope).href,
            new Response(file, {
              headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'X-File-Name': encodeURIComponent(file.name || 'statement'),
              },
            }),
          );
        }
      } catch {
        /* the Import screen says nothing was received */
      }
      return Response.redirect(new URL('more/import?shared=1', scope).href, 303);
    })(),
  );
});
