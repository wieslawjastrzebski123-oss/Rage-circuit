import type Phaser from 'phaser';
import type { RaceScene } from './RaceScene';

/** Keeps the attract-mode race running behind the menus. */
export function ensureDemo(scene: Phaser.Scene): void {
  const race = scene.scene.get('RaceScene') as RaceScene;
  if (!scene.scene.isActive('RaceScene') || !race.isDemo) {
    scene.scene.launch('RaceScene', { demo: true });
  }
}
