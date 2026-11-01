/* Painel de administração — todas as ações são validadas no servidor. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const STATUS = { waiting: 'À espera', playing: 'Em jogo', won: 'Terminada', draw: 'Empate' };
  let refreshTimer = null;

  function toast(message, bad = false) {
    const t = document.createElement('div');
    t.className = `toast${bad ? ' bad' : ''}`;
    t.textContent = message;
    $('#toasts').appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 400);
    }, 3200);
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'quatro-em-linha' },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* sem corpo */
    }
    if (res.status === 401 && !url.endsWith('/login')) {
      showLogin();
    }
    return { status: res.status, ...data };
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Convite copiado!');
    } catch {
      prompt('Copia o convite:', text);
    }
  }

  function inviteMessage(url, code) {
    return `Vamos jogar Quatro em Linha? 🔴🟡\n${url}\nCódigo da mesa: ${code}`;
  }

  function fmtAgo(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'agora';
    const m = Math.round(s / 60);
    if (m < 60) return `há ${m} min`;
    const h = Math.round(m / 60);
    if (h < 48) return `há ${h} h`;
    return `há ${Math.round(h / 24)} dias`;
  }

  function fmtUptime(sec) {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function iconBtn(label, icon, cls, onClick) {
    const b = el('button', `btn ${cls}`);
    b.innerHTML = `<svg class="ico"><use href="#${icon}"/></svg>`;
    b.append(` ${label}`);
    b.addEventListener('click', onClick);
    return b;
  }

  /* ---------- Vistas ---------- */
  function showLogin() {
    clearInterval(refreshTimer);
    $('#panel-view').hidden = true;
    $('#login-view').hidden = false;
    $('#login-password').focus();
  }

  function showPanel() {
    $('#login-view').hidden = true;
    $('#panel-view').hidden = false;
    refresh();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(refresh, 4000);
  }

  /* ---------- Login ---------- */
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-error').textContent = '';
    const res = await api('POST', '/api/admin/login', { password: $('#login-password').value });
    if (!res.ok) {
      $('#login-error').textContent = res.message || 'Não foi possível entrar.';
      return;
    }
    $('#login-password').value = '';
    showPanel();
  });

  $('#btn-logout').addEventListener('click', async () => {
    await api('POST', '/api/admin/logout');
    showLogin();
  });

  $('#btn-logout-all').addEventListener('click', async () => {
    if (!confirm('Terminar todas as sessões de administrador (incluindo esta)?')) return;
    await api('POST', '/api/admin/sessions/logout-all');
    showLogin();
  });

  /* ---------- Criar mesa ---------- */
  $('#create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#btn-create');
    btn.disabled = true;
    const res = await api('POST', '/api/admin/rooms', { label: $('#room-label').value });
    btn.disabled = false;
    if (!res.ok) return toast(res.message || 'Erro ao criar mesa.', true);
    $('#room-label').value = '';
    const { code, inviteUrl } = res.room;
    $('#new-code').textContent = code;
    $('#new-link').textContent = inviteUrl;
    $('#new-link').href = inviteUrl;
    $('#btn-new-join').href = inviteUrl;
    $('#btn-new-copy').onclick = () => copy(inviteMessage(inviteUrl, code));
    $('#new-room').hidden = false;
    toast(`Mesa ${code} criada.`);
    refresh();
  });

  /* ---------- Lista de mesas ---------- */
  function renderRooms(rooms) {
    const box = $('#rooms');
    box.innerHTML = '';
    $('#rooms-empty').hidden = rooms.length > 0;
    for (const r of rooms) {
      const card = el('article', 'room-card');
      const top = el('div', 'room-top');
      top.append(el('span', 'room-code', r.code));
      if (r.label) top.append(el('span', 'room-label', r.label));
      top.append(el('span', `badge ${r.status}`, STATUS[r.status] || r.status));
      card.append(top);

      const players = el('div', 'room-players');
      for (const color of ['red', 'yellow']) {
        const p = r.players[color];
        const row = el('div', 'room-player');
        row.append(el('span', `piece ${color}`));
        if (p) {
          row.append(el('span', `dot ${p.connected ? 'on' : 'off'}`));
          row.append(el('span', '', p.name));
          row.append(el('span', 'muted', p.connected ? 'ligado' : `desligado ${fmtAgo(p.lastSeen)}`));
        } else {
          row.append(el('span', 'free', 'Lugar livre'));
        }
        row.append(el('span', 'score', String(r.score[color])));
        players.append(row);
      }
      card.append(players);

      const meta = el('div', 'room-meta');
      meta.append(el('span', '', `Criada ${fmtAgo(r.createdAt)}`));
      meta.append(el('span', '', `Partida nº ${r.round || '—'}`));
      meta.append(el('span', '', `${r.moves} jogadas`));
      meta.append(el('span', '', `Empates: ${r.score.draws}`));
      meta.append(el('span', '', `Atividade ${fmtAgo(r.lastActivity)}`));
      card.append(meta);

      const actions = el('div', 'room-actions');
      actions.append(iconBtn('Convite', 'i-copy', 'btn-ghost', () => copy(inviteMessage(r.inviteUrl, r.code))));
      const join = el('a', 'btn btn-ghost');
      join.href = r.inviteUrl;
      join.target = '_blank';
      join.rel = 'noopener';
      join.innerHTML = '<svg class="ico"><use href="#i-play"/></svg> Entrar';
      actions.append(join);
      actions.append(
        iconBtn('Reiniciar', 'i-refresh', 'btn-ghost', async () => {
          const res = await api('POST', `/api/admin/rooms/${r.code}/reset`);
          toast(res.ok ? 'Partida reiniciada.' : res.message || 'Erro.', !res.ok);
          refresh();
        })
      );
      actions.append(
        iconBtn('Expulsar', 'i-userx', 'btn-ghost', async () => {
          if (!confirm(`Terminar as sessões dos jogadores da mesa ${r.code}? Os lugares ficam livres.`)) return;
          const res = await api('POST', `/api/admin/rooms/${r.code}/kick`);
          toast(res.ok ? 'Sessões terminadas.' : res.message || 'Erro.', !res.ok);
          refresh();
        })
      );
      actions.append(
        iconBtn('Eliminar', 'i-trash', 'btn-danger', async () => {
          if (!confirm(`Eliminar definitivamente a mesa ${r.code}?`)) return;
          const res = await api('DELETE', `/api/admin/rooms/${r.code}`);
          toast(res.ok ? `Mesa ${r.code} eliminada.` : res.message || 'Erro.', !res.ok);
          refresh();
        })
      );
      card.append(actions);
      box.append(card);
    }
  }

  function renderActivity(data) {
    const s = data.server;
    $('#k-rooms').textContent = data.stats.rooms;
    $('#k-playing').textContent = data.stats.playing;
    $('#k-online').textContent = data.stats.online;
    $('#k-sockets').textContent = s.sockets;
    $('#k-uptime').textContent = fmtUptime(s.uptimeSec);
    $('#k-mem').textContent = `${s.memoryMb} MB`;
    const list = $('#activity');
    list.innerHTML = '';
    for (const e of data.log) {
      const li = el('li');
      li.append(el('time', '', new Date(e.at).toLocaleTimeString('pt-PT')));
      li.append(el('span', `type ${e.type}`, e.type));
      li.append(el('span', '', e.message));
      list.append(li);
    }
    if (!s.turnConfigured && !document.querySelector('.turn-note')) {
      const note = el('p', 'muted turn-note', 'Dica: configure um servidor TURN (TURN_URLS) para videochamadas fiáveis em redes móveis.');
      $('.admin-activity').append(note);
    }
  }

  async function refresh() {
    const [rooms, activity] = await Promise.all([api('GET', '/api/admin/rooms'), api('GET', '/api/admin/activity')]);
    if (rooms.ok) renderRooms(rooms.rooms);
    if (activity.ok) renderActivity(activity);
    $('#refresh-note').textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-PT')}`;
  }

  /* ---------- Arranque ---------- */
  (async () => {
    const s = await api('GET', '/api/admin/session');
    if (!s.configured) {
      showLogin();
      $('#login-error').textContent = 'A variável ADMIN_PASSWORD não está definida no servidor.';
      return;
    }
    if (s.authenticated) showPanel();
    else showLogin();
  })();
})();
