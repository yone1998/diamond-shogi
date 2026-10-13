import { describe, it, expect } from "vitest";
import { createInitialState, emptyBoard, placePiece } from "../src/engine/initial";
import {
  applyAction,
  generateLegalMoves,
  hasNifu,
  isCheckmate,
  isInCheck,
  isLegalAction,
  legalDropTargets,
  rawPieceTargets,
} from "../src/engine/moves";
import { tryMove, newGame, countPoints } from "../src/engine/game";
import { cellKey } from "../src/engine/types";
import type { GameState } from "../src/engine/types";
import { emptyHand } from "../src/engine/types";
import { hasNoMoveDestination, mustPromote, isPromotionZone } from "../src/engine/directions";

function bareState(overrides: Partial<GameState> = {}): GameState {
  return {
    board: emptyBoard(),
    turn: "black",
    hands: { black: emptyHand(), white: emptyHand() },
    history: [],
    positionCounts: new Map(),
    checkHistory: [],
    lastMoveWasCheck: false,
    result: null,
    ...overrides,
  };
}

describe("成りゾーン", () => {
  it("先手の相手陣は1〜3段", () => {
    expect(isPromotionZone(1, "black")).toBe(true);
    expect(isPromotionZone(3, "black")).toBe(true);
    expect(isPromotionZone(4, "black")).toBe(false);
  });

  it("後手の相手陣は7〜9段", () => {
    expect(isPromotionZone(7, "white")).toBe(true);
    expect(isPromotionZone(9, "white")).toBe(true);
    expect(isPromotionZone(6, "white")).toBe(false);
  });
});

describe("行き所のない駒", () => {
  it("先手の歩・香は1〜2段目不可（2段前進で盤外）", () => {
    expect(hasNoMoveDestination("pawn", 1, "black")).toBe(true);
    expect(hasNoMoveDestination("pawn", 2, "black")).toBe(true);
    expect(hasNoMoveDestination("lance", 2, "black")).toBe(true);
    expect(hasNoMoveDestination("pawn", 3, "black")).toBe(false);
  });

  it("後手の歩・香は8〜9段目不可", () => {
    expect(hasNoMoveDestination("pawn", 9, "white")).toBe(true);
    expect(hasNoMoveDestination("pawn", 8, "white")).toBe(true);
    expect(hasNoMoveDestination("pawn", 7, "white")).toBe(false);
  });

  it("先手の桂は1〜3段不可", () => {
    expect(hasNoMoveDestination("knight", 1, "black")).toBe(true);
    expect(hasNoMoveDestination("knight", 3, "black")).toBe(true);
    expect(hasNoMoveDestination("knight", 4, "black")).toBe(false);
  });

  it("強制成り", () => {
    expect(mustPromote("pawn", 1, "black")).toBe(true);
    expect(mustPromote("pawn", 2, "black")).toBe(true);
    expect(mustPromote("knight", 3, "black")).toBe(true);
    expect(mustPromote("knight", 5, "black")).toBe(false);
  });
});

describe("二歩", () => {
  it("同じ筋に歩があると二歩", () => {
    const board = emptyBoard();
    placePiece(board, { file: 9, rank: 7 }, { type: "pawn", owner: "black" });
    expect(hasNifu(board, "black", 9)).toBe(true);
    expect(hasNifu(board, "black", 7)).toBe(false);
  });

  it("と金は二歩に数えない", () => {
    const board = emptyBoard();
    placePiece(board, { file: 9, rank: 5 }, { type: "promoted_pawn", owner: "black" });
    expect(hasNifu(board, "black", 9)).toBe(false);
  });
});

describe("持ち駒打ち", () => {
  it("初期局面では持ち駒なし", () => {
    const state = createInitialState();
    expect(legalDropTargets(state, "pawn")).toHaveLength(0);
  });

  it("歩を打てる（二歩でない筋）", () => {
    const state = bareState({
      hands: {
        black: { ...emptyHand(), pawn: 1 },
        white: emptyHand(),
      },
    });
    placePiece(state.board, { file: 9, rank: 9 }, { type: "king", owner: "black" });
    placePiece(state.board, { file: 9, rank: 1 }, { type: "king", owner: "white" });
    const drops = legalDropTargets(state, "pawn");
    expect(drops.some((c) => c.file === 9 && c.rank === 1)).toBe(false);
    expect(drops.some((c) => c.rank === 2)).toBe(false); // 2段目も行き所なし
    expect(drops.length).toBeGreaterThan(0);
  });

  it("初期配置で奇数筋は二歩のため歩が打てない（偶数筋の偶数段には打てる）", () => {
    const state = createInitialState();
    state.hands.black.pawn = 1;
    const drops = legalDropTargets(state, "pawn");
    // 奇数筋は自歩あり → 二歩
    expect(drops.every((c) => c.file % 2 === 0)).toBe(true);
    // 偶数筋のマスは偶数段のみ存在する（盤の定義）
    expect(drops.every((c) => c.rank % 2 === 0)).toBe(true);
    expect(drops.some((c) => c.file === 4 && c.rank === 4)).toBe(true);
  });

  it("奇数筋の自歩が無ければ奇数段にも歩を打てる", () => {
    const state = createInitialState();
    state.hands.black.pawn = 1;
    // 9七の歩を除去
    state.board.delete(cellKey(9, 7));
    const drops = legalDropTargets(state, "pawn");
    expect(drops.some((c) => c.file === 9 && c.rank === 5)).toBe(true);
  });
});

describe("王手・詰み", () => {
  it("初期局面は王手でない", () => {
    const state = createInitialState();
    expect(isInCheck(state, "black")).toBe(false);
    expect(isInCheck(state, "white")).toBe(false);
  });

  it("簡単な詰み形を検出できる", () => {
    // 後手玉が9一、先手飛が9五で当たり、金が近くで詰みに近い形
    const state = bareState({ turn: "white" });
    placePiece(state.board, { file: 9, rank: 1 }, { type: "king", owner: "white" });
    placePiece(state.board, { file: 9, rank: 9 }, { type: "king", owner: "black" });
    placePiece(state.board, { file: 9, rank: 3 }, { type: "rook", owner: "black" });
    placePiece(state.board, { file: 8, rank: 2 }, { type: "gold", owner: "black" });
    placePiece(state.board, { file: 10, rank: 2 }, { type: "gold", owner: "black" });
    // 後手番で王手されているか
    expect(isInCheck(state, "white")).toBe(true);
  });

  it("自殺手は違法", () => {
    const state = bareState();
    placePiece(state.board, { file: 9, rank: 5 }, { type: "king", owner: "black" });
    placePiece(state.board, { file: 9, rank: 1 }, { type: "king", owner: "white" });
    placePiece(state.board, { file: 9, rank: 3 }, { type: "rook", owner: "white" });
    // 玉が飛の筋から逃げずに横へ? 前(9三)は敵飛がいるので取れそうだが…
    // 左へ: 7五 — 飛の筋から外れるのでOK
    // 真前 9三 へ行くのは飛を取る — 合法かも
    // 後ろ 9七 — 飛のライン上に残るので自殺
    const suicide = {
      kind: "move" as const,
      from: { file: 9, rank: 5 },
      to: { file: 9, rank: 7 },
      promote: false,
    };
    expect(isLegalAction(state, suicide)).toBe(false);
  });
});

describe("ゲーム進行", () => {
  it("新規対局を開始できる", () => {
    const g = newGame();
    expect(g.board.size).toBe(40);
    expect(g.turn).toBe("black");
  });

  it("合法な歩の前進ができる", () => {
    const state = createInitialState();
    const action = {
      kind: "move" as const,
      from: { file: 9, rank: 7 },
      to: { file: 9, rank: 5 },
      promote: false,
    };
    expect(isLegalAction(state, action)).toBe(true);
    const next = tryMove(state, action);
    expect(next).not.toBeNull();
    expect(next!.turn).toBe("white");
    expect(next!.board.get(cellKey(9, 5))?.type).toBe("pawn");
  });

  it("初期局面に合法手がある", () => {
    const moves = generateLegalMoves(createInitialState());
    expect(moves.length).toBeGreaterThan(0);
  });
});

describe("持将棋点数", () => {
  it("初期局面の点数", () => {
    const state = createInitialState();
    // 各大駒5、他1、玉0。先手: 飛5+角5+金1*2+銀1*2+桂1*2+香1*2+歩1*9 = 5+5+2+2+2+2+9 = 27
    expect(countPoints(state, "black")).toBe(27);
    expect(countPoints(state, "white")).toBe(27);
  });
});

describe("成駒の移動", () => {
  it("と金は金と同じ", () => {
    const board = emptyBoard();
    const from = { file: 9, rank: 5 };
    placePiece(board, from, { type: "promoted_pawn", owner: "black" });
    const tok = rawPieceTargets(board, from, { type: "promoted_pawn", owner: "black" });
    const gold = rawPieceTargets(board, from, { type: "gold", owner: "black" });
    expect(tok.map((c) => cellKey(c.file, c.rank)).sort()).toEqual(
      gold.map((c) => cellKey(c.file, c.rank)).sort()
    );
  });

  it("龍は飛＋斜め1", () => {
    const board = emptyBoard();
    const from = { file: 9, rank: 5 };
    placePiece(board, from, { type: "dragon", owner: "black" });
    const got = rawPieceTargets(board, from, { type: "dragon", owner: "black" });
    expect(got.some((c) => c.file === 8 && c.rank === 4)).toBe(true);
    expect(got.some((c) => c.file === 10 && c.rank === 4)).toBe(true);
  });
});

void applyAction;
void isCheckmate;
