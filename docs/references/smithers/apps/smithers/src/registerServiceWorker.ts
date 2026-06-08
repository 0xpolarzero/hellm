/** sessionStorage flag that gates the one-time dev teardown reload. */
const DEV_RELOAD_FLAG = "smithers.sw.devReloaded";

/**
 * Wire up the service worker. In production it registers /sw.js for offline
 * support. In development it tears down any existing registration and caches so
 * Vite's HMR is always the source of truth, then reloads once (guarded by a
 * sessionStorage flag) if a stale worker is still controlling the page.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
        console.error("Service worker registration failed", error);
      });
    });
    return;
  }

  // Dev: a cache-first service worker would serve stale assets over Vite's HMR.
  // Tear down any existing registration and caches so the dev server is always
  // the source of truth.
  const teardown = async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      await registration.unregister();
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      for (const key of keys) {
        await caches.delete(key);
      }
    }
    // A controller means this page is still being served by an old worker. The
    // unregister above only takes effect on the next navigation, so reload once
    // to escape the stale controller. The flag prevents a reload loop.
    if (
      navigator.serviceWorker.controller &&
      !window.sessionStorage.getItem(DEV_RELOAD_FLAG)
    ) {
      window.sessionStorage.setItem(DEV_RELOAD_FLAG, "1");
      window.location.reload();
    }
  };

  void teardown();
}
