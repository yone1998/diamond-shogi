import type { Cell } from "./types";
import { cellKey } from "./types";

/** 存在するマス: file%2 === rank%2, 1..17 × 1..9 */
export function isValidCell(file: number, rank: number): boolean {
  return (
    file >= 1 &&
    file <= 17 &&
    rank >= 1 &&
    rank <= 9 &&
    file % 2 === rank % 2
  );
}

export function isValidCellObj(cell: Cell): boolean {
  return isValidCell(cell.file, cell.rank);
}

/** 77マスすべてのセルを生成 */
export function allCells(): Cell[] {
  const cells: Cell[] = [];
  for (let rank = 1; rank <= 9; rank++) {
    for (let file = 1; file <= 17; file++) {
      if (isValidCell(file, rank)) {
        cells.push({ file, rank });
      }
    }
  }
  return cells;
}

export function allCellKeys(): string[] {
  return allCells().map((c) => cellKey(c.file, c.rank));
}

/** 表示用の筋番号（右が1・左が17） */
export function displayFile(file: number): number {
  return 18 - file;
}

/** 座標表記: 例「9五」（筋は右が1） */
export function formatCell(cell: Cell): string {
  const ranks = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  return `${displayFile(cell.file)}${ranks[cell.rank]}`;
}

/**
 * 菱形盤の画面座標への変換。
 * file 大＝右（表示ラベル displayFile で右が1）、rank 大＝下。
 */
export function cellToScreen(cell: Cell, size: number): { x: number; y: number } {
  const halfW = size;
  const halfH = size * 0.55;
  const x = (cell.file - 1) * (halfW / 2);
  const y = (cell.rank - 1) * (halfH / 2);
  return { x, y };
}

export function boardPixelSize(size: number): { width: number; height: number } {
  const halfW = size;
  const halfH = size * 0.55;
  return {
    width: 16 * (halfW / 2) + halfW,
    height: 8 * (halfH / 2) + halfH,
  };
}
