'use strict';

/**
 * Motor do jogo Quatro em Linha.
 * Toda a lógica oficial vive aqui e é executada apenas no servidor:
 * o navegador nunca decide onde cai uma peça nem quem ganha.
 *
 * Convenção do tabuleiro: board[linha][coluna], linha 0 = topo, linha 5 = fundo.
 */

const ROWS = 6;
const COLS = 7;
const COLORS = ['red', 'yellow'];

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function otherColor(color) {
  return color === 'red' ? 'yellow' : 'red';
}

/** Linha livre mais baixa da coluna, ou -1 se a coluna estiver cheia. */
function lowestFreeRow(board, col) {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === null) return r;
  }
  return -1;
}

function isBoardFull(board) {
  return board[0].every((cell) => cell !== null);
}

/**
 * Procura um alinhamento de 4 ou mais peças que passe pela posição (row, col).
 * Devolve a lista de células [[r, c], ...] do alinhamento, ou null.
 */
function findWinningLine(board, row, col) {
  const color = board[row][col];
  if (!color) return null;
  const directions = [
    [0, 1], // horizontal
    [1, 0], // vertical
    [1, 1], // diagonal ↘
    [1, -1], // diagonal ↙
  ];
  for (const [dr, dc] of directions) {
    const line = [[row, col]];
    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === color) {
        if (sign === 1) line.push([r, c]);
        else line.unshift([r, c]);
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (line.length >= 4) return line;
  }
  return null;
}

class Game {
  /**
   * @param {'red'|'yellow'} startingColor quem joga primeiro nesta partida
   */
  constructor(startingColor = 'red') {
    this.board = createBoard();
    this.startingColor = startingColor;
    this.turn = startingColor;
    this.moves = [];
    this.status = 'playing'; // 'playing' | 'won' | 'draw'
    this.winner = null;
    this.winLine = null;
    this.startedAt = Date.now();
    this.endedAt = null;
  }

  /**
   * Tenta jogar uma peça. Valida turno, coluna e estado do jogo.
   * @returns {{ok: true, move: object} | {ok: false, error: string}}
   */
  play(color, col) {
    if (this.status !== 'playing') return { ok: false, error: 'GAME_OVER' };
    if (!COLORS.includes(color)) return { ok: false, error: 'INVALID_PLAYER' };
    if (color !== this.turn) return { ok: false, error: 'NOT_YOUR_TURN' };
    if (!Number.isInteger(col) || col < 0 || col >= COLS) return { ok: false, error: 'INVALID_COLUMN' };

    const row = lowestFreeRow(this.board, col);
    if (row === -1) return { ok: false, error: 'COLUMN_FULL' };

    this.board[row][col] = color;
    const move = { n: this.moves.length + 1, color, col, row, at: Date.now() };
    this.moves.push(move);

    const line = findWinningLine(this.board, row, col);
    if (line) {
      this.status = 'won';
      this.winner = color;
      this.winLine = line;
      this.endedAt = Date.now();
    } else if (isBoardFull(this.board)) {
      this.status = 'draw';
      this.endedAt = Date.now();
    } else {
      this.turn = otherColor(color);
    }
    return { ok: true, move };
  }

  toJSON() {
    return {
      board: this.board,
      turn: this.turn,
      status: this.status,
      winner: this.winner,
      winLine: this.winLine,
      moveCount: this.moves.length,
      lastMove: this.moves[this.moves.length - 1] || null,
      history: this.moves.slice(-12),
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      startingColor: this.startingColor,
    };
  }
}

module.exports = {
  ROWS,
  COLS,
  COLORS,
  Game,
  createBoard,
  otherColor,
  lowestFreeRow,
  findWinningLine,
  isBoardFull,
};
