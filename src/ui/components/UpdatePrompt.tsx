import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Service worker registration with an explicit "Reload" prompt for new versions, so an update never
 * reloads the page under the owner's fingers.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
    },
  });
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-lg lg:bottom-6"
    >
      <span className="flex-1 text-sm">A new version of Mealheiro is ready.</span>
      <button className="h-10 rounded-xl px-3 text-sm text-ink-2" onClick={() => setNeedRefresh(false)}>
        Later
      </button>
      <button
        className="h-10 rounded-xl bg-accent px-4 text-sm font-medium text-accent-ink"
        onClick={() => void updateServiceWorker(true)}
      >
        Reload
      </button>
    </div>
  );
}
