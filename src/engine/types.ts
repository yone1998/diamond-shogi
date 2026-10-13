/** 菱形将棋の基本型定義 */

export type Player = "black" | "white"; // black=先手, white=後手

export type PieceType =
  | "king"
  | "gold"
  | "silver"
  | "knight"
  | "lance"
  | "rook"
  | "bishop"
  | "pawn"
  | "promoted_silver"
  | "promoted_knight"
  | "promoted_lance"
  | "promoted_pawn"
  | "dragon"
  | "horse";

export type UnpromotedType =
  | "king"
  | "gold"
  | "silver"
  | "knight"
  | "lance"
  | "rook"
  | "bishop"
  | "pawn";

export interface Cell {
  file: number; // 1〜17
  rank: number; // 1〜9
}

export interface Piece {
  type: PieceType;
  owner: Player;
}

export type BoardMap = Map<string, Piece>; // key = cellKey(file, rank)

export interface Hand {
  pawn: number;
  lance: number;
  knight: number;
  silver: number;
  gold: number;
  bishop: number;
  rook: number;
}

export type HandPiece = keyof Hand;

export interface GameState {
  board: BoardMap;
  turn: Player;
  hands: Record<Player, Hand>;
  /** 局面キー履歴（千日手） */
  history: string[];
  /** 同一局面出現回数 */
  positionCounts: Map<string, number>;
  /** 各手が王手だったか（連続王手千日手用、history と対応） */
  checkHistory: boolean[];
  /** 最終手が王手だったか */
  lastMoveWasCheck: boolean;
  /** 持将棋・千日手などの終局理由 */
  result: GameResult | null;
}

export type GameResult =
  | { type: "checkmate"; winner: Player }
  | { type: "resign"; winner: Player }
  | { type: "sennichite" }
  | { type: "perpetual_check"; winner: Player }
  | { type: "impasse"; blackPoints: number; whitePoints: number; winner: Player | "draw" }
  | { type: "illegal"; winner: Player; reason: string };

export interface Move {
  kind: "move";
  from: Cell;
  to: Cell;
  promote: boolean;
}

export interface Drop {
  kind: "drop";
  piece: HandPiece;
  to: Cell;
}

export type Action = Move | Drop;

export const RANK_KANJI = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"] as const;

export const PIECE_LABEL: Record<PieceType, string> = {
  king: "王",
  gold: "金",
  silver: "銀",
  knight: "桂",
  lance: "香",
  rook: "飛",
  bishop: "角",
  pawn: "歩",
  promoted_silver: "成銀",
  promoted_knight: "成桂",
  promoted_lance: "成香",
  promoted_pawn: "と",
  dragon: "龍",
  horse: "馬",
};

export const HAND_LABEL: Record<HandPiece, string> = {
  pawn: "歩",
  lance: "香",
  knight: "桂",
  silver: "銀",
  gold: "金",
  bishop: "角",
  rook: "飛",
};

export function cellKey(file: number, rank: number): string {
  return `${file},${rank}`;
}

export function cellKeyOf(cell: Cell): string {
  return cellKey(cell.file, cell.rank);
}

export function parseCellKey(key: string): Cell {
  const [f, r] = key.split(",").map(Number);
  return { file: f, rank: r };
}

export function cellEquals(a: Cell, b: Cell): boolean {
  return a.file === b.file && a.rank === b.rank;
}

export function opponent(player: Player): Player {
  return player === "black" ? "white" : "black";
}

export function emptyHand(): Hand {
  return {
    pawn: 0,
    lance: 0,
    knight: 0,
    silver: 0,
    gold: 0,
    bishop: 0,
    rook: 0,
  };
}

export function cloneHand(h: Hand): Hand {
  return { ...h };
}

/** 成駒を持ち駒用の生駒に戻す */
export function demoteForHand(type: PieceType): HandPiece | null {
  switch (type) {
    case "king":
      return null;
    case "gold":
      return "gold";
    case "silver":
    case "promoted_silver":
      return "silver";
    case "knight":
    case "promoted_knight":
      return "knight";
    case "lance":
    case "promoted_lance":
      return "lance";
    case "rook":
    case "dragon":
      return "rook";
    case "bishop":
    case "horse":
      return "bishop";
    case "pawn":
    case "promoted_pawn":
      return "pawn";
    default:
      return null;
  }
}

export function promoteType(type: PieceType): PieceType | null {
  switch (type) {
    case "pawn":
      return "promoted_pawn";
    case "lance":
      return "promoted_lance";
    case "knight":
      return "promoted_knight";
    case "silver":
      return "promoted_silver";
    case "rook":
      return "dragon";
    case "bishop":
      return "horse";
    default:
      return null;
  }
}

export function canPromote(type: PieceType): boolean {
  return promoteType(type) !== null;
}

export function handPieceToType(p: HandPiece): PieceType {
  return p;
}
