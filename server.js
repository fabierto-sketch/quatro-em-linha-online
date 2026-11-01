'use strict';

/**
 * Quatro em Linha Online — servidor principal.
 * Express (site + API) · Socket.IO (multiplayer + sinalização WebRTC)
 */

require('./server/env').load();

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const logger = require('./server/logger');
const { securityHeaders, rateLimitMiddleware } = require('./server/security');
const { RoomManager, registerRoomHandlers } = require('./server/rooms');
const { registerSignaling } = require('./server/webrtc');
const { createAdminRouter } = require('./server/admin');

const PORT = Number(process.env.PORT) || 3000;
const startedAt = Date.now();

const app = express();
app.disable('x-powered-by');
// O Render (e a maioria dos alojamentos) coloca um proxy à frente da aplicação.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));

const server = http.createServer(app);
const io = new Server(server, {
  serveClient: true,
  pingInterval: 20_000,
  pingTimeout: 25_000,
  maxHttpBufferSize: 100_000,
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60_000, skipMiddlewares: true },
  cors: process.env.ALLOWED_ORIGINS ? { origin: process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) } : undefined,
});

const manager = new RoomManager();
manager.attach(io);

app.use(securityHeaders);

// Redireciona HTTP -> HTTPS em produção (o Render envia x-forwarded-proto).
app.use((req, res, next) => {
  if (process.env.FORCE_HTTPS === 'true' && req.get('x-forwarded-proto') === 'http') {
    return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
  }
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));

app.use('/api/admin', createAdminRouter({ manager, io, startedAt }));
app.use('/api', rateLimitMiddleware({ windowMs: 60_000, max: 120 }));

// Qualquer tentativa de criar mesas fora da área de administração é recusada.
app.all(['/api/rooms', '/api/rooms/*', '/api/create-room', '/api/room'], (req, res) => {
  logger.warn(`Pedido recusado a rota de mesas fora do painel: ${req.method} ${req.originalUrl} [${req.ip}]`);
  res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'Apenas o administrador pode criar mesas.' });
});

app.use(
  express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// Convites: /mesa/ABC123 -> página principal com o código preenchido.
app.get(['/mesa/:code', '/sala/:code'], (req, res) => {
  res.redirect(302, `/?sala=${encodeURIComponent(req.params.code)}`);
});

app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'NOT_FOUND' }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

// Tratamento de erros centralizado.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST' });
  }
  logger.error(`Erro em ${req.method} ${req.originalUrl}: ${err.message}`, { error: err.stack });
  res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: 'Ocorreu um erro inesperado.' });
});

registerRoomHandlers(io, manager);
registerSignaling(io, manager);

io.engine.on('connection_error', (err) => {
  logger.warn(`Erro de ligação Socket.IO: ${err.message}`);
});

process.on('unhandledRejection', (reason) => logger.error(`Promessa rejeitada sem tratamento: ${reason}`, { error: reason && reason.stack }));
process.on('uncaughtException', (err) => logger.error(`Exceção não tratada: ${err.message}`, { error: err.stack }));

function shutdown(signal) {
  logger.info(`Sinal ${signal} recebido. A encerrar…`);
  io.emit('server:restarting', { message: 'O servidor vai reiniciar. A ligação será retomada automaticamente.' });
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  server.listen(PORT, () => {
    logger.info(`Quatro em Linha Online a funcionar na porta ${PORT}`);
  });
}

module.exports = { app, server, io, manager };
