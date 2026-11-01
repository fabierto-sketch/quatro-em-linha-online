'use strict';

/**
 * Testes automáticos: motor de jogo + servidor real (HTTP, Socket.IO, admin).
 * Executar com:  npm test
 */

process.env.ADMIN_PASSWORD = 'palavra-secreta-teste';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { io: ioc } = require('socket.io-client');
const { Game, findWinningLine, createBoard } = require('../server/game-engine');
const { server, manager } = require('../server');

let BASE;
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

/* ------------------------------------------------------------------ */
/* Utilitários                                                          */
/* ------------------------------------------------------------------ */
function playAll(game, cols) {
  let last;
  for (const c of cols) {
    last = game.play(game.turn, c);
    assert.ok(last.ok, `jogada na coluna ${c} falhou: ${last.error}`);
  }
  return last;
}

/** Procura, por jogo aleatório determinístico, uma sequência que termine empatada. */
function findDrawSequence() {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let attempt = 0; attempt < 200000; attempt++) {
    const g = new Game('red');
    const seq = [];
    while (g.status === 'playing') {
      const open = [0, 1, 2, 3, 4, 5, 6].filter((c) => g.board[0][c] === null);
      const c = open[Math.floor(rand() * open.length)];
      g.play(g.turn, c);
      seq.push(c);
    }
    if (g.status === 'draw') return seq;
  }
  throw new Error('sem empate encontrado');
}

function connect() {
  return new Promise((resolve, reject) => {
    const s = ioc(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

function emit(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function once(socket, event, ms = 2000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout à espera de ${event}`)), ms);
    socket.once(event, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

function waitEvent(socket, type, ms = 2000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout à espera do evento ${type}`)), ms);
    const handler = (ev) => {
      if (ev.type === type) {
        clearTimeout(t);
        socket.off('room:event', handler);
        resolve(ev);
      }
    };
    socket.on('room:event', handler);
  });
}

async function http(method, url, { body, cookie, headers = {} } = {}) {
  const res = await fetch(BASE + url, {
    method,
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('json')) data = await res.json();
  else data = await res.text();
  return { status: res.status, data, headers: res.headers };
}

const ADMIN_H = { 'X-Requested-With': 'quatro-em-linha' };
let adminCookie;

async function createRoom() {
  const r = await http('POST', '/api/admin/rooms', { cookie: adminCookie, headers: ADMIN_H, body: { label: 'Teste' } });
  assert.equal(r.status, 201);
  return r.data.room;
}

async function seatTwo(code) {
  const a = await connect();
  const b = await connect();
  const ra = await emit(a, 'room:join', { code, name: 'Ana', color: 'red' });
  assert.ok(ra.ok, ra.message);
  const rb = await emit(b, 'room:join', { code, name: 'Bruno', color: 'red' }); // vermelho ocupado → amarelo
  assert.ok(rb.ok, rb.message);
  assert.equal(rb.color, 'yellow');
  return { a, b, ra, rb };
}

/** Joga uma sequência de colunas alternando os dois sockets segundo o turno do servidor. */
async function playSeq(code, sockets, cols) {
  let res;
  for (const col of cols) {
    const room = manager.rooms.get(code);
    const turn = room.game.turn;
    res = await emit(sockets[turn], 'game:move', { col, moveNumber: room.game.moves.length });
    assert.ok(res.ok, `coluna ${col}: ${res.message}`);
  }
  return res;
}

async function rematch(code, a, b) {
  await emit(a, 'game:rematch');
  const r = await emit(b, 'game:rematch');
  assert.ok(r.restarted);
  return manager.rooms.get(code);
}

/* ------------------------------------------------------------------ */
/* 1. Motor do jogo                                                     */
/* ------------------------------------------------------------------ */
test('motor: peças caem até à posição livre mais baixa e os turnos alternam', () => {
  const g = new Game('red');
  assert.equal(g.play('red', 3).move.row, 5);
  assert.equal(g.turn, 'yellow');
  assert.equal(g.play('yellow', 3).move.row, 4);
  assert.equal(g.play('red', 3).move.row, 3);
  assert.equal(g.play('red', 2).error, 'NOT_YOUR_TURN');
});

test('motor: vitória horizontal', () => {
  const g = new Game('red');
  playAll(g, [0, 0, 1, 1, 2, 2, 3]);
  assert.equal(g.status, 'won');
  assert.equal(g.winner, 'red');
  assert.deepEqual(g.winLine, [[5, 0], [5, 1], [5, 2], [5, 3]]);
});

test('motor: vitória vertical', () => {
  const g = new Game('yellow');
  playAll(g, [4, 5, 4, 5, 4, 5, 4]);
  assert.equal(g.winner, 'yellow');
  assert.deepEqual(g.winLine, [[2, 4], [3, 4], [4, 4], [5, 4]]);
});

test('motor: vitória diagonal ↗', () => {
  const g = new Game('red');
  // red: (5,0) (4,1) (3,2) (2,3)
  playAll(g, [0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
  assert.equal(g.winner, 'red');
  assert.equal(g.winLine.length, 4);
  assert.deepEqual(g.winLine, [[2, 3], [3, 2], [4, 1], [5, 0]]);
});

test('motor: vitória diagonal ↘', () => {
  const g = new Game('red');
  // red: (2,3) (3,4) (4,5) (5,6)
  playAll(g, [6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]);
  assert.equal(g.winner, 'red');
  assert.deepEqual(g.winLine, [[2, 3], [3, 4], [4, 5], [5, 6]]);
});

test('motor: alinhamento com 5 peças é detetado por inteiro', () => {
  const b = createBoard();
  for (const c of [0, 1, 3, 4]) b[5][c] = 'red';
  b[5][2] = 'red';
  assert.equal(findWinningLine(b, 5, 2).length, 5);
});

test('motor: coluna cheia é recusada', () => {
  const g = new Game('red');
  playAll(g, [0, 0, 0, 0, 0, 0]);
  assert.equal(g.play(g.turn, 0).error, 'COLUMN_FULL');
  assert.equal(g.play(g.turn, 7).error, 'INVALID_COLUMN');
  assert.equal(g.play(g.turn, -1).error, 'INVALID_COLUMN');
});

test('motor: 42 posições sem vencedor → empate', () => {
  const seq = findDrawSequence();
  const g = new Game('red');
  playAll(g, seq);
  assert.equal(seq.length, 42);
  assert.equal(g.status, 'draw');
  assert.equal(g.winner, null);
  assert.equal(g.play(g.turn, 0).error, 'GAME_OVER');
});

/* ------------------------------------------------------------------ */
/* 2. Servidor                                                          */
/* ------------------------------------------------------------------ */
test('servidor', async (t) => {
  await new Promise((r) => server.listen(0, r));
  BASE = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {
    server.closeAllConnections && server.closeAllConnections();
    return new Promise((r) => {
      require('../server').io.close();
      server.close(() => r());
    });
  });

  await t.test('páginas, saúde e convites', async () => {
    assert.equal((await http('GET', '/healthz')).status, 200);
    const home = await http('GET', '/');
    assert.equal(home.status, 200);
    assert.match(home.data, /Quatro em Linha/);
    assert.ok(home.headers.get('content-security-policy'));
    const admin = await http('GET', '/admin');
    assert.equal(admin.status, 200);
    assert.match(admin.data, /Área do anfitrião/);
    const inv = await http('GET', '/mesa/ABC234');
    assert.equal(inv.status, 302);
    assert.equal(inv.headers.get('location'), '/?sala=ABC234');
    const client = await http('GET', '/socket.io/socket.io.js');
    assert.equal(client.status, 200);
  });

  await t.test('a palavra-passe nunca aparece nos ficheiros públicos', () => {
    const dir = path.join(__dirname, '..', 'public');
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isFile()) assert.ok(!fs.readFileSync(p, 'utf8').includes(process.env.ADMIN_PASSWORD), f);
    }
  });

  await t.test('convidados não podem criar mesas', async () => {
    assert.equal((await http('POST', '/api/admin/rooms', { headers: ADMIN_H })).status, 401);
    assert.equal((await http('GET', '/api/admin/rooms')).status, 401);
    assert.equal((await http('POST', '/api/rooms', { body: {} })).status, 403);
    assert.equal((await http('POST', '/api/create-room', { body: {} })).status, 403);
    assert.equal((await http('DELETE', '/api/admin/rooms/ABC234', { headers: ADMIN_H })).status, 401);
    // Cookie inventado
    assert.equal((await http('POST', '/api/admin/rooms', { cookie: 'qel_admin=falso', headers: ADMIN_H })).status, 401);
    // Não existe evento socket para criar mesas
    const s = await connect();
    s.emit('room:create', {});
    await new Promise((r) => setTimeout(r, 100));
    s.close();
    assert.equal(manager.rooms.size, 0);
  });

  await t.test('login do administrador', async () => {
    const bad = await http('POST', '/api/admin/login', { body: { password: 'errada' } });
    assert.equal(bad.status, 401);
    const ok = await http('POST', '/api/admin/login', { body: { password: process.env.ADMIN_PASSWORD } });
    assert.equal(ok.status, 200);
    const setCookie = ok.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    adminCookie = setCookie.split(';')[0];
    const session = await http('GET', '/api/admin/session', { cookie: adminCookie });
    assert.equal(session.data.authenticated, true);
    // Sem cabeçalho anti-CSRF → recusado
    const csrf = await http('POST', '/api/admin/rooms', { cookie: adminCookie });
    assert.equal(csrf.status, 403);
  });

  let room;
  await t.test('administrador cria mesa com código de 6 caracteres e convite', async () => {
    room = await createRoom();
    assert.match(room.code, CODE_RE);
    assert.equal(room.inviteUrl, `${BASE}/?sala=${room.code}`);
    const list = await http('GET', '/api/admin/rooms', { cookie: adminCookie });
    assert.equal(list.data.rooms.length, 1);
    const second = await createRoom();
    assert.notEqual(second.code, room.code);
  });

  let a;
  let b;
  let tokenB;
  await t.test('entrada por código, escolha de cor e limite de 2 jogadores', async () => {
    const probe = await connect();
    assert.equal((await emit(probe, 'room:lookup', { code: 'XYZ' })).error, 'INVALID_CODE');
    assert.equal((await emit(probe, 'room:lookup', { code: 'ZZZZZZ' })).error, 'ROOM_NOT_FOUND');
    const info = await emit(probe, 'room:lookup', { code: room.code.toLowerCase() });
    assert.ok(info.ok);
    assert.deepEqual(info.seats, { red: null, yellow: null });

    a = await connect();
    b = await connect();
    assert.equal((await emit(a, 'room:join', { code: room.code, name: '   ' })).error, 'NAME_REQUIRED');
    const ra = await emit(a, 'room:join', { code: room.code, name: 'Ana <b>PT</b>', color: 'yellow' });
    assert.ok(ra.ok);
    assert.equal(ra.color, 'yellow');
    assert.equal(ra.state.status, 'waiting');

    const joinedEvent = waitEvent(a, 'joined');
    // Entrada "pelo convite": o link é /?sala=CODE; o cliente usa o mesmo código.
    const code = new URL(room.inviteUrl).searchParams.get('sala');
    const rb = await emit(b, 'room:join', { code, name: 'Bruno', color: 'yellow' });
    assert.ok(rb.ok);
    assert.equal(rb.color, 'red', 'amarelo ocupado → recebe vermelho');
    tokenB = rb.token;
    const ev = await joinedEvent;
    assert.equal(ev.name, 'Bruno');
    assert.equal(rb.state.status, 'playing');

    const c = await connect();
    const rc = await emit(c, 'room:join', { code: room.code, name: 'Intruso' });
    assert.equal(rc.error, 'ROOM_FULL');
    const info2 = await emit(probe, 'room:lookup', { code: room.code });
    assert.equal(info2.full, true);
    c.close();
    probe.close();
  });

  await t.test('jogadas validadas no servidor: turnos, duplicados e manipulação', async () => {
    const r = manager.rooms.get(room.code);
    assert.equal(r.game.turn, 'red'); // Bruno (vermelho) começa
    assert.equal((await emit(a, 'game:move', { col: 3, moveNumber: 0 })).error, 'NOT_YOUR_TURN');
    const stateP = once(a, 'room:state');
    const m1 = await emit(b, 'game:move', { col: 3, moveNumber: 0 });
    assert.ok(m1.ok);
    assert.equal(m1.move.row, 5);
    const st = await stateP;
    assert.equal(st.game.board[5][3], 'red');
    assert.equal(st.game.turn, 'yellow');
    // Mesma jogada repetida (duplo clique / reenvio)
    assert.equal((await emit(b, 'game:move', { col: 3, moveNumber: 0 })).error, 'STALE_MOVE');
    assert.equal((await emit(b, 'game:move', { col: 3, moveNumber: 1 })).error, 'NOT_YOUR_TURN');
    // Tentativas de manipulação
    assert.equal((await emit(a, 'game:move', { col: 99, moveNumber: 1 })).error, 'INVALID_COLUMN');
    assert.equal((await emit(a, 'game:move', { col: '2; DROP', moveNumber: 1 })).error, 'INVALID_COLUMN');
    assert.equal((await emit(a, 'game:move', { col: 2, moveNumber: 1, color: 'red', row: 0 })).ok, true);
    assert.equal(r.game.board[5][2], 'yellow', 'a cor e a linha vêm sempre do servidor');
    // Jogadas simultâneas: duas enviadas ao mesmo tempo pelo mesmo jogador → só uma conta
    const [x, y] = await Promise.all([
      emit(b, 'game:move', { col: 0, moveNumber: 2 }),
      emit(b, 'game:move', { col: 1, moveNumber: 2 }),
    ]);
    assert.equal([x, y].filter((res) => res.ok).length, 1);
    assert.equal(r.game.moves.length, 3);
  });

  await t.test('vitória horizontal pela rede, placar e destaque', async () => {
    const sockets = { red: b, yellow: a };
    await emit(a, 'game:rematch');
    await emit(b, 'game:rematch');
    let r = manager.rooms.get(room.code);
    assert.equal(r.round, 2);
    assert.equal(r.game.turn, 'yellow', 'quem começa alterna entre partidas');
    // amarelo: 0,1,2,3 na linha de baixo
    await playSeq(room.code, sockets, [0, 0, 1, 1, 2, 2, 3]);
    r = manager.rooms.get(room.code);
    assert.equal(r.game.status, 'won');
    assert.equal(r.game.winner, 'yellow');
    assert.equal(r.score.yellow, 1);
    assert.equal(r.game.winLine.length, 4);
    assert.equal((await emit(b, 'game:move', { col: 5, moveNumber: r.game.moves.length })).error, 'GAME_OVER');
  });

  await t.test('revanche por acordo dos dois jogadores', async () => {
    const reqP = waitEvent(b, 'rematch-request');
    const first = await emit(a, 'game:rematch');
    assert.ok(first.pending);
    const req = await reqP;
    assert.equal(req.name, 'Ana <b>PT</b>');
    // Recusar limpa o pedido
    await emit(b, 'game:rematch-decline');
    assert.equal(manager.rooms.get(room.code).rematchVotes.size, 0);
    await emit(a, 'game:rematch');
    const restartP = waitEvent(a, 'restart');
    const second = await emit(b, 'game:rematch');
    assert.ok(second.restarted);
    await restartP;
    const r = manager.rooms.get(room.code);
    assert.equal(r.round, 3);
    assert.equal(r.game.moves.length, 0);
    assert.equal(r.game.turn, 'red');
  });

  await t.test('vitória vertical e diagonais pela rede', async () => {
    const sockets = { red: b, yellow: a };
    await playSeq(room.code, sockets, [4, 5, 4, 5, 4, 5, 4]);
    let r = manager.rooms.get(room.code);
    assert.equal(r.game.winner, 'red');
    assert.deepEqual(r.game.winLine.map(([, c]) => c), [4, 4, 4, 4]);

    r = await rematch(room.code, a, b); // começa amarelo
    await playSeq(room.code, sockets, [0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
    assert.equal(r.game.winner, 'yellow');
    assert.deepEqual(r.game.winLine, [[2, 3], [3, 2], [4, 1], [5, 0]]);

    r = await rematch(room.code, a, b); // começa vermelho
    await playSeq(room.code, sockets, [6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3]);
    assert.equal(r.game.winner, 'red');
    assert.deepEqual(r.game.winLine, [[2, 3], [3, 4], [4, 5], [5, 6]]);
  });

  await t.test('empate pela rede (42 peças)', async () => {
    const r = await rematch(room.code, a, b); // começa amarelo
    assert.equal(r.game.turn, 'yellow');
    const seq = findDrawSequence(); // sequência válida para quem começa (a cor é simétrica)
    await playSeq(room.code, { red: b, yellow: a }, seq);
    assert.equal(r.game.status, 'draw');
    assert.equal(r.score.draws, 1);
  });

  await t.test('coluna cheia recusada pela rede', async () => {
    const r = await rematch(room.code, a, b);
    await playSeq(room.code, { red: b, yellow: a }, [0, 0, 0, 0, 0, 0]);
    const turnSocket = r.game.turn === 'red' ? b : a;
    assert.equal((await emit(turnSocket, 'game:move', { col: 0, moveNumber: 6 })).error, 'COLUMN_FULL');
  });

  await t.test('chat em tempo real (texto seguro, limites)', async () => {
    const msgP = once(b, 'chat:message');
    const res = await emit(a, 'chat:send', { text: '  Olá do Brasil 🇧🇷 <script>alert(1)</script>  ' });
    assert.ok(res.ok);
    const m = await msgP;
    assert.equal(m.text, 'Olá do Brasil 🇧🇷 <script>alert(1)</script>');
    assert.equal(m.color, 'yellow');
    assert.equal((await emit(a, 'chat:send', { text: '   ' })).error, 'INVALID_MESSAGE');
    const long = await emit(b, 'chat:send', { text: 'x'.repeat(5000) });
    assert.ok(long.ok);
    assert.equal(manager.rooms.get(room.code).chat.at(-1).text.length, 400);
    // Quem não está sentado não pode escrever
    const outsider = await connect();
    assert.equal((await emit(outsider, 'chat:send', { text: 'olá' })).error, 'NOT_IN_ROOM');
    outsider.close();
  });

  await t.test('sinalização da videochamada só entre os dois jogadores', async () => {
    const cfg = await emit(a, 'rtc:config');
    assert.ok(cfg.ok);
    assert.ok(cfg.iceServers[0].urls.length >= 1);
    const invP = once(b, 'rtc:invite');
    assert.ok((await emit(a, 'rtc:invite')).ok);
    assert.equal((await invP).name, 'Ana <b>PT</b>');
    const accP = once(a, 'rtc:accept');
    await emit(b, 'rtc:accept');
    await accP;
    const sigP = once(b, 'rtc:signal');
    await emit(a, 'rtc:signal', { description: { type: 'offer', sdp: 'v=0\r\n' } });
    const sig = await sigP;
    assert.equal(sig.description.type, 'offer');
    assert.equal(sig.from, 'yellow');
    const candP = once(a, 'rtc:signal');
    await emit(b, 'rtc:signal', { candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0' } });
    assert.ok((await candP).candidate);
    const mediaP = once(b, 'rtc:media');
    await emit(a, 'rtc:media', { mic: false, cam: true });
    const media = await mediaP;
    assert.equal(media.mic, false);
    assert.equal(media.cam, true);
    const hangP = once(b, 'rtc:hangup');
    await emit(a, 'rtc:hangup');
    await hangP;
    const outsider = await connect();
    assert.equal((await emit(outsider, 'rtc:config')).error, 'NOT_IN_ROOM');
    assert.equal((await emit(outsider, 'rtc:invite')).error, 'NOT_IN_ROOM');
    const big = await emit(a, 'rtc:signal', { description: { type: 'offer', sdp: 'x'.repeat(70000) } });
    assert.equal(big.error, 'TOO_LARGE');
    outsider.close();
  });

  await t.test('desconexão e reconexão automática mantêm o lugar e o tabuleiro', async () => {
    const r = manager.rooms.get(room.code);
    // Bruno (vermelho) joga para que a vez passe para a Ana antes da queda de ligação
    assert.equal(r.game.turn, 'red');
    assert.ok((await emit(b, 'game:move', { col: 1, moveNumber: r.game.moves.length })).ok);
    const before = JSON.stringify(r.game.board);
    const discP = waitEvent(a, 'disconnected');
    b.close();
    const ev = await discP;
    assert.equal(ev.name, 'Bruno');
    assert.equal(r.players.red.connected, false);
    assert.equal(r.game.turn, 'yellow');
    assert.equal((await emit(a, 'game:move', { col: 3, moveNumber: r.game.moves.length })).error, 'OPPONENT_OFFLINE');
    // Terceiro não pode "roubar" o lugar de quem caiu
    const thief = await connect();
    assert.equal((await emit(thief, 'room:join', { code: room.code, name: 'Ladrão' })).error, 'ROOM_FULL');
    thief.close();

    const backP = waitEvent(a, 'reconnected');
    b = await connect();
    const lookup = await emit(b, 'room:lookup', { code: room.code, token: tokenB });
    assert.equal(lookup.mySeat, 'red');
    const rb = await emit(b, 'room:join', { code: room.code, token: tokenB });
    assert.ok(rb.ok);
    assert.equal(rb.color, 'red');
    assert.equal(rb.name, 'Bruno');
    assert.equal(JSON.stringify(rb.state.game.board), before);
    assert.ok(rb.chat.length >= 2, 'histórico do chat recuperado');
    await backP;
    assert.equal(r.players.red.connected, true);

    // Mesmo token noutra janela → a sessão antiga é substituída
    const replacedP = once(b, 'session:replaced');
    const b2 = await connect();
    assert.ok((await emit(b2, 'room:join', { code: room.code, token: tokenB })).ok);
    await replacedP;
    assert.equal((await emit(b, 'chat:send', { text: 'antigo' })).error, 'NOT_IN_ROOM');
    b.close();
    b = b2;
  });

  await t.test('reconexão com o cliente Socket.IO a religar sozinho', async () => {
    const r = manager.rooms.get(room.code);
    const s = ioc(BASE, { transports: ['websocket'], forceNew: true, reconnectionDelay: 50, reconnectionDelayMax: 100 });
    await once(s, 'connect');
    // usa o lugar do Bruno
    assert.ok((await emit(s, 'room:join', { code: room.code, token: tokenB })).ok);
    let rejoined = false;
    s.on('connect', async () => {
      const res = await emit(s, 'room:join', { code: room.code, token: tokenB });
      rejoined = res.ok;
    });
    s.io.engine.close(); // corte de rede simulado
    await new Promise((res) => setTimeout(res, 600));
    assert.ok(rejoined, 'voltou a entrar automaticamente');
    assert.equal(r.players.red.connected, true);
    b.close();
    b = s;
  });

  await t.test('abandonar a mesa liberta o lugar', async () => {
    const leftP = waitEvent(a, 'left');
    await emit(b, 'room:leave');
    await leftP;
    const r = manager.rooms.get(room.code);
    assert.equal(r.players.red, null);
    assert.equal(r.game, null);
    const c = await connect();
    const rc = await emit(c, 'room:join', { code: room.code, name: 'Carla' });
    assert.ok(rc.ok);
    assert.equal(rc.color, 'red');
    b.close();
    b = c;
  });

  await t.test('administrador: reiniciar, terminar sessões, eliminar, atividade', async () => {
    const resetP = waitEvent(a, 'reset');
    assert.equal((await http('POST', `/api/admin/rooms/${room.code}/reset`, { cookie: adminCookie, headers: ADMIN_H })).status, 200);
    await resetP;

    const act = await http('GET', '/api/admin/activity', { cookie: adminCookie });
    assert.equal(act.status, 200);
    assert.ok(act.data.log.length > 5);
    assert.equal(act.data.stats.online, 2);

    const endedP = once(a, 'session:ended');
    assert.equal((await http('POST', `/api/admin/rooms/${room.code}/kick`, { cookie: adminCookie, headers: ADMIN_H })).status, 200);
    await endedP;
    assert.equal(manager.rooms.get(room.code).players.yellow, null);

    // Volta a sentar alguém e elimina a mesa
    assert.ok((await emit(a, 'room:join', { code: room.code, name: 'Ana' })).ok);
    const closedP = once(a, 'room:closed');
    assert.equal((await http('DELETE', `/api/admin/rooms/${room.code}`, { cookie: adminCookie, headers: ADMIN_H })).status, 200);
    await closedP;
    assert.equal((await emit(a, 'room:lookup', { code: room.code })).error, 'ROOM_NOT_FOUND');
    assert.equal((await http('DELETE', `/api/admin/rooms/${room.code}`, { cookie: adminCookie, headers: ADMIN_H })).status, 404);
    a.close();
    b.close();
  });

  await t.test('terminar todas as sessões de administrador', async () => {
    assert.equal((await http('POST', '/api/admin/sessions/logout-all', { cookie: adminCookie, headers: ADMIN_H })).status, 200);
    assert.equal((await http('GET', '/api/admin/rooms', { cookie: adminCookie })).status, 401);
  });

  await t.test('limitação de tentativas de login', async () => {
    let last;
    for (let i = 0; i < 10; i++) last = await http('POST', '/api/admin/login', { body: { password: `x${i}` } });
    assert.equal(last.status, 429);
  });

  await t.test('jogo completo com duas salas em paralelo', async () => {
    // Nova sessão (outro IP lógico não é possível aqui; repõe o limitador)
    const ok = await http('POST', '/api/admin/login', { body: { password: process.env.ADMIN_PASSWORD }, headers: { 'X-Forwarded-For': '10.9.9.9' } });
    assert.equal(ok.status, 200);
    adminCookie = ok.headers.get('set-cookie').split(';')[0];
    const r1 = await createRoom();
    const r2 = await createRoom();
    const p1 = await seatTwo(r1.code);
    const p2 = await seatTwo(r2.code);
    const leak = [];
    p2.a.on('room:state', (s) => s.code !== r2.code && leak.push(s));
    await playSeq(r1.code, { red: p1.a, yellow: p1.b }, [0, 1, 0, 1, 0, 1, 0]);
    assert.equal(manager.rooms.get(r1.code).game.winner, 'red');
    assert.equal(manager.rooms.get(r2.code).game.moves.length, 0);
    assert.equal(leak.length, 0, 'eventos não passam entre mesas');
    [p1.a, p1.b, p2.a, p2.b].forEach((s) => s.close());
  });
});
