import type { Action, GameState, PieceType, Player } from "./types";
import {
  applyAction,
  generateLegalMoves,
  isInCheck,
  isCheckmate,
  positionKey,
} from "./moves";
import { isPromotionZone } from "./directions";
import { cellKeyOf } from "./types";

/** 駒の基本価値（たたき台） */
const PIECE_VALUE: Record<PieceType, number> = {
  king: 10000,
  rook: 1000,
  dragon: 1300,
  bishop: 850,
  horse: 1100,
  gold: 540,
  silver: 430,
  promoted_silver: 540,
  knight: 350,
  promoted_knight: 540,
  lance: 300,
  promoted_lance: 540,
  pawn: 100,
  promoted_pawn: 420,
};

const HAND_VALUE: Record<string, number> = {
  rook: 1100,
  bishop: 950,
  gold: 560,
  silver: 450,
  knight: 370,
  lance: 320,
  pawn: 110,
};

/**
 * 手番価値（先手が持つ「次に指せる権利」の概算）。
 * 初期局面の静的駒割り・配置点は180度対称でちょうど0。
 */
export const TEMPO_BONUS = 80;

export interface EvalBreakdown {
  material: number;
  positional: number;
  tempo: number;
  position: number;
  total: number;
}

/** 先手視点の内訳 */
export function evaluateBreakdown(state: GameState): EvalBreakdown {
  if (state.result) {
    let terminal = 0;
    if (state.result.type === "checkmate" || state.result.type === "resign") {
      terminal = state.result.winner === "black" ? 50000 : -50000;
    } else if (state.result.type === "perpetual_check") {
      terminal = state.result.winner === "black" ? 50000 : -50000;
    }
    return {
      material: terminal,
      positional: 0,
      tempo: 0,
      position: terminal,
      total: terminal,
    };
  }

  let material = 0;
  let positional = 0;

  for (const [key, piece] of state.board) {
    const rank = Number(key.split(",")[1]);
    const file = Number(key.split(",")[0]);
    let pos = 0;
    const mat = PIECE_VALUE[piece.type];

    const centerDist = Math.abs(file - 9) + Math.abs(rank - 5);
    pos += Math.max(0, 8 - centerDist) * 3;

    if (piece.type !== "king" && isPromotionZone(rank, piece.owner)) {
      pos += 25;
    }

    if (piece.type === "king") {
      pos += Math.min(file - 1, 17 - file) * 2;
    }

    const sign = piece.owner === "black" ? 1 : -1;
    material += sign * mat;
    positional += sign * pos;
  }

  for (const p of ["black", "white"] as Player[]) {
    const h = state.hands[p];
    let hv = 0;
    hv += h.rook * HAND_VALUE.rook;
    hv += h.bishop * HAND_VALUE.bishop;
    hv += h.gold * HAND_VALUE.gold;
    hv += h.silver * HAND_VALUE.silver;
    hv += h.knight * HAND_VALUE.knight;
    hv += h.lance * HAND_VALUE.lance;
    hv += h.pawn * HAND_VALUE.pawn;
    material += p === "black" ? hv : -hv;
  }

  if (isInCheck(state, "black")) positional -= 140;
  if (isInCheck(state, "white")) positional += 140;

  const position = material + positional;
  const tempo = state.turn === "black" ? TEMPO_BONUS : -TEMPO_BONUS;

  return {
    material,
    positional,
    tempo,
    position,
    total: position + tempo,
  };
}

export function evaluate(state: GameState): number {
  return evaluateBreakdown(state).total;
}

export function evaluatePosition(state: GameState): number {
  return evaluateBreakdown(state).position;
}

function scoreFromPerspective(state: GameState, player: Player): number {
  // 評価は駒得・配置のみ。千日手ペナルティをここへ入れると強いCPUが極端に弱くなる
  return player === "black" ? evaluate(state) : -evaluate(state);
}

function movePriority(state: GameState, action: Action): number {
  let p = 0;
  if (action.kind === "move") {
    const cap = state.board.get(cellKeyOf(action.to));
    if (cap) {
      p += PIECE_VALUE[cap.type] * 10;
      const moving = state.board.get(cellKeyOf(action.from));
      if (moving) p -= PIECE_VALUE[moving.type];
    }
    if (action.promote) p += 200;
  } else {
    p += (HAND_VALUE[action.piece] ?? 0) / 5;
  }
  return p;
}

/** ルート手だけ千日手回避（出現3回目は後回し）。評価値は壊さない */
function orderRootMoves(state: GameState, moves: Action[]): Action[] {
  return [...moves].sort((a, b) => {
    const pa = movePriority(state, a) + rootRepetitionAdjust(state, a);
    const pb = movePriority(state, b) + rootRepetitionAdjust(state, b);
    return pb - pa;
  });
}

function rootRepetitionAdjust(state: GameState, action: Action): number {
  try {
    const next = applyAction(state, action);
    const cnt = next.positionCounts.get(positionKey(next)) ?? 0;
    if (cnt >= 3) return -3000;
    if (cnt >= 2) return -200;
  } catch {
    /* ignore */
  }
  return 0;
}

function orderMoves(state: GameState, moves: Action[]): Action[] {
  return [...moves].sort((a, b) => movePriority(state, b) - movePriority(state, a));
}

function isCapture(state: GameState, action: Action): boolean {
  return action.kind === "move" && state.board.has(cellKeyOf(action.to));
}

/**
 * CPU強さ（3段階）のパラメータ差:
 *
 * | レベル | 探索 | ルート候補 | 応手候補 | 乱数 | 備考 |
 * | 弱い(1) | 深さ1（自分の手だけ評価） | 16 | — | 大 | ほぼ駒得＋乱択 |
 * | 普通(2) | 深さ3＋αβ | 56 | 32 | 小 | 2手先まで読む |
 * | 強い(3) | 深さ4＋αβ＋静止探索 | 広い | 広い | なし | 詰み優先・12秒 |
 */
export type CpuLevel = 1 | 2 | 3;

const CPU_PARAMS: Record<
  CpuLevel,
  { depth: number; rootCandidates: number; replyCandidates: number; noise: number; timeMs: number }
> = {
  1: { depth: 1, rootCandidates: 16, replyCandidates: 8, noise: 120, timeMs: 0 },
  2: { depth: 3, rootCandidates: 56, replyCandidates: 32, noise: 8, timeMs: 2500 },
  /** 強い: 深さ4＋広い分岐＋12秒。弱体化要因だった千日手評価ペナルティは不使用 */
  3: { depth: 4, rootCandidates: 120, replyCandidates: 56, noise: 0, timeMs: 12000 },
};

/** CPUの思考時間上限（ms）。0 = 制限なし（弱いは即返し） */
export function getCpuTimeLimitMs(level: CpuLevel): number {
  return CPU_PARAMS[level].timeMs;
}

/** 取り・成りのみを延長する静止探索（強い用） */
function quiesce(
  state: GameState,
  rootPlayer: Player,
  alpha: number,
  beta: number,
  qDepth: number
): number {
  if (isCheckmate(state)) {
    return state.turn === rootPlayer ? -90000 - qDepth : 90000 + qDepth;
  }

  const standPat = scoreFromPerspective(state, rootPlayer);
  if (qDepth <= 0) return standPat;

  const moves = orderMoves(state, generateLegalMoves(state))
    .filter((a) => isCapture(state, a) || (a.kind === "move" && a.promote))
    .slice(0, 24);

  if (moves.length === 0) return standPat;

  if (state.turn === rootPlayer) {
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    for (const action of moves) {
      const next = applyAction(state, action);
      const score = quiesce(next, rootPlayer, alpha, beta, qDepth - 1);
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  if (standPat <= alpha) return alpha;
  if (standPat < beta) beta = standPat;
  for (const action of moves) {
    const next = applyAction(state, action);
    const score = quiesce(next, rootPlayer, alpha, beta, qDepth - 1);
    if (score <= alpha) return alpha;
    if (score < beta) beta = score;
  }
  return beta;
}

/**
 * αβミニマックス（rootPlayer 視点、大きいほど良い）
 */
function alphabeta(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  rootPlayer: Player,
  branchLimit: number,
  deadline: number
): number {
  if (Date.now() > deadline) {
    return scoreFromPerspective(state, rootPlayer);
  }

  if (isCheckmate(state)) {
    return state.turn === rootPlayer ? -100000 + depth : 100000 - depth;
  }

  // 王手中は1手先読み延長
  let searchDepth = depth;
  if (isInCheck(state, state.turn)) {
    searchDepth = depth + 1;
  }

  if (searchDepth <= 0) {
    return quiesce(state, rootPlayer, alpha, beta, 3);
  }

  const moves = orderMoves(state, generateLegalMoves(state)).slice(
    0,
    branchLimit
  );
  if (moves.length === 0) {
    return scoreFromPerspective(state, rootPlayer);
  }

  const nextBranch = Math.max(14, Math.floor(branchLimit * 0.75));
  const maximizing = state.turn === rootPlayer;
  if (maximizing) {
    let value = -Infinity;
    for (const action of moves) {
      const next = applyAction(state, action);
      const score = alphabeta(
        next,
        searchDepth - 1,
        alpha,
        beta,
        rootPlayer,
        nextBranch,
        deadline
      );
      if (score > value) value = score;
      if (value > alpha) alpha = value;
      if (alpha >= beta) break;
      if (Date.now() > deadline) break;
    }
    return value;
  }

  let value = Infinity;
  for (const action of moves) {
    const next = applyAction(state, action);
    const score = alphabeta(
      next,
      searchDepth - 1,
      alpha,
      beta,
      rootPlayer,
      nextBranch,
      deadline
    );
    if (score < value) value = score;
    if (value < beta) beta = value;
    if (alpha >= beta) break;
    if (Date.now() > deadline) break;
  }
  return value;
}

/**
 * 深さに応じた探索で着手を選ぶ（同期）。
 */
export function chooseCpuMove(state: GameState, level: CpuLevel = 2): Action | null {
  return searchBestMoveSync(state, level);
}

/** UI用: 時間制限がある場合はルート候補ごとに yield してカウント表示を更新できる */
export async function chooseCpuMoveAsync(
  state: GameState,
  level: CpuLevel
): Promise<Action | null> {
  return searchBestMoveAsync(state, level);
}

function searchBestMoveSync(state: GameState, level: CpuLevel): Action | null {
  const params = CPU_PARAMS[level];
  const player = state.turn;
  const moves = generateLegalMoves(state);
  if (moves.length === 0) return null;

  const ordered =
    level >= 2 ? orderRootMoves(state, moves) : orderMoves(state, moves);
  const candidates = ordered.slice(
    0,
    Math.min(ordered.length, params.rootCandidates)
  );
  const deadline =
    params.timeMs > 0 ? Date.now() + params.timeMs : Number.POSITIVE_INFINITY;

  let best: Action | null = null;
  let bestScore = -Infinity;

  if (level >= 2) {
    let scored = candidates.map((action) => ({ action, score: -Infinity }));
    for (let d = 1; d <= params.depth; d++) {
      const pool =
        level === 2 || d <= 2
          ? scored
          : scored.slice(0, Math.min(scored.length, d === 3 ? 40 : 24));
      for (const entry of pool) {
        if (Date.now() > deadline && best) break;
        const next = applyAction(state, entry.action);
        let score: number;
        if (isCheckmate({ ...next, result: null })) {
          score = 100000;
        } else {
          score = alphabeta(
            next,
            d - 1,
            -Infinity,
            Infinity,
            player,
            params.replyCandidates,
            deadline
          );
          if (isInCheck(next, next.turn)) score += level === 3 ? 80 : 50;
          score += rootRepetitionAdjust(state, entry.action) * 0.1;
          score += Math.random() * params.noise;
        }
        entry.score = score;
        if (score > bestScore) {
          bestScore = score;
          best = entry.action;
        }
      }
      scored.sort((a, b) => b.score - a.score);
      if (scored[0] && scored[0].score > -Infinity) {
        best = scored[0].action;
        bestScore = scored[0].score;
      }
      if (Date.now() > deadline) break;
    }
    return best;
  }

  return searchShallow(state, candidates, player, params);
}

async function searchBestMoveAsync(
  state: GameState,
  level: CpuLevel
): Promise<Action | null> {
  const params = CPU_PARAMS[level];
  const player = state.turn;
  const moves = generateLegalMoves(state);
  if (moves.length === 0) return null;

  const ordered =
    level >= 2 ? orderRootMoves(state, moves) : orderMoves(state, moves);
  const candidates = ordered.slice(
    0,
    Math.min(ordered.length, params.rootCandidates)
  );
  const deadline =
    params.timeMs > 0 ? Date.now() + params.timeMs : Number.POSITIVE_INFINITY;

  let best: Action | null = null;
  let bestScore = -Infinity;

  if (level >= 2) {
    const yieldUi = () => new Promise<void>((r) => setTimeout(r, 0));
    // 反復深化（強いは深い層で有望手に集中）
    let scored = candidates.map((action) => ({ action, score: -Infinity }));
    for (let d = 1; d <= params.depth; d++) {
      const pool =
        level === 2 || d <= 2
          ? scored
          : scored.slice(0, Math.min(scored.length, d === 3 ? 40 : 24));
      for (let i = 0; i < pool.length; i++) {
        if (Date.now() > deadline && best) break;
        await yieldUi();
        const action = pool[i]!.action;
        const next = applyAction(state, action);
        let score: number;
        if (isCheckmate({ ...next, result: null })) {
          score = 100000;
        } else {
          score = alphabeta(
            next,
            d - 1,
            -Infinity,
            Infinity,
            player,
            params.replyCandidates,
            deadline
          );
          if (isInCheck(next, next.turn)) score += level === 3 ? 80 : 50;
          score += rootRepetitionAdjust(state, action) * 0.1;
          score += Math.random() * params.noise;
        }
        pool[i]!.score = score;
        if (score > bestScore) {
          bestScore = score;
          best = action;
        }
      }
      scored.sort((a, b) => b.score - a.score);
      if (scored[0] && scored[0].score > -Infinity) {
        best = scored[0].action;
        bestScore = scored[0].score;
      }
      if (Date.now() > deadline) break;
      await yieldUi();
    }
    return best;
  }

  return searchShallow(state, candidates, player, params);
}

function searchShallow(
  state: GameState,
  candidates: Action[],
  player: Player,
  params: (typeof CPU_PARAMS)[CpuLevel]
): Action | null {
  let best: Action | null = null;
  let bestScore = -Infinity;

  for (const action of candidates) {
    const next = applyAction(state, action);
    let score: number;

    if (isCheckmate({ ...next, result: null })) {
      score = 100000;
    } else if (params.depth <= 1) {
      score = scoreFromPerspective(next, player);
      if (isInCheck(next, next.turn)) score += 40;
    } else {
      const replies = orderMoves(next, generateLegalMoves(next)).slice(
        0,
        params.replyCandidates
      );
      if (replies.length === 0) {
        score = scoreFromPerspective(next, player) + 5000;
      } else {
        let worst = Infinity;
        for (const reply of replies) {
          const after = applyAction(next, reply);
          let s = scoreFromPerspective(after, player);
          if (isInCheck(after, player)) s -= 60;
          if (s < worst) worst = s;
        }
        score = worst;
      }
      if (isInCheck(next, next.turn)) score += 35;
    }

    score += Math.random() * params.noise;

    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  }

  return best;
}
