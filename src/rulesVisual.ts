/**
 * ルール説明用 SVG
 * 各駒について「空き盤全体」の中央に駒を置き、到達マスを図示する
 * タイトル・説明文は HTML 側に出し、SVG 内テキストの見切れを避ける
 */

import { allCells, displayFile } from "./engine/board";
import { targetsOnEmptyBoard } from "./engine/moves";
import { faceFor, piecePolygon } from "./engine/pieceFace";
import type { Cell, PieceType } from "./engine/types";
import { cellKeyOf, RANK_KANJI } from "./engine/types";

const CENTER: Cell = { file: 9, rank: 5 };
const CELL_W = 12;
const CELL_H = 17;
const PAD_X = 22;
const PAD_Y = 18;

function cellCenter(cell: Cell): { cx: number; cy: number } {
  return {
    cx: PAD_X + (cell.file - 1) * (CELL_W / 2) + CELL_W / 2,
    cy: PAD_Y + (cell.rank - 1) * (CELL_H / 2) + CELL_H / 2,
  };
}

function boardSize(): { width: number; height: number } {
  return {
    width: 16 * (CELL_W / 2) + CELL_W + PAD_X * 2,
    height: 8 * (CELL_H / 2) + CELL_H + PAD_Y * 2,
  };
}

function rhomb(cx: number, cy: number, fill: string, stroke = "#6a4a28"): string {
  const hw = CELL_W / 2;
  const hh = CELL_H / 2;
  const pts = `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`;
  return `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="0.7"/>`;
}

function miniPiece(cx: number, cy: number, type: PieceType): string {
  const w = CELL_W * 0.52;
  const h = CELL_H * 0.58;
  const face = faceFor(type, "black");
  const pts = piecePolygon(cx, cy, w, h);
  const fs = face.length > 1 ? w * 0.42 : w * 0.55;
  return `<g>
    <polygon points="${pts}" fill="#f2dcb0" stroke="#4a3010" stroke-width="0.8"/>
    <text x="${cx}" y="${cy + h * 0.06}" text-anchor="middle" dominant-baseline="central"
      font-size="${fs}" font-weight="700" fill="#1a1208"
      font-family="Hiragino Mincho ProN, Yu Mincho, Noto Serif JP, serif">${face}</text>
  </g>`;
}

function boardSvgOnly(cellsHtml: string, extras = ""): string {
  const { width, height } = boardSize();
  return `<svg class="rule-svg board-full" viewBox="0 0 ${width} ${height}" role="img">
    ${cellsHtml}${extras}
  </svg>`;
}

/**
 * 空き盤＋中央の駒＋到達マス（薄暗い丸）
 * タイトル・キャプションは呼び出し側の HTML で表示
 */
export function diagramPieceOnFullBoard(type: PieceType): string {
  const reach = new Set(
    targetsOnEmptyBoard(type, CENTER, "black").map((c) => cellKeyOf(c))
  );
  const originKey = cellKeyOf(CENTER);
  const dotR = Math.min(CELL_W, CELL_H) * 0.16;

  const cells = allCells()
    .map((cell) => {
      const { cx, cy } = cellCenter(cell);
      const key = cellKeyOf(cell);
      const isOrigin = key === originKey;
      const can = reach.has(key);
      const fill = isOrigin ? "#c5d8e8" : "#e8d5a8";
      let extra = "";
      if (can) {
        extra = `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="rgba(36,40,48,0.5)"/>`;
      }
      return `${rhomb(cx, cy, fill)}${extra}`;
    })
    .join("");

  const { cx, cy } = cellCenter(CENTER);
  return boardSvgOnly(cells, miniPiece(cx, cy, type));
}

/** 自陣・敵陣の色分け（先手視点） */
export function diagramCamps(): string {
  const cells = allCells()
    .map((cell) => {
      const { cx, cy } = cellCenter(cell);
      let fill = "#e8d5a8";
      if (cell.rank <= 3) fill = "#e8a898";
      else if (cell.rank >= 7) fill = "#98b8e0";
      return rhomb(cx, cy, fill);
    })
    .join("");
  return boardSvgOnly(cells);
}

/** 筋・段の説明図用（大きめ・矢印番号が見やすい） */
const AXIS = {
  w: 16,
  h: 20,
  padX: 14,
  padY: 24,
  padRight: 22,
} as const;

const FILE_ODD = "#c8e0a8";
const FILE_EVEN = "#e8d5a8";
const RANK_ODD = "#d8c0e8";
const RANK_EVEN = "#e8d5a8";

function axisCenter(cell: Cell): { cx: number; cy: number } {
  // 説明図は従来どおり左＝内部file小。ラベルだけ右が1になるよう displayFile
  return {
    cx: AXIS.padX + (cell.file - 1) * (AXIS.w / 2) + AXIS.w / 2,
    cy: AXIS.padY + (cell.rank - 1) * (AXIS.h / 2) + AXIS.h / 2,
  };
}

function axisBoardSize(): { width: number; height: number } {
  return {
    width: 16 * (AXIS.w / 2) + AXIS.w + AXIS.padX + AXIS.padRight,
    height: 8 * (AXIS.h / 2) + AXIS.h + AXIS.padY * 2,
  };
}

function axisRhomb(cx: number, cy: number, fill: string): string {
  const hw = AXIS.w / 2;
  const hh = AXIS.h / 2;
  const pts = `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`;
  return `<polygon points="${pts}" fill="${fill}" stroke="#6a4a28" stroke-width="0.7"/>`;
}

function cellsOfFile(file: number): Cell[] {
  const out: Cell[] = [];
  for (let rank = 1; rank <= 9; rank++) {
    if ((file + rank) % 2 === 0) out.push({ file, rank });
  }
  return out;
}

function cellsOfRank(rank: number): Cell[] {
  const out: Cell[] = [];
  for (let file = 1; file <= 17; file++) {
    if ((file + rank) % 2 === 0) out.push({ file, rank });
  }
  return out;
}

/** 上→下の縦矢印。番号は上端（表示用筋番号＝右が1） */
function vArrowDown(
  cx: number,
  y1: number,
  y2: number,
  label: string,
  color: string
): string {
  const tip = 3.8;
  return `<g>
    <line x1="${cx}" y1="${y1}" x2="${cx}" y2="${y2}" stroke="${color}" stroke-width="1.25" stroke-linecap="round"/>
    <polyline points="${cx - tip},${y2 - tip * 1.35} ${cx},${y2} ${cx + tip},${y2 - tip * 1.35}"
      fill="none" stroke="${color}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="${cx}" y="${y1 - 5}" text-anchor="middle" font-size="10" font-weight="700" fill="${color}">${label}</text>
  </g>`;
}

/** 右→左の横矢印。番号は右端 */
function hArrowLeft(
  cy: number,
  xLeft: number,
  xRight: number,
  label: string,
  color: string
): string {
  const tip = 3.8;
  return `<g>
    <line x1="${xRight}" y1="${cy}" x2="${xLeft}" y2="${cy}" stroke="${color}" stroke-width="1.25" stroke-linecap="round"/>
    <polyline points="${xLeft + tip * 1.35},${cy - tip} ${xLeft},${cy} ${xLeft + tip * 1.35},${cy + tip}"
      fill="none" stroke="${color}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="${xRight + 7}" y="${cy}" text-anchor="start" dominant-baseline="central"
      font-size="10" font-weight="700" fill="${color}">${label}</text>
  </g>`;
}

/** 筋だけの説明図（奇偶色分け・上→下矢印・ラベルは右が1） */
export function diagramFiles(): string {
  const cells = allCells()
    .map((cell) => {
      const { cx, cy } = axisCenter(cell);
      const vis = displayFile(cell.file);
      const fill = vis % 2 === 1 ? FILE_ODD : FILE_EVEN;
      return axisRhomb(cx, cy, fill);
    })
    .join("");

  const arrows: string[] = [];
  for (let file = 1; file <= 17; file++) {
    const col = cellsOfFile(file);
    if (col.length === 0) continue;
    const top = axisCenter(col[0]!);
    const bot = axisCenter(col[col.length - 1]!);
    const y1 = top.cy - AXIS.h * 0.28;
    const y2 = bot.cy + AXIS.h * 0.28;
    const vis = displayFile(file);
    const color = vis % 2 === 1 ? "#1a4a18" : "#3a6a28";
    arrows.push(vArrowDown(top.cx, y1, y2, String(vis), color));
  }
  const { width, height } = axisBoardSize();
  return `<svg class="rule-svg board-full" viewBox="0 0 ${width} ${height}" role="img">
    ${cells}${arrows.join("")}
  </svg>`;
}

/** 段だけの説明図（奇偶色分け・右→左矢印・番号は右・上＝一） */
export function diagramRanks(): string {
  const cells = allCells()
    .map((cell) => {
      const { cx, cy } = axisCenter(cell);
      const fill = cell.rank % 2 === 1 ? RANK_ODD : RANK_EVEN;
      return axisRhomb(cx, cy, fill);
    })
    .join("");

  const arrows: string[] = [];
  for (let rank = 1; rank <= 9; rank++) {
    const row = cellsOfRank(rank);
    if (row.length === 0) continue;
    const left = axisCenter(row[0]!);
    const right = axisCenter(row[row.length - 1]!);
    const x1 = left.cx - AXIS.w * 0.28;
    const x2 = right.cx + AXIS.w * 0.28;
    const color = rank % 2 === 1 ? "#4a1860" : "#6a3a78";
    arrows.push(hArrowLeft(left.cy, x1, x2, RANK_KANJI[rank]!, color));
  }
  const { width, height } = axisBoardSize();
  return `<svg class="rule-svg board-full" viewBox="0 0 ${width} ${height}" role="img">
    ${cells}${arrows.join("")}
  </svg>`;
}

/** ルール画面に並べる駒図（1駒＝1盤） */
export const PIECE_RULE_DIAGRAMS: {
  type: PieceType;
  title: string;
  caption: string;
}[] = [
  {
    type: "pawn",
    title: "歩",
    caption: "正面の隣マスへ1つ（本将棋の1段前）",
  },
  {
    type: "lance",
    title: "香",
    caption: "正面の同筋を、ぶつかるまで前進",
  },
  {
    type: "knight",
    title: "桂",
    caption: "左右に開いて3段先（飛び越え）",
  },
  {
    type: "silver",
    title: "銀",
    caption: "斜め4方向＋正面。左右・真後ろは不可",
  },
  {
    type: "gold",
    title: "金",
    caption: "前後左右＋斜め前。成香・成桂・成銀・と金も同じ動き",
  },
  {
    type: "king",
    title: "玉（王）",
    caption: "周囲8方向へ1マス",
  },
  {
    type: "bishop",
    title: "角",
    caption: "斜め（辺方向）を、ぶつかるまで",
  },
  {
    type: "rook",
    title: "飛",
    caption: "縦横（同筋・同段）を、ぶつかるまで",
  },
  {
    type: "horse",
    title: "馬（成角）",
    caption: "角の動きに加え、周囲の縦横1マス",
  },
  {
    type: "dragon",
    title: "龍（成飛）",
    caption: "飛の動きに加え、周囲の斜め1マス",
  },
];
