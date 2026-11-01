/* ==========================================================================
   Quatro em Linha Online — aplicação do jogador
   Entrada na mesa · multiplayer em tempo real · chat · videochamada WebRTC
   ========================================================================== */
(function () {
  'use strict';

  const { BoardView, SoundManager, AmbientMusic, Confetti } = window.QEL;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const COLOR_LABEL = { red: 'Vermelho', yellow: 'Amarelo' };
  const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

  /* ------------------------------------------------------------------ */
  /* Armazenamento local (tolerante a falhas)                            */
  /* ------------------------------------------------------------------ */
  const store = {
    get(key, fallback = null) {
      try {
        const v = localStorage.getItem(`qel.${key}`);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(`qel.${key}`, JSON.stringify(value));
      } catch {
        /* ignorar */
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(`qel.${key}`);
      } catch {
        /* ignorar */
      }
    },
  };

  /* ------------------------------------------------------------------ */
  /* Estado da aplicação                                                 */
  /* ------------------------------------------------------------------ */
  const app = {
    code: null,
    token: null,
    color: null,
    name: null,
    state: null,
    pendingMove: false,
    timeOffset: 0,
    joined: false,
    lastResultKey: null,
  };

  const sound = new SoundManager();
  const music = new AmbientMusic(sound);
  const confetti = new Confetti($('#confetti'));
  const settings = Object.assign({ sfx: true, music: false, romantic: false, volume: 70 }, store.get('settings', {}));

  /* ------------------------------------------------------------------ */
  /* Utilitários de interface                                            */
  /* ------------------------------------------------------------------ */
  function pieceEl(color, cls = '') {
    const s = document.createElement('span');
    s.className = `piece ${color} ${cls}`.trim();
    return s;
  }

  function toast(message, { color, bad = false, duration = 3800, actions } = {}) {
    const t = document.createElement('div');
    t.className = `toast${bad ? ' bad' : ''}`;
    if (color) t.appendChild(pieceEl(color));
    const span = document.createElement('span');
    span.textContent = message;
    t.appendChild(span);
    if (actions) {
      const box = document.createElement('div');
      box.className = 'toast-actions';
      actions.forEach(({ label, kind, onClick }) => {
        const b = document.createElement('button');
        b.className = `btn ${kind || 'btn-ghost'}`;
        b.textContent = label;
        b.addEventListener('click', () => {
          onClick();
          close();
        });
        box.appendChild(b);
      });
      t.appendChild(box);
    }
    $('#toasts').appendChild(t);
    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      t.classList.add('out');
      setTimeout(() => t.remove(), 400);
    }
    if (duration) setTimeout(close, duration);
    return { close };
  }

  function openModal(id) {
    $(id).hidden = false;
  }

  function closeModal(id) {
    $(id).hidden = true;
  }

  $$('.modal').forEach((m) => {
    m.addEventListener('click', (e) => {
      if (e.target === m || e.target.closest('[data-close]')) m.hidden = true;
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('.modal').forEach((m) => m.id !== 'modal-call' && (m.hidden = true));
  });

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  function inviteUrl() {
    return `${location.origin}/?sala=${app.code}`;
  }

  async function copyInvite() {
    const url = inviteUrl();
    const text = `Vamos jogar Quatro em Linha? 🔴🟡\n${url}\nCódigo da mesa: ${app.code}`;
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: 'Quatro em Linha Online', text });
        return;
      } catch {
        /* cancelado: copiar */
      }
    }
    const ok = await copyText(text);
    toast(ok ? 'Convite copiado! Envia-o ao teu adversário.' : `Convite: ${url}`);
  }

  function fmtTime(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function normalizeCode(v) {
    return (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }

  /* ------------------------------------------------------------------ */
  /* Definições                                                          */
  /* ------------------------------------------------------------------ */
  function buildAmbient() {
    const box = $('#ambient');
    if (box.childElementCount) return;
    for (let i = 0; i < 90; i++) {
      const s = document.createElement('span');
      s.className = 'star';
      s.style.left = `${Math.random() * 100}%`;
      s.style.top = `${Math.random() * 100}%`;
      s.style.animationDelay = `${Math.random() * 3}s`;
      s.style.animationDuration = `${2 + Math.random() * 3}s`;
      const size = Math.random() < 0.15 ? 3 : 2;
      s.style.width = s.style.height = `${size}px`;
      box.appendChild(s);
    }
    const hearts = ['❤️', '💛', '💚', '❤️', '🤍'];
    for (let i = 0; i < 14; i++) {
      const h = document.createElement('span');
      h.className = 'float-heart';
      h.textContent = hearts[i % hearts.length];
      h.style.left = `${Math.random() * 100}%`;
      h.style.animationDuration = `${14 + Math.random() * 14}s`;
      h.style.animationDelay = `${Math.random() * 20}s`;
      h.style.fontSize = `${12 + Math.random() * 14}px`;
      box.appendChild(h);
    }
  }

  function applySettings() {
    sound.enabled = settings.sfx;
    sound.setVolume(settings.volume / 100);
    document.body.classList.toggle('romantic', settings.romantic);
    if (settings.romantic) buildAmbient();
    if (settings.music) music.start();
    else music.stop();
    $('#set-sfx').checked = settings.sfx;
    $('#set-music').checked = settings.music;
    $('#set-romantic').checked = settings.romantic;
    $('#set-volume').value = settings.volume;
    store.set('settings', settings);
  }

  $('#set-sfx').addEventListener('change', (e) => {
    settings.sfx = e.target.checked;
    applySettings();
    sound.play('click');
  });
  $('#set-music').addEventListener('change', (e) => {
    settings.music = e.target.checked;
    applySettings();
  });
  $('#set-romantic').addEventListener('change', (e) => {
    settings.romantic = e.target.checked;
    applySettings();
    if (settings.romantic) toast('Modo noite romântica ativado — Portugal ❤️ Brasil');
  });
  $('#set-volume').addEventListener('input', (e) => {
    settings.volume = Number(e.target.value);
    applySettings();
  });
  $('#btn-settings').addEventListener('click', () => openModal('#modal-settings'));

  /* ------------------------------------------------------------------ */
  /* Ligação Socket.IO                                                   */
  /* ------------------------------------------------------------------ */
  const socket = io({ reconnectionDelay: 800, reconnectionDelayMax: 4000, timeout: 15000 });
  let latency = null;

  function setConn(kind, text) {
    const pill = $('#conn-pill');
    pill.className = `pill pill-${kind}`;
    $('#conn-text').textContent = text;
    pill.title = text;
  }

  function emitAck(event, payload, timeoutMs = 8000) {
    return new Promise((resolve) => {
      if (!socket.connected) return resolve({ ok: false, error: 'OFFLINE', message: 'Sem ligação ao servidor.' });
      socket.timeout(timeoutMs).emit(event, payload, (err, res) => {
        if (err) resolve({ ok: false, error: 'TIMEOUT', message: 'O servidor não respondeu. Tenta novamente.' });
        else resolve(res || { ok: false });
      });
    });
  }

  socket.on('connect', async () => {
    setConn('ok', latency ? `Ligado · ${latency} ms` : 'Ligado');
    if (app.joined && app.code && app.token) {
      const res = await emitAck('room:join', { code: app.code, token: app.token });
      if (res.ok) onJoined(res, { silent: true });
      else handleLostSeat(res.message || 'Não foi possível voltar à mesa.');
    }
  });

  socket.on('disconnect', () => setConn('bad', 'Sem ligação'));
  socket.io.on('reconnect_attempt', () => setConn('warn', 'A religar…'));
  socket.io.on('reconnect_failed', () => setConn('bad', 'Sem ligação'));

  setInterval(() => {
    if (!socket.connected) return;
    const t0 = performance.now();
    socket.timeout(5000).emit('net:ping', null, (err) => {
      if (err) return setConn('warn', 'Ligação lenta');
      latency = Math.round(performance.now() - t0);
      setConn(latency > 400 ? 'warn' : 'ok', `Ligado · ${latency} ms`);
    });
  }, 5000);

  socket.on('server:restarting', (p) => toast(p.message, { duration: 6000 }));

  /* ------------------------------------------------------------------ */
  /* Entrada na mesa                                                     */
  /* ------------------------------------------------------------------ */
  const joinCode = $('#join-code');
  const joinName = $('#join-name');
  const joinError = $('#join-error');
  const roomInfo = $('#room-info');
  let lookupTimer = null;

  joinName.value = store.get('name', '') || '';

  function setRoomInfo(text, kind = '') {
    roomInfo.textContent = text;
    roomInfo.className = `room-info ${kind}`;
  }

  function updateSeats(info) {
    $$('.seat-note').forEach((n) => (n.textContent = ''));
    $$('input[name="color"]').forEach((r) => (r.disabled = false));
    if (!info || !info.ok) return;
    let free = null;
    for (const color of ['red', 'yellow']) {
      const radio = $(`input[name="color"][value="${color}"]`);
      const note = $(`.seat-note[data-seat="${color}"]`);
      const taken = info.seats[color];
      if (taken && info.mySeat !== color) {
        radio.disabled = true;
        note.textContent = `Ocupado · ${taken}`;
      } else {
        note.textContent = info.mySeat === color ? 'O teu lugar' : 'Disponível';
        if (!free) free = color;
      }
    }
    const checked = $('input[name="color"]:checked');
    if (info.mySeat) $(`input[name="color"][value="${info.mySeat}"]`).checked = true;
    else if (!checked || checked.disabled) {
      if (free) $(`input[name="color"][value="${free}"]`).checked = true;
    }
  }

  async function lookup(code) {
    const token = store.get(`token.${code}`);
    const res = await emitAck('room:lookup', { code, token });
    if (normalizeCode(joinCode.value) !== code) return res;
    if (!res.ok) {
      setRoomInfo(res.message || 'Mesa não encontrada.', 'bad');
      updateSeats(null);
      return res;
    }
    updateSeats(res);
    if (res.mySeat) setRoomInfo(`Mesa ${code} encontrada — o teu lugar está reservado.`, 'ok');
    else if (res.full) setRoomInfo('Esta mesa já tem dois jogadores.', 'bad');
    else {
      const seated = Object.values(res.seats).filter(Boolean);
      setRoomInfo(seated.length ? `${seated[0]} está à tua espera na mesa ${code}.` : `Mesa ${code} pronta. Sê o primeiro a sentar-te!`, 'ok');
    }
    return res;
  }

  joinCode.addEventListener('input', () => {
    const code = normalizeCode(joinCode.value);
    joinCode.value = code;
    joinError.textContent = '';
    clearTimeout(lookupTimer);
    if (code.length < 6) {
      setRoomInfo('');
      updateSeats(null);
      return;
    }
    if (!CODE_RE.test(code)) return setRoomInfo('Código inválido.', 'bad');
    lookupTimer = setTimeout(() => lookup(code), 250);
  });

  $('#join-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    joinError.textContent = '';
    const code = normalizeCode(joinCode.value);
    const name = joinName.value.trim();
    if (!CODE_RE.test(code)) {
      joinError.textContent = 'Introduz o código de 6 caracteres da mesa.';
      joinCode.focus();
      return;
    }
    const token = store.get(`token.${code}`);
    if (!name && !token) {
      joinError.textContent = 'Escreve o teu nome.';
      joinName.focus();
      return;
    }
    const color = ($('input[name="color"]:checked') || {}).value || 'red';
    const btn = $('#join-btn');
    btn.disabled = true;
    btn.textContent = 'A entrar…';
    const res = await emitAck('room:join', { code, name, color, token });
    btn.disabled = false;
    btn.textContent = 'Sentar à mesa';
    if (!res.ok) {
      joinError.textContent = res.message || 'Não foi possível entrar.';
      if (res.error === 'ROOM_FULL' || res.error === 'ROOM_NOT_FOUND') lookup(code);
      return;
    }
    if (name) store.set('name', name);
    onJoined(res);
  });

  function onJoined(res, { silent = false } = {}) {
    const firstEntry = !app.joined;
    app.code = res.state.code;
    app.token = res.token;
    app.color = res.color;
    app.name = res.name;
    app.joined = true;
    store.set(`token.${app.code}`, res.token);
    history.replaceState(null, '', `/?sala=${app.code}`);

    $('#screen-lobby').hidden = true;
    $('#screen-game').hidden = false;
    $('#room-code').textContent = app.code;
    $('#invite-code').textContent = app.code;
    board.setMyColor(app.color);

    if (firstEntry || !silent) {
      renderChatHistory(res.chat || []);
      if (!silent) {
        sound.play('join');
        toast(`Sentaste-te à mesa ${app.code} com as peças ${app.color === 'red' ? 'vermelhas' : 'amarelas'}.`, { color: app.color });
      }
    }
    applyState(res.state, { animate: false });
    if (silent) toast('Ligação restabelecida.', { duration: 2200 });
  }

  function backToLobby(message) {
    call.hangup(false);
    app.joined = false;
    app.state = null;
    app.lastResultKey = null;
    $('#screen-game').hidden = true;
    $('#screen-lobby').hidden = false;
    $$('.modal').forEach((m) => (m.hidden = true));
    board.render(null);
    if (message) joinError.textContent = message;
    if (app.code) {
      joinCode.value = app.code;
      lookup(app.code);
    }
  }

  function handleLostSeat(message) {
    store.remove(`token.${app.code}`);
    app.token = null;
    backToLobby(message);
  }

  socket.on('session:replaced', (p) => {
    app.joined = false;
    backToLobby(p.message);
  });
  socket.on('room:closed', (p) => {
    store.remove(`token.${app.code}`);
    app.token = null;
    backToLobby(p.message);
    toast(p.message, { bad: true, duration: 6000 });
  });
  socket.on('session:ended', (p) => {
    store.remove(`token.${app.code}`);
    app.token = null;
    backToLobby(p.message);
    toast(p.message, { bad: true, duration: 6000 });
  });

  /* ------------------------------------------------------------------ */
  /* Tabuleiro e estado                                                  */
  /* ------------------------------------------------------------------ */
  const board = new BoardView($('#board'), {
    onColumn: (col) => playColumn(col),
    onImpact: (r) => sound.play('drop', { rate: 0.92 + r * 0.03 + Math.random() * 0.06 }),
  });

  function myTurn() {
    const s = app.state;
    return !!(s && s.status === 'playing' && s.game && s.game.turn === app.color);
  }

  async function playColumn(col) {
    const s = app.state;
    if (!s || !s.game) return;
    if (s.status !== 'playing') return;
    if (!myTurn()) {
      board.shakeColumn();
      toast('Ainda não é a tua vez.', { duration: 1800 });
      return;
    }
    if (s.game.board[0][col]) {
      board.shakeColumn();
      toast('Essa coluna está cheia.', { duration: 1800 });
      return;
    }
    if (app.pendingMove) return;
    const opp = s.players[app.color === 'red' ? 'yellow' : 'red'];
    if (opp && !opp.connected) {
      toast('O adversário está desligado. Aguarda que volte.', { duration: 2500 });
      return;
    }
    app.pendingMove = true;
    board.setInteractive(false);
    const res = await emitAck('game:move', { col, moveNumber: s.game.moveCount });
    app.pendingMove = false;
    if (!res.ok) {
      if (res.error !== 'STALE_MOVE') toast(res.message || 'Jogada inválida.', { bad: true, duration: 2500 });
      updateInteractivity();
    }
  }

  function updateInteractivity() {
    board.setInteractive(myTurn() && !app.pendingMove);
  }

  socket.on('room:state', (state) => {
    if (!app.joined || state.code !== app.code) return;
    applyState(state, { animate: true });
  });

  function applyState(state, { animate }) {
    const prev = app.state;
    app.state = state;
    app.timeOffset = state.serverTime - Date.now();
    const g = state.game;

    // Jogadores
    for (const color of ['red', 'yellow']) {
      const card = $(`.player-card[data-color="${color}"]`);
      const p = state.players[color];
      card.querySelector('.player-name').textContent = p ? p.name : 'Lugar livre';
      card.querySelector('.status-text').textContent = !p ? 'À espera de jogador' : p.connected ? 'Ligado' : 'Desligado';
      card.classList.toggle('online', !!(p && p.connected));
      card.classList.toggle('offline', !!(p && !p.connected));
      card.classList.toggle('me', color === app.color);
      card.classList.toggle('turn', !!(g && state.status === 'playing' && g.turn === color));
      card.querySelector('.player-score').textContent = state.score[color];
    }

    // Estatísticas
    $('#stat-moves').textContent = g ? g.moveCount : 0;
    $('#stat-round').textContent = state.round || '—';
    $('#stat-draws').textContent = state.score.draws;
    renderHistory(state);

    // Espera pelo adversário
    $('#waiting-overlay').hidden = state.status !== 'waiting';

    // Tabuleiro
    const newRound = prev && prev.round !== state.round;
    const animateLast = animate && !newRound && prev && prev.game && g && g.moveCount === prev.game.moveCount + 1;
    const drawn = board.render(g, { animate: !!animateLast });
    updateBanner(state);
    updateInteractivity();
    updateRematchButton(state);

    // Fim de partida
    if (g && (g.status === 'won' || g.status === 'draw')) {
      const key = `${state.round}-${g.status}`;
      if (app.lastResultKey !== key) {
        app.lastResultKey = key;
        const justEnded = prev && prev.game && prev.round === state.round && prev.game.status === 'playing';
        if (justEnded) drawn.then(() => showResult(state));
      }
    } else if (g && g.status === 'playing') {
      app.lastResultKey = null;
      if (newRound) closeModal('#modal-result');
    }
  }

  function updateBanner(state) {
    const banner = $('#turn-banner');
    const g = state.game;
    banner.className = 'turn-banner';
    banner.textContent = '';
    const opp = state.players[app.color === 'red' ? 'yellow' : 'red'];
    if (state.status === 'waiting') {
      banner.textContent = 'À espera do adversário…';
      return;
    }
    if (g.status === 'won') {
      const w = state.players[g.winner];
      banner.appendChild(pieceEl(g.winner));
      banner.append(g.winner === app.color ? ' Ganhaste! Quatro em linha!' : ` ${w ? w.name : 'Adversário'} ganhou!`);
      return;
    }
    if (g.status === 'draw') {
      banner.textContent = 'Empate — tabuleiro cheio!';
      return;
    }
    if (opp && !opp.connected) {
      banner.textContent = `${opp.name} desligou-se… a aguardar reconexão`;
      return;
    }
    banner.appendChild(pieceEl(g.turn));
    if (g.turn === app.color) {
      banner.classList.add('mine');
      banner.append(' É a tua vez!');
    } else {
      banner.append(` Vez de ${state.players[g.turn].name}…`);
    }
  }

  function updateRematchButton(state) {
    const btn = $('#btn-rematch');
    const label = btn.querySelector('span');
    const g = state.game;
    btn.classList.remove('waiting');
    btn.disabled = state.status === 'waiting';
    const finished = g && g.status !== 'playing';
    const iVoted = state.rematchVotes.includes(app.color);
    const theyVoted = state.rematchVotes.some((c) => c !== app.color);
    if (iVoted) {
      label.textContent = 'À espera do adversário…';
      btn.classList.add('waiting');
    } else if (theyVoted) {
      label.textContent = finished ? 'Aceitar revanche' : 'Aceitar reinício';
    } else {
      label.textContent = finished ? 'Pedir revanche' : 'Propor reinício';
    }
    const resultBtn = $('#result-rematch');
    resultBtn.disabled = iVoted;
    resultBtn.lastChild.textContent = iVoted ? ' À espera…' : theyVoted ? ' Aceitar revanche' : ' Jogar novamente';
  }

  function renderHistory(state) {
    const list = $('#history-list');
    list.innerHTML = '';
    const g = state.game;
    if (!g || !g.history.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'Ainda sem jogadas.';
      list.appendChild(li);
      return;
    }
    [...g.history].reverse().forEach((m) => {
      const li = document.createElement('li');
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = `${m.n}.`;
      const p = state.players[m.color];
      const txt = document.createElement('span');
      txt.textContent = `${p ? p.name : COLOR_LABEL[m.color]} → coluna ${m.col + 1}`;
      li.append(num, pieceEl(m.color), txt);
      list.appendChild(li);
    });
  }

  const WIN_LINES = [
    'Que jogada! Quatro em linha perfeito.',
    'Vitória brilhante — estratégia de mestre!',
    'Imbatível hoje! Mais uma?',
    'Jogada de campeão. Parabéns!',
  ];
  const LOSE_LINES = [
    'Desta vez não deu… a revanche espera por ti!',
    'Foi por pouco! Pedes a desforra?',
    'Boa luta — a próxima é tua.',
  ];

  function showResult(state) {
    const g = state.game;
    const badge = $('#result-badge');
    badge.innerHTML = '';
    if (g.status === 'won') {
      const won = g.winner === app.color;
      const winner = state.players[g.winner];
      badge.appendChild(pieceEl(g.winner));
      $('#result-title').textContent = won ? 'Vitória!' : `${winner ? winner.name : 'Adversário'} ganhou`;
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
      $('#result-text').textContent = won ? `${pick(WIN_LINES)} Parabéns, ${app.name}! 🏆` : pick(LOSE_LINES);
      sound.play(won ? 'win' : 'lose');
      if (won) confetti.burst({ hearts: settings.romantic });
    } else {
      badge.append(pieceEl('red'), pieceEl('yellow'));
      $('#result-title').textContent = 'Empate!';
      $('#result-text').textContent = 'Tabuleiro cheio e ninguém cedeu. Equilíbrio total!';
      sound.play('draw');
    }
    setTimeout(() => openModal('#modal-result'), g.status === 'won' ? 900 : 300);
  }

  async function requestRematch() {
    const res = await emitAck('game:rematch');
    if (!res.ok) toast(res.message || 'Não foi possível.', { bad: true });
    else if (res.pending) toast('Pedido enviado. À espera da resposta do adversário…', { duration: 2500 });
    if (res.restarted) closeModal('#modal-result');
  }

  $('#btn-rematch').addEventListener('click', requestRematch);
  $('#result-rematch').addEventListener('click', requestRematch);

  // Cronómetro
  setInterval(() => {
    const s = app.state;
    if (!s || !s.game) {
      $('#stat-timer').textContent = '00:00';
      return;
    }
    const end = s.game.endedAt || Date.now() + app.timeOffset;
    $('#stat-timer').textContent = fmtTime(end - s.game.startedAt);
  }, 500);

  /* ------------------------------------------------------------------ */
  /* Eventos da mesa                                                     */
  /* ------------------------------------------------------------------ */
  let rematchToast = null;

  socket.on('room:event', (ev) => {
    if (!app.joined) return;
    switch (ev.type) {
      case 'joined':
        sound.play('join');
        toast(ev.message, { color: ev.color });
        systemMessage(ev.message);
        break;
      case 'reconnected':
        toast(ev.message, { color: ev.color, duration: 2500 });
        systemMessage(ev.message);
        break;
      case 'disconnected':
        toast(ev.message, { color: ev.color, bad: true });
        systemMessage(ev.message);
        break;
      case 'left':
        toast(ev.message, { color: ev.color, bad: true, duration: 5000 });
        systemMessage(ev.message);
        call.hangup(false);
        break;
      case 'rematch-request':
        if (rematchToast) rematchToast.close();
        sound.play('chat');
        rematchToast = toast(ev.message, {
          color: ev.color,
          duration: 20000,
          actions: [
            { label: 'Recusar', onClick: () => emitAck('game:rematch-decline') },
            { label: 'Aceitar', kind: 'btn-gold', onClick: requestRematch },
          ],
        });
        break;
      case 'rematch-declined':
        toast(ev.message, { bad: true });
        break;
      case 'restart':
      case 'reset':
        if (rematchToast) rematchToast.close();
        closeModal('#modal-result');
        toast(ev.message, { duration: 2500 });
        systemMessage(ev.message);
        break;
      default:
        if (ev.message) toast(ev.message);
    }
  });

  /* ------------------------------------------------------------------ */
  /* Abandonar / convite                                                 */
  /* ------------------------------------------------------------------ */
  function confirmLeave() {
    openModal('#modal-confirm');
  }

  $('#btn-leave').addEventListener('click', confirmLeave);
  $('#btn-leave-2').addEventListener('click', confirmLeave);
  $('#confirm-ok').addEventListener('click', async () => {
    closeModal('#modal-confirm');
    await emitAck('room:leave');
    store.remove(`token.${app.code}`);
    app.token = null;
    backToLobby('');
    toast('Saíste da mesa.');
  });

  $('#room-chip').addEventListener('click', copyInvite);
  $('#btn-copy-invite').addEventListener('click', copyInvite);

  /* ------------------------------------------------------------------ */
  /* Chat                                                                */
  /* ------------------------------------------------------------------ */
  const chatList = $('#chat-list');
  const chatInput = $('#chat-input');
  const EMOJIS = ['😀', '😂', '😉', '😍', '🥰', '😘', '😎', '🤔', '😮', '😅', '😭', '😡', '👏', '👍', '👎', '🙏', '💪', '🔥', '⭐', '🏆', '🎉', '❤️', '💛', '💚', '🇵🇹', '🇧🇷', '🔴', '🟡', '🤞', '😴', '🍷', '☕'];
  const EMOJI_ONLY = /^(\p{Extended_Pictographic}|\p{Regional_Indicator}|‍|️|\s)+$/u;

  function addMessage(m) {
    const div = document.createElement('div');
    const mine = m.color === app.color;
    div.className = `msg${mine ? ' mine' : ''}`;
    const who = document.createElement('div');
    who.className = 'who';
    const time = new Date(m.at).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    who.append(pieceEl(m.color), `${mine ? 'Tu' : m.name} · ${time}`);
    const text = document.createElement('div');
    text.className = 'text';
    if (EMOJI_ONLY.test(m.text) && [...m.text.replace(/\s/g, '')].length <= 6) text.classList.add('big');
    text.textContent = m.text;
    div.append(who, text);
    chatList.appendChild(div);
    chatList.scrollTop = chatList.scrollHeight;
  }

  function systemMessage(text) {
    const div = document.createElement('div');
    div.className = 'msg system';
    div.textContent = text;
    chatList.appendChild(div);
    chatList.scrollTop = chatList.scrollHeight;
  }

  function renderChatHistory(list) {
    chatList.innerHTML = '';
    if (!list.length) systemMessage('Mensagens privadas entre os dois jogadores.');
    list.forEach(addMessage);
  }

  socket.on('chat:message', (m) => {
    if (!app.joined) return;
    addMessage(m);
    $('#typing').hidden = true;
    if (m.color !== app.color) sound.play('chat');
  });

  let typingTimer = null;
  socket.on('chat:typing', () => {
    $('#typing').hidden = false;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => ($('#typing').hidden = true), 2500);
  });

  let lastTypingSent = 0;
  chatInput.addEventListener('input', () => {
    if (Date.now() - lastTypingSent > 1500 && chatInput.value.trim()) {
      lastTypingSent = Date.now();
      socket.emit('chat:typing');
    }
  });

  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    $('#emoji-picker').hidden = true;
    const res = await emitAck('chat:send', { text });
    if (!res.ok) {
      chatInput.value = text;
      toast(res.message || 'Mensagem não enviada.', { bad: true });
    }
  });

  const picker = $('#emoji-picker');
  EMOJIS.forEach((em) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = em;
    b.addEventListener('click', () => {
      const pos = chatInput.selectionStart ?? chatInput.value.length;
      chatInput.value = chatInput.value.slice(0, pos) + em + chatInput.value.slice(pos);
      chatInput.focus();
    });
    picker.appendChild(b);
  });
  $('#btn-emoji').addEventListener('click', () => (picker.hidden = !picker.hidden));
  document.addEventListener('click', (e) => {
    if (!picker.hidden && !e.target.closest('#emoji-picker, #btn-emoji')) picker.hidden = true;
  });

  /* ------------------------------------------------------------------ */
  /* Videochamada (WebRTC, negociação "perfect negotiation")             */
  /* ------------------------------------------------------------------ */
  const call = (() => {
    const panel = $('#video-panel');
    const remoteVideo = $('#remote-video');
    const localVideo = $('#local-video');
    const hint = $('#video-hint');
    const btnCall = $('#btn-call');
    const btnMic = $('#btn-mic');
    const btnCam = $('#btn-cam');
    const btnHang = $('#btn-hangup');
    const remoteMedia = $('#remote-media');

    let state = 'idle'; // idle | calling | ringing | connecting | connected
    let pc = null;
    let pcPromise = null;
    let localStream = null;
    let makingOffer = false;
    let ignoreOffer = false;
    let inviteTimer = null;
    let ringTimer = null;
    let micOn = true;
    let camOn = true;

    function setState(s, text) {
      state = s;
      panel.dataset.state = s;
      panel.classList.toggle('in-call', s !== 'idle');
      btnHang.disabled = s === 'idle';
      btnMic.disabled = !localStream || !localStream.getAudioTracks().length;
      btnCam.disabled = !localStream || !localStream.getVideoTracks().length;
      if (text) hint.textContent = text;
    }

    async function getMedia() {
      if (localStream) return localStream;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast('Este navegador não suporta videochamada (é necessário HTTPS).', { bad: true, duration: 6000 });
        return null;
      }
      const attempts = [
        { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } },
        { video: false, audio: true },
        { video: true, audio: false },
      ];
      for (const constraints of attempts) {
        try {
          localStream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
            toast('Permissão de câmara/microfone recusada. Podes ativá-la nas definições do navegador.', { bad: true, duration: 6000 });
            return null;
          }
        }
      }
      if (!localStream) {
        toast('Não foi encontrada câmara nem microfone. Vais apenas ver e ouvir o adversário.', { duration: 5000 });
        return null;
      }
      localVideo.srcObject = localStream;
      panel.classList.toggle('has-local', localStream.getVideoTracks().length > 0);
      micOn = true;
      camOn = localStream.getVideoTracks().length > 0;
      refreshButtons();
      return localStream;
    }

    function refreshButtons() {
      btnMic.classList.toggle('off', !micOn);
      btnCam.classList.toggle('off', !camOn);
      btnMic.querySelector('use').setAttribute('href', micOn ? '#i-mic' : '#i-mic-off');
      btnCam.querySelector('use').setAttribute('href', camOn ? '#i-cam' : '#i-cam-off');
      btnMic.title = micOn ? 'Desligar microfone' : 'Ligar microfone';
      btnCam.title = camOn ? 'Desligar câmara' : 'Ligar câmara';
      panel.classList.toggle('cam-off', !camOn);
      btnMic.disabled = !localStream || !localStream.getAudioTracks().length;
      btnCam.disabled = !localStream || !localStream.getVideoTracks().length;
    }

    function sendSignal(data) {
      socket.emit('rtc:signal', data);
    }

    function ensurePC() {
      if (pcPromise) return pcPromise;
      pcPromise = (async () => {
        const cfg = await emitAck('rtc:config');
        const iceServers = cfg.ok ? cfg.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }];
        pc = new RTCPeerConnection({ iceServers });
        const polite = app.color === 'yellow';

        if (localStream) {
          localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
          if (!localStream.getVideoTracks().length) pc.addTransceiver('video', { direction: 'recvonly' });
          if (!localStream.getAudioTracks().length) pc.addTransceiver('audio', { direction: 'recvonly' });
        } else {
          pc.addTransceiver('audio', { direction: 'recvonly' });
          pc.addTransceiver('video', { direction: 'recvonly' });
        }

        pc.ontrack = (e) => {
          const stream = e.streams[0] || new MediaStream([e.track]);
          if (remoteVideo.srcObject !== stream) remoteVideo.srcObject = stream;
          panel.classList.add('has-remote');
          remoteVideo.play().catch(() => {});
        };

        pc.onicecandidate = (e) => sendSignal({ candidate: e.candidate ? e.candidate.toJSON() : null });

        pc.onnegotiationneeded = async () => {
          try {
            makingOffer = true;
            await pc.setLocalDescription();
            sendSignal({ description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
          } catch (err) {
            console.warn('Negociação falhou', err);
          } finally {
            makingOffer = false;
          }
        };

        pc.onconnectionstatechange = () => {
          const s = pc && pc.connectionState;
          if (s === 'connected') {
            if (state !== 'connected') {
              setState('connected', 'Em chamada');
              toast('Videochamada ligada.', { duration: 2000 });
            }
          } else if (s === 'failed') {
            setState('connecting', 'A restabelecer a chamada…');
            try {
              pc.restartIce();
            } catch {
              /* ignorar */
            }
          } else if (s === 'disconnected') {
            hint.textContent = 'Ligação instável…';
          }
        };

        pc.oniceconnectionstatechange = () => {
          if (pc && pc.iceConnectionState === 'failed') {
            try {
              pc.restartIce();
            } catch {
              /* ignorar */
            }
          }
        };

        pc._polite = polite;
        return pc;
      })();
      return pcPromise;
    }

    async function onSignal({ description, candidate }) {
      if (state === 'idle' || state === 'ringing') return;
      const peer = await ensurePC();
      try {
        if (description) {
          const collision = description.type === 'offer' && (makingOffer || peer.signalingState !== 'stable');
          ignoreOffer = !peer._polite && collision;
          if (ignoreOffer) return;
          await peer.setRemoteDescription(description);
          if (description.type === 'offer') {
            await peer.setLocalDescription();
            sendSignal({ description: { type: peer.localDescription.type, sdp: peer.localDescription.sdp } });
          }
        } else if (candidate !== undefined) {
          try {
            await peer.addIceCandidate(candidate || undefined);
          } catch (err) {
            if (!ignoreOffer) console.warn('Candidato ICE rejeitado', err);
          }
        }
      } catch (err) {
        console.warn('Erro de sinalização', err);
      }
    }

    function stopRinging() {
      clearInterval(ringTimer);
      ringTimer = null;
    }

    async function start() {
      if (state !== 'idle') return;
      const s = app.state;
      const opp = s && s.players[app.color === 'red' ? 'yellow' : 'red'];
      if (!opp || !opp.connected) {
        toast('O adversário ainda não está na mesa.', { duration: 2500 });
        return;
      }
      setState('calling', 'A preparar câmara e microfone…');
      await getMedia();
      if (state !== 'calling') return;
      const res = await emitAck('rtc:invite');
      if (!res.ok) {
        toast(res.message || 'Não foi possível ligar ao adversário.', { bad: true });
        return cleanup();
      }
      setState('calling', `A chamar ${opp.name}…`);
      inviteTimer = setTimeout(() => {
        if (state === 'calling') {
          toast('Sem resposta à videochamada.');
          hangup(true);
        }
      }, 45000);
    }

    async function accept() {
      closeModal('#modal-call');
      stopRinging();
      setState('connecting', 'A ligar…');
      await getMedia();
      await ensurePC();
      socket.emit('rtc:accept');
    }

    function decline() {
      closeModal('#modal-call');
      stopRinging();
      socket.emit('rtc:decline');
      cleanup();
    }

    function hangup(notify = true) {
      if (state === 'idle') return;
      if (notify) socket.emit('rtc:hangup');
      cleanup();
    }

    function cleanup() {
      clearTimeout(inviteTimer);
      stopRinging();
      closeModal('#modal-call');
      if (pc) {
        pc.ontrack = pc.onicecandidate = pc.onnegotiationneeded = pc.onconnectionstatechange = null;
        pc.close();
      }
      pc = null;
      pcPromise = null;
      makingOffer = false;
      ignoreOffer = false;
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
      localVideo.srcObject = null;
      remoteVideo.srcObject = null;
      panel.classList.remove('has-remote', 'has-local', 'cam-off');
      remoteMedia.hidden = true;
      micOn = camOn = true;
      refreshButtons();
      setState('idle', 'Videochamada com o adversário');
      if (document.fullscreenElement === panel) document.exitFullscreen().catch(() => {});
    }

    socket.on('rtc:invite', ({ name }) => {
      if (!app.joined) return;
      if (state === 'calling') {
        // Os dois ligaram ao mesmo tempo: aceitar diretamente.
        clearTimeout(inviteTimer);
        setState('connecting', 'A ligar…');
        ensurePC().then(() => socket.emit('rtc:accept'));
        return;
      }
      if (state !== 'idle') return;
      setState('ringing', `${name} está a ligar…`);
      $('#call-from').textContent = name;
      openModal('#modal-call');
      sound.play('ring');
      ringTimer = setInterval(() => sound.play('ring'), 2500);
      setTimeout(() => {
        if (state === 'ringing') decline();
      }, 45000);
    });

    socket.on('rtc:accept', () => {
      if (state !== 'calling' && state !== 'connecting') return;
      clearTimeout(inviteTimer);
      setState('connecting', 'A ligar…');
      ensurePC();
    });

    socket.on('rtc:decline', ({ name }) => {
      if (state === 'idle') return;
      toast(`${name} recusou a videochamada.`);
      cleanup();
    });

    socket.on('rtc:hangup', ({ name }) => {
      if (state === 'idle') return;
      toast(`${name} terminou a videochamada.`);
      cleanup();
    });

    socket.on('rtc:signal', onSignal);

    socket.on('rtc:media', ({ mic, cam, name }) => {
      const parts = [];
      if (!mic) parts.push('🔇 microfone desligado');
      if (!cam) parts.push('📷 câmara desligada');
      remoteMedia.textContent = parts.length ? `${name}: ${parts.join(' · ')}` : '';
      remoteMedia.hidden = !parts.length;
    });

    function sendMediaState() {
      socket.emit('rtc:media', { mic: micOn, cam: camOn });
    }

    btnCall.addEventListener('click', start);
    btnHang.addEventListener('click', () => hangup(true));
    btnMic.addEventListener('click', () => {
      if (!localStream) return;
      micOn = !micOn;
      localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
      refreshButtons();
      sendMediaState();
    });
    btnCam.addEventListener('click', () => {
      if (!localStream) return;
      camOn = !camOn;
      localStream.getVideoTracks().forEach((t) => (t.enabled = camOn));
      refreshButtons();
      sendMediaState();
    });
    $('#btn-expand').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (panel.requestFullscreen) panel.requestFullscreen().catch(() => {});
      else if (remoteVideo.webkitEnterFullscreen) remoteVideo.webkitEnterFullscreen();
    });
    $('#call-accept').addEventListener('click', accept);
    $('#call-decline').addEventListener('click', decline);

    window.addEventListener('beforeunload', () => hangup(true));

    return { hangup, get state() { return state; } };
  })();

  /* ------------------------------------------------------------------ */
  /* Arranque                                                            */
  /* ------------------------------------------------------------------ */
  applySettings();

  const params = new URLSearchParams(location.search);
  const urlCode = normalizeCode(params.get('sala') || params.get('mesa') || params.get('code') || '');
  if (urlCode) {
    joinCode.value = urlCode;
    const tryAuto = async () => {
      const info = await lookup(urlCode);
      // Já tinha lugar nesta mesa (ex.: recarregou a página): volta a entrar automaticamente.
      if (info && info.ok && info.mySeat) {
        const res = await emitAck('room:join', { code: urlCode, token: store.get(`token.${urlCode}`) });
        if (res.ok) onJoined(res, { silent: false });
      } else if (!joinName.value) joinName.focus();
    };
    if (socket.connected) tryAuto();
    else socket.once('connect', tryAuto);
  } else {
    joinCode.focus();
  }

  // Exposto apenas para diagnóstico na consola.
  window.__qel = { app, socket };
})();
