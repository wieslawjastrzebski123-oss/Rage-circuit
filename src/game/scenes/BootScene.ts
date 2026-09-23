import Phaser from 'phaser';
import { generateTextures } from '../Textures';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    generateTextures(this);
    // give web fonts a moment so the first HUD frame uses them
    const go = () => this.scene.start('MenuScene');
    if (document.fonts?.ready) {
      Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]).then(go);
    } else go();
  }
}
