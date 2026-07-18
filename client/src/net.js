// Socket.IO connection management. The address is user-supplied (the host's
// LAN IP), never hardcoded to localhost — this is what lets a Capacitor-
// wrapped APK on a phone reach a PC host on the same network.

import { io } from 'socket.io-client';
import { MSG } from '@lan-shooter/shared';
import { getSessionToken } from './utils.js';

let socket = null;

export function getSocket() {
  return socket;
}

/**
 * Connect to `address` ("192.168.1.10:3000" or "hostname:3000").
 * Reconnection is left on: after a brief LAN drop, socket.io reconnects and
 * we re-send JOIN with our persistent token so the server reattaches us to
 * the same player (same team, same stats) mid-match.
 */
export function connect(address, name) {
  disconnect();
  const url = /^https?:\/\//.test(address) ? address : `http://${address}`;
  socket = io(url, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
    timeout: 6000,
  });
  socket.on('connect', () => {
    socket.emit(MSG.JOIN, { token: getSessionToken(), name });
  });
  return socket;
}

export function disconnect() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export function emit(event, data) {
  socket?.emit(event, data);
}
