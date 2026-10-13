import type {
  Action,
  BoardMap,
  Cell,
  Drop,
  GameState,
  HandPiece,
  Piece,
  PieceType,
  Player,
} from "./types";
import { cellKey, cellKeyOf, demoteForHand, opponent, promoteType } from "./types";
import { isValidCell } from "./board";
import {
  EDGE_DIRS,
  ORTHO_DIRS,
  dragonStepDirs,
  forwardVec,
  goldLikeDirs,
  horseStepDirs,
  isPromotionZone,
  kingDirs,
  knightVecs,
  mustPromote,
  silverDirs,
  slideTargets,
  stepTargets,
  hasNoMoveDestination,
} from "./directions";

/** 生の擬似合法手（自殺手・打ち歩詰め等を未フィルタ） */
export function generatePseudoMoves(state: GameState, player: Player): Action[] {
  const actions: Action[] = [];
  const board = state.board;

  for (const [key, piece] of board) {
    if (piece.owner !== player) continue;
    const [file, rank] = key.split(",").map(Number);
    const from: Cell = { file, rank };
    const targets = pieceTargets(board, from, piece);
    for (const to of targets) {
      for (const promote of promoteOptions(piece, from, to, player)) {
        actions.push({ kind: "move", from, to, promote });
      }
    }
  }

  // 駒打ち
  const hand = state.hands[player];
  const handPieces: HandPiece[] = [
    "pawn",
    "lance",
    "knight",
    "silver",
    "gold",
    "bishop",
    "rook",
  ];
  for (const hp of handPieces) {
    if (hand[hp] <= 0) continue;
    for (const to of dropTargets(state, player, hp)) {
      actions.push({ kind: "drop", piece: hp, to });
    }
  }

  return actions;
}

/** 空き盤上で、中央などに置いた駒の到達マス（ルール図解用） */
export function targetsOnEmptyBoard(
  type: PieceType,
  from: Cell,
  owner: Player = "black"
): Cell[] {
  const board: BoardMap = new Map();
  const piece: Piece = { type, owner };
  board.set(cellKeyOf(from), piece);
  return pieceTargets(board, from, piece);
}

function pieceTargets(board: BoardMap, from: Cell, piece: Piece): Cell[] {
  const { type, owner } = piece;
  switch (type) {
    case "king":
      return stepTargets(board, from, kingDirs(owner), owner);
    case "gold":
    case "promoted_silver":
    case "promoted_knight":
    case "promoted_lance":
    case "promoted_pawn":
      return stepTargets(board, from, goldLikeDirs(owner), owner);
    case "silver":
      return stepTargets(board, from, silverDirs(owner), owner);
    case "knight":
      return stepTargets(board, from, knightVecs(owner), owner);
    case "lance": {
      const dir = forwardVec(owner);
      return slideTargets(board, from, dir, owner);
    }
    case "rook": {
      let cells: Cell[] = [];
      for (const d of ORTHO_DIRS) {
        cells = cells.concat(slideTargets(board, from, d, owner));
      }
      return cells;
    }
    case "bishop": {
      let cells: Cell[] = [];
      for (const d of EDGE_DIRS) {
        cells = cells.concat(slideTargets(board, from, d, owner));
      }
      return cells;
    }
    case "dragon": {
      let cells: Cell[] = [];
      for (const d of ORTHO_DIRS) {
        cells = cells.concat(slideTargets(board, from, d, owner));
      }
      cells = cells.concat(stepTargets(board, from, dragonStepDirs(), owner));
      return uniqueCells(cells);
    }
    case "horse": {
      let cells: Cell[] = [];
      for (const d of EDGE_DIRS) {
        cells = cells.concat(slideTargets(board, from, d, owner));
      }
      cells = cells.concat(stepTargets(board, from, horseStepDirs(), owner));
      return uniqueCells(cells);
    }
    case "pawn": {
      const dir = forwardVec(owner);
      return stepTargets(board, from, [dir], owner);
    }
    default:
      return [];
  }
}

function uniqueCells(cells: Cell[]): Cell[] {
  const seen = new Set<string>();
  const out: Cell[] = [];
  for (const c of cells) {
    const k = cellKeyOf(c);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

function promoteOptions(
  piece: Piece,
  from: Cell,
  to: Cell,
  player: Player
): boolean[] {
  const promoted = promoteType(piece.type);
  if (!promoted) return [false];

  const inZone =
    isPromotionZone(from.rank, player) || isPromotionZone(to.rank, player);
  if (!inZone) return [false];

  if (mustPromote(piece.type, to.rank, player)) {
    return [true];
  }
  // 成り選択可
  return [false, true];
}

/** 打ち可能なマス（二歩・行き所なしを除外。打ち歩詰めは合法手フィルタで） */
export function dropTargets(
  state: GameState,
  player: Player,
  hp: HandPiece
): Cell[] {
  const board = state.board;
  const result: Cell[] = [];

  for (let rank = 1; rank <= 9; rank++) {
    for (let file = 1; file <= 17; file++) {
      if (!isValidCell(file, rank)) continue;
      const key = cellKey(file, rank);
      if (board.has(key)) continue;

      if (
        (hp === "pawn" || hp === "lance" || hp === "knight") &&
        hasNoMoveDestination(hp, rank, player)
      ) {
        continue;
      }

      if (hp === "pawn" && hasNifu(board, player, file)) {
        continue;
      }

      result.push({ file, rank });
    }
  }
  return result;
}

/** 二歩: 同じ筋に未成の歩がある */
export function hasNifu(board: BoardMap, player: Player, file: number): boolean {
  for (let rank = 1; rank <= 9; rank++) {
    if (!isValidCell(file, rank)) continue;
    const p = board.get(cellKey(file, rank));
    if (p && p.owner === player && p.type === "pawn") return true;
  }
  return false;
}

/** 王の位置 */
export function findKing(board: BoardMap, player: Player): Cell | null {
  for (const [key, piece] of board) {
    if (piece.owner === player && piece.type === "king") {
      const [file, rank] = key.split(",").map(Number);
      return { file, rank };
    }
  }
  return null;
}

/** 指定マスが player に攻撃されているか */
export function isSquareAttacked(
  board: BoardMap,
  target: Cell,
  by: Player
): boolean {
  // 各攻撃者から target へ到達できるか
  for (const [key, piece] of board) {
    if (piece.owner !== by) continue;
    const [file, rank] = key.split(",").map(Number);
    const from: Cell = { file, rank };
    const targets = pieceTargets(board, from, piece);
    if (targets.some((t) => t.file === target.file && t.rank === target.rank)) {
      return true;
    }
  }
  return false;
}

export function isInCheck(state: GameState, player: Player): boolean {
  const king = findKing(state.board, player);
  if (!king) return false;
  return isSquareAttacked(state.board, king, opponent(player));
}

/** 手を適用した新しい状態（合法性は呼び出し側で保証） */
export function applyAction(state: GameState, action: Action): GameState {
  const board = new Map(state.board);
  const hands: GameState["hands"] = {
    black: { ...state.hands.black },
    white: { ...state.hands.white },
  };
  const player = state.turn;

  if (action.kind === "move") {
    const fromKey = cellKeyOf(action.from);
    const toKey = cellKeyOf(action.to);
    const piece = board.get(fromKey);
    if (!piece) throw new Error("no piece at from");

    const captured = board.get(toKey);
    if (captured) {
      const hp = demoteForHand(captured.type);
      if (hp) {
        hands[player][hp]++;
      }
    }

    board.delete(fromKey);
    let newType: PieceType = piece.type;
    if (action.promote) {
      const p = promoteType(piece.type);
      if (p) newType = p;
    }
    board.set(toKey, { type: newType, owner: player });
  } else {
    const hand = hands[player];
    if (hand[action.piece] <= 0) throw new Error("no hand piece");
    hand[action.piece]--;
    board.set(cellKeyOf(action.to), {
      type: action.piece,
      owner: player,
    });
  }

  const next: GameState = {
    board,
    turn: opponent(player),
    hands,
    history: [...state.history],
    positionCounts: new Map(state.positionCounts),
    checkHistory: [...state.checkHistory],
    lastMoveWasCheck: false,
    result: null,
  };

  next.lastMoveWasCheck = isInCheck(next, next.turn);
  next.checkHistory.push(next.lastMoveWasCheck);

  const posKey = positionKey(next);
  next.history.push(posKey);
  const count = (next.positionCounts.get(posKey) ?? 0) + 1;
  next.positionCounts.set(posKey, count);

  return next;
}

/** 局面キー（千日手用）: 盤面+手番+持ち駒 */
export function positionKey(state: GameState): string {
  const cells: string[] = [];
  for (const [k, p] of state.board) {
    cells.push(`${k}:${p.owner[0]}${p.type}`);
  }
  cells.sort();
  const hb = handKey(state.hands.black);
  const hw = handKey(state.hands.white);
  return `${state.turn}|${cells.join(";")}|b:${hb}|w:${hw}`;
}

function handKey(h: GameState["hands"]["black"]): string {
  return `p${h.pawn}l${h.lance}n${h.knight}s${h.silver}g${h.gold}b${h.bishop}r${h.rook}`;
}

/**
 * 合法手: 自殺手禁止、王手放置禁止、打ち歩詰め禁止
 */
export function generateLegalMoves(state: GameState): Action[] {
  if (state.result) return [];
  const player = state.turn;
  const pseudo = generatePseudoMoves(state, player);
  const legal: Action[] = [];

  for (const action of pseudo) {
    if (!isLegalAction(state, action)) continue;
    legal.push(action);
  }
  return legal;
}

export function isLegalAction(state: GameState, action: Action): boolean {
  const player = state.turn;

  // 基本的な整合性
  if (action.kind === "move") {
    const piece = state.board.get(cellKeyOf(action.from));
    if (!piece || piece.owner !== player) return false;
    const targets = pieceTargets(state.board, action.from, piece);
    if (!targets.some((t) => t.file === action.to.file && t.rank === action.to.rank)) {
      return false;
    }
    const opts = promoteOptions(piece, action.from, action.to, player);
    if (!opts.includes(action.promote)) return false;
  } else {
    if (state.hands[player][action.piece] <= 0) return false;
    const drops = dropTargets(state, player, action.piece);
    if (!drops.some((t) => t.file === action.to.file && t.rank === action.to.rank)) {
      return false;
    }
  }

  const next = applyAction(state, action);

  // 自殺手・王手放置: 自分の王が相手に取られる状態になってはいけない
  // applyAction 後の turn は相手なので、自分(player)が王手なら違法
  if (isInCheck(next, player)) return false;

  // 千日手禁止: 同一局面が4回目になる手は指せない
  const posKey = positionKey(next);
  if ((next.positionCounts.get(posKey) ?? 0) >= 4) return false;

  // 打ち歩詰め
  if (action.kind === "drop" && action.piece === "pawn") {
    if (isUchifuzume(state, action, next)) return false;
  }

  return true;
}

/**
 * 打ち歩詰め: 歩を打った結果、相手が詰みになること
 * （歩の移動による詰みは可）
 */
function isUchifuzume(
  _before: GameState,
  drop: Drop,
  after: GameState
): boolean {
  // after.turn は相手。相手が王手されていて合法手がない = 詰み
  const opponentPlayer = after.turn;
  if (!isInCheck(after, opponentPlayer)) return false;

  // 相手に合法手があるか（再帰的に打ち歩詰めチェックすると無限になり得るが、
  // 深さは1段: 相手の手に対する打ち歩詰めは見ない簡易でOK。
  // 正確には相手の各手について isLegalAction 相当を行う）
  const replies = generatePseudoMoves(after, opponentPlayer);
  for (const reply of replies) {
    // 簡易合法性: 適用後に相手王が安全
    if (reply.kind === "drop") {
      // 相手の打ちも二歩等チェック
      const drops = dropTargets(after, opponentPlayer, reply.piece);
      if (!drops.some((t) => t.file === reply.to.file && t.rank === reply.to.rank)) {
        continue;
      }
    } else {
      const piece = after.board.get(cellKeyOf(reply.from));
      if (!piece || piece.owner !== opponentPlayer) continue;
      const targets = pieceTargets(after.board, reply.from, piece);
      if (!targets.some((t) => t.file === reply.to.file && t.rank === reply.to.rank)) {
        continue;
      }
    }
    const afterReply = applyAction(after, reply);
    if (!isInCheck(afterReply, opponentPlayer)) {
      return false; // 逃れる手がある
    }
  }
  // 歩打ちで詰み
  void drop;
  return true;
}

export function isCheckmate(state: GameState): boolean {
  if (!isInCheck(state, state.turn)) return false;
  return generateLegalMoves(state).length === 0;
}

export function isStalemateNoMoves(state: GameState): boolean {
  return generateLegalMoves(state).length === 0;
}

/** 特定の駒の合法移動先（ハイライト用） */
export function legalMoveTargets(
  state: GameState,
  from: Cell
): { to: Cell; promote: boolean; canChoosePromote: boolean }[] {
  const legal = generateLegalMoves(state);
  const results: { to: Cell; promote: boolean; canChoosePromote: boolean }[] = [];
  const byDest = new Map<string, { promote: boolean; notPromote: boolean }>();

  for (const a of legal) {
    if (a.kind !== "move") continue;
    if (a.from.file !== from.file || a.from.rank !== from.rank) continue;
    const k = cellKeyOf(a.to);
    const entry = byDest.get(k) ?? { promote: false, notPromote: false };
    if (a.promote) entry.promote = true;
    else entry.notPromote = true;
    byDest.set(k, entry);
  }

  for (const [k, v] of byDest) {
    const [file, rank] = k.split(",").map(Number);
    const canChoose = v.promote && v.notPromote;
    // ハイライトはマス単位。成り選択は移動時に聞く
    results.push({
      to: { file, rank },
      promote: v.promote && !v.notPromote, // 強制成り
      canChoosePromote: canChoose,
    });
  }
  return results;
}

export function legalDropTargets(
  state: GameState,
  piece: HandPiece
): Cell[] {
  return generateLegalMoves(state)
    .filter((a): a is Drop => a.kind === "drop" && a.piece === piece)
    .map((a) => a.to);
}

/**
 * 相手駒の利き確認用: その駒の所有者の手番として合法移動先を返す
 * （実際に手番を変えず、ハイライト専用）
 */
export function previewPieceTargets(
  state: GameState,
  from: Cell
): { to: Cell; promote: boolean; canChoosePromote: boolean }[] {
  const piece = state.board.get(cellKeyOf(from));
  if (!piece) return [];
  const fake: GameState = {
    ...state,
    turn: piece.owner,
    result: null,
  };
  return legalMoveTargets(fake, from);
}

/** テスト・デバッグ用: 擬似合法の移動先のみ */
export function rawPieceTargets(
  board: BoardMap,
  from: Cell,
  piece: Piece
): Cell[] {
  return pieceTargets(board, from, piece);
}
