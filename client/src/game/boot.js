// Creates/destroys the 3D game instance. A fresh instance per match keeps
// state clean (map changes, reconnects, rematches all just rebuild).

import { Game3D } from './Game3D.js';

let game = null;

export function startGame(matchData) {
  destroyGame();
  game = new Game3D(matchData);
  game.mount(document.getElementById('game-root'));
  return game;
}

export function destroyGame() {
  if (game) {
    game.destroy();
    game = null;
  }
}

/** Live game accessor (may be null between matches). */
export function activeScene() {
  return game;
}
