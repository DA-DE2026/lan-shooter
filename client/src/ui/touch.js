// Twin-stick touch controls for phones/tablets (and the Capacitor APK).
// Left half of the screen: floating movement joystick. Right half: floating
// aim joystick — deflect it past FIRE_THRESHOLD to shoot. Two small action
// buttons cover reload and weapon switching. Desktop input is untouched;
// the whole layer only activates on coarse-pointer devices.

import { $ } from '../utils.js';

const RADIUS = 60;              // max knob travel, px
export const STICK_DEAD_ZONE = 0.18;
export const FIRE_THRESHOLD = 0.4;

class Stick {
  constructor(zoneEl, baseEl) {
    this.zone = zoneEl;
    this.base = baseEl;
    this.knob = baseEl.querySelector('.stick-knob');
    this.pointerId = null;
    this.x = 0; // -1..1 (screen right = world +x)
    this.y = 0; // -1..1 (screen down = world +y/z)

    zoneEl.addEventListener('pointerdown', (e) => this.onDown(e));
    zoneEl.addEventListener('pointermove', (e) => this.onMove(e));
    zoneEl.addEventListener('pointerup', (e) => this.onEnd(e));
    zoneEl.addEventListener('pointercancel', (e) => this.onEnd(e));
  }

  get active() {
    return this.pointerId !== null;
  }

  onDown(e) {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.zone.setPointerCapture(e.pointerId);
    this.cx = e.clientX;
    this.cy = e.clientY;
    // Float the stick base to wherever the thumb landed.
    this.base.style.left = `${this.cx}px`;
    this.base.style.top = `${this.cy}px`;
    this.base.classList.remove('hidden');
    this.setKnob(0, 0);
    e.preventDefault();
  }

  onMove(e) {
    if (e.pointerId !== this.pointerId) return;
    let dx = e.clientX - this.cx;
    let dy = e.clientY - this.cy;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    this.setKnob(dx, dy);
  }

  onEnd(e) {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.x = 0;
    this.y = 0;
    this.base.classList.add('hidden');
  }

  setKnob(dx, dy) {
    this.x = dx / RADIUS;
    this.y = dy / RADIUS;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}

let sticks = null;
let handlers = {};

export const touch = {
  /** True on phones/tablets — the only devices that get the touch layer. */
  enabled: typeof window !== 'undefined'
    && (window.matchMedia?.('(pointer: coarse)')?.matches || 'ontouchstart' in window),

  init() {
    if (!this.enabled || sticks) return;
    sticks = {
      move: new Stick($('stick-move-zone'), $('stick-move')),
      aim: new Stick($('stick-aim-zone'), $('stick-aim')),
    };
    $('btn-reload').addEventListener('click', () => handlers.onReload?.());
    $('btn-weapon').addEventListener('click', () => handlers.onWeapon?.());
    $('btn-zoom').addEventListener('click', () => handlers.onZoom?.());
  },

  /** The active match registers its actions here; cleared on destroy. */
  setHandlers(h) {
    handlers = h ?? {};
  },

  show() {
    if (!this.enabled) return;
    this.init();
    $('touch-ui').classList.remove('hidden');
  },

  hide() {
    $('touch-ui').classList.add('hidden');
  },

  moveStick() {
    return sticks?.move ?? { active: false, x: 0, y: 0 };
  },

  aimStick() {
    return sticks?.aim ?? { active: false, x: 0, y: 0 };
  },
};
