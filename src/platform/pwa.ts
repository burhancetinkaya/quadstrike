export const registerServiceWorker = async (): Promise<void> => {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  try {
    // Registration is best-effort; the game still runs normally when offline
    // support is unavailable.
    await navigator.serviceWorker.register('/sw.js');
  } catch (error) {
    console.warn('Service worker registration failed.', error);
  }
};
