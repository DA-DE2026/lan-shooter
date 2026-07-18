// Weapon definitions shared by server (validation + damage) and client (HUD,
// projectile visuals, fire cadence). Add a new weapon by appending an entry —
// everything else (ammo, reload, HUD, projectiles) picks it up automatically.

export const WEAPONS = [
  {
    id: 'rifle',
    name: 'Pulse Rifle',
    magSize: 30,
    damage: 12,
    fireDelayMs: 120,   // min time between shots
    reloadMs: 1500,
    projSpeed: 1000,    // px/sec
    projTtlMs: 900,     // projectile lifetime
    pellets: 1,         // projectiles per trigger pull
    spread: 0.035,      // radians of random deviation per pellet
    auto: true,         // holding fire keeps shooting
  },
  {
    id: 'scatter',
    name: 'Scattergun',
    magSize: 6,
    damage: 9,
    fireDelayMs: 800,
    reloadMs: 2200,
    projSpeed: 820,
    projTtlMs: 420,
    pellets: 7,
    spread: 0.26,
    auto: false,
  },
  // --- loot-only weapons (found in crates; no reload — one clip and gone) ---
  {
    id: 'longshot',
    name: 'Longshot Rifle',
    magSize: 4,
    damage: 60,
    fireDelayMs: 1100,
    reloadMs: 0,
    projSpeed: 1600,
    projTtlMs: 900,
    pellets: 1,
    spread: 0.004,
    auto: false,
    loot: true,
  },
  {
    id: 'stinger',
    name: 'Stinger SMG',
    magSize: 40,
    damage: 7,
    fireDelayMs: 60,
    reloadMs: 0,
    projSpeed: 1100,
    projTtlMs: 700,
    pellets: 1,
    spread: 0.06,
    auto: true,
    loot: true,
  },
];

/** Indices of the starting loadout (always carried). */
export const LOADOUT = [0, 1];

/** Indices of the loot-only weapons. */
export const LOOT_WEAPONS = WEAPONS
  .map((w, i) => (w.loot ? i : -1))
  .filter((i) => i >= 0);
