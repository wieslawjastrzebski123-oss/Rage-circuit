import Phaser from 'phaser';
import type { Controls } from '../entities/Car';

type Key = Phaser.Input.Keyboard.Key;

/**
 * Keyboard + mouse → car controls.
 * WASD / arrows drive, SHIFT drifts, E boosts, mouse aims,
 * LMB primary, RMB (or Q) secondary, SPACE ability, R reset.
 */
export class InputManager {
  private scene: Phaser.Scene;
  private keys: Record<string, Key>;
  private onContextMenu = (e: Event) => e.preventDefault();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    const kb = scene.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = kb.addKeys({
      w: K.W,
      a: K.A,
      s: K.S,
      d: K.D,
      up: K.UP,
      down: K.DOWN,
      left: K.LEFT,
      right: K.RIGHT,
      shift: K.SHIFT,
      space: K.SPACE,
      e: K.E,
      q: K.Q,
      r: K.R,
    }) as Record<string, Key>;
    scene.input.mouse?.disableContextMenu();
    document.addEventListener('contextmenu', this.onContextMenu);
  }

  /** Mouse position in world space – recomputed every frame because the camera moves. */
  aimWorld(): { x: number; y: number } {
    const p = this.scene.input.activePointer;
    const cam = this.scene.cameras.main;
    const wp = cam.getWorldPoint(p.x, p.y);
    return { x: wp.x, y: wp.y };
  }

  read(out: Controls): void {
    const k = this.keys;
    const p = this.scene.input.activePointer;
    const up = k.w.isDown || k.up.isDown;
    const down = k.s.isDown || k.down.isDown;
    const left = k.a.isDown || k.left.isDown;
    const right = k.d.isDown || k.right.isDown;
    out.throttle = (up ? 1 : 0) - (down ? 1 : 0);
    out.steer = (right ? 1 : 0) - (left ? 1 : 0);
    out.drift = k.shift.isDown;
    out.boost = k.e.isDown;
    out.ability = k.space.isDown;
    out.reset = k.r.isDown;
    out.firePrimary = p.leftButtonDown();
    out.fireSecondary = p.rightButtonDown() || k.q.isDown;
    const a = this.aimWorld();
    out.aimX = a.x;
    out.aimY = a.y;
  }

  destroy(): void {
    document.removeEventListener('contextmenu', this.onContextMenu);
  }
}
