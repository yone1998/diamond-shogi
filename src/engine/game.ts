import type { Action, GameState, Player, PieceType } from "./types";
import { demoteForHand, opponent } from "./types";
import {
  applyAction,
  generateLegalMoves,
  isCheckmate,
  isInCheck,
  isLegalAction,
  positionKey,
} from "./moves";
import { createInitialState } from "./initial";

/** 駒の点数（持将棋）: 玉以外、大駒5点、それ以外1点 */
function piecePoints(type: PieceType): number {
  if (type === "king") return 0;
  if (type === "rook" || type === "dragon" || type === "bishop" || type === "horse") {
    return 5;
  }
  return 1;
}

export function countPoints(state: GameState, player: Player): number {
  let pts = 0;
  for (const p of state.board.values()) {
    if (p.owner === player) pts += piecePoints(p.type);
  }
  const h = state.hands[player];
  pts += h.pawn + h.lance + h.knight + h.silver + h.gold;
  pts += (h.bishop + h.rook) * 5;
  return pts;
}

/**
 * 持将棋: 双方の王が相手陣に入っているとき申告可能。
 * 先手24点以上・後手27点以上で勝ち、両方満たせば引き分け。
 */
export function canDeclareImpasse(state: GameState): boolean {
  let blackKingIn = false;
  let whiteKingIn = false;
  for (const [key, p] of state.board) {
    if (p.type !== "king") continue;
    const rank = Number(key.split(",")[1]);
    if (p.owner === "black" && rank <= 3) blackKingIn = true;
    if (p.owner === "white" && rank >= 7) whiteKingIn = true;
  }
  return blackKingIn && whiteKingIn;
}

export function resolveImpasse(state: GameState): GameState {
  const bp = countPoints(state, "black");
  const wp = countPoints(state, "white");
  const blackOk = bp >= 24;
  const whiteOk = wp >= 27;
  let winner: Player | "draw";
  if (blackOk && whiteOk) winner = "draw";
  else if (blackOk) winner = "black";
  else if (whiteOk) winner = "white";
  else winner = "draw";

  return {
    ...state,
    result: { type: "impasse", blackPoints: bp, whitePoints: wp, winner },
  };
}

/**
 * 千日手禁止の安全網: 同一局面4回目が成立した場合、
 * その手を指した側の反則負け（通常は合法手生成で弾かれる）。
 */
export function checkSennichite(state: GameState): GameState {
  const key = positionKey(state);
  const count = state.positionCounts.get(key) ?? 0;
  if (count < 4) return state;
  // 着手後の手番は相手なので、勝者はいま手番の側
  return {
    ...state,
    result: {
      type: "illegal",
      winner: state.turn,
      reason: "千日手禁止",
    },
  };
}

export type TryMoveOptions = {
  /** このプレイヤーが詰んでも result を付けず、投了待ちにする */
  deferMateFor?: Player;
};

export function tryMove(
  state: GameState,
  action: Action,
  opts?: TryMoveOptions
): GameState | null {
  if (state.result) return null;
  if (!isLegalAction(state, action)) return null;

  let next = applyAction(state, action);
  next = checkSennichite(next);

  if (next.result) return next;

  const mated =
    isCheckmate(next) || generateLegalMoves(next).length === 0;
  if (mated) {
    if (opts?.deferMateFor && next.turn === opts.deferMateFor) {
      return next;
    }
    return {
      ...next,
      result: { type: "checkmate", winner: state.turn },
    };
  }

  return next;
}

export function resign(state: GameState): GameState {
  return {
    ...state,
    result: { type: "resign", winner: opponent(state.turn) },
  };
}

export function newGame(): GameState {
  return createInitialState();
}

export function statusText(state: GameState): string {
  if (state.result) {
    const r = state.result;
    if (r.type === "checkmate") {
      return `詰み — ${r.winner === "black" ? "先手" : "後手"}の勝ち`;
    }
    if (r.type === "resign") {
      return `投了 — ${r.winner === "black" ? "先手" : "後手"}の勝ち`;
    }
    if (r.type === "sennichite") {
      return "千日手 — 引き分け";
    }
    if (r.type === "perpetual_check") {
      return `連続王手千日手 — ${r.winner === "black" ? "先手" : "後手"}の勝ち`;
    }
    if (r.type === "impasse") {
      const w =
        r.winner === "draw"
          ? "引き分け"
          : r.winner === "black"
            ? "先手の勝ち"
            : "後手の勝ち";
      return `相入玉・点数勝負 — 先手${r.blackPoints}点 / 後手${r.whitePoints}点 — ${w}`;
    }
    if (r.type === "illegal") {
      return `反則（${r.reason}） — ${r.winner === "black" ? "先手" : "後手"}の勝ち`;
    }
  }
  const turn = state.turn === "black" ? "先手" : "後手";
  const check = isInCheck(state, state.turn) ? "（王手）" : "";
  return `${turn}番${check}`;
}

export { demoteForHand };
