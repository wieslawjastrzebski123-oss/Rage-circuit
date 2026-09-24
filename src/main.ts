import './style.css';
import { App } from './game/App';
import { loadAssets } from './game/render/Assets';
import { DEBUG } from './game/constants';
import { enterMobileFullscreen, IS_TOUCH } from './game/ui/device';

// Custom crosshair follows the mouse (shown only during a race).
const crosshair = document.getElementById('crosshair')!;
window.addEventListener('mousemove', (e) => {
  crosshair.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
});

// Phones: menu taps switch to fullscreen (hides the browser bars; Android only).
if (IS_TOUCH) {
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest?.('.btn')) enterMobileFullscreen();
  });
}

// Give the web fonts a moment so canvas-drawn labels use them; Blender-made textures load meanwhile.
const fontsReady = document.fonts?.ready ?? Promise.resolve();
Promise.all([Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]), loadAssets()]).then(() => {
  const app = new App(document.getElementById('game')!);
  if (DEBUG) (window as unknown as { __app: App }).__app = app;
});
