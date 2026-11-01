'use strict';

/**
 * Área de administração.
 *
 * - A palavra-passe vem EXCLUSIVAMENTE da variável de ambiente ADMIN_PASSWORD.
 * - O login cria uma sessão no servidor; o navegador recebe apenas um cookie
 *   HttpOnly (inacessível ao JavaScript), SameSite=Strict e Secure em HTTPS.
 * - Todas as rotas /api/admin/* (exceto login/sessão) exigem sessão válida.
 *   Um convidado que chame a API diretamente recebe 401.
 */

const express = require('express');
const os = require('os');
const { randomToken, safeEqual, rateLimitMiddleware, RateLimiter, cleanText } = require('./security');
const { normalizeCode, isValidCode } = require('./rooms');
const { hasTurn } = require('./webrtc');
const logger = require('./logger');

const COOKIE_NAME = 'qel_admin';
const SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_HOURS || 12) * 3_600_000;

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

function createAdminRouter({ manager, io, startedAt }) {
  const router = express.Router();
  const sessions = new Map(); // token -> { createdAt, expiresAt, ip }
  const failedLogins = new RateLimiter({ windowMs: 15 * 60_000, max: 8 });

  const passwordConfigured = () => typeof process.env.ADMIN_PASSWORD === 'string' && process.env.ADMIN_PASSWORD.length >= 6;

  if (!passwordConfigured()) {
    logger.warn('ADMIN_PASSWORD não está definida (mínimo 6 caracteres). A área de administração está desativada.');
  }

  setInterval(() => {
    const now = Date.now();
    for (const [token, s] of sessions) if (s.expiresAt < now) sessions.delete(token);
  }, 10 * 60_000).unref();

  function setSessionCookie(req, res, token, maxAgeMs) {
    const parts = [
      `${COOKIE_NAME}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    ];
    if (req.secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  function getSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) return null;
    const s = sessions.get(token);
    if (!s) return null;
    if (s.expiresAt < Date.now()) {
      sessions.delete(token);
      return null;
    }
    return { token, ...s };
  }

  function requireAdmin(req, res, next) {
    const session = getSession(req);
    if (!session) {
      logger.warn(`Acesso administrativo negado: ${req.method} ${req.originalUrl} [${req.ip}]`);
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Acesso reservado ao administrador.' });
    }
    // Proteção CSRF adicional: pedidos que alteram dados têm de vir do próprio site.
    if (req.method !== 'GET' && req.get('X-Requested-With') !== 'quatro-em-linha') {
      return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
    }
    req.adminSession = session;
    next();
  }

  function inviteUrl(req, code) {
    const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    return `${base}/?sala=${code}`;
  }

  router.use(express.json({ limit: '10kb' }));
  router.use(rateLimitMiddleware({ windowMs: 60_000, max: 240 }));

  router.get('/session', (req, res) => {
    res.json({ ok: true, authenticated: !!getSession(req), configured: passwordConfigured() });
  });

  router.post('/login', (req, res) => {
    if (!passwordConfigured()) {
      return res.status(503).json({ ok: false, error: 'NOT_CONFIGURED', message: 'Defina ADMIN_PASSWORD no servidor.' });
    }
    if (!failedLogins.hit(req.ip)) {
      logger.warn(`Login de administrador bloqueado temporariamente [${req.ip}]`);
      return res.status(429).json({ ok: false, error: 'RATE_LIMITED', message: 'Demasiadas tentativas. Aguarde 15 minutos.' });
    }
    const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
    if (!safeEqual(password, process.env.ADMIN_PASSWORD)) {
      logger.warn(`Tentativa de login de administrador falhada [${req.ip}]`);
      return res.status(401).json({ ok: false, error: 'INVALID_PASSWORD', message: 'Palavra-passe incorreta.' });
    }
    failedLogins.reset(req.ip);
    const token = randomToken(32);
    sessions.set(token, { createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS, ip: req.ip });
    setSessionCookie(req, res, token, SESSION_TTL_MS);
    logger.admin(`Administrador autenticado [${req.ip}]`);
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    const session = getSession(req);
    if (session) sessions.delete(session.token);
    setSessionCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  /* ---------- Rotas protegidas ---------- */

  router.post('/sessions/logout-all', requireAdmin, (req, res) => {
    const count = sessions.size;
    sessions.clear();
    setSessionCookie(req, res, '', 0);
    logger.admin(`Todas as sessões administrativas terminadas (${count})`);
    res.json({ ok: true, count });
  });

  router.get('/rooms', requireAdmin, (req, res) => {
    const rooms = manager.listRooms().map((r) => ({ ...r, inviteUrl: inviteUrl(req, r.code) }));
    res.json({ ok: true, rooms });
  });

  router.post('/rooms', requireAdmin, (req, res) => {
    try {
      const room = manager.createRoom({ label: cleanText(req.body && req.body.label, 40) });
      res.status(201).json({ ok: true, room: { code: room.code, label: room.label, inviteUrl: inviteUrl(req, room.code) } });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.code || 'ERROR', message: err.message });
    }
  });

  function withRoom(handler) {
    return (req, res) => {
      const code = normalizeCode(req.params.code);
      if (!isValidCode(code) || !manager.rooms.has(code)) {
        return res.status(404).json({ ok: false, error: 'ROOM_NOT_FOUND', message: 'Mesa não encontrada.' });
      }
      handler(code, req, res);
    };
  }

  router.delete(
    '/rooms/:code',
    requireAdmin,
    withRoom((code, req, res) => res.json({ ok: manager.deleteRoom(code) }))
  );

  router.post(
    '/rooms/:code/kick',
    requireAdmin,
    withRoom((code, req, res) => res.json({ ok: manager.kickPlayers(code) }))
  );

  router.post(
    '/rooms/:code/reset',
    requireAdmin,
    withRoom((code, req, res) => res.json({ ok: manager.resetGame(code) }))
  );

  router.get('/activity', requireAdmin, (req, res) => {
    const mem = process.memoryUsage();
    res.json({
      ok: true,
      server: {
        startedAt,
        uptimeSec: Math.round(process.uptime()),
        node: process.version,
        memoryMb: Math.round(mem.rss / 1048576),
        heapMb: Math.round(mem.heapUsed / 1048576),
        load: os.loadavg()[0],
        sockets: io.engine.clientsCount,
        adminSessions: sessions.size,
        turnConfigured: hasTurn(),
      },
      stats: manager.stats(),
      log: logger.recent(150),
    });
  });

  return router;
}

module.exports = { createAdminRouter };
