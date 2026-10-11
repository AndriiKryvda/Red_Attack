import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom.js';
import { SERVER_PORT } from '@red-attack/shared';

const app = express();
const server = http.createServer(app);

app.use(cors());
app.get('/health', (_req, res) => res.json({ status: 'ok', game: 'Red Attack' }));

const gameServer = new Server({
  transport: new WebSocketTransport({ server }),
});

gameServer.define('game', GameRoom);

// In-memory room code → roomId registry (populated by GameRoom.onCreate via callback)
export const roomCodeRegistry = new Map<string, string>();

// Lookup room by code — returns roomId for joinById
app.get('/join/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const roomId = roomCodeRegistry.get(code);
  if (roomId) {
    return res.json({ roomId });
  }
  res.status(404).json({ error: 'Room not found' });
});

gameServer.listen(SERVER_PORT);
console.log(`[Red Attack] Server listening on ws://localhost:${SERVER_PORT}`);
