/** 盤上・持駒に描画する駒面（1〜2文字） */
import type { PieceType, Player } from "./types";

export const PIECE_FACE: Record<PieceType, string> = {
  king: "王",
  gold: "金",
  silver: "銀",
  knight: "桂",
  lance: "香",
  rook: "飛",
  bishop: "角",
  pawn: "歩",
  promoted_silver: "全",
  promoted_knight: "圭",
  promoted_lance: "杏",
  promoted_pawn: "と",
  dragon: "龍",
  horse: "馬",
};

/** 先手玉は「玉」、後手玉は「王」 */
export function faceFor(type: PieceType, owner: Player): string {
  if (type === "king") return owner === "black" ? "玉" : "王";
  return PIECE_FACE[type];
}

/**
 * 駒種ごとの相対サイズ（本将棋の実駒に近い比率）
 * 基準 1.0 = 金・銀。菱形マスに収めるため最大でも約1.08。
 */
export function pieceSizeScale(type: PieceType): number {
  switch (type) {
    case "king":
      return 1.08;
    case "rook":
    case "dragon":
    case "bishop":
    case "horse":
      return 1.04;
    case "gold":
    case "silver":
    case "promoted_silver":
      return 1.0;
    case "knight":
    case "lance":
    case "promoted_knight":
    case "promoted_lance":
      return 0.94;
    case "pawn":
    case "promoted_pawn":
      return 0.88;
    default:
      return 1.0;
  }
}

/**
 * 将棋駒の五角形パス（上向き、中心 cx,cy）
 */
export function piecePolygon(cx: number, cy: number, w: number, h: number): string {
  const top = `${cx},${cy - h / 2}`;
  const ul = `${cx - w / 2},${cy - h * 0.18}`;
  const ur = `${cx + w / 2},${cy - h * 0.18}`;
  const bl = `${cx - w * 0.42},${cy + h / 2}`;
  const br = `${cx + w * 0.42},${cy + h / 2}`;
  return `${top} ${ur} ${br} ${bl} ${ul}`;
}

export function isPromotedFace(type: PieceType): boolean {
  return (
    type === "promoted_pawn" ||
    type === "promoted_lance" ||
    type === "promoted_knight" ||
    type === "promoted_silver" ||
    type === "dragon" ||
    type === "horse"
  );
}
