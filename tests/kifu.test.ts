import { describe, expect, it } from "vitest";
import { formatKifuAction, formatKifuActionDetailed } from "../src/engine/kifu";
import { newGame } from "../src/engine/game";
import { cellKeyOf } from "../src/engine/types";

describe("棋譜表記", () => {
  it("通常は座標＋駒名", () => {
    const g = newGame();
    const from = { file: 9, rank: 7 };
    const to = { file: 9, rank: 5 };
    const text = formatKifuAction(g.board, "black", {
      kind: "move",
      from,
      to,
      promote: false,
    });
    expect(text).toBe("▲9五歩");
  });

  it("直前手の到着マスを取るときは「同」", () => {
    const g = newGame();
    // 盤上に何かある必要はない（表記のみ）
    const text = formatKifuAction(
      g.board,
      "black",
      {
        kind: "move",
        from: { file: 9, rank: 7 },
        to: { file: 9, rank: 5 },
        promote: false,
      },
      { file: 9, rank: 5 }
    );
    expect(text).toBe("▲同歩");
  });

  it("詳細表記でも同＋不成が付く", () => {
    const g = newGame();
    // 成れる歩を想定した不成表記
    const pawn = g.board.get(cellKeyOf({ file: 9, rank: 7 }));
    expect(pawn?.type).toBe("pawn");
    const text = formatKifuActionDetailed(
      g.board,
      "black",
      {
        kind: "move",
        from: { file: 9, rank: 7 },
        to: { file: 9, rank: 3 },
        promote: false,
      },
      true,
      { file: 9, rank: 3 }
    );
    expect(text).toBe("▲同歩不成");
  });
});
