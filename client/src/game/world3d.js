// Builds the 3D jungle from the shared 2D map grid, in a stylized painterly
// direction (classic MOBA jungle): mixed tree species (deep greens, autumn
// golds, pale blossoms), fluffy noise-displaced canopies with vertex-color
// gradients, real sun shadows, and hand-painted-looking terrain with dirt
// clearings, stone slabs, flowers, logs and ambient butterflies.
// Collision remains the shared 2D tile grid — this file is visuals only.
//
// Returns { tick(now) } for ambient animation; the game loop calls it.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TILE } from '@lan-shooter/shared';

/** Deterministic per-tile hash — same jungle on every client. */
function tileHash(c, r) {
  return (((c + 7) * 73856093) ^ ((r + 3) * 19349663)) >>> 0;
}

/** Small deterministic PRNG for painted details and ambient life. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap position-based noise in [-1, 1] (stable across the seam verts). */
function vnoise(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * Displace vertices radially from the local origin — turns smooth spheres
 * and cones into fluffy, irregular foliage. Call before translating away
 * from the origin; recomputes normals.
 */
function roughen(geo, amount) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const n = vnoise(v.x * 0.11, v.y * 0.11, v.z * 0.11);
    const len = v.length() || 1;
    const k = 1 + (n * amount) / len * Math.min(len, 40);
    pos.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Paint a vertical color gradient into vertex colors (painterly shading). */
function applyVerticalGradient(geo, bottomColor, topColor, yMin, yMax) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cb = new THREE.Color(bottomColor);
  const ct = new THREE.Color(topColor);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - yMin) / (yMax - yMin)));
    tmp.lerpColors(cb, ct, t);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

// Foliage species — mostly deep greens, with autumn and blossom trees mixed
// in for the varied MOBA-forest palette.
const SPECIES = [
  { weight: 70, bottom: 0x1e3a12, top: 0x7fa62e },  // lush green
  { weight: 15, bottom: 0x4a2c0e, top: 0xd1892f },  // autumn gold
  { weight: 15, bottom: 0x5e6b4c, top: 0xe9e4cf },  // pale blossom
];
const TRUNK_BOTTOM = 0x36261a;
const TRUNK_TOP = 0x584022;

// Tree shapes. Types 0/1: lobed deciduous ([dx, y, dz, radius] clumps).
// Type 2: stylized conifer ([y, r, h] tiers) — always green.
const TREES = [
  { type: 'lobed', trunkH: 62, trunkR: 9, clumps: [
    [0, 96, 0, 36], [-24, 82, 8, 27], [22, 84, -10, 26],
    [0, 120, -2, 24], [14, 108, 14, 15],
  ] },
  { type: 'lobed', trunkH: 54, trunkR: 8, clumps: [
    [0, 86, 0, 31], [-19, 100, -8, 23], [17, 102, 10, 21], [0, 120, 0, 16],
  ] },
  { type: 'conifer', trunkH: 42, trunkR: 7, tiers: [
    [62, 42, 52], [96, 32, 44], [126, 21, 38],
  ] },
];

export function buildWorld(scene, map) {
  // --- lighting: warm sun with real shadows, cool green bounce, fog ---
  scene.add(new THREE.HemisphereLight(0xd8ebc0, 0x1f2c14, 0.8));
  const sun = new THREE.DirectionalLight(0xffe3b0, 1.35);
  sun.position.set(map.widthPx / 2 + 400, 900, map.heightPx / 2 + 260);
  sun.target.position.set(map.widthPx / 2, 0, map.heightPx / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = Math.max(map.widthPx, map.heightPx) * 0.62;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.camera.near = 100;
  sun.shadow.camera.far = 2400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 3;
  scene.add(sun, sun.target);

  // --- ground plane with the map painted onto a canvas texture ---
  const tex = new THREE.CanvasTexture(paintGround(map));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(map.widthPx, map.heightPx),
    new THREE.MeshLambertMaterial({ map: tex }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(map.widthPx / 2, 0, map.heightPx / 2);
  ground.receiveShadow = true;
  scene.add(ground);

  // Dark forest floor beyond the map edge.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(map.widthPx * 5, map.heightPx * 5),
    new THREE.MeshLambertMaterial({ color: 0x14200d }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(map.widthPx / 2, -1, map.heightPx / 2);
  scene.add(apron);

  buildTrees(scene, map);
  buildBushes(scene, map);
  buildProps(scene, map);
  return buildAmbient(scene, map);
}

/**
 * Hiding bushes ('%' tiles): bright leafy mounds, visually distinct from
 * decorative shrubs so players learn "this is concealment".
 */
function buildBushes(scene, map) {
  const geos = [];
  const unitSphere = new THREE.SphereGeometry(1, 8, 6);
  for (const { c, r, cluster } of map.bushTiles) {
    const h = tileHash(c, r) ^ cluster;
    const cx = c * TILE + TILE / 2;
    const cz = r * TILE + TILE / 2;
    const rot = (h % 628) / 100;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    for (const [dx, y, dz, radius] of [
      [0, 16, 0, 19], [13, 11, 9, 12], [-12, 12, 7, 12], [2, 10, -13, 11],
    ]) {
      const g = unitSphere.clone();
      g.scale(radius, radius * 0.85, radius);
      roughen(g, 0.2);
      g.translate(dx * cos - dz * sin, y, dx * sin + dz * cos);
      applyVerticalGradient(g, 0x28511a, 0x9cc94a, 0, 34);
      g.translate(cx, 0, cz);
      geos.push(g);
    }
  }
  if (!geos.length) return;
  const mesh = new THREE.Mesh(
    mergeGeometries(geos),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  mesh.castShadow = true;
  scene.add(mesh);
}

/** Pick a foliage species for a tree from its hash. */
function pickSpecies(h) {
  const roll = (h >> 21) % 100;
  let acc = 0;
  for (const s of SPECIES) {
    acc += s.weight;
    if (roll < acc) return s;
  }
  return SPECIES[0];
}

/**
 * All trees merged by material: one trunk mesh + one canopy mesh for the
 * whole forest, both gradient-shaded and shadow-casting.
 */
function buildTrees(scene, map) {
  const trunkGeos = [];
  const canopyGeos = [];
  const unitSphere = new THREE.SphereGeometry(1, 9, 7);

  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (!map.solid[r][c]) continue;
      const h = tileHash(c, r);
      const species = pickSpecies(h);
      // Blossom/autumn trees use the lobed silhouettes; conifers stay green.
      let v = TREES[h % 3];
      if (v.type === 'conifer' && species !== SPECIES[0]) v = TREES[h % 2];
      const cx = c * TILE + TILE / 2 + ((h >> 5) % 13) - 6;
      const cz = r * TILE + TILE / 2 + ((h >> 11) % 13) - 6;
      const s = 0.85 + ((h >> 9) % 30) / 100;
      const rot = ((h >> 3) % 628) / 100;

      const top = new THREE.Color(species.top)
        .offsetHSL((((h >> 13) % 20) - 10) / 400, 0, (((h >> 17) % 20) - 10) / 200);

      // Thick tapered trunk with a root flare.
      const trunk = new THREE.CylinderGeometry(v.trunkR * 0.55, v.trunkR, v.trunkH, 8);
      trunk.translate(0, v.trunkH / 2, 0);
      const flare = new THREE.CylinderGeometry(v.trunkR * 0.9, v.trunkR * 1.7, 10, 8);
      flare.translate(0, 5, 0);
      const trunkAll = mergeGeometries([trunk, flare]);
      trunkAll.scale(s, s, s);
      applyVerticalGradient(trunkAll, TRUNK_BOTTOM, TRUNK_TOP, 0, v.trunkH * s);
      trunkAll.translate(cx, 0, cz);
      trunkGeos.push(trunkAll);

      // Canopy: fluffy lobed clumps or wobbly conifer tiers.
      const parts = [];
      let yMin = Infinity;
      let yMax = -Infinity;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      if (v.type === 'lobed') {
        for (const [dx, y, dz, radius] of v.clumps) {
          const g = unitSphere.clone();
          g.scale(radius * s, radius * 0.85 * s, radius * s);
          roughen(g, 0.16);
          const rx = (dx * cos - dz * sin) * s;
          const rz = (dx * sin + dz * cos) * s;
          g.translate(rx, y * s, rz);
          yMin = Math.min(yMin, (y - radius) * s);
          yMax = Math.max(yMax, (y + radius) * s);
          parts.push(g);
        }
      } else {
        for (const [y, radius, height] of v.tiers) {
          const g = new THREE.ConeGeometry(radius * s, height * s, 9);
          roughen(g, 0.1);
          g.translate(0, y * s, 0);
          yMin = Math.min(yMin, (y - height / 2) * s);
          yMax = Math.max(yMax, (y + height / 2) * s);
          parts.push(g);
        }
      }
      const canopy = mergeGeometries(parts);
      applyVerticalGradient(canopy, species.bottom, top.getHex(), yMin, yMax);
      canopy.translate(cx, 0, cz);
      canopyGeos.push(canopy);
    }
  }
  if (!trunkGeos.length) return;

  const trunks = new THREE.Mesh(
    mergeGeometries(trunkGeos),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  trunks.castShadow = true;
  const canopies = new THREE.Mesh(
    mergeGeometries(canopyGeos),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  canopies.castShadow = true;
  scene.add(trunks, canopies);
}

/**
 * Floor props: low-poly boulders, leafy shrubs, mushrooms and fallen logs —
 * deterministically placed by the decor hash, merged into a few meshes.
 */
function buildProps(scene, map) {
  const rockGeos = [];
  const shrubGeos = [];
  const stemGeos = [];
  const capGeos = [];
  const logGeos = [];
  const unitSphere = new THREE.SphereGeometry(1, 8, 6);
  const unitRock = new THREE.IcosahedronGeometry(1, 0);

  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (map.solid[r][c]) continue;
      const h = tileHash(c, r);
      const roll = h % 100;
      const x = c * TILE + 12 + (h >> 8) % (TILE - 24);
      const z = r * TILE + 12 + (h >> 16) % (TILE - 24);

      if (roll >= 6 && roll < 10) {
        const g = unitRock.clone();
        g.scale(10 + (h >> 6) % 5, 6 + (h >> 7) % 4, 8 + (h >> 9) % 4);
        g.rotateY(((h >> 4) % 628) / 100);
        g.translate(x, 4, z);
        rockGeos.push(g);
      } else if (roll >= 17 && roll < 22) {
        for (const [dx, y, dz, radius] of [[0, 9, 0, 12], [7, 6, 5, 8]]) {
          const g = unitSphere.clone();
          g.scale(radius, radius * 0.8, radius);
          roughen(g, 0.18);
          g.translate(dx, y, dz);
          applyVerticalGradient(g, 0x1e3a12, 0x6d9430, 0, 18);
          g.translate(x, 0, z);
          shrubGeos.push(g);
        }
      } else if (roll >= 22 && roll < 24) {
        for (const [dx, dz, s] of [[0, 0, 1], [7, 4, 0.7]]) {
          const stem = new THREE.CylinderGeometry(1.6 * s, 2 * s, 6 * s, 6);
          stem.translate(x + dx, 3 * s, z + dz);
          stemGeos.push(stem);
          const cap = new THREE.ConeGeometry(4.5 * s, 4 * s, 7);
          cap.translate(x + dx, 7.5 * s, z + dz);
          capGeos.push(cap);
        }
      } else if (roll >= 30 && roll < 32) {
        // Fallen log: tapered trunk lying on the ground.
        const len = 40 + (h >> 6) % 24;
        const g = new THREE.CylinderGeometry(5, 7, len, 7);
        g.rotateZ(Math.PI / 2);
        g.rotateY(((h >> 4) % 628) / 100);
        g.translate(x, 6, z);
        logGeos.push(g);
      }
    }
  }

  const addMerged = (geos, material) => {
    if (!geos.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(geos), material);
    mesh.castShadow = true;
    scene.add(mesh);
  };
  addMerged(rockGeos, new THREE.MeshLambertMaterial({ color: 0x7a7466, flatShading: true }));
  addMerged(shrubGeos, new THREE.MeshLambertMaterial({ vertexColors: true }));
  addMerged(stemGeos, new THREE.MeshLambertMaterial({ color: 0xd8c9a3 }));
  addMerged(capGeos, new THREE.MeshLambertMaterial({ color: 0xa04b32 }));
  addMerged(logGeos, new THREE.MeshLambertMaterial({ color: 0x4d3a26 }));
}

/**
 * Ambient life: butterflies / sunlit motes drifting over the clearings.
 * Returns { tick(now) } — one Points draw call, animated per frame.
 */
function buildAmbient(scene, map) {
  const rand = mulberry32(map.cols * 2654435761 + map.rows);
  const COUNT = 16;
  const PALETTE = [0xffc457, 0xfff2e0, 0xa8c8ff, 0xffa8d8];
  const bases = [];
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const tmp = new THREE.Color();

  for (let i = 0; i < COUNT; i++) {
    // Find a floor tile to hover over.
    let c = 0;
    let r = 0;
    for (let tries = 0; tries < 40; tries++) {
      c = 1 + Math.floor(rand() * (map.cols - 2));
      r = 1 + Math.floor(rand() * (map.rows - 2));
      if (!map.solid[r][c]) break;
    }
    bases.push({
      x: c * TILE + TILE / 2,
      z: r * TILE + TILE / 2,
      radius: 30 + rand() * 60,
      speed: 0.3 + rand() * 0.45,
      phase: rand() * Math.PI * 2,
    });
    tmp.setHex(PALETTE[Math.floor(rand() * PALETTE.length)]);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 7, vertexColors: true, sizeAttenuation: true,
    transparent: true, opacity: 0.9, depthWrite: false,
  }));
  scene.add(points);

  return {
    tick(now) {
      const t = now / 1000;
      for (let i = 0; i < COUNT; i++) {
        const b = bases[i];
        positions[i * 3] = b.x + Math.cos(t * b.speed + b.phase) * b.radius;
        positions[i * 3 + 1] = 20 + Math.sin(t * 1.7 + b.phase * 2) * 9;
        positions[i * 3 + 2] = b.z + Math.sin(t * b.speed * 0.8 + b.phase) * b.radius;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

/**
 * Paint the terrain like a hand-painted MOBA map: varied grass, dirt
 * clearings through the open lanes, stone slabs, flowers, grain noise,
 * soil under trees, and a shaded vignette toward the edges.
 */
function paintGround(map) {
  const canvas = document.createElement('canvas');
  canvas.width = map.cols * TILE;
  canvas.height = map.rows * TILE;
  const ctx = canvas.getContext('2d');

  // Distance-to-wall (chamfer transform) — used to carve dirt clearings
  // down the middle of open lanes, away from the tree lines.
  const dist = [];
  for (let r = 0; r < map.rows; r++) {
    dist.push(new Array(map.cols).fill(map.solid[r][0] ? 0 : 999));
    for (let c = 0; c < map.cols; c++) if (map.solid[r][c]) dist[r][c] = 0;
  }
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (r > 0) dist[r][c] = Math.min(dist[r][c], dist[r - 1][c] + 1);
      if (c > 0) dist[r][c] = Math.min(dist[r][c], dist[r][c - 1] + 1);
    }
  }
  for (let r = map.rows - 1; r >= 0; r--) {
    for (let c = map.cols - 1; c >= 0; c--) {
      if (r < map.rows - 1) dist[r][c] = Math.min(dist[r][c], dist[r + 1][c] + 1);
      if (c < map.cols - 1) dist[r][c] = Math.min(dist[r][c], dist[r][c + 1] + 1);
    }
  }

  // Base: grass shades per tile / dark soil with roots under trees.
  const GRASS = ['#31511e', '#2c4a1c', '#365722'];
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      const ox = c * TILE;
      const oy = r * TILE;
      if (map.solid[r][c]) {
        ctx.fillStyle = '#241c10';
        ctx.fillRect(ox, oy, TILE, TILE);
        for (let i = 0; i < 6; i++) {
          const x = (i * 31 + 9) % (TILE - 12) + 6;
          const y = (i * 43 + 21) % (TILE - 12) + 6;
          ctx.fillStyle = i % 2 ? '#1b150c' : '#2e2413';
          ctx.beginPath();
          ctx.arc(ox + x, oy + y, 6 + (i % 3) * 2, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.fillStyle = GRASS[tileHash(c, r) % 3];
        ctx.fillRect(ox, oy, TILE, TILE);
        if (map.bush[r][c]) {
          // Darker patch under hiding bushes.
          ctx.fillStyle = 'rgba(24, 46, 14, 0.7)';
          ctx.beginPath();
          ctx.arc(ox + TILE / 2, oy + TILE / 2, 26, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // Dirt clearings: sandy trails where the lanes are widest.
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (map.solid[r][c] || dist[r][c] < 2) continue;
      const h = tileHash(c, r);
      const alpha = Math.min(0.6, (dist[r][c] - 1) * 0.26);
      const x = c * TILE + TILE / 2 + ((h >> 6) % 21) - 10;
      const y = r * TILE + TILE / 2 + ((h >> 12) % 21) - 10;
      const radius = TILE * (0.75 + ((h >> 9) % 10) / 25);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
      grad.addColorStop(0, `rgba(151, 129, 79, ${alpha})`);
      grad.addColorStop(1, 'rgba(151, 129, 79, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  }

  // Soft painterly blotches: warm sun patches and cool shade pools.
  const rand = mulberry32(map.cols * 7919 + map.rows * 104729);
  for (let i = 0; i < 70; i++) {
    const x = rand() * canvas.width;
    const y = rand() * canvas.height;
    const radius = 90 + rand() * 220;
    const warm = rand() < 0.5;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, warm ? 'rgba(140, 168, 60, 0.13)' : 'rgba(16, 34, 18, 0.15)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  // Grain: thousands of tiny light/dark dabs — reads as painted texture.
  for (let i = 0; i < 4200; i++) {
    const x = rand() * canvas.width;
    const y = rand() * canvas.height;
    ctx.fillStyle = i % 2 ? 'rgba(20, 30, 12, 0.1)' : 'rgba(170, 190, 90, 0.07)';
    ctx.fillRect(x, y, 1 + (i % 2), 1 + ((i >> 1) % 2));
  }

  // Per-tile decals: blades, ferns, tufts, stone slabs, flower patches.
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (map.solid[r][c]) continue;
      const ox = c * TILE;
      const oy = r * TILE;
      ctx.fillStyle = 'rgba(120, 158, 62, 0.5)';
      for (let i = 0; i < 12; i++) {
        const x = (i * 37 + 13) % (TILE - 3);
        const y = (i * 53 + 29) % (TILE - 5);
        ctx.fillRect(ox + x, oy + y, 2, 4);
      }
      const h = tileHash(c, r);
      const roll = h % 100;
      const dx = ox + 12 + (h >> 8) % (TILE - 24);
      const dy = oy + 12 + (h >> 16) % (TILE - 24);
      if (roll < 6) paintFern(ctx, dx, dy);
      else if (roll >= 10 && roll < 17) paintTuft(ctx, dx, dy);
      else if (roll >= 24 && roll < 26) paintSlabs(ctx, dx, dy, h);
      else if (roll >= 26 && roll < 30) paintFlowers(ctx, dx, dy, h);
    }
  }

  // Vignette: the forest closes in toward the map edges.
  const edge = TILE * 1.6;
  let grad = ctx.createLinearGradient(0, 0, 0, edge);
  grad.addColorStop(0, 'rgba(8, 14, 5, 0.4)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, edge);
  grad = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - edge);
  grad.addColorStop(0, 'rgba(8, 14, 5, 0.4)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, canvas.height - edge, canvas.width, edge);
  grad = ctx.createLinearGradient(0, 0, edge, 0);
  grad.addColorStop(0, 'rgba(8, 14, 5, 0.4)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, edge, canvas.height);
  grad = ctx.createLinearGradient(canvas.width, 0, canvas.width - edge, 0);
  grad.addColorStop(0, 'rgba(8, 14, 5, 0.4)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(canvas.width - edge, 0, edge, canvas.height);

  return canvas;
}

function paintFern(ctx, x, y) {
  ctx.strokeStyle = '#4d7d33';
  ctx.lineWidth = 2;
  for (const [bx, by] of [[-9, -6], [-5, -10], [0, -12], [5, -10], [9, -6]]) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + bx, y + by);
    ctx.stroke();
  }
}

function paintTuft(ctx, x, y) {
  ctx.fillStyle = '#5a8a3c';
  for (const [bx, h] of [[-6, 7], [-2, 10], [2, 8], [6, 10]]) {
    ctx.fillRect(x + bx, y - h, 2, h);
  }
}

/** Mossy stone slabs — ruined paving peeking through the grass. */
function paintSlabs(ctx, x, y, h) {
  for (let i = 0; i < 4; i++) {
    const sx = x + ((h >> (i * 3)) % 26) - 13;
    const sy = y + ((h >> (i * 3 + 5)) % 26) - 13;
    const w = 10 + ((h >> i) % 6);
    const ht = 8 + ((h >> (i + 2)) % 5);
    ctx.fillStyle = i % 2 ? '#6e7568' : '#7d8578';
    ctx.beginPath();
    ctx.roundRect(sx, sy, w, ht, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20, 28, 16, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** Little flower clusters. */
function paintFlowers(ctx, x, y, h) {
  const COLORS = ['#e8e8d8', '#e0c04d', '#7a9ad0', '#d88aa8'];
  const color = COLORS[(h >> 7) % COLORS.length];
  for (let i = 0; i < 5; i++) {
    const fx = x + ((h >> (i * 4)) % 22) - 11;
    const fy = y + ((h >> (i * 4 + 7)) % 22) - 11;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(fx, fy, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}
