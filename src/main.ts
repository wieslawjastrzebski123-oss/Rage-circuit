import Phaser from 'phaser';
import './style.css';
import { createGameConfig } from './game/GameConfig';

// Custom crosshair follows the mouse (shown only during a race).
const crosshair = document.getElementById('crosshair')!;
window.addEventListener('mousemove', (e) => {
  crosshair.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
});

// WebGL can't create a zero-sized canvas (e.g. a tab opened in the background),
// so wait until the window actually has a size.
function boot(): void {
  if (window.innerWidth < 2 || window.innerHeight < 2) {
    requestAnimationFrame(boot);
    return;
  }
  new Phaser.Game(createGameConfig('game'));
}
boot();
