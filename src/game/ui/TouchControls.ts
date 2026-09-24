import { Storage } from '../utils/storage';
import { h, layer } from './dom';

type Key = 'fire' | 'alt' | 'ability' | 'drift' | 'boost' | 'brake' | 'rear' | 'reset' | 'pause';

/** thumb travel (px) for full steering lock – short, so turns come quickly */
const STICK_RADIUS = 46;
const DEADZONE = 0.08;
/** <1 makes small thumb movements steer harder (response curve) */
const CURVE = 0.8;
/** pushing the stick this far up (px) triggers boost – frees the right thumb for shooting */
const BOOST_PUSH = 38;

/**
 * On-screen controls for phones/tablets (landscape).
 * Left thumb: a floating steering stick anywhere on the left half.
 * Right thumb: FIRE / ALT / ABILITY / DRIFT / BOOST / BRAKE / REAR – the thumb can slide between buttons.
 * The car accelerates by itself; BRAKE slows down and reverses.
 */
export class TouchControls {
  readonly root: HTMLElement;
  steer = 0;
  /** stick pushed up */
  stickBoost = false;
  private held = new Set<Key>();
  private buttons = new Map<Key, HTMLElement>();
  private pointers = new Map<number, Key | 'stick'>();
  private stickId = -1;
  private stickX = 0;
  private stickY = 0;
  private base: HTMLElement;
  private knob: HTMLElement;
  /** thumb travel for full lock, scaled by the STEERING setting (higher sensitivity = shorter travel) */
  private radius: number;
  /** tapped the pause button */
  onPause: (() => void) | null = null;

  constructor() {
    const sens = Math.max(0.5, Math.min(1.5, Storage.getSettings().steerSensitivity || 1));
    this.radius = STICK_RADIUS / sens;
    this.root = layer('touch-ctl');
    this.base = h('div', 'stick', undefined, this.root);
    this.knob = h('div', 'knob', undefined, this.base);
    h('div', 'stick-hint', 'STEER<b>▲ PUSH UP = BOOST</b>', this.root);
    const btn = (k: Key, label: string) => {
      const b = h('div', `tbtn ${k}`, `<b>${label}</b><i class="cd"></i>`, this.root);
      b.dataset.k = k;
      this.buttons.set(k, b);
      return b;
    };
    btn('fire', 'FIRE');
    btn('alt', 'ALT');
    btn('ability', 'SKILL');
    btn('drift', 'DRIFT');
    btn('boost', 'BOOST');
    btn('brake', 'BRAKE');
    btn('rear', 'REAR');
    btn('reset', '↺');
    btn('pause', 'II');

    const r = this.root;
    r.addEventListener('pointerdown', this.onDown);
    r.addEventListener('pointermove', this.onMove);
    r.addEventListener('pointerup', this.onUp);
    r.addEventListener('pointercancel', this.onUp);
    r.addEventListener('lostpointercapture', this.onUp);
    r.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private keyAt(x: number, y: number): Key | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const b = el?.closest<HTMLElement>('.tbtn');
    return b && this.root.contains(b) ? (b.dataset.k as Key) : null;
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    try {
      this.root.setPointerCapture(e.pointerId); // keep receiving the finger's moves/ups
    } catch {
      /* pointer already gone */
    }
    const k = this.keyAt(e.clientX, e.clientY);
    if (k === 'pause') {
      this.onPause?.();
      return;
    }
    if (k) {
      this.pointers.set(e.pointerId, k);
      this.refresh();
      return;
    }
    if (e.clientX < window.innerWidth * 0.5 && this.stickId < 0) {
      this.stickId = e.pointerId;
      this.pointers.set(e.pointerId, 'stick');
      this.stickX = e.clientX;
      this.stickY = e.clientY;
      this.base.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.base.classList.add('on');
      this.moveStick(e.clientX, e.clientY);
    }
  };

  private onMove = (e: PointerEvent): void => {
    const cur = this.pointers.get(e.pointerId);
    if (cur === undefined) return;
    if (cur === 'stick') {
      this.moveStick(e.clientX, e.clientY);
      return;
    }
    // slide the thumb from one button to another (not onto pause/reset)
    const k = this.keyAt(e.clientX, e.clientY);
    if (k && k !== cur && k !== 'pause' && k !== 'reset') {
      this.pointers.set(e.pointerId, k);
      this.refresh();
    }
  };

  private onUp = (e: PointerEvent): void => {
    const cur = this.pointers.get(e.pointerId);
    if (cur === undefined) return;
    this.pointers.delete(e.pointerId);
    if (cur === 'stick') {
      this.stickId = -1;
      this.steer = 0;
      this.stickBoost = false;
      this.base.classList.remove('on', 'boost');
      this.knob.style.transform = '';
    }
    this.refresh();
  };

  private moveStick(x: number, y: number): void {
    let dx = x - this.stickX;
    const dy = y - this.stickY;
    const d = Math.hypot(dx, dy);
    // the base follows a thumb that wanders too far, so steering never "runs out"
    let dyy = dy;
    if (d > this.radius * 1.6) {
      const k = (d - this.radius * 1.6) / d;
      this.stickX += dx * k;
      this.stickY += dy * k;
      this.base.style.transform = `translate(${this.stickX}px, ${this.stickY}px)`;
      dx = x - this.stickX;
      dyy = y - this.stickY;
    }
    this.stickBoost = dyy < -BOOST_PUSH;
    this.base.classList.toggle('boost', this.stickBoost);
    const kx = Math.max(-1, Math.min(1, dx / this.radius));
    const mag = Math.max(0, (Math.abs(kx) - DEADZONE) / (1 - DEADZONE));
    this.steer = Math.sign(kx) * Math.min(1, mag) ** CURVE;
    this.knob.style.transform = `translate(${kx * 34}px, ${Math.max(-40, Math.min(0, dyy))}px)`;
  }

  private refresh(): void {
    this.held.clear();
    for (const k of this.pointers.values()) if (k !== 'stick') this.held.add(k);
    for (const [k, b] of this.buttons) b.classList.toggle('down', this.held.has(k));
  }

  down(k: Key): boolean {
    return this.held.has(k);
  }

  /** Mirror a weapon slot's state (from the HUD) on its button. */
  setSlot(k: 'fire' | 'alt' | 'ability', label: string, cd: number, ready: boolean, locked: boolean): void {
    const b = this.buttons.get(k)!;
    const txt = locked ? '🔒' : label;
    const bEl = b.firstElementChild as HTMLElement;
    if (bEl.textContent !== txt) bEl.textContent = txt;
    b.classList.toggle('ready', ready);
    b.classList.toggle('locked', locked);
    b.style.setProperty('--cd', Math.max(0, Math.min(1, cd)).toFixed(3));
  }

  /** DRIFT button glows in the colour of the current drift charge level (0 = off). */
  setDriftLevel(lvl: number, color: string): void {
    const b = this.buttons.get('drift')!;
    b.style.setProperty('--lc', color);
    b.classList.toggle('charged', lvl > 0);
    if (lvl > 0) {
      b.classList.remove('lvlup');
      void b.offsetWidth;
      b.classList.add('lvlup');
    } else b.classList.remove('lvlup');
  }

  setLock(on: boolean): void {
    this.buttons.get('fire')!.classList.toggle('lock', on);
  }

  release(): void {
    this.pointers.clear();
    this.stickId = -1;
    this.steer = 0;
    this.stickBoost = false;
    this.base.classList.remove('on');
    this.refresh();
  }

  destroy(): void {
    this.root.remove();
  }
}
