import { describe, it, expect } from "vitest";
import { allCells, isValidCell } from "../src/engine/board";
import {
  createInitialBoard,
  createInitialState,
  countPieces,
  expectedPieceAt,
  getInitialPlacements,
} from "../src/engine/initial";
import { cellKey } from "../src/engine/types";
import type { PieceType } from "../src/engine/types";

describe("盤面", () => {
  it("存在するマスは77個", () => {
    expect(allCells()).toHaveLength(77);
  });

  it("file % 2 === rank % 2 のみ有効", () => {
    let count = 0;
    for (let r = 1; r <= 9; r++) {
      for (let f = 1; f <= 17; f++) {
        if (f % 2 === r % 2) {
          expect(isValidCell(f, r)).toBe(true);
          count++;
        } else {
          expect(isValidCell(f, r)).toBe(false);
        }
      }
    }
    expect(count).toBe(77);
  });

  it("各段のマス数は 9,8,9,8,9,8,9,8,9", () => {
    const expected = [9, 8, 9, 8, 9, 8, 9, 8, 9];
    for (let rank = 1; rank <= 9; rank++) {
      const n = allCells().filter((c) => c.rank === rank).length;
      expect(n).toBe(expected[rank - 1]);
    }
  });

  it("1段目は奇数筋のみ", () => {
    const files = allCells()
      .filter((c) => c.rank === 1)
      .map((c) => c.file)
      .sort((a, b) => a - b);
    expect(files).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17]);
  });

  it("2段目は偶数筋のみ", () => {
    const files = allCells()
      .filter((c) => c.rank === 2)
      .map((c) => c.file)
      .sort((a, b) => a - b);
    expect(files).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
  });
});

describe("初期配置", () => {
  const board = createInitialBoard();
  const counts = countPieces(board);

  it("先手20枚・後手20枚・合計40枚", () => {
    expect(counts.black).toBe(20);
    expect(counts.white).toBe(20);
    expect(counts.total).toBe(40);
  });

  it("配置リストは40個", () => {
    expect(getInitialPlacements()).toHaveLength(40);
  });

  it("指定40座標に正しい駒がある", () => {
    for (const p of getInitialPlacements()) {
      const piece = board.get(cellKey(p.file, p.rank));
      expect(piece).toEqual({ type: p.type, owner: p.owner });
    }
  });

  it("上記以外のセルには駒がない", () => {
    const occupied = new Set(
      getInitialPlacements().map((p) => cellKey(p.file, p.rank))
    );
    for (const cell of allCells()) {
      const key = cellKey(cell.file, cell.rank);
      if (!occupied.has(key)) {
        expect(board.has(key)).toBe(false);
      }
    }
  });

  const assertAt = (file: number, rank: number, type: PieceType, owner: "black" | "white") => {
    expect(board.get(cellKey(file, rank))).toEqual({ type, owner });
  };

  it("角・飛・香の特別位置", () => {
    assertAt(1, 1, "lance", "white");
    assertAt(17, 1, "lance", "white");
    assertAt(4, 2, "rook", "white");
    assertAt(14, 2, "bishop", "white");
    assertAt(4, 8, "bishop", "black");
    assertAt(14, 8, "rook", "black");
    assertAt(1, 9, "lance", "black");
    assertAt(17, 9, "lance", "black");
  });

  it("3段目の歩9枚", () => {
    for (const f of [1, 3, 5, 7, 9, 11, 13, 15, 17]) {
      assertAt(f, 3, "pawn", "white");
    }
  });

  it("7段目の歩9枚", () => {
    for (const f of [1, 3, 5, 7, 9, 11, 13, 15, 17]) {
      assertAt(f, 7, "pawn", "black");
    }
  });

  it("expectedPieceAt と一致", () => {
    expect(expectedPieceAt(9, 1)).toEqual({ type: "king", owner: "white" });
    expect(expectedPieceAt(9, 9)).toEqual({ type: "king", owner: "black" });
    expect(expectedPieceAt(9, 5)).toBeNull();
  });

  it("初期状態は先手番", () => {
    expect(createInitialState().turn).toBe("black");
  });
});
