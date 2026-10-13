import type { Action, BoardMap, Cell, PieceType, Player } from "./types";
import { HAND_LABEL, PIECE_LABEL, cellKeyOf } from "./types";
import { formatCell } from "./board";

export interface KifuEntry {
  moveNumber: number;
  player: Player;
  action: Action;
  /** 例: ▲9五歩 / ▲同歩 */
  text: string;
  /** 移動元（打ちは null） */
  from: { file: number; rank: number } | null;
  /** 移動先 */
  to: { file: number; rank: number };
}

function pieceName(type: PieceType): string {
  return PIECE_LABEL[type];
}

function mark(player: Player): string {
  return player === "black" ? "▲" : "△";
}

function sameSquare(
  a: { file: number; rank: number },
  b: { file: number; rank: number }
): boolean {
  return a.file === b.file && a.rank === b.rank;
}

/** 直前手の到着マスと同じなら「同」、否则は座標 */
function destLabel(
  to: Cell,
  prevTo: { file: number; rank: number } | null | undefined
): string {
  if (prevTo && sameSquare(to, prevTo)) return "同";
  return formatCell(to);
}

/**
 * 着手前の盤面情報を使って棋譜文字列を生成する。
 * @param prevTo 直前の着手の到着マス（同取り表記用）
 */
export function formatKifuAction(
  board: BoardMap,
  player: Player,
  action: Action,
  prevTo?: { file: number; rank: number } | null
): string {
  const m = mark(player);
  const dest = destLabel(action.to, prevTo);

  if (action.kind === "drop") {
    return `${m}${dest}${HAND_LABEL[action.piece]}打`;
  }

  const piece = board.get(cellKeyOf(action.from));
  const name = piece ? pieceName(piece.type) : "？";
  const promo = action.promote ? "成" : "";
  return `${m}${dest}${name}${promo}`;
}

export function formatKifuActionDetailed(
  board: BoardMap,
  player: Player,
  action: Action,
  couldPromote: boolean,
  prevTo?: { file: number; rank: number } | null
): string {
  const m = mark(player);
  const dest = destLabel(action.to, prevTo);

  if (action.kind === "drop") {
    return `${m}${dest}${HAND_LABEL[action.piece]}打`;
  }

  const piece = board.get(cellKeyOf(action.from));
  const name = piece ? pieceName(piece.type) : "？";
  let suffix = "";
  if (action.promote) suffix = "成";
  else if (couldPromote) suffix = "不成";
  return `${m}${dest}${name}${suffix}`;
}
