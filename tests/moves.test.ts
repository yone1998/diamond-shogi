import { describe, it, expect } from "vitest";
import { emptyBoard, placePiece } from "../src/engine/initial";
import { rawPieceTargets } from "../src/engine/moves";
import { cellKey } from "../src/engine/types";
import type { Cell, Piece, Player } from "../src/engine/types";
import { formatCell } from "../src/engine/board";

function keys(cells: Cell[]): string[] {
  return cells.map((c) => cellKey(c.file, c.rank)).sort();
}

function expectTargets(
  piece: Piece,
  from: Cell,
  expected: Cell[]
): void {
  const board = emptyBoard();
  placePiece(board, from, piece);
  const got = rawPieceTargets(board, from, piece);
  expect(keys(got)).toEqual(keys(expected));
}

describe("駒の移動（盤中央・単独）", () => {
  const center: Cell = { file: 9, rank: 5 };

  it("王は8方向", () => {
    expectTargets(
      { type: "king", owner: "black" },
      center,
      [
        { file: 9, rank: 3 }, // 前
        { file: 9, rank: 7 }, // 後
        { file: 7, rank: 5 }, // 左
        { file: 11, rank: 5 }, // 右
        { file: 8, rank: 4 }, // 前左
        { file: 10, rank: 4 }, // 前右
        { file: 8, rank: 6 }, // 後左
        { file: 10, rank: 6 }, // 後右
      ]
    );
  });

  it("金は6方向のみ（後方斜めなし）", () => {
    expectTargets(
      { type: "gold", owner: "black" },
      center,
      [
        { file: 9, rank: 3 },
        { file: 8, rank: 4 },
        { file: 10, rank: 4 },
        { file: 7, rank: 5 },
        { file: 11, rank: 5 },
        { file: 9, rank: 7 },
      ]
    );
  });

  it("銀は5方向のみ（左右・真後ろなし）", () => {
    expectTargets(
      { type: "silver", owner: "black" },
      center,
      [
        { file: 9, rank: 3 },
        { file: 8, rank: 4 },
        { file: 10, rank: 4 },
        { file: 8, rank: 6 },
        { file: 10, rank: 6 },
      ]
    );
  });

  it("先手桂 9五 → 8二, 10二", () => {
    expectTargets(
      { type: "knight", owner: "black" },
      center,
      [
        { file: 8, rank: 2 },
        { file: 10, rank: 2 },
      ]
    );
  });

  it("後手桂 9五 → 8八, 10八", () => {
    expectTargets(
      { type: "knight", owner: "white" },
      center,
      [
        { file: 8, rank: 8 },
        { file: 10, rank: 8 },
      ]
    );
  });

  it("歩は前方のみ（先手: rank-2）", () => {
    expectTargets(
      { type: "pawn", owner: "black" },
      center,
      [{ file: 9, rank: 3 }]
    );
  });

  it("歩は前方のみ（後手: rank+2）", () => {
    expectTargets(
      { type: "pawn", owner: "white" },
      center,
      [{ file: 9, rank: 7 }]
    );
  });

  it("香は前方のみ・後方へは行けない", () => {
    const board = emptyBoard();
    const from = center;
    placePiece(board, from, { type: "lance", owner: "black" });
    const got = rawPieceTargets(board, from, { type: "lance", owner: "black" });
    // 前方: 9三, 9一
    expect(keys(got)).toEqual(keys([
      { file: 9, rank: 3 },
      { file: 9, rank: 1 },
    ]));
    // 後方マスが含まれない
    expect(got.some((c) => c.rank > from.rank)).toBe(false);
  });

  it("飛車は同じ筋・同じ段の4方向", () => {
    const board = emptyBoard();
    placePiece(board, center, { type: "rook", owner: "black" });
    const got = rawPieceTargets(board, center, { type: "rook", owner: "black" });
    // すべての到達マスは file=9 または rank=5、かつ偶奇一致
    for (const c of got) {
      expect(c.file === 9 || c.rank === 5).toBe(true);
      expect((c.file + c.rank) % 2).toBe(0); // 両方奇数なので偶
    }
    // 斜めは含まない
    expect(got.some((c) => c.file !== 9 && c.rank !== 5)).toBe(false);
    // 前後左右に少なくとも1マスずつ
    expect(got.some((c) => c.file === 9 && c.rank < 5)).toBe(true);
    expect(got.some((c) => c.file === 9 && c.rank > 5)).toBe(true);
    expect(got.some((c) => c.rank === 5 && c.file < 9)).toBe(true);
    expect(got.some((c) => c.rank === 5 && c.file > 9)).toBe(true);
  });

  it("角は辺方向4方向のみ", () => {
    const board = emptyBoard();
    placePiece(board, center, { type: "bishop", owner: "black" });
    const got = rawPieceTargets(board, center, { type: "bishop", owner: "black" });
    for (const c of got) {
      const df = Math.abs(c.file - 9);
      const dr = Math.abs(c.rank - 5);
      expect(df).toBe(dr);
      expect(df).toBeGreaterThan(0);
    }
    // 正交方向は含まない
    expect(got.some((c) => c.file === 9 || c.rank === 5)).toBe(false);
  });

  it("味方駒のマスはハイライト対象にならない（捕獲不可）", () => {
    const board = emptyBoard();
    placePiece(board, center, { type: "gold", owner: "black" });
    placePiece(board, { file: 9, rank: 3 }, { type: "pawn", owner: "black" });
    const got = rawPieceTargets(board, center, { type: "gold", owner: "black" });
    expect(got.some((c) => c.file === 9 && c.rank === 3)).toBe(false);
  });

  it("敵駒のマスは捕獲可能", () => {
    const board = emptyBoard();
    placePiece(board, center, { type: "gold", owner: "black" });
    placePiece(board, { file: 9, rank: 3 }, { type: "pawn", owner: "white" });
    const got = rawPieceTargets(board, center, { type: "gold", owner: "black" });
    expect(got.some((c) => c.file === 9 && c.rank === 3)).toBe(true);
  });

  it("飛び越え不可（香）", () => {
    const board = emptyBoard();
    placePiece(board, center, { type: "lance", owner: "black" });
    placePiece(board, { file: 9, rank: 3 }, { type: "pawn", owner: "white" });
    const got = rawPieceTargets(board, center, { type: "lance", owner: "black" });
    expect(keys(got)).toEqual(keys([{ file: 9, rank: 3 }]));
    expect(got.some((c) => c.rank === 1)).toBe(false);
  });
});

describe("座標表記", () => {
  it("formatCell", () => {
    // 表示筋は右が1（内部fileの左右反転）
    expect(formatCell({ file: 2, rank: 2 })).toBe("16二");
    expect(formatCell({ file: 16, rank: 8 })).toBe("2八");
    expect(formatCell({ file: 9, rank: 5 })).toBe("9五");
  });
});

describe("後手の方向反転", () => {
  it("後手金の前方は rank+2", () => {
    const from: Cell = { file: 9, rank: 5 };
    expectTargets(
      { type: "gold", owner: "white" },
      from,
      [
        { file: 9, rank: 7 }, // 前
        { file: 8, rank: 6 },
        { file: 10, rank: 6 },
        { file: 7, rank: 5 },
        { file: 11, rank: 5 },
        { file: 9, rank: 3 }, // 後
      ]
    );
  });
});

void (null as unknown as Player);
