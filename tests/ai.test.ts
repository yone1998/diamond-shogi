import { describe, it, expect } from "vitest";
import { createInitialState } from "../src/engine/initial";
import {
  chooseCpuMove,
  evaluate,
  evaluateBreakdown,
  evaluatePosition,
  TEMPO_BONUS,
} from "../src/engine/ai";
import { tryMove } from "../src/engine/game";

describe("CPU（たたき台）", () => {
  it("初期局面で合法手を返す", () => {
    const state = createInitialState();
    const move = chooseCpuMove(state, 2);
    expect(move).not.toBeNull();
  });

  it("初期局面の静的評価（手番除く）は0", () => {
    const state = createInitialState();
    const b = evaluateBreakdown(state);
    expect(b.material).toBe(0);
    expect(b.positional).toBe(0);
    expect(evaluatePosition(state)).toBe(0);
    expect(b.tempo).toBe(TEMPO_BONUS);
    expect(evaluate(state)).toBe(TEMPO_BONUS);
  });

  it("着手後に局面が進む", () => {
    const state = createInitialState();
    const move = chooseCpuMove(state, 1);
    expect(move).not.toBeNull();
    const next = tryMove(state, move!);
    expect(next).not.toBeNull();
    expect(next!.turn).toBe("white");
  });

  it("3段階すべてで着手できる", () => {
    const state = createInitialState();
    expect(chooseCpuMove(state, 1)).not.toBeNull();
    expect(chooseCpuMove(state, 2)).not.toBeNull();
    expect(chooseCpuMove(state, 3)).not.toBeNull();
  });
});
