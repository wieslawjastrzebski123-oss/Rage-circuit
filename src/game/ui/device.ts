/**
 * Touch-device detection. Phones and tablets get on-screen controls, a landscape
 * prompt and lighter graphics defaults. `?touch=true` forces it on a desktop for testing.
 */
const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;

export const IS_TOUCH: boolean =
  typeof window !== 'undefined' &&
  (params?.get('touch') === 'true' ||
    (params?.get('touch') !== 'false' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 1)));

if (IS_TOUCH && typeof document !== 'undefined') document.body.classList.add('touch');

/** Best effort: go fullscreen and lock landscape (Android; iOS ignores it). Must run inside a tap. */
export function enterMobileFullscreen(): void {
  if (!IS_TOUCH || document.fullscreenElement) return;
  const el = document.documentElement;
  el.requestFullscreen?.({ navigationUI: 'hide' })
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => {});
}
