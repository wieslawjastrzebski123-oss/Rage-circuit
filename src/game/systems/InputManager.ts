import type { Controls } from '../entities/Car';
import type { Gfx } from '../render/Gfx';
import { IS_TOUCH } from '../ui/device';
import { TouchControls } from '../ui/TouchControls';

const MAX_AIM = 1100;
const CAPTURED = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyQ', 'KeyR']);

/**
 * Keyboard + mouse → car controls.
 * WASD / arrows drive, SPACE drifts, E boosts, mouse aims,
 * LMB primary, RMB (or Q) secondary, SHIFT ability, R reset.
 * On touch devices on-screen controls are added; aiming is automatic there.
 */
export class InputManager {
  private gfx: Gfx;
  private keys = new Set<string>();
  private buttons = 0;
  mouseX = window.innerWidth / 2;
  mouseY = window.innerHeight * 0.4;
  readonly touch: TouchControls | null = IS_TOUCH ? new TouchControls() : null;
  /** touch auto-aim: a rival roughly ahead of the car (set by the race session) */
  findTarget: ((heading: number) => { x: number; y: number } | null) | null = null;

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
    if (CAPTURED.has(e.code)) e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onMouseMove = (e: MouseEvent) => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
  };
  private onMouseDown = (e: MouseEvent) => {
    this.buttons = e.buttons;
    if (e.button === 2) e.preventDefault();
  };
  private onMouseUp = (e: MouseEvent) => (this.buttons = e.buttons);
  private onContext = (e: Event) => e.preventDefault();
  private onBlur = () => {
    this.keys.clear();
    this.buttons = 0;
    this.touch?.release();
  };

  constructor(gfx: Gfx) {
    this.gfx = gfx;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', this.onContext);
    window.addEventListener('blur', this.onBlur);
  }

  private down(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  /**
   * Mouse → aim point on the ground around the car. Recomputed every frame because the camera moves.
   * The lower part of the screen is the road behind the car, so you can shoot backwards too.
   */
  aimWorld(carX: number, carY: number): { x: number; y: number } {
    const hit = this.gfx.screenToGround(this.mouseX, this.mouseY);
    if (hit) {
      const dx = hit.x - carX;
      const dy = hit.z - carY;
      const d = Math.hypot(dx, dy);
      if (d <= MAX_AIM) return { x: hit.x, y: hit.z };
      return { x: carX + (dx / d) * MAX_AIM, y: carY + (dy / d) * MAX_AIM };
    }
    // cursor above the horizon: aim along the ray's horizontal direction
    const r = this.gfx.rayDirection(this.mouseX, this.mouseY);
    const l = Math.hypot(r.x, r.z) || 1;
    return { x: carX + (r.x / l) * MAX_AIM, y: carY + (r.z / l) * MAX_AIM };
  }

  read(out: Controls, carX: number, carY: number, heading = 0): void {
    const up = this.down('KeyW', 'ArrowUp');
    const dn = this.down('KeyS', 'ArrowDown');
    const left = this.down('KeyA', 'ArrowLeft');
    const right = this.down('KeyD', 'ArrowRight');
    out.throttle = (up ? 1 : 0) - (dn ? 1 : 0);
    out.steer = (right ? 1 : 0) - (left ? 1 : 0);
    out.drift = this.down('Space');
    out.boost = this.down('KeyE');
    out.ability = this.down('ShiftLeft', 'ShiftRight');
    out.reset = this.down('KeyR');
    out.firePrimary = (this.buttons & 1) !== 0;
    out.fireSecondary = (this.buttons & 2) !== 0 || this.down('KeyQ');
    const a = this.aimWorld(carX, carY);
    out.aimX = a.x;
    out.aimY = a.y;
    const t = this.touch;
    if (!t) return;
    // the car drives itself forward; BRAKE slows down and reverses
    if (!up && !dn) out.throttle = t.down('brake') ? -1 : 1;
    if (!left && !right) out.steer = Math.round(t.steer * 50) / 50;
    out.drift ||= t.down('drift');
    out.boost ||= t.down('boost') || t.stickBoost;
    out.ability ||= t.down('ability');
    out.reset ||= t.down('reset');
    out.firePrimary ||= t.down('fire');
    out.fireSecondary ||= t.down('alt');
    const target = this.findTarget?.(heading);
    out.aimX = target ? target.x : carX + Math.cos(heading) * 600;
    out.aimY = target ? target.y : carY + Math.sin(heading) * 600;
  }

  destroy(): void {
    this.touch?.destroy();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('blur', this.onBlur);
  }
}
