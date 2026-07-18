// Minimap on a plain HTML canvas in the HUD: walls + self + teammates +
// team pings. Enemies are deliberately NOT drawn — callouts are the point.
// Clicking the minimap sends a ping to your team.

import { TILE, PING_LIFETIME_MS } from '@lan-shooter/shared';
import { cssColor } from '../utils.js';

const WIDTH = 180;

export class Minimap2D {
  constructor(map, { onPing }) {
    this.map = map;
    this.scaleFactor = WIDTH / map.widthPx;
    this.canvas = document.getElementById('minimap');
    this.canvas.width = WIDTH;
    this.canvas.height = Math.round(map.heightPx * this.scaleFactor);
    this.ctx = this.canvas.getContext('2d');

    // Static background (grass + canopy walls) rendered once.
    this.bg = document.createElement('canvas');
    this.bg.width = this.canvas.width;
    this.bg.height = this.canvas.height;
    const bctx = this.bg.getContext('2d');
    bctx.fillStyle = 'rgba(12, 19, 10, .85)';
    bctx.fillRect(0, 0, this.bg.width, this.bg.height);
    const ts = this.scaleFactor * TILE;
    bctx.fillStyle = 'rgba(78, 122, 60, .9)';
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        if (map.solid[r][c]) {
          bctx.fillRect(c * ts, r * ts, Math.ceil(ts), Math.ceil(ts));
        }
      }
    }

    this._onClick = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      onPing({
        x: (e.clientX - rect.left) / this.scaleFactor,
        y: (e.clientY - rect.top) / this.scaleFactor,
      });
    };
    this.canvas.addEventListener('pointerdown', this._onClick);
  }

  /**
   * Redraw dynamic markers.
   * self: {x, y} | null. teammates: [{x, y, color}]. pings: [{x, y, bornAt, color}].
   * fog: the fog-of-war canvas, stamped over the map before the markers.
   */
  update({ self, selfColor, teammates, pings, pickups = [], fog, now }) {
    const s = this.scaleFactor;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.bg, 0, 0);
    if (fog) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(fog, 0, 0, this.canvas.width, this.canvas.height);
      ctx.globalAlpha = 1;
    }

    for (const pk of pickups) {
      ctx.fillStyle = '#ffd764';
      ctx.fillRect(pk.x * s - 2.5, pk.y * s - 2.5, 5, 5);
    }
    for (const t of teammates) {
      ctx.fillStyle = cssColor(t.color);
      ctx.beginPath();
      ctx.arc(t.x * s, t.y * s, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (self) {
      ctx.fillStyle = cssColor(selfColor);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(self.x * s, self.y * s, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    for (const p of pings) {
      const age = (now - p.bornAt) / PING_LIFETIME_MS;
      if (age > 1) continue;
      const pulse = 3 + ((now - p.bornAt) % 700) / 700 * 5;
      ctx.strokeStyle = cssColor(p.color);
      ctx.globalAlpha = 1 - age * 0.6;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x * s, p.y * s, pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this._onClick);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
