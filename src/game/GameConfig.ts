import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GarageScene } from './scenes/GarageScene';
import { RaceScene } from './scenes/RaceScene';
import { ResultsScene } from './scenes/ResultsScene';

export function createGameConfig(parent: string): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0b0c10',
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: window.innerWidth,
      height: window.innerHeight,
      // WebGL framebuffers can't be zero-sized (e.g. a hidden/minimised tab)
      min: { width: 320, height: 240 },
    },
    render: {
      antialias: true,
      powerPreference: 'high-performance',
    },
    fps: { target: 60, smoothStep: true },
    input: { mouse: { preventDefaultWheel: false } },
    scene: [BootScene, MenuScene, GarageScene, RaceScene, ResultsScene],
  };
}
