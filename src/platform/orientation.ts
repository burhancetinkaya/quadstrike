export const isLandscape = (): boolean => window.innerWidth >= window.innerHeight;

export const observeLandscape = (onChange: (landscape: boolean) => void): (() => void) => {
  // Resize and orientation events do not fire consistently across all mobile
  // browsers, so we subscribe to both and funnel them through one callback.
  const handler = (): void => {
    onChange(isLandscape());
  };

  window.addEventListener('resize', handler);
  window.addEventListener('orientationchange', handler);
  handler();

  return () => {
    window.removeEventListener('resize', handler);
    window.removeEventListener('orientationchange', handler);
  };
};
