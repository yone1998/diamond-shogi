import type { Cell, Player, PieceType, BoardMap, HandPiece } from "./types";
import { isValidCell } from "./board";
import { cellKey } from "./types";

export type Vec = readonly [number, number]; // [dFile, dRank]

/** 同じ筋方向 (上下) */
export const FILE_DIRS: Vec[] = [
  [0, -2],
  [0, 2],
];

/** 同じ段方向 (左右) */
export const RANK_DIRS: Vec[] = [
  [-2, 0],
  [2, 0],
];

/** 辺方向 (斜め4) */
export const EDGE_DIRS: Vec[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

/** 前後左右 (正交4) */
export const ORTHO_DIRS: Vec[] = [...FILE_DIRS, ...RANK_DIRS];

/** 全8方向 */
export const ALL8_DIRS: Vec[] = [...ORTHO_DIRS, ...EDGE_DIRS];

/** 前方の段方向符号: 先手は rank 減、後手は rank 増 */
export function forwardSign(player: Player): number {
  return player === "black" ? -1 : 1;
}

/** 前方1ユニット（通常将棋の1段前＝2段） */
export function forwardVec(player: Player): Vec {
  return [0, 2 * forwardSign(player)];
}

/** 後方1ユニット */
export function backwardVec(player: Player): Vec {
  return [0, -2 * forwardSign(player)];
}

/** 左右 */
export const LEFT: Vec = [-2, 0];
export const RIGHT: Vec = [2, 0];

/**
 * 斜め前方左右（辺方向）
 * 先手: 前=rank減 → (-1,-1), (+1,-1)
 * 後手: 前=rank増 → (-1,+1), (+1,+1)
 */
export function forwardDiagVecs(player: Player): Vec[] {
  const s = forwardSign(player);
  return [
    [-1, s],
    [1, s],
  ];
}

/**
 * 斜め後方左右
 */
export function backwardDiagVecs(player: Player): Vec[] {
  const s = -forwardSign(player);
  return [
    [-1, s],
    [1, s],
  ];
}

/** 桂馬の移動ベクトル */
export function knightVecs(player: Player): Vec[] {
  const s = forwardSign(player);
  return [
    [-1, 3 * s],
    [1, 3 * s],
  ];
}

export function addVec(cell: Cell, vec: Vec): Cell {
  return { file: cell.file + vec[0], rank: cell.rank + vec[1] };
}

export function step(cell: Cell, vec: Vec): Cell | null {
  const next = addVec(cell, vec);
  return isValidCell(next.file, next.rank) ? next : null;
}

/**
 * 王: 周囲8方向へ1マス
 */
export function kingDirs(_player: Player): Vec[] {
  return ALL8_DIRS;
}

/**
 * 金: 前・前左・前右・左・右・後 （後方斜め不可）
 */
export function goldDirs(player: Player): Vec[] {
  return [
    forwardVec(player),
    ...forwardDiagVecs(player),
    LEFT,
    RIGHT,
    backwardVec(player),
  ];
}

/**
 * 銀: 前・前左・前右・後左・後右 （左右・真後ろ不可）
 */
export function silverDirs(player: Player): Vec[] {
  return [
    forwardVec(player),
    ...forwardDiagVecs(player),
    ...backwardDiagVecs(player),
  ];
}

/**
 * と金・成香・成桂・成銀 = 金と同じ
 */
export function goldLikeDirs(player: Player): Vec[] {
  return goldDirs(player);
}

/**
 * 龍 = 飛 + 斜め1マス
 * 馬 = 角 + 正交1マス
 */
export function dragonStepDirs(): Vec[] {
  return EDGE_DIRS;
}

export function horseStepDirs(): Vec[] {
  return ORTHO_DIRS;
}

/** 成りのゾーン */
export function isPromotionZone(rank: number, player: Player): boolean {
  if (player === "black") {
    return rank >= 1 && rank <= 3;
  }
  return rank >= 7 && rank <= 9;
}

/**
 * 行き所のない駒か（打ち・移動後の強制成り判定用）
 *
 * 菱形将棋では通常将棋の1段前＝2段移動なので、
 * 「そのマスから前方に1手も進めない」位置を行き所なしとする。
 *
 * 歩・香（前方 (0, ±2)）:
 *   先手: rank 1 および rank 2（2段進むと盤外）
 *   後手: rank 9 および rank 8
 *
 * 桂（前方 (±1, ±3)）:
 *   先手: rank 1〜3
 *   後手: rank 7〜9
 */
export function hasNoMoveDestination(
  piece: HandPiece | "pawn" | "lance" | "knight",
  rank: number,
  player: Player
): boolean {
  if (piece === "pawn" || piece === "lance") {
    if (player === "black") return rank <= 2;
    return rank >= 8;
  }
  if (piece === "knight") {
    if (player === "black") return rank <= 3;
    return rank >= 7;
  }
  return false;
}

/** 強制成りが必要か（移動後に行き所がない） */
export function mustPromote(
  type: PieceType,
  toRank: number,
  player: Player
): boolean {
  if (type === "pawn" || type === "lance") {
    return hasNoMoveDestination(type, toRank, player);
  }
  if (type === "knight") {
    return hasNoMoveDestination("knight", toRank, player);
  }
  return false;
}

/** スライド移動の到達マス列（障害物手前まで、敵は捕獲可） */
export function slideTargets(
  board: BoardMap,
  from: Cell,
  dir: Vec,
  owner: Player
): Cell[] {
  const result: Cell[] = [];
  let cur = from;
  while (true) {
    const next = step(cur, dir);
    if (!next) break;
    const piece = board.get(cellKey(next.file, next.rank));
    if (!piece) {
      result.push(next);
      cur = next;
      continue;
    }
    if (piece.owner !== owner) {
      result.push(next); // 捕獲可
    }
    break;
  }
  return result;
}

/** 1マス移動の到達 */
export function stepTargets(
  board: BoardMap,
  from: Cell,
  dirs: Vec[],
  owner: Player
): Cell[] {
  const result: Cell[] = [];
  for (const d of dirs) {
    const next = step(from, d);
    if (!next) continue;
    const piece = board.get(cellKey(next.file, next.rank));
    if (!piece || piece.owner !== owner) {
      result.push(next);
    }
  }
  return result;
}
