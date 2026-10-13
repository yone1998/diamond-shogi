import type { BoardMap, Cell, GameState, Piece, PieceType, Player } from "./types";
import { cellKey, emptyHand } from "./types";
import { allCells, isValidCell } from "./board";
import { positionKey } from "./moves";

interface Placement {
  file: number;
  rank: number;
  type: PieceType;
  owner: Player;
}

const INITIAL_PLACEMENTS: Placement[] = [
  // 後手1段目
  { file: 1, rank: 1, type: "lance", owner: "white" },
  { file: 3, rank: 1, type: "knight", owner: "white" },
  { file: 5, rank: 1, type: "silver", owner: "white" },
  { file: 7, rank: 1, type: "gold", owner: "white" },
  { file: 9, rank: 1, type: "king", owner: "white" },
  { file: 11, rank: 1, type: "gold", owner: "white" },
  { file: 13, rank: 1, type: "silver", owner: "white" },
  { file: 15, rank: 1, type: "knight", owner: "white" },
  { file: 17, rank: 1, type: "lance", owner: "white" },
  // 後手2段目（大駒は4・14筋）
  { file: 4, rank: 2, type: "rook", owner: "white" },
  { file: 14, rank: 2, type: "bishop", owner: "white" },
  // 後手3段目 歩
  ...([1, 3, 5, 7, 9, 11, 13, 15, 17] as const).map((file) => ({
    file,
    rank: 3,
    type: "pawn" as const,
    owner: "white" as const,
  })),
  // 先手7段目 歩
  ...([1, 3, 5, 7, 9, 11, 13, 15, 17] as const).map((file) => ({
    file,
    rank: 7,
    type: "pawn" as const,
    owner: "black" as const,
  })),
  // 先手8段目（大駒は4・14筋）
  { file: 4, rank: 8, type: "bishop", owner: "black" },
  { file: 14, rank: 8, type: "rook", owner: "black" },
  // 先手9段目
  { file: 1, rank: 9, type: "lance", owner: "black" },
  { file: 3, rank: 9, type: "knight", owner: "black" },
  { file: 5, rank: 9, type: "silver", owner: "black" },
  { file: 7, rank: 9, type: "gold", owner: "black" },
  { file: 9, rank: 9, type: "king", owner: "black" },
  { file: 11, rank: 9, type: "gold", owner: "black" },
  { file: 13, rank: 9, type: "silver", owner: "black" },
  { file: 15, rank: 9, type: "knight", owner: "black" },
  { file: 17, rank: 9, type: "lance", owner: "black" },
];

export function createInitialBoard(): BoardMap {
  const board: BoardMap = new Map();
  for (const p of INITIAL_PLACEMENTS) {
    if (!isValidCell(p.file, p.rank)) {
      throw new Error(`Invalid initial cell: ${p.file},${p.rank}`);
    }
    board.set(cellKey(p.file, p.rank), { type: p.type, owner: p.owner });
  }
  return board;
}

export function createInitialState(): GameState {
  const board = createInitialBoard();
  const state: GameState = {
    board,
    turn: "black",
    hands: {
      black: emptyHand(),
      white: emptyHand(),
    },
    history: [],
    positionCounts: new Map(),
    checkHistory: [],
    lastMoveWasCheck: false,
    result: null,
  };
  const key = positionKey(state);
  state.history.push(key);
  state.positionCounts.set(key, 1);
  return state;
}

export function getInitialPlacements(): readonly Placement[] {
  return INITIAL_PLACEMENTS;
}

/** 検証用: 初期配置の期待値 */
export function expectedPieceAt(file: number, rank: number): Piece | null {
  const p = INITIAL_PLACEMENTS.find((x) => x.file === file && x.rank === rank);
  return p ? { type: p.type, owner: p.owner } : null;
}

export function countPieces(board: BoardMap): { black: number; white: number; total: number } {
  let black = 0;
  let white = 0;
  for (const p of board.values()) {
    if (p.owner === "black") black++;
    else white++;
  }
  return { black, white, total: black + white };
}

export function emptyBoard(): BoardMap {
  return new Map();
}

export function placePiece(board: BoardMap, cell: Cell, piece: Piece): void {
  board.set(cellKey(cell.file, cell.rank), piece);
}

export { allCells, INITIAL_PLACEMENTS };
