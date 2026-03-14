export const isLandscape = (): boolean => window.innerWidth >= window.innerHeight;

export const observeLandscape = (onChange: (landscape: boolean) => void): (() => void) => {
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
