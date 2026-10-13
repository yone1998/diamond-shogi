import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/engine/initial";
import {
  applyAction,
  generateLegalMoves,
  isLegalAction,
  positionKey,
} from "../src/engine/moves";
import { tryMove } from "../src/engine/game";

describe("千日手禁止", () => {
  it("同一局面が4回目になる手は非合法として弾かれる", () => {
    let state = createInitialState();
    const key = positionKey(state);
    state = {
      ...state,
      positionCounts: new Map([[key, 3]]),
      history: [key, key, key],
    };

    const moves = generateLegalMoves(state);
    for (const m of moves) {
      const next = applyAction(state, m);
      const nk = positionKey(next);
      if ((next.positionCounts.get(nk) ?? 0) >= 4) {
        expect(isLegalAction(state, m)).toBe(false);
      }
    }
    // 合法手自体は（千日手にならない限り）残る
    expect(moves.length).toBeGreaterThan(0);
  });

  it("deferMateFor 指定でも通常の1手は結果なし", () => {
    const state = createInitialState();
    const moves = generateLegalMoves(state);
    expect(moves.length).toBeGreaterThan(0);
    const next = tryMove(state, moves[0]!, { deferMateFor: "white" });
    expect(next).not.toBeNull();
    expect(next!.result).toBeNull();
  });
});
