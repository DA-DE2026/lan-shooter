// Fog-of-war renderer: a dark decal plane just above the ground whose
// texture is a low-res canvas — dark everywhere, with soft ray-cast
// visibility shapes cleared around you and your living teammates. The
// same canvas is stamped onto the minimap. The server independently
// withholds unseen enemies, so this layer is presentation, not the secret.

import * as THREE from 'three';
import { VISION_RANGE, pointHitsWall } from '@lan-shooter/shared';

const RESOLUTION = 8;     // world px per fog canvas px (low-res = soft edges)
const RAYS = 72;          // visibility polygon rays per viewer
const RAY_STEP = 14;      // sampling step along each ray, world px
const UPDATE_MS = 80;     // fog redraw cadence
const DARKNESS = 'rgba(5, 9, 4, 0.66)';

export class FogOfWar {
  constructor(scene, map) {
    this.scene = scene;
    this.map = map;
    this.k = 1 / RESOLUTION;

    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(map.widthPx * this.k);
    this.canvas.height = Math.ceil(map.heightPx * this.k);
    this.ctx = this.canvas.getContext('2d');

    this.tex = new THREE.CanvasTexture(this.canvas);
    this.plane = new THREE.Mesh(
      new THREE.PlaneGeometry(map.widthPx, map.heightPx),
      new THREE.MeshBasicMaterial({
        map: this.tex, transparent: true, depthWrite: false,
      }),
    );
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.position.set(map.widthPx / 2, 2, map.heightPx / 2);
    this.plane.renderOrder = 5;
    scene.add(this.plane);

    this.lastUpdate = 0;
  }

  /** March a ray until it hits a tree line or reaches full vision range. */
  castRay(x, y, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const steps = Math.floor(VISION_RANGE / RAY_STEP);
    for (let i = 1; i <= steps; i++) {
      const nx = x + cos * RAY_STEP * i;
      const ny = y + sin * RAY_STEP * i;
      if (pointHitsWall(this.map, nx, ny)) return { x: nx, y: ny };
    }
    return { x: x + cos * VISION_RANGE, y: y + sin * VISION_RANGE };
  }

  /** Redraw the fog. viewers: [{x, y}] in world coords (self + teammates). */
  update(viewers, now) {
    if (now - this.lastUpdate < UPDATE_MS) return;
    this.lastUpdate = now;

    const ctx = this.ctx;
    const k = this.k;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = DARKNESS;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Punch out each viewer's visibility shape (walls clip the polygon,
    // a radial gradient fades the outer rim of the range).
    ctx.globalCompositeOperation = 'destination-out';
    for (const v of viewers) {
      ctx.beginPath();
      for (let i = 0; i <= RAYS; i++) {
        const hit = this.castRay(v.x, v.y, (i / RAYS) * Math.PI * 2);
        if (i === 0) ctx.moveTo(hit.x * k, hit.y * k);
        else ctx.lineTo(hit.x * k, hit.y * k);
      }
      ctx.closePath();
      const grad = ctx.createRadialGradient(
        v.x * k, v.y * k, 0,
        v.x * k, v.y * k, VISION_RANGE * k,
      );
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.78, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.plane);
    this.plane.geometry.dispose();
    this.plane.material.dispose();
    this.tex.dispose();
  }
}
