'use strict';

/**
 * Gestão das mesas (salas privadas) e eventos multiplayer em tempo real.
 *
 * - Só o administrador cria mesas (ver admin.js); aqui apenas se entra nelas.
 * - Máximo de 2 jogadores por mesa. Terceiros são recusados.
 * - Cada jogador recebe um "token" secreto que identifica o seu lugar e
 *   permite reconexão automática sem registo.
 * - Todas as jogadas são validadas no servidor (game-engine.js).
 */

const crypto = require('crypto');
const { Game, COLORS, otherColor } = require('./game-engine');
const { RateLimiter, cleanText, randomToken, socketIp } = require('./security');
const logger = require('./logger');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O, 1/I para evitar confusões
const CODE_LENGTH = 6;
const CODE_REGEX = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

const SEAT_TIMEOUT_MS = Number(process.env.SEAT_TIMEOUT_MINUTES || 60) * 60_000;
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_HOURS || 168) * 3_600_000;
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 200);
const CHAT_HISTORY = 80;

function normalizeCode(value) {
  if (typeof value !== 'string') return '';
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

function isValidCode(code) {
  return CODE_REGEX.test(code);
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.io = null;
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref();
  }

  attach(io) {
    this.io = io;
  }

  generateCode() {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Não foi possível gerar um código único.');
  }

  /* ------------------------------------------------------------------ */
  /* Operações administrativas                                           */
  /* ------------------------------------------------------------------ */

  createRoom({ label } = {}) {
    if (this.rooms.size >= MAX_ROOMS) {
      const err = new Error('Limite de mesas atingido.');
      err.code = 'MAX_ROOMS';
      throw err;
    }
    const code = this.generateCode();
    const room = {
      code,
      label: cleanText(label || '', 40),
      createdAt: Date.now(),
      lastActivity: Date.now(),
      players: { red: null, yellow: null },
      game: null,
      nextStarter: 'red',
      round: 0,
      score: { red: 0, yellow: 0, draws: 0 },
      rematchVotes: new Set(),
      chat: [],
    };
    this.rooms.set(code, room);
    logger.admin(`Mesa ${code} criada${room.label ? ` (${room.label})` : ''}`);
    return room;
  }

  deleteRoom(code, reason = 'A mesa foi encerrada pelo administrador.') {
    const room = this.rooms.get(code);
    if (!room) return false;
    this.disconnectPlayers(room, 'room:closed', reason);
    this.rooms.delete(code);
    logger.admin(`Mesa ${code} eliminada`);
    return true;
  }

  /** Encerra as sessões dos jogadores (liberta os lugares) sem apagar a mesa. */
  kickPlayers(code) {
    const room = this.rooms.get(code);
    if (!room) return false;
    this.disconnectPlayers(room, 'session:ended', 'A tua sessão foi terminada pelo administrador.');
    room.players = { red: null, yellow: null };
    room.game = null;
    room.rematchVotes.clear();
    room.score = { red: 0, yellow: 0, draws: 0 };
    room.round = 0;
    room.nextStarter = 'red';
    this.broadcastState(room);
    logger.admin(`Sessões da mesa ${code} terminadas`);
    return true;
  }

  /** Termina a partida em curso e começa uma nova (se houver 2 jogadores). */
  resetGame(code) {
    const room = this.rooms.get(code);
    if (!room) return false;
    room.game = null;
    room.rematchVotes.clear();
    this.ensureGame(room);
    this.broadcastState(room);
    this.emitEvent(room, { type: 'reset', message: 'O administrador reiniciou a partida.' });
    logger.admin(`Partida da mesa ${code} reiniciada`);
    return true;
  }

  disconnectPlayers(room, event, message) {
    if (!this.io) return;
    for (const color of COLORS) {
      const p = room.players[color];
      if (p && p.socketId) {
        const s = this.io.sockets.sockets.get(p.socketId);
        if (s) {
          s.emit(event, { message });
          s.leave(room.code);
          s.data.code = null;
          s.data.color = null;
        }
      }
    }
  }

  listRooms() {
    return [...this.rooms.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((room) => ({
        code: room.code,
        label: room.label,
        createdAt: room.createdAt,
        lastActivity: room.lastActivity,
        status: this.roomStatus(room),
        round: room.round,
        moves: room.game ? room.game.moves.length : 0,
        score: room.score,
        gameStartedAt: room.game ? room.game.startedAt : null,
        players: Object.fromEntries(
          COLORS.map((c) => {
            const p = room.players[c];
            return [c, p ? { name: p.name, connected: p.connected, ip: p.ip, joinedAt: p.joinedAt, lastSeen: p.lastSeen } : null];
          })
        ),
      }));
  }

  stats() {
    let seated = 0;
    let online = 0;
    let playing = 0;
    for (const room of this.rooms.values()) {
      for (const c of COLORS) {
        const p = room.players[c];
        if (p) {
          seated++;
          if (p.connected) online++;
        }
      }
      if (this.roomStatus(room) === 'playing') playing++;
    }
    return { rooms: this.rooms.size, seated, online, playing };
  }

  /* ------------------------------------------------------------------ */
  /* Estado                                                              */
  /* ------------------------------------------------------------------ */

  roomStatus(room) {
    if (!room.players.red || !room.players.yellow || !room.game) return 'waiting';
    return room.game.status; // playing | won | draw
  }

  ensureGame(room) {
    if (room.players.red && room.players.yellow && !room.game) {
      room.game = new Game(room.nextStarter);
      room.nextStarter = otherColor(room.nextStarter);
      room.round += 1;
      room.rematchVotes.clear();
      logger.game(`Mesa ${room.code}: partida ${room.round} começou (${room.players.red.name} vs ${room.players.yellow.name})`);
    }
  }

  publicState(room) {
    const game = room.game ? room.game.toJSON() : null;
    return {
      code: room.code,
      status: this.roomStatus(room),
      round: room.round,
      score: room.score,
      rematchVotes: [...room.rematchVotes],
      players: Object.fromEntries(
        COLORS.map((c) => {
          const p = room.players[c];
          return [c, p ? { name: p.name, color: c, connected: p.connected } : null];
        })
      ),
      game,
      serverTime: Date.now(),
    };
  }

  broadcastState(room) {
    if (this.io) this.io.to(room.code).emit('room:state', this.publicState(room));
  }

  emitEvent(room, event, exceptSocket) {
    if (!this.io) return;
    const payload = { ...event, at: Date.now() };
    if (exceptSocket) exceptSocket.to(room.code).emit('room:event', payload);
    else this.io.to(room.code).emit('room:event', payload);
  }

  /** Contexto do socket: mesa, cor e jogador, validados pelo token. */
  context(socket) {
    const { code, color, token } = socket.data || {};
    if (!code || !color) return null;
    const room = this.rooms.get(code);
    if (!room) return null;
    const player = room.players[color];
    if (!player || player.token !== token || player.socketId !== socket.id) return null;
    return { room, color, player };
  }

  opponentSocket(ctx) {
    const opp = ctx.room.players[otherColor(ctx.color)];
    if (!opp || !opp.socketId || !this.io) return null;
    return this.io.sockets.sockets.get(opp.socketId) || null;
  }

  /* ------------------------------------------------------------------ */
  /* Limpeza periódica                                                   */
  /* ------------------------------------------------------------------ */

  cleanup() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      for (const c of COLORS) {
        const p = room.players[c];
        if (p && !p.connected && now - p.lastSeen > SEAT_TIMEOUT_MS) {
          room.players[c] = null;
          room.game = null;
          room.rematchVotes.clear();
          room.score = { red: 0, yellow: 0, draws: 0 };
          this.emitEvent(room, { type: 'left', color: c, name: p.name, message: `${p.name} saiu da mesa (inatividade).` });
          this.broadcastState(room);
          logger.game(`Mesa ${room.code}: lugar ${c} libertado por inatividade (${p.name})`);
        }
      }
      if (now - room.lastActivity > ROOM_TTL_MS) {
        this.deleteRoom(room.code, 'A mesa expirou por inatividade.');
        logger.info(`Mesa ${room.code} expirou por inatividade`);
      }
    }
  }
}

/* ==================================================================== */
/* Eventos Socket.IO                                                     */
/* ==================================================================== */

const ERRORS = {
  INVALID_CODE: 'Código de mesa inválido. O código tem 6 caracteres.',
  ROOM_NOT_FOUND: 'Mesa não encontrada. Confirma o código ou o convite.',
  ROOM_FULL: 'Esta mesa já tem dois jogadores.',
  NAME_REQUIRED: 'Escreve o teu nome para entrar.',
  NOT_IN_ROOM: 'Não estás sentado nesta mesa.',
  NOT_YOUR_TURN: 'Aguarda pela tua vez.',
  COLUMN_FULL: 'Essa coluna está cheia.',
  INVALID_COLUMN: 'Coluna inválida.',
  GAME_OVER: 'A partida já terminou.',
  WAITING_OPPONENT: 'Aguarda que o adversário entre.',
  OPPONENT_OFFLINE: 'O adversário está desligado. Aguarda a reconexão.',
  STALE_MOVE: 'Jogada repetida ou fora de sincronia.',
  RATE_LIMITED: 'Demasiados pedidos. Abranda um pouco.',
  INVALID_MESSAGE: 'Mensagem inválida.',
  NOTHING_TO_RESTART: 'Ainda não há partida para reiniciar.',
};

function fail(ack, error) {
  if (typeof ack === 'function') ack({ ok: false, error, message: ERRORS[error] || error });
}

function safeAck(ack) {
  return typeof ack === 'function' ? ack : () => {};
}

function registerRoomHandlers(io, manager) {
  const joinLimiter = new RateLimiter({ windowMs: 60_000, max: 20 });
  const lookupLimiter = new RateLimiter({ windowMs: 60_000, max: 40 });
  const chatLimiter = new RateLimiter({ windowMs: 10_000, max: 10 });

  io.on('connection', (socket) => {
    const ip = socketIp(socket);
    socket.data.ip = ip;

    // Limite geral de eventos por socket (proteção contra abuso).
    const eventLimiter = new RateLimiter({ windowMs: 5_000, max: 120 });
    socket.use(([event], next) => {
      if (event.startsWith('rtc:') || eventLimiter.hit(socket.id)) return next();
      next(new Error('RATE_LIMITED'));
    });
    socket.on('error', () => {});

    socket.on('net:ping', (_p, ack) => safeAck(ack)({ t: Date.now() }));

    // Consulta pública: a mesa existe? que cores estão livres?
    socket.on('room:lookup', (payload, ack) => {
      ack = safeAck(ack);
      if (!lookupLimiter.hit(ip)) return fail(ack, 'RATE_LIMITED');
      const code = normalizeCode(payload && payload.code);
      if (!isValidCode(code)) return fail(ack, 'INVALID_CODE');
      const room = manager.rooms.get(code);
      if (!room) return fail(ack, 'ROOM_NOT_FOUND');
      const token = payload && typeof payload.token === 'string' ? payload.token : null;
      const mine = token ? COLORS.find((c) => room.players[c] && room.players[c].token === token) : null;
      ack({
        ok: true,
        code,
        label: room.label,
        seats: Object.fromEntries(COLORS.map((c) => [c, room.players[c] ? room.players[c].name : null])),
        mySeat: mine || null,
        full: !mine && !!room.players.red && !!room.players.yellow,
      });
    });

    socket.on('room:join', (payload, ack) => {
      ack = safeAck(ack);
      if (!joinLimiter.hit(ip)) return fail(ack, 'RATE_LIMITED');
      payload = payload || {};
      const code = normalizeCode(payload.code);
      if (!isValidCode(code)) return fail(ack, 'INVALID_CODE');
      const room = manager.rooms.get(code);
      if (!room) return fail(ack, 'ROOM_NOT_FOUND');

      // Se este socket já estava noutra mesa, sai dela (sem perder o lugar).
      if (socket.data.code && socket.data.code !== code) {
        socket.leave(socket.data.code);
        socket.data.code = null;
        socket.data.color = null;
      }

      const token = typeof payload.token === 'string' && payload.token.length <= 64 ? payload.token : null;
      let color = token ? COLORS.find((c) => room.players[c] && room.players[c].token === token) : null;
      let player;
      let reconnected = false;

      if (color) {
        // Reconexão ao lugar já reservado.
        player = room.players[color];
        if (player.socketId && player.socketId !== socket.id) {
          const old = io.sockets.sockets.get(player.socketId);
          if (old) {
            old.emit('session:replaced', { message: 'Abriste esta mesa noutra janela ou dispositivo.' });
            old.leave(code);
            old.data.code = null;
            old.data.color = null;
          }
        }
        const newName = cleanText(payload.name, 20);
        if (newName) player.name = newName;
        reconnected = true;
      } else {
        const name = cleanText(payload.name, 20);
        if (!name) return fail(ack, 'NAME_REQUIRED');
        const free = COLORS.filter((c) => !room.players[c]);
        if (!free.length) {
          logger.warn(`Mesa ${code}: entrada recusada (mesa cheia) para ${name} [${ip}]`);
          return fail(ack, 'ROOM_FULL');
        }
        color = free.includes(payload.color) ? payload.color : free[0];
        player = { token: randomToken(), name, color, joinedAt: Date.now(), ip };
        room.players[color] = player;
        logger.game(`Mesa ${code}: ${name} sentou-se (${color === 'red' ? 'vermelho' : 'amarelo'})`);
      }

      player.socketId = socket.id;
      player.connected = true;
      player.lastSeen = Date.now();
      room.lastActivity = Date.now();
      socket.data.code = code;
      socket.data.color = color;
      socket.data.token = player.token;
      socket.join(code);

      manager.ensureGame(room);

      ack({
        ok: true,
        token: player.token,
        color,
        name: player.name,
        state: manager.publicState(room),
        chat: room.chat,
      });

      manager.emitEvent(
        room,
        reconnected
          ? { type: 'reconnected', color, name: player.name, message: `${player.name} está de volta.` }
          : { type: 'joined', color, name: player.name, message: `${player.name} entrou na mesa.` },
        socket
      );
      manager.broadcastState(room);
    });

    socket.on('room:leave', (_p, ack) => {
      ack = safeAck(ack);
      const ctx = manager.context(socket);
      if (!ctx) return ack({ ok: true });
      const { room, color, player } = ctx;
      room.players[color] = null;
      room.game = null;
      room.rematchVotes.clear();
      room.score = { red: 0, yellow: 0, draws: 0 };
      room.round = 0;
      room.lastActivity = Date.now();
      socket.leave(room.code);
      socket.data.code = null;
      socket.data.color = null;
      manager.emitEvent(room, { type: 'left', color, name: player.name, message: `${player.name} abandonou a mesa.` });
      manager.broadcastState(room);
      logger.game(`Mesa ${room.code}: ${player.name} abandonou a mesa`);
      ack({ ok: true });
    });

    socket.on('game:move', (payload, ack) => {
      ack = safeAck(ack);
      const ctx = manager.context(socket);
      if (!ctx) return fail(ack, 'NOT_IN_ROOM');
      const { room, color, player } = ctx;
      const game = room.game;
      if (!game || !room.players.red || !room.players.yellow) return fail(ack, 'WAITING_OPPONENT');
      const opponent = room.players[otherColor(color)];
      if (!opponent.connected) return fail(ack, 'OPPONENT_OFFLINE');
      payload = payload || {};
      // Proteção contra jogadas duplicadas: o cliente indica o número de jogadas que conhece.
      if (payload.moveNumber !== game.moves.length) return fail(ack, 'STALE_MOVE');
      const col = Number(payload.col);
      const result = game.play(color, Number.isInteger(col) ? col : -1);
      if (!result.ok) return fail(ack, result.error);

      room.lastActivity = Date.now();
      if (game.status === 'won') {
        room.score[color] += 1;
        logger.game(`Mesa ${room.code}: ${player.name} venceu a partida ${room.round} em ${game.moves.length} jogadas`);
      } else if (game.status === 'draw') {
        room.score.draws += 1;
        logger.game(`Mesa ${room.code}: partida ${room.round} terminou empatada`);
      }
      ack({ ok: true, move: result.move });
      manager.broadcastState(room);
    });

    // Revanche / reinício por acordo dos dois jogadores.
    socket.on('game:rematch', (_p, ack) => {
      ack = safeAck(ack);
      const ctx = manager.context(socket);
      if (!ctx) return fail(ack, 'NOT_IN_ROOM');
      const { room, color, player } = ctx;
      if (!room.game || !room.players.red || !room.players.yellow) return fail(ack, 'NOTHING_TO_RESTART');
      if (room.rematchVotes.has(color)) return ack({ ok: true, pending: true });
      room.rematchVotes.add(color);
      room.lastActivity = Date.now();
      if (room.rematchVotes.size === 2) {
        room.game = null;
        manager.ensureGame(room);
        manager.emitEvent(room, { type: 'restart', message: 'Nova partida! Boa sorte a ambos.' });
        ack({ ok: true, restarted: true });
      } else {
        const inProgress = room.game.status === 'playing';
        manager.emitEvent(
          room,
          {
            type: 'rematch-request',
            color,
            name: player.name,
            inProgress,
            message: inProgress ? `${player.name} propõe reiniciar a partida.` : `${player.name} quer a revanche!`,
          },
          socket
        );
        ack({ ok: true, pending: true });
      }
      manager.broadcastState(room);
    });

    socket.on('game:rematch-decline', (_p, ack) => {
      ack = safeAck(ack);
      const ctx = manager.context(socket);
      if (!ctx) return fail(ack, 'NOT_IN_ROOM');
      const { room, player } = ctx;
      if (room.rematchVotes.size) {
        room.rematchVotes.clear();
        manager.emitEvent(room, { type: 'rematch-declined', name: player.name, message: `${player.name} recusou o pedido.` }, socket);
        manager.broadcastState(room);
      }
      ack({ ok: true });
    });

    socket.on('chat:send', (payload, ack) => {
      ack = safeAck(ack);
      const ctx = manager.context(socket);
      if (!ctx) return fail(ack, 'NOT_IN_ROOM');
      if (!chatLimiter.hit(socket.id)) return fail(ack, 'RATE_LIMITED');
      const text = cleanText(payload && payload.text, 400);
      if (!text) return fail(ack, 'INVALID_MESSAGE');
      const { room, color, player } = ctx;
      const message = { id: randomToken(8), color, name: player.name, text, at: Date.now() };
      room.chat.push(message);
      if (room.chat.length > CHAT_HISTORY) room.chat.shift();
      room.lastActivity = Date.now();
      io.to(room.code).emit('chat:message', message);
      ack({ ok: true, id: message.id });
    });

    socket.on('chat:typing', () => {
      const ctx = manager.context(socket);
      if (ctx) socket.to(ctx.room.code).emit('chat:typing', { color: ctx.color });
    });

    socket.on('disconnect', (reason) => {
      const ctx = manager.context(socket);
      if (!ctx) return;
      const { room, color, player } = ctx;
      player.connected = false;
      player.lastSeen = Date.now();
      manager.emitEvent(room, { type: 'disconnected', color, name: player.name, message: `${player.name} perdeu a ligação…` });
      manager.broadcastState(room);
      logger.game(`Mesa ${room.code}: ${player.name} desligou-se (${reason})`);
    });
  });
}

module.exports = { RoomManager, registerRoomHandlers, normalizeCode, isValidCode, ERRORS };
