/* ==========================================================================
   Quatro em Linha Online — tabuleiro 3D, som, música e confetes.
   Este ficheiro só DESENHA o jogo. Todas as regras e validações são feitas
   no servidor; o navegador limita-se a pedir "quero jogar na coluna X".
   ========================================================================== */
(function () {
  'use strict';

  const ROWS = 6;
  const COLS = 7;
  // Geometria em "unidades" do SVG do tabuleiro (760 × 660).
  const W = 760;
  const H = 660;
  const PAD = 30;
  const CELL = 100;
  const HOLE_R = 38;
  const DISC = 82;

  const pctX = (u) => `${(u / W) * 100}%`;
  const pctY = (u) => `${(u / H) * 100}%`;
  const discLeft = (c) => PAD + c * CELL + (CELL - DISC) / 2;
  const discTop = (r) => PAD + r * CELL + (CELL - DISC) / 2;

  const svgNS = 'http://www.w3.org/2000/svg';

  function el(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  function buildFrontPlate() {
    const holes = [];
    const bevels = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cx = PAD + c * CELL + CELL / 2;
        const cy = PAD + r * CELL + CELL / 2;
        holes.push(`<circle cx="${cx}" cy="${cy}" r="${HOLE_R}" fill="#000"/>`);
        bevels.push(`<circle cx="${cx}" cy="${cy}" r="${HOLE_R + 2.6}" fill="none" stroke="url(#qel-bevel)" stroke-width="5.2"/>`);
      }
    }
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'board-front');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `
      <defs>
        <linearGradient id="qel-plate" x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0" stop-color="#3a74e6"/>
          <stop offset="0.35" stop-color="#2356c4"/>
          <stop offset="0.75" stop-color="#1a45a3"/>
          <stop offset="1" stop-color="#123482"/>
        </linearGradient>
        <radialGradient id="qel-sheen" cx="0.25" cy="-0.1" r="0.9">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
          <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.05"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="qel-bevel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000814" stop-opacity="0.65"/>
          <stop offset="0.45" stop-color="#06143a" stop-opacity="0.25"/>
          <stop offset="1" stop-color="#bcd3ff" stop-opacity="0.55"/>
        </linearGradient>
        <linearGradient id="qel-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#f6e2a6"/>
          <stop offset="0.3" stop-color="#d4af37"/>
          <stop offset="0.55" stop-color="#8c6a12"/>
          <stop offset="0.8" stop-color="#e9c766"/>
          <stop offset="1" stop-color="#9c7a1c"/>
        </linearGradient>
        <linearGradient id="qel-gloss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
          <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>
        <mask id="qel-holes" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
          <rect width="${W}" height="${H}" rx="34" fill="#fff"/>
          ${holes.join('')}
        </mask>
      </defs>
      <g mask="url(#qel-holes)">
        <rect width="${W}" height="${H}" rx="34" fill="url(#qel-plate)"/>
        <rect width="${W}" height="${H}" rx="34" fill="url(#qel-sheen)"/>
        <path d="M34 6 H726 Q754 6 754 34 V90 Q380 60 6 110 V34 Q6 6 34 6 Z" fill="url(#qel-gloss)"/>
        ${bevels.join('')}
      </g>
      <rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="32" fill="none" stroke="url(#qel-rim)" stroke-width="6"/>
      <rect x="12" y="12" width="${W - 24}" height="${H - 24}" rx="26" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1.5"/>
    `;
    return svg;
  }

  /* ------------------------------------------------------------------ */
  /* Tabuleiro                                                           */
  /* ------------------------------------------------------------------ */
  class BoardView {
    constructor(host, { onColumn, onImpact } = {}) {
      this.host = host;
      this.onColumn = onColumn || (() => {});
      this.onImpact = onImpact || (() => {});
      this.discs = new Map(); // "r-c" -> {el, color}
      this.myColor = 'red';
      this.interactive = false;
      this.hoverCol = null;
      this.winKey = null;
      this.build();
    }

    build() {
      this.host.innerHTML = '';
      const scene = el('div', 'board-scene locked', this.host);
      const lane = el('div', 'preview-lane', scene);
      this.preview = el('div', 'disc red', lane);
      const tilt = el('div', 'board-tilt', scene);
      el('div', 'table-surface', tilt);
      const feet = el('div', 'board-feet', tilt);
      el('span', '', feet);
      el('span', '', feet);
      const b3d = el('div', 'board-3d', tilt);
      el('div', 'board-depth', b3d);
      el('div', 'board-back', b3d);
      this.piecesLayer = el('div', 'pieces', b3d);
      b3d.appendChild(buildFrontPlate());
      this.fx = el('div', 'fx-layer', b3d);
      this.glows = [];
      for (let c = 0; c < COLS; c++) {
        const g = el('div', 'col-glow', this.fx);
        g.style.left = pctX(PAD + c * CELL);
        this.glows.push(g);
      }
      this.ringsLayer = el('div', '', this.fx);
      const hits = el('div', 'hit-cols', b3d);
      el('button', 'hit-col', hits).tabIndex = -1;
      this.hitButtons = [];
      for (let c = 0; c < COLS; c++) {
        const btn = el('button', 'hit-col', hits);
        btn.type = 'button';
        btn.dataset.col = String(c);
        btn.setAttribute('aria-label', `Jogar na coluna ${c + 1}`);
        btn.addEventListener('pointerenter', () => this.setHover(c));
        btn.addEventListener('focus', () => this.setHover(c));
        btn.addEventListener('click', () => this.trigger(c));
        this.hitButtons.push(btn);
      }
      el('button', 'hit-col', hits).tabIndex = -1;
      hits.addEventListener('pointerleave', () => this.setHover(null));
      this.scene = scene;

      // Teclado: setas para escolher, Enter/Espaço para jogar, 1–7 direto.
      document.addEventListener('keydown', (e) => {
        if (!this.interactive || e.target.closest('input, textarea')) return;
        if (e.key >= '1' && e.key <= '7') {
          this.trigger(Number(e.key) - 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const cur = this.hoverCol ?? 3;
          this.setHover(Math.max(0, Math.min(COLS - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1))));
          e.preventDefault();
        } else if ((e.key === 'Enter' || e.key === ' ') && this.hoverCol !== null && !e.target.closest('button')) {
          this.trigger(this.hoverCol);
          e.preventDefault();
        }
      });
    }

    trigger(col) {
      if (!this.interactive) return;
      this.onColumn(col);
    }

    setHover(col) {
      this.hoverCol = col;
      this.glows.forEach((g, i) => g.classList.toggle('active', i === col && this.interactive));
      if (col === null) {
        this.preview.classList.remove('show');
        return;
      }
      this.preview.style.left = pctX(discLeft(col));
      this.preview.classList.add('show');
    }

    setMyColor(color) {
      this.myColor = color;
      this.preview.className = `disc ${color}${this.hoverCol !== null ? ' show' : ''}`;
      this.preview.style.width = pctX(DISC);
    }

    setInteractive(on) {
      this.interactive = !!on;
      this.scene.classList.toggle('locked', !on);
      this.hitButtons.forEach((b) => (b.tabIndex = on ? 0 : -1));
      if (!on) this.glows.forEach((g) => g.classList.remove('active'));
      else if (this.hoverCol !== null) this.setHover(this.hoverCol);
    }

    createDisc(r, c, color) {
      const d = el('div', `disc ${color}`);
      d.style.left = pctX(discLeft(c));
      d.style.top = pctY(discTop(r));
      this.piecesLayer.appendChild(d);
      this.discs.set(`${r}-${c}`, { el: d, color });
      return d;
    }

    dropDisc(r, c, color) {
      const d = this.createDisc(r, c, color);
      // Distância de queda, em % da altura da própria peça.
      const fall = ((discTop(r) + 88) / DISC) * 100;
      const bounce = 10 + r * 2.2;
      const duration = 420 + r * 75;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.glows[c].classList.remove('flash');
      void this.glows[c].offsetWidth;
      this.glows[c].classList.add('flash');
      if (reduced || !d.animate) {
        this.impact(r, c);
        return Promise.resolve();
      }
      const anim = d.animate(
        [
          { transform: `translateY(-${fall}%)`, offset: 0, easing: 'cubic-bezier(.55,0,1,.7)' },
          { transform: 'translateY(0)', offset: 0.7, easing: 'cubic-bezier(.2,.6,.4,1)' },
          { transform: `translateY(-${bounce}%)`, offset: 0.82, easing: 'cubic-bezier(.6,0,1,1)' },
          { transform: 'translateY(0)', offset: 0.92, easing: 'ease-out' },
          { transform: `translateY(-${bounce / 3.5}%)`, offset: 0.96, easing: 'ease-in' },
          { transform: 'translateY(0)', offset: 1 },
        ],
        { duration, fill: 'both' }
      );
      setTimeout(() => this.impact(r, c), duration * 0.7);
      // Remove o efeito de animação no fim, para que a peça possa voltar a ser animada (ex.: ao limpar).
      return anim.finished.then(() => anim.cancel()).catch(() => {});
    }

    impact(r, c) {
      const ring = el('div', 'impact', this.fx);
      ring.style.left = pctX(discLeft(c));
      ring.style.top = pctY(discTop(r));
      setTimeout(() => ring.remove(), 600);
      this.onImpact(r, c);
    }

    clearAll(animated) {
      const list = [...this.discs.values()];
      this.discs.clear();
      this.clearWin();
      if (!animated) {
        list.forEach((d) => d.el.remove());
        return;
      }
      list.forEach((d, i) => {
        setTimeout(() => {
          d.el.classList.add('leaving');
          d.el.style.transform = 'translateY(700%)';
        }, (i % 7) * 25);
        setTimeout(() => d.el.remove(), 900);
      });
    }

    clearWin() {
      this.ringsLayer.innerHTML = '';
      this.winKey = null;
      for (const d of this.discs.values()) d.el.classList.remove('win', 'dim');
    }

    showWin(line) {
      const key = line.map(([r, c]) => `${r}-${c}`).join('|');
      if (this.winKey === key) return;
      this.clearWin();
      this.winKey = key;
      const winning = new Set(line.map(([r, c]) => `${r}-${c}`));
      for (const [k, d] of this.discs) {
        if (winning.has(k)) d.el.classList.add('win');
        else d.el.classList.add('dim');
      }
      line.forEach(([r, c], i) => {
        const ring = el('div', 'win-ring', this.ringsLayer);
        ring.style.left = pctX(PAD + c * CELL + (CELL - 94) / 2);
        ring.style.top = pctY(PAD + r * CELL + (CELL - 94) / 2);
        ring.style.animationDelay = `${i * 0.12}s, ${0.6 + i * 0.12}s`;
      });
    }

    /**
     * Sincroniza o desenho com o estado do servidor.
     * Se a última jogada for nova, anima a queda; o resto aparece no lugar.
     * @returns {Promise} resolvida quando a animação termina
     */
    render(game, { animate = true } = {}) {
      const board = game ? game.board : null;
      // Reinício: há peças desenhadas que já não existem no estado.
      for (const [key, d] of this.discs) {
        const [r, c] = key.split('-').map(Number);
        if (!board || board[r][c] !== d.color) {
          this.clearAll(true);
          break;
        }
      }
      if (!board) return Promise.resolve();
      const last = game.lastMove;
      let pending = Promise.resolve();
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const color = board[r][c];
          if (!color || this.discs.has(`${r}-${c}`)) continue;
          if (animate && last && last.row === r && last.col === c) pending = this.dropDisc(r, c, color);
          else this.createDisc(r, c, color);
        }
      }
      return pending.then(() => {
        if (game.winLine) this.showWin(game.winLine);
        else if (this.winKey) this.clearWin();
      });
    }

    shakeColumn() {
      this.scene.classList.remove('shake');
      void this.scene.offsetWidth;
      this.scene.classList.add('shake');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Som                                                                 */
  /* ------------------------------------------------------------------ */
  class SoundManager {
    constructor() {
      this.ctx = null;
      this.buffers = {};
      this.enabled = true;
      this.volume = 0.7;
      this.master = null;
      this.names = ['drop', 'win', 'lose', 'draw', 'chat', 'join', 'click', 'ring'];
      const unlock = () => {
        this.init();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      };
      ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));
    }

    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      this.names.forEach((n) => this.load(n));
    }

    async load(name) {
      try {
        const res = await fetch(`sounds/${name}.wav`);
        const data = await res.arrayBuffer();
        this.buffers[name] = await this.ctx.decodeAudioData(data);
      } catch (e) {
        /* som opcional */
      }
    }

    setVolume(v) {
      this.volume = v;
      if (this.master) this.master.gain.value = v;
    }

    play(name, { rate = 1, gain = 1 } = {}) {
      if (!this.enabled || !this.ctx || !this.buffers[name]) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffers[name];
      src.playbackRate.value = rate;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(this.master);
      src.start();
    }
  }

  /* Música ambiente gerada em tempo real (sem ficheiros pesados). */
  class AmbientMusic {
    constructor(sound) {
      this.sound = sound;
      this.playing = false;
      this.timer = null;
      this.step = 0;
      this.out = null;
      // Progressão suave: Am9 – Fmaj7 – Cmaj7 – G6
      this.chords = [
        [220.0, 261.63, 329.63, 493.88],
        [174.61, 220.0, 261.63, 329.63],
        [130.81, 196.0, 246.94, 329.63],
        [196.0, 246.94, 293.66, 329.63],
      ];
    }

    start() {
      this.sound.init();
      const ctx = this.sound.ctx;
      if (!ctx || this.playing) return;
      this.playing = true;
      this.out = ctx.createGain();
      this.out.gain.value = 0.0001;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      this.out.connect(lp).connect(this.sound.master);
      this.out.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 2);
      const tick = () => {
        if (!this.playing) return;
        this.playChord(this.chords[this.step % this.chords.length]);
        this.step++;
        this.timer = setTimeout(tick, 6000);
      };
      tick();
    }

    playChord(freqs) {
      const ctx = this.sound.ctx;
      const t = ctx.currentTime;
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        osc.type = i === 0 ? 'sine' : 'triangle';
        osc.frequency.value = f;
        osc.detune.value = (Math.random() - 0.5) * 8;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.09 / (i + 1.2), t + 2.2);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 7.5);
        osc.connect(g).connect(this.out);
        osc.start(t);
        osc.stop(t + 7.6);
      });
      // Pequena melodia de "caixinha de música"
      const notes = [freqs[3] * 2, freqs[2] * 2, freqs[1] * 2];
      notes.forEach((f, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f;
        const g = ctx.createGain();
        const st = t + 1.2 + i * 1.3 + Math.random() * 0.2;
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(0.035, st + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 1.6);
        osc.connect(g).connect(this.out);
        osc.start(st);
        osc.stop(st + 1.7);
      });
    }

    stop() {
      if (!this.playing) return;
      this.playing = false;
      clearTimeout(this.timer);
      const ctx = this.sound.ctx;
      if (this.out && ctx) {
        const out = this.out;
        out.gain.cancelScheduledValues(ctx.currentTime);
        out.gain.setValueAtTime(out.gain.value || 0.1, ctx.currentTime);
        out.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
        setTimeout(() => out.disconnect(), 1500);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Confetes                                                            */
  /* ------------------------------------------------------------------ */
  class Confetti {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.parts = [];
      this.running = false;
    }

    burst({ hearts = false } = {}) {
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = innerWidth * dpr;
      this.canvas.height = innerHeight * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const colors = ['#f6e2a6', '#d4af37', '#ef2b35', '#ffd43a', '#ffffff', '#3a74e6'];
      for (let i = 0; i < 220; i++) {
        this.parts.push({
          x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3,
          y: innerHeight * 0.35,
          vx: (Math.random() - 0.5) * 16,
          vy: -Math.random() * 15 - 4,
          r: Math.random() * 6 + 4,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.3,
          color: colors[(Math.random() * colors.length) | 0],
          heart: hearts && Math.random() < 0.35,
          life: 0,
        });
      }
      if (!this.running) {
        this.running = true;
        requestAnimationFrame(() => this.frame());
      }
    }

    frame() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      this.parts = this.parts.filter((p) => p.y < innerHeight + 40 && p.life < 420);
      for (const p of this.parts) {
        p.life++;
        p.vy += 0.32;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.heart) {
          ctx.font = `${p.r * 3}px serif`;
          ctx.fillText('❤', 0, 0);
        } else {
          ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
        }
        ctx.restore();
      }
      if (this.parts.length) requestAnimationFrame(() => this.frame());
      else {
        this.running = false;
        ctx.clearRect(0, 0, innerWidth, innerHeight);
      }
    }
  }

  window.QEL = { BoardView, SoundManager, AmbientMusic, Confetti, ROWS, COLS };
})();
