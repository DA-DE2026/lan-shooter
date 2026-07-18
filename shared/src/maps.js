// Map definitions. Maps are ASCII grids: '#' = jungle wall (dense canopy /
// ruin block), '.' = jungle floor, '1'/'2'/'3' = spawn tiles for that team
// (also walkable floor), '%' = hiding bush (walkable; conceals players from
// enemies outside the same bush cluster).
// `teams` lists which team counts the map supports.
// To add a map: append an entry here — lobby, server and client pick it up.

import { TILE } from './constants.js';

const RAW_MAPS = [
  {
    id: 'ruins',
    name: 'Temple Ruins',
    teams: [2],
    grid: [
      '##############################',
      '#11........................22#',
      '#11..####............####..22#',
      '#11..#..................#..22#',
      '#....#..................#....#',
      '#......%%............%%......#',
      '#...##......######......##...#',
      '#...##......#....#......##...#',
      '#....%%................%%....#',
      '#........##...##...##........#',
      '#........##...##...##........#',
      '#....%%................%%....#',
      '#...##......#....#......##...#',
      '#...##......######......##...#',
      '#......%%............%%......#',
      '#....#..................#....#',
      '#11..#..................#..22#',
      '#11..####............####..22#',
      '#11........................22#',
      '##############################',
    ],
  },
  {
    id: 'canopy',
    name: 'Triple Canopy',
    teams: [2, 3],
    grid: [
      '##################################',
      '#11............................22#',
      '#11..####................####..22#',
      '#11..#......................#..22#',
      '#....#......................#....#',
      '#......%%................%%......#',
      '#....##........####........##....#',
      '#....##........#..#........##....#',
      '#....%%....................%%....#',
      '#..####....................####..#',
      '#................................#',
      '#.........##..........##.........#',
      '#.........##..........##.........#',
      '#....%%....................%%....#',
      '#..####....................####..#',
      '#................................#',
      '#....##........#..#........##....#',
      '#....##........####........##....#',
      '#......%%................%%......#',
      '#....#........333333........#....#',
      '#....####.....333333.....####....#',
      '##################################',
    ],
  },
];

/**
 * Parse a raw grid into a fast-lookup map object.
 * Throws on malformed grids (ragged rows, missing spawns) so mistakes
 * surface at startup instead of mid-match.
 */
function parseMap(raw) {
  const rows = raw.grid.length;
  const cols = raw.grid[0].length;
  const solid = [];
  const bush = [];
  const spawns = { 0: [], 1: [], 2: [] };

  for (let r = 0; r < rows; r++) {
    const line = raw.grid[r];
    if (line.length !== cols) {
      throw new Error(`Map ${raw.id} row ${r} has length ${line.length}, expected ${cols}`);
    }
    solid.push([]);
    bush.push([]);
    for (let c = 0; c < cols; c++) {
      const ch = line[c];
      solid[r].push(ch === '#');
      bush[r].push(ch === '%');
      if (ch >= '1' && ch <= '3') {
        spawns[Number(ch) - 1].push({ c, r });
      }
    }
  }

  // Label connected bush tiles into clusters (flood fill): players inside
  // the same cluster can see each other, outsiders cannot see in.
  const bushClusterId = bush.map((row) => row.map(() => -1));
  const bushTiles = [];
  let clusterCount = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!bush[r][c] || bushClusterId[r][c] !== -1) continue;
      const id = clusterCount++;
      const stack = [{ c, r }];
      while (stack.length) {
        const t = stack.pop();
        if (t.c < 0 || t.r < 0 || t.c >= cols || t.r >= rows) continue;
        if (!bush[t.r][t.c] || bushClusterId[t.r][t.c] !== -1) continue;
        bushClusterId[t.r][t.c] = id;
        bushTiles.push({ c: t.c, r: t.r, cluster: id });
        stack.push(
          { c: t.c + 1, r: t.r }, { c: t.c - 1, r: t.r },
          { c: t.c, r: t.r + 1 }, { c: t.c, r: t.r - 1 },
        );
      }
    }
  }

  const maxTeams = Math.max(...raw.teams);
  for (let t = 0; t < maxTeams; t++) {
    if (spawns[t].length === 0) {
      throw new Error(`Map ${raw.id} supports ${maxTeams} teams but has no spawns for team ${t + 1}`);
    }
  }

  return {
    id: raw.id,
    name: raw.name,
    teams: raw.teams,
    cols,
    rows,
    widthPx: cols * TILE,
    heightPx: rows * TILE,
    solid,          // solid[r][c] -> boolean
    spawns,         // spawns[teamIndex] -> [{c, r}, ...]
    bush,           // bush[r][c] -> boolean
    bushClusterId,  // bushClusterId[r][c] -> cluster id or -1
    bushTiles,      // [{c, r, cluster}, ...]
  };
}

export const MAPS = {};
for (const raw of RAW_MAPS) {
  MAPS[raw.id] = parseMap(raw);
}

export function mapList() {
  return Object.values(MAPS).map((m) => ({ id: m.id, name: m.name, teams: m.teams }));
}

export function mapsForTeamCount(teamCount) {
  return Object.values(MAPS).filter((m) => m.teams.includes(teamCount));
}
