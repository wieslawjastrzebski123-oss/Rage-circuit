import './style.css';
import { App } from './game/App';
import { DEBUG } from './game/constants';

// Custom crosshair follows the mouse (shown only during a race).
const crosshair = document.getElementById('crosshair')!;
window.addEventListener('mousemove', (e) => {
  crosshair.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
});

// Give the web fonts a moment so canvas-drawn labels use them.
const fontsReady = document.fonts?.ready ?? Promise.resolve();
Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]).then(() => {
  const app = new App(document.getElementById('game')!);
  if (DEBUG) (window as unknown as { __app: App }).__app = app;
});
