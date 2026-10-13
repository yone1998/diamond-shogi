import type { Cell, GameState, HandPiece, Player, Action } from "./engine/types";
import { HAND_LABEL, cellKeyOf, RANK_KANJI } from "./engine/types";
import { allCells, isValidCell, formatCell, displayFile } from "./engine/board";
import {
  isCheckmate,
  legalDropTargets,
  legalMoveTargets,
  previewPieceTargets,
  isInCheck,
} from "./engine/moves";
import {
  canDeclareImpasse,
  countPoints,
  newGame,
  resign,
  resolveImpasse,
  tryMove,
} from "./engine/game";
import { formatKifuActionDetailed, type KifuEntry } from "./engine/kifu";
import { canPromote, promoteType } from "./engine/types";
import { isPromotionZone, mustPromote } from "./engine/directions";
import {
  chooseCpuMoveAsync,
  getCpuTimeLimitMs,
  type CpuLevel,
} from "./engine/ai";
import { faceFor, piecePolygon, isPromotedFace, pieceSizeScale } from "./engine/pieceFace";
import { playSfx, setSoundEnabled, soundEnabled, unlockAudio } from "./audio";
import {
  diagramCamps,
  diagramFiles,
  diagramRanks,
  diagramPieceOnFullBoard,
  PIECE_RULE_DIAGRAMS,
} from "./rulesVisual";

type Selection =
  | { kind: "board"; cell: Cell; targets: ReturnType<typeof legalMoveTargets> }
  /** CPU駒の利き確認（表示のみ・動かせない） */
  | { kind: "preview"; cell: Cell; targets: ReturnType<typeof legalMoveTargets> }
  | { kind: "hand"; player: Player; piece: HandPiece; targets: Cell[] }
  | null;

type Phase = "setup" | "playing";
type GameMode = "cpu" | "pvp";

interface Snapshot {
  state: GameState;
  kifu: KifuEntry[];
  lastMove: { from: Cell | null; to: Cell } | null;
  humanPlayer: Player;
}

let phase: Phase = "setup";
let gameMode: GameMode = "cpu";
let cpuLevel: CpuLevel = 2;
let setupSide: "black" | "white" | "random" = "random";
let state: GameState = newGame();
let humanPlayer: Player = "black";
let selection: Selection = null;
let pendingPromote: { action: Extract<Action, { kind: "move" }> } | null = null;
let kifu: KifuEntry[] = [];
let lastMove: { from: Cell | null; to: Cell } | null = null;
let cpuThinking = false;
/** CPU思考の残りms（時間制限がある強さのみ。CPU以外は使わない） */
let cpuRemainingMs: number | null = null;
let cpuTimer: ReturnType<typeof setTimeout> | null = null;
let cpuCountdownTimer: ReturnType<typeof setInterval> | null = null;
let undoStack: Snapshot[] = [];
let endMessage: { detail: string; title: string; winClass: string } | null = null;
let showRules = false;
/** 画面上部の一時お知らせ */
let notice: string | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

/** 対局中は盤の論理サイズを固定（縮尺ずれ防止） */
type BoardMetrics = {
  w: number;
  h: number;
  pad: number;
  baseW: number;
  baseH: number;
};
let lockedMetrics: BoardMetrics | null = null;

const HAND_ORDER: HandPiece[] = [
  "rook",
  "bishop",
  "gold",
  "silver",
  "knight",
  "lance",
  "pawn",
];

function cloneState(s: GameState): GameState {
  return {
    board: new Map(s.board),
    turn: s.turn,
    hands: {
      black: { ...s.hands.black },
      white: { ...s.hands.white },
    },
    history: [...s.history],
    positionCounts: new Map(s.positionCounts),
    checkHistory: [...s.checkHistory],
    lastMoveWasCheck: s.lastMoveWasCheck,
    result: s.result ? ({ ...s.result } as GameState["result"]) : null,
  };
}

function pushUndoSnapshot(): void {
  undoStack.push({
    state: cloneState(state),
    kifu: kifu.map((e) => ({
      ...e,
      from: e.from ? { ...e.from } : null,
      to: { ...e.to },
    })),
    lastMove: lastMove
      ? {
          from: lastMove.from ? { ...lastMove.from } : null,
          to: { ...lastMove.to },
        }
      : null,
    humanPlayer,
  });
}

function cpuPlayer(): Player {
  return humanPlayer === "black" ? "white" : "black";
}

/**
 * CPU後手時は盤を180度反転（手前＝自陣）。
 * 先手時は右が1筋・上が一段。棋譜は常に絶対座標（ラベルと同じ）。
 */
function boardFlipped(): boolean {
  return gameMode === "cpu" && humanPlayer === "white";
}

function toDisplay(cell: Cell): Cell {
  if (!boardFlipped()) return cell;
  return { file: 18 - cell.file, rank: 10 - cell.rank };
}

/** 現在操作できる手番か */
function canAct(): boolean {
  return phase === "playing" && !state.result && !cpuThinking;
}

function isPlayersTurn(player: Player): boolean {
  if (!canAct()) return false;
  if (state.turn !== player) return false;
  if (gameMode === "cpu") return player === humanPlayer;
  return true;
}

/** 手前側の駒が上向きになるよう向きを決める */
function pieceFacesDown(owner: Player): boolean {
  if (boardFlipped()) return owner === "black";
  return owner === "white";
}

function computeCellMetrics(): BoardMetrics {
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  // ヘッダ＋上下持ち駒＋余白を確保し、ズーム100%で持ち駒が見切れないようにする
  const topBarPx = 44;
  const handPx = 90; // --hand-h ≈ 5.6rem
  const chromePx = topBarPx + handPx * 2 + 48;
  const availH = Math.max(260, vh - chromePx);
  const availW = Math.max(300, Math.min(vw - 176, vw * 0.82));
  // 右側に段番号を置くため pad を左右非対称に（描画は pad 共通＋右ラベル）
  const pad = 22;
  let h = Math.floor((availH - pad * 2) / 5);
  let w = Math.floor((availW - pad * 2 - 12) / 8);
  h = Math.max(36, Math.min(72, h));
  w = Math.max(26, Math.min(48, w));
  if (h < w * 1.35) h = Math.round(w * 1.45);
  if (w > h * 0.75) w = Math.round(h * 0.68);
  // 上下持ち駒込みで収まるよう再調整
  const boardH = 8 * (h / 2) + h + pad * 2;
  if (boardH > availH) {
    const scale = availH / boardH;
    h = Math.max(36, Math.floor(h * scale));
    w = Math.max(26, Math.floor(w * scale));
  }
  const baseH = Math.round(h * 0.4);
  const baseW = Math.round(w * 0.48);
  return { w, h, pad, baseW, baseH };
}

function lockBoardMetrics(): void {
  lockedMetrics = computeCellMetrics();
}

/** 対局中はロック値を使い、ウィンドウリサイズ時のみ再計算 */
function cellMetrics(): BoardMetrics {
  if (lockedMetrics) return lockedMetrics;
  return computeCellMetrics();
}

/**
 * 画面座標（先手視点: file大＝右＝表示1筋、rank小＝上＝一段）。
 * 後手時は toDisplay で180度反転。
 */
function screenPos(
  cell: Cell,
  m: ReturnType<typeof cellMetrics>
): { x: number; y: number } {
  const d = toDisplay(cell);
  return {
    x: (d.file - 1) * (m.w / 2),
    y: (d.rank - 1) * (m.h / 2),
  };
}

function boardDims(m: ReturnType<typeof cellMetrics>): {
  width: number;
  height: number;
} {
  // 右側に段番号を置く余白
  const padRight = Math.max(m.pad, 28);
  return {
    width: 16 * (m.w / 2) + m.w + m.pad + padRight,
    height: 8 * (m.h / 2) + m.h + m.pad * 2,
  };
}

function rhombusPoints(
  cx: number,
  cy: number,
  m: ReturnType<typeof cellMetrics>
): string {
  const hw = m.w / 2;
  const hh = m.h / 2;
  return `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`;
}

function cellCenter(
  cell: Cell,
  m: ReturnType<typeof cellMetrics>
): { cx: number; cy: number } {
  const { x, y } = screenPos(cell, m);
  return {
    cx: x + m.w / 2 + m.pad,
    cy: y + m.h / 2 + m.pad,
  };
}

function isHighlighted(cell: Cell): boolean {
  if (!selection) return false;
  if (selection.kind === "board" || selection.kind === "preview") {
    return selection.targets.some(
      (t) => t.to.file === cell.file && t.to.rank === cell.rank
    );
  }
  return selection.targets.some(
    (t) => t.file === cell.file && t.rank === cell.rank
  );
}

function isCaptureHighlight(cell: Cell): boolean {
  if (!isHighlighted(cell)) return false;
  const piece = state.board.get(cellKeyOf(cell));
  if (!piece) return false;
  if (selection?.kind === "board" || selection?.kind === "preview") {
    const sel = state.board.get(cellKeyOf(selection.cell));
    return !!sel && piece.owner !== sel.owner;
  }
  return piece.owner !== state.turn;
}

function isSelected(cell: Cell): boolean {
  return (
    (selection?.kind === "board" || selection?.kind === "preview") &&
    selection.cell.file === cell.file &&
    selection.cell.rank === cell.rank
  );
}

function isLastFrom(cell: Cell): boolean {
  return (
    !!lastMove?.from &&
    lastMove.from.file === cell.file &&
    lastMove.from.rank === cell.rank
  );
}

function isLastTo(cell: Cell): boolean {
  return (
    !!lastMove &&
    lastMove.to.file === cell.file &&
    lastMove.to.rank === cell.rank
  );
}

function renderShogiPiece(
  cx: number,
  cy: number,
  type: Parameters<typeof faceFor>[0],
  owner: Player,
  baseW: number,
  baseH: number,
  maxW?: number,
  maxH?: number
): string {
  const scale = pieceSizeScale(type);
  let w = baseW * scale;
  let h = baseH * scale;
  if (maxW !== undefined && w > maxW) {
    const r = maxW / w;
    w *= r;
    h *= r;
  }
  if (maxH !== undefined && h > maxH) {
    const r = maxH / h;
    w *= r;
    h *= r;
  }
  const rot = pieceFacesDown(owner)
    ? ` transform="rotate(180 ${cx} ${cy})"`
    : "";
  const face = faceFor(type, owner);
  const promo = isPromotedFace(type) ? " promoted" : "";
  const pts = piecePolygon(cx, cy, w, h);
  const fontSize = face.length > 1 ? w * 0.4 : w * 0.52;
  return `<g class="shogi-piece${promo}"${rot}>
    <polygon class="piece-body" points="${pts}" fill="url(#pieceWood)" filter="url(#pieceEmboss)" />
    <text class="piece-face" x="${cx}" y="${cy + h * 0.06}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}">${face}</text>
  </g>`;
}

function handRoleLabel(player: Player): string {
  if (gameMode === "pvp") return player === "black" ? "先手" : "後手";
  if (player === humanPlayer) {
    return `あなた · ${player === "black" ? "先手" : "後手"}`;
  }
  return `CPU · ${player === "black" ? "先手" : "後手"}`;
}

function renderHand(player: Player): string {
  const hand = state.hands[player];
  const buttons = HAND_ORDER.filter((p) => hand[p] > 0)
    .map((p) => {
      const active =
        selection?.kind === "hand" &&
        selection.player === player &&
        selection.piece === p
          ? " active"
          : "";
      const canClick = isPlayersTurn(player);
      const disabled = !canClick ? " disabled" : "";
      return `<button type="button" class="hand-piece${active}" data-hand="${player}:${p}"${disabled} title="${HAND_LABEL[p]}">
        <span class="hand-piece-svg">${miniHandPiece(p, player)}</span>
        <span class="count">${hand[p]}</span>
      </button>`;
    })
    .join("");

  const turnClass =
    state.turn === player && !state.result && phase === "playing"
      ? " turn-owner"
      : "";
  return `<div class="hand ${player}${turnClass}">
    <div class="hand-label">${handRoleLabel(player)}</div>
    <div class="hand-pieces">${buttons || '<span class="empty-hand">なし</span>'}</div>
  </div>`;
}

function miniHandPiece(piece: HandPiece, owner: Player): string {
  const cx = 17;
  const cy = 19;
  return `<svg width="34" height="38" viewBox="0 0 34 38">
    <defs>
      <linearGradient id="handWood-${owner}-${piece}" x1="0%" y1="0%" x2="30%" y2="100%">
        <stop offset="0%" stop-color="#f8e8c0"/>
        <stop offset="45%" stop-color="#efd8a4"/>
        <stop offset="100%" stop-color="#d4b078"/>
      </linearGradient>
    </defs>
    ${renderShogiPiece(cx, cy, piece, owner, 18, 24).replace(
      'fill="url(#pieceWood)" filter="url(#pieceEmboss)"',
      `fill="url(#handWood-${owner}-${piece})"`
    )}
  </svg>`;
}

function renderAxisLabels(m: ReturnType<typeof cellMetrics>): string {
  const { width } = boardDims(m);
  const labels: string[] = [];
  // 筋ラベル（棋譜の displayFile と同じ数字をマスの上に）
  for (let file = 1; file <= 17; file++) {
    let best: Cell | null = null;
    let bestDR = 99;
    for (let rank = 1; rank <= 9; rank++) {
      if (!isValidCell(file, rank)) continue;
      const dr = toDisplay({ file, rank }).rank;
      if (dr < bestDR) {
        bestDR = dr;
        best = { file, rank };
      }
    }
    if (!best) continue;
    const { cx } = cellCenter(best, m);
    labels.push(
      `<text class="axis-label" x="${cx}" y="${m.pad - 6}" text-anchor="middle">${displayFile(file)}</text>`
    );
  }
  // 段ラベルは画面右端（棋譜の段と同じ）。180度反転時もマスに追従
  for (let rank = 1; rank <= 9; rank++) {
    let best: Cell | null = null;
    let bestDF = -1;
    for (let file = 1; file <= 17; file++) {
      if (!isValidCell(file, rank)) continue;
      const df = toDisplay({ file, rank }).file;
      if (df > bestDF) {
        bestDF = df;
        best = { file, rank };
      }
    }
    if (!best) continue;
    const { cy } = cellCenter(best, m);
    labels.push(
      `<text class="axis-label" x="${width - 12}" y="${cy}" text-anchor="middle" dominant-baseline="central">${RANK_KANJI[rank]}</text>`
    );
  }
  return labels.join("");
}

function renderBoard(): string {
  const m = cellMetrics();
  const { width, height } = boardDims(m);
  const maxPieceW = m.w * 0.58;
  const maxPieceH = m.h * 0.7;
  const dotR = Math.min(m.w, m.h) * 0.13;

  const polygons = allCells()
    .map((cell) => {
      const { cx, cy } = cellCenter(cell, m);
      const pts = rhombusPoints(cx, cy, m);
      let cls = "cell";
      if (isSelected(cell)) cls += " selected";
      if (isLastFrom(cell)) cls += " last-from";
      if (isLastTo(cell)) cls += " last-to";
      const highlighted = isHighlighted(cell);
      const capturing = highlighted && isCaptureHighlight(cell);
      if (highlighted) cls += capturing ? " capture" : " move";

      const piece = state.board.get(cellKeyOf(cell));
      const pieceHtml = piece
        ? renderShogiPiece(
            cx,
            cy,
            piece.type,
            piece.owner,
            m.baseW,
            m.baseH,
            maxPieceW,
            maxPieceH
          )
        : "";

      const isPreviewSel =
        selection?.kind === "preview" &&
        selection.cell.file === cell.file &&
        selection.cell.rank === cell.rank;
      if (isPreviewSel) cls += " preview-sel";

      // 選択マス: セルを暗く。自分の駒のみ枠線（プレビューは枠なし）
      let selectMark = "";
      if (isSelected(cell)) {
        selectMark = `<polygon class="select-shade" points="${pts}" pointer-events="none"/>`;
        if (!isPreviewSel) {
          selectMark += `
           <polygon class="select-ring-outer" points="${pts}" pointer-events="none"/>
           <polygon class="select-ring" points="${pts}" pointer-events="none"/>`;
        }
      }

      // 候補手: マス塗りつぶしではなく薄暗い丸（取れるマスは少し濃く＋輪郭）
      let moveMark = "";
      if (highlighted) {
        if (capturing) {
          moveMark = `<circle class="move-dot capture-dot" cx="${cx}" cy="${cy}" r="${dotR * 1.05}" pointer-events="none"/>`;
        } else {
          moveMark = `<circle class="move-dot" cx="${cx}" cy="${cy}" r="${dotR}" pointer-events="none"/>`;
        }
      }

      return `<g class="${cls}" data-file="${cell.file}" data-rank="${cell.rank}">
        <polygon points="${pts}" />
        ${selectMark}
        ${pieceHtml}
        ${moveMark}
      </g>`;
    })
    .join("");

  return `<svg class="board-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
    <defs>
      <linearGradient id="pieceWood" x1="0%" y1="0%" x2="30%" y2="100%">
        <stop offset="0%" stop-color="#f8e8c0"/>
        <stop offset="45%" stop-color="#efd8a4"/>
        <stop offset="100%" stop-color="#d4b078"/>
      </linearGradient>
      <linearGradient id="cellWood" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#edd8a8"/>
        <stop offset="50%" stop-color="#e2cc98"/>
        <stop offset="100%" stop-color="#d4b888"/>
      </linearGradient>
      <filter id="pieceEmboss" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0.7" dy="1.1" stdDeviation="0.6" flood-color="#3a2810" flood-opacity="0.4"/>
      </filter>
    </defs>
    ${renderAxisLabels(m)}
    ${polygons}
  </svg>`;
}

function renderPromoteDialog(): string {
  if (!pendingPromote) return "";
  return `<div class="modal-overlay" id="promote-overlay">
    <div class="modal" role="dialog" aria-modal="true">
      <p class="modal-title">成りますか？</p>
      <p class="modal-sub">${formatCell(pendingPromote.action.from)} → ${formatCell(pendingPromote.action.to)}</p>
      <p class="modal-hint">画面外をクリックで手を取消</p>
      <div class="modal-actions">
        <button type="button" id="promote-yes" class="btn-promote">成る</button>
        <button type="button" id="promote-no" class="btn-nopromote">不成</button>
      </div>
    </div>
  </div>`;
}

function renderSetupDialog(): string {
  if (phase !== "setup") return "";
  const sideActive = (s: string) => (setupSide === s ? " selected" : "");
  const levelActive = (n: CpuLevel) => (cpuLevel === n ? " selected" : "");
  const modeActive = (m: GameMode) => (gameMode === m ? " selected" : "");
  // 高さ固定のため hidden ではなく invisible（領域は常に確保）
  const cpuInvisible = gameMode !== "cpu" ? " invisible" : "";

  return `<div class="modal-overlay" id="setup-overlay">
    <div class="modal setup-modal" role="dialog" aria-modal="true">
      <p class="modal-title">対局設定</p>

      <div class="setup-section">
        <div class="setup-section-label">モード</div>
        <div class="setup-row">
          <button type="button" class="setup-btn mode${modeActive("pvp")}" data-mode="pvp">2人対戦</button>
          <button type="button" class="setup-btn mode${modeActive("cpu")}" data-mode="cpu">CPUと対局</button>
        </div>
      </div>

      <div class="setup-section cpu-only${cpuInvisible}" aria-hidden="${gameMode !== "cpu"}">
        <div class="setup-section-label">手番</div>
        <div class="setup-row">
          <button type="button" class="setup-btn random${sideActive("random")}" data-side="random"${gameMode !== "cpu" ? " tabindex=\"-1\"" : ""}>ランダム</button>
          <button type="button" class="setup-btn sente${sideActive("black")}" data-side="black"${gameMode !== "cpu" ? " tabindex=\"-1\"" : ""}>先手（▲）</button>
          <button type="button" class="setup-btn gote${sideActive("white")}" data-side="white"${gameMode !== "cpu" ? " tabindex=\"-1\"" : ""}>後手（△）</button>
        </div>
        <div class="setup-section-label">CPUの強さ</div>
        <div class="setup-row">
          <button type="button" class="setup-btn level${levelActive(1)}" data-level="1"${gameMode !== "cpu" ? " tabindex=\"-1\"" : ""}>弱い</button>
          <button type="button" class="setup-btn level${levelActive(2)}" data-level="2"${gameMode !== "cpu" ? " tabindex=\"-1\"" : ""}>普通</button>
          <button type="button" class="setup-btn level${levelActive(3)}" data-level="3"${gameMode !== "cpu" ? " tabindex=\"-1\"" : ""}>強い</button>
        </div>
      </div>

      <div class="setup-actions">
        <button type="button" id="btn-start" class="setup-btn start">対局開始</button>
        <button type="button" id="btn-setup-rules" class="setup-btn">ルール説明</button>
      </div>
    </div>
  </div>`;
}

function buildEndMessageFromState(): {
  detail: string;
  title: string;
  winClass: string;
} | null {
  if (!state.result) return null;
  const r = state.result;
  let title = "";
  let detail = "";
  let youWin: boolean | null = null;

  const winnerLabel = (winner: Player) => {
    if (gameMode === "pvp") {
      return winner === "black" ? "先手の勝ち" : "後手の勝ち";
    }
    youWin = winner === humanPlayer;
    return youWin ? "あなたの勝ち" : "CPUの勝ち";
  };

  if (r.type === "checkmate") {
    title = winnerLabel(r.winner);
    detail = "詰み";
  } else if (r.type === "resign") {
    title = winnerLabel(r.winner);
    detail = "投了";
  } else if (r.type === "sennichite") {
    title = "引き分け";
    detail = "千日手";
  } else if (r.type === "perpetual_check") {
    title = winnerLabel(r.winner);
    detail = "連続王手千日手";
  } else if (r.type === "impasse") {
    if (r.winner === "draw") title = "引き分け";
    else title = winnerLabel(r.winner);
    detail = `相入玉・点数勝負（先手${r.blackPoints}点 / 後手${r.whitePoints}点）`;
  } else if (r.type === "illegal") {
    title = winnerLabel(r.winner);
    detail = `反則: ${r.reason}`;
  }

  const winClass =
    gameMode === "pvp"
      ? " draw"
      : youWin === true
        ? " you-win"
        : youWin === false
          ? " you-lose"
          : " draw";
  return { detail, title, winClass };
}

function renderResultSlot(): string {
  const msg =
    endMessage ?? (phase === "playing" ? buildEndMessageFromState() : null);
  if (!msg) return "";
  // 左上持ち駒と Y が被ってもよいオーバーレイ（盤の縮尺を圧迫しない）
  return `<div class="result-overlay" aria-live="polite">
    <div class="result-banner${msg.winClass}" role="status">
      <div class="result-detail">${msg.detail}</div>
      <div class="result-title">${msg.title}</div>
    </div>
  </div>`;
}

function renderRulesDialog(): string {
  if (!showRules) return "";
  const pieceSections = PIECE_RULE_DIAGRAMS.map(
    (d) => `<section class="rule-card rule-piece-card">
      <h3 class="rule-piece-title">${d.title}</h3>
      ${diagramPieceOnFullBoard(d.type)}
      <p class="rule-caption">${d.caption}</p>
    </section>`
  ).join("");

  return `<div class="modal-overlay" id="rules-overlay">
    <div class="modal rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title">
      <p class="modal-title" id="rules-title">ルール（駒の動き）</p>
      <div class="rules-body visual">
        <section class="rule-card rule-piece-card">
          <h3 class="rule-piece-title">筋（縦の列）</h3>
          ${diagramFiles()}
          <p class="rule-caption">縦の列が筋。右が1・左が17。</p>
        </section>
        <section class="rule-card rule-piece-card">
          <h3 class="rule-piece-title">段（横の行）</h3>
          ${diagramRanks()}
          <p class="rule-caption">横の行が段。上が一・下が九。</p>
        </section>
        <section class="rule-card rule-piece-card">
          <h3 class="rule-piece-title">自陣と敵陣（先手視点）</h3>
          ${diagramCamps()}
          <p class="rule-caption">赤＝敵陣（1〜3段）。青＝自陣（7〜9段）。敵陣への出入りで成れます。</p>
        </section>
        ${pieceSections}
        <section class="rule-card tip">
          <h3>そのほか</h3>
          <ul class="rule-chips">
            <li>持ち駒を打つ</li>
            <li>二歩・打ち歩詰め禁止</li>
            <li>成り・強制成り</li>
            <li>王手は必ず解除</li>
            <li>詰み・投了で勝ち</li>
          </ul>
        </section>
      </div>
      <div class="setup-actions">
        <button type="button" id="btn-rules-close" class="setup-btn start">閉じる</button>
      </div>
    </div>
  </div>`;
}

function showNotice(message: string): void {
  notice = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice = null;
    noticeTimer = null;
    const el = document.querySelector(".toast-notice");
    if (el) el.remove();
  }, 2200);
  playSfx("notice");
}

function renderNotice(): string {
  if (!notice) return "";
  return `<div class="toast-notice" role="status">${notice}</div>`;
}

function cancelPromote(): void {
  if (!pendingPromote) return;
  pendingPromote = null;
  playSfx("cancel");
  render();
}

function renderTurnIndicator(): string {
  if (phase === "setup") {
    return `<div class="turn-indicator finished">対局設定</div>`;
  }
  if (state.result) {
    return `<div class="turn-indicator finished">対局終了</div>`;
  }
  if (cpuThinking) {
    const limit = getCpuTimeLimitMs(cpuLevel);
    const secs =
      limit > 0 && cpuRemainingMs != null
        ? Math.max(0, Math.ceil(cpuRemainingMs / 1000))
        : null;
    const countdown =
      secs != null
        ? `<span class="cpu-countdown" aria-live="polite">${secs}秒</span>`
        : "";
    return `<div class="turn-indicator cpu-turn"><span class="turn-name">CPU思考中…</span>${countdown}</div>`;
  }
  const isBlack = state.turn === "black";
  const check = isInCheck(state, state.turn)
    ? '<span class="check-badge">王手</span>'
    : "";
  let name: string;
  if (gameMode === "pvp") {
    name = isBlack ? "先手番" : "後手番";
  } else if (state.turn === humanPlayer) {
    name = "あなたの番";
  } else {
    name = "CPUの番";
  }
  const cls =
    gameMode === "cpu" && state.turn !== humanPlayer
      ? "cpu-turn"
      : isBlack
        ? "black-turn your-turn"
        : "white-turn your-turn";
  return `<div class="turn-indicator ${cls}">
    <span class="turn-mark">${isBlack ? "▲" : "△"}</span>
    <span class="turn-name">${name}</span>${check}
  </div>`;
}

function renderKifu(): string {
  if (kifu.length === 0) {
    return `<div class="kifu-list"><div class="kifu-empty">棋譜</div></div>`;
  }
  const rows = kifu
    .map(
      (e, i) =>
        `<div class="kifu-row${i === kifu.length - 1 ? " latest" : ""}">
          <span class="kifu-num">${e.moveNumber}.</span>
          <span class="kifu-text">${e.text}</span>
        </div>`
    )
    .join("");
  return `<div class="kifu-list" id="kifu-list">${rows}</div>`;
}

function canUndo(): boolean {
  return phase === "playing" && !state.result && !cpuThinking && undoStack.length > 0;
}

/** 手前（下）＝ユーザー／先手、奥（上）＝CPU／後手 */
function topHandPlayer(): Player {
  if (gameMode === "cpu") return cpuPlayer();
  return "white";
}

function bottomHandPlayer(): Player {
  if (gameMode === "cpu") return humanPlayer;
  return "black";
}

function render(): void {
  const app = document.getElementById("app");
  if (!app) return;

  const impasseBtn =
    canDeclareImpasse(state) && canAct()
      ? `<button type="button" id="btn-impasse" title="相入玉の点数勝負">持将棋（先${countPoints(state, "black")}/後${countPoints(state, "white")}）</button>`
      : "";

  const subtitle =
    gameMode === "pvp"
      ? "2人対戦"
      : `vs CPU（${cpuLevel === 1 ? "弱" : cpuLevel === 2 ? "普" : "強"}）`;

  app.innerHTML = `
    <div class="app-shell">
      <header class="top-bar">
        <div class="brand">
          <h1>ダイヤモンド将棋</h1>
          <span class="subtitle">${subtitle}</span>
        </div>
        <div class="header-meta">
          ${renderTurnIndicator()}
          <div class="move-counter">
            <span class="move-label">手数</span>
            <span class="move-value">${kifu.length}</span>
          </div>
        </div>
        <div class="toolbar">
          <button type="button" id="btn-sound" title="効果音" aria-pressed="${soundEnabled}">♪${soundEnabled ? "" : "×"}</button>
          <button type="button" id="btn-rules">ルール</button>
          <button type="button" id="btn-undo" ${!canUndo() ? "disabled" : ""}>待った</button>
          <button type="button" id="btn-new">新規</button>
          <button type="button" id="btn-resign" ${!canAct() ? "disabled" : ""}>投了</button>
          ${impasseBtn}
        </div>
      </header>

      <div class="play-area">
        ${renderResultSlot()}
        ${renderNotice()}
        <div class="board-column">
          <div class="hand-row top">
            ${renderHand(topHandPlayer())}
          </div>
          <div class="board-wrap">
            ${renderBoard()}
          </div>
          <div class="hand-row bottom">
            ${renderHand(bottomHandPlayer())}
          </div>
        </div>
        <aside class="side-column">
          <div class="kifu-panel">
            <div class="kifu-header">棋譜</div>
            ${renderKifu()}
          </div>
        </aside>
      </div>
      ${renderSetupDialog()}
      ${renderRulesDialog()}
      ${renderPromoteDialog()}
    </div>
  `;

  bindEvents();
  const kifuList = document.getElementById("kifu-list");
  if (kifuList) kifuList.scrollTop = kifuList.scrollHeight;
}

function clearSelection(): void {
  selection = null;
}

function startGame(): void {
  void unlockAudio();
  playSfx("start");
  if (gameMode === "cpu") {
    if (setupSide === "random") {
      humanPlayer = Math.random() < 0.5 ? "black" : "white";
    } else {
      humanPlayer = setupSide;
    }
  } else {
    humanPlayer = "black";
  }
  state = newGame();
  phase = "playing";
  clearSelection();
  pendingPromote = null;
  kifu = [];
  lastMove = null;
  undoStack = [];
  endMessage = null;
  abortCpuThinking();
  lockBoardMetrics();
  render();
  scheduleCpuIfNeeded();
}

function doUndo(): void {
  if (!canUndo()) return;
  abortCpuThinking();
  const snap = undoStack.pop()!;
  state = snap.state;
  kifu = snap.kifu;
  lastMove = snap.lastMove;
  humanPlayer = snap.humanPlayer;
  clearSelection();
  pendingPromote = null;
  endMessage = null;
  render();
}

/** 終局: 結果バナーのみ表示（対局設定は出さない） */
function finishGameWithResult(): void {
  endMessage = buildEndMessageFromState();
  playSfx("end");
  phase = "playing";
  clearSelection();
  pendingPromote = null;
  abortCpuThinking();
  render();
}

function clearCpuCountdown(): void {
  if (cpuCountdownTimer) {
    clearInterval(cpuCountdownTimer);
    cpuCountdownTimer = null;
  }
  cpuRemainingMs = null;
}

function abortCpuThinking(): void {
  if (cpuTimer) {
    clearTimeout(cpuTimer);
    cpuTimer = null;
  }
  clearCpuCountdown();
  cpuThinking = false;
}

function scheduleCpuIfNeeded(): void {
  abortCpuThinking();
  if (gameMode !== "cpu") return;
  if (phase !== "playing" || state.result) return;
  if (state.turn !== cpuPlayer()) return;

  const limit = getCpuTimeLimitMs(cpuLevel);
  cpuThinking = true;
  cpuRemainingMs = limit > 0 ? limit : null;
  render();
  cpuTimer = setTimeout(() => {
    cpuTimer = null;
    void runCpuMove();
  }, 280);
}

function cpuShouldDeclareImpasse(): boolean {
  if (!canDeclareImpasse(state)) return false;
  const bp = countPoints(state, "black");
  const wp = countPoints(state, "white");
  const cpu = cpuPlayer();
  // 自分だけ勝ち点に達しているとき宣言（相入玉の点数勝負）
  if (cpu === "black") return bp >= 24 && wp < 27;
  return wp >= 27 && bp < 24;
}

async function runCpuMove(): Promise<void> {
  if (gameMode !== "cpu" || state.result || state.turn !== cpuPlayer()) {
    abortCpuThinking();
    render();
    return;
  }

  if (cpuShouldDeclareImpasse()) {
    clearCpuCountdown();
    cpuThinking = false;
    state = resolveImpasse(state);
    finishGameWithResult();
    return;
  }

  const limit = getCpuTimeLimitMs(cpuLevel);
  if (limit > 0) {
    const deadline = Date.now() + limit;
    cpuRemainingMs = limit;
    let shownSec = -1;
    const paintCountdown = () => {
      cpuRemainingMs = Math.max(0, deadline - Date.now());
      const sec = Math.max(0, Math.ceil(cpuRemainingMs / 1000));
      // 表示は1秒単位。短い間隔でポーリングし、秒が変わったときだけDOM更新
      if (sec === shownSec) return;
      shownSec = sec;
      const el = document.querySelector(".cpu-countdown");
      if (el) el.textContent = `${sec}秒`;
    };
    paintCountdown();
    cpuCountdownTimer = setInterval(paintCountdown, 200);
  }

  const action = await chooseCpuMoveAsync(state, cpuLevel);

  clearCpuCountdown();
  cpuThinking = false;
  if (!action) {
    render();
    return;
  }
  commitAction(action, action.kind === "move" && action.promote, true);
}

function clearSelectionIfAny(): void {
  if (!selection) return;
  clearSelection();
  render();
}

function dismissSetup(): void {
  if (phase !== "setup") return;
  // 詰み後など、盤面・結果を確認できるよう設定だけ閉じる
  phase = "playing";
  render();
}

function bindEvents(): void {
  document.getElementById("setup-overlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      dismissSetup();
    }
  });

  document.querySelector(".setup-modal")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  document.querySelectorAll("[data-mode]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      gameMode = (el as HTMLElement).dataset.mode as GameMode;
      render();
    });
  });

  document.querySelectorAll("[data-side]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      setupSide = (el as HTMLElement).dataset.side as typeof setupSide;
      render();
    });
  });

  document.querySelectorAll("[data-level]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      cpuLevel = Number((el as HTMLElement).dataset.level) as CpuLevel;
      render();
    });
  });

  document.getElementById("btn-start")?.addEventListener("click", (e) => {
    e.stopPropagation();
    startGame();
  });

  document.getElementById("btn-sound")?.addEventListener("click", (e) => {
    e.stopPropagation();
    void unlockAudio();
    setSoundEnabled(!soundEnabled);
    playSfx("click");
    render();
  });

  document.getElementById("btn-setup-rules")?.addEventListener("click", (e) => {
    e.stopPropagation();
    playSfx("click");
    showRules = true;
    render();
  });

  document.getElementById("btn-rules")?.addEventListener("click", (e) => {
    e.stopPropagation();
    playSfx("click");
    showRules = true;
    render();
  });

  document.getElementById("btn-rules-close")?.addEventListener("click", (e) => {
    e.stopPropagation();
    playSfx("click");
    showRules = false;
    render();
  });

  document.getElementById("rules-overlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      showRules = false;
      render();
    }
  });

  document.querySelector(".rules-modal")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  document.getElementById("promote-overlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      cancelPromote();
    }
  });

  document.querySelector("#promote-overlay .modal")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  document.querySelectorAll(".cell").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!canAct() || pendingPromote) return;
      const file = Number((el as HTMLElement).dataset.file);
      const rank = Number((el as HTMLElement).dataset.rank);
      onCellClick({ file, rank });
    });
  });

  document.querySelectorAll(".hand-piece").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!canAct() || pendingPromote) return;
      const raw = (el as HTMLElement).dataset.hand;
      if (!raw) return;
      const [player, piece] = raw.split(":") as [Player, HandPiece];
      if (!isPlayersTurn(player)) return;
      onHandClick(player, piece);
    });
  });

  // 持ち駒枠の空き部分クリック → 選択解除（駒ボタンは stopPropagation）
  document.querySelectorAll(".hand").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      clearSelectionIfAny();
    });
  });

  // 盤外クリック → 選択解除（盤上・持ち駒どちらも）
  document.querySelector(".app-shell")?.addEventListener("click", () => {
    clearSelectionIfAny();
  });

  document.getElementById("btn-undo")?.addEventListener("click", (e) => {
    e.stopPropagation();
    doUndo();
  });

  document.getElementById("btn-new")?.addEventListener("click", (e) => {
    e.stopPropagation();
    abortCpuThinking();
    phase = "setup";
    endMessage = null;
    clearSelection();
    pendingPromote = null;
    render();
  });

  document.getElementById("btn-resign")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!canAct()) return;
    state = resign(state);
    finishGameWithResult();
  });

  document.getElementById("btn-impasse")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!canAct()) return;
    state = resolveImpasse(state);
    finishGameWithResult();
  });

  document.getElementById("promote-yes")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!pendingPromote) return;
    const action: Action = { ...pendingPromote.action, promote: true };
    pendingPromote = null;
    commitAction(action, true, false);
  });

  document.getElementById("promote-no")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!pendingPromote) return;
    const action: Action = { ...pendingPromote.action, promote: false };
    pendingPromote = null;
    commitAction(action, true, false);
  });
}

function onHandClick(player: Player, piece: HandPiece): void {
  void unlockAudio();
  if (state.hands[player][piece] <= 0) return;
  if (
    selection?.kind === "hand" &&
    selection.player === player &&
    selection.piece === piece
  ) {
    clearSelection();
    render();
    return;
  }
  const targets = legalDropTargets(state, piece);
  if (isInCheck(state, state.turn) && targets.length === 0) {
    showNotice("この持ち駒では王手を外せません");
    render();
    return;
  }
  selection = { kind: "hand", player, piece, targets };
  render();
}

function moveCouldPromote(
  action: Extract<Action, { kind: "move" }>
): boolean {
  const piece = state.board.get(cellKeyOf(action.from));
  if (!piece || !canPromote(piece.type)) return false;
  if (!promoteType(piece.type)) return false;
  return (
    isPromotionZone(action.from.rank, piece.owner) ||
    isPromotionZone(action.to.rank, piece.owner) ||
    mustPromote(piece.type, action.to.rank, piece.owner)
  );
}

function onCellClick(cell: Cell): void {
  void unlockAudio();
  if (!isValidCell(cell.file, cell.rank)) return;

  if (selection?.kind === "hand") {
    if (isHighlighted(cell)) {
      commitAction(
        { kind: "drop", piece: selection.piece, to: cell },
        false,
        false
      );
      return;
    }
    clearSelection();
    render();
    return;
  }

  // プレビュー中のハイライトクリックは移動せず解除のみ
  if (selection?.kind === "preview") {
    if (
      selection.cell.file === cell.file &&
      selection.cell.rank === cell.rank
    ) {
      clearSelection();
      render();
      return;
    }
    // 別のマスへ → 下の選択処理へ続く（プレビュー解除してから判定）
  }

  if (selection?.kind === "board" && isHighlighted(cell)) {
    const info = selection.targets.find(
      (t) => t.to.file === cell.file && t.to.rank === cell.rank
    );
    if (!info) return;
    const action: Extract<Action, { kind: "move" }> = {
      kind: "move",
      from: selection.cell,
      to: cell,
      promote: info.promote,
    };
    if (info.canChoosePromote) {
      pendingPromote = { action };
      clearSelection();
      render();
      return;
    }
    commitAction(action, info.promote || moveCouldPromote(action), false);
    return;
  }

  const piece = state.board.get(cellKeyOf(cell));

  // 手番でない側の駒: 候補手の表示のみ（動かせない）
  if (piece && canAct() && piece.owner !== state.turn) {
    if (
      selection?.kind === "preview" &&
      selection.cell.file === cell.file &&
      selection.cell.rank === cell.rank
    ) {
      clearSelection();
      render();
      return;
    }
    const targets = previewPieceTargets(state, cell);
    selection = { kind: "preview", cell, targets };
    render();
    return;
  }

  if (piece && isPlayersTurn(piece.owner)) {
    if (
      selection?.kind === "board" &&
      selection.cell.file === cell.file &&
      selection.cell.rank === cell.rank
    ) {
      clearSelection();
      render();
      return;
    }
    const targets = legalMoveTargets(state, cell);
    if (isInCheck(state, state.turn) && targets.length === 0) {
      showNotice("この駒では王手を外せません");
      render();
      return;
    }
    selection = { kind: "board", cell, targets };
    render();
    return;
  }

  clearSelection();
  render();
}

function commitAction(
  action: Action,
  couldPromoteFlag: boolean,
  fromCpu: boolean
): void {
  if (gameMode === "pvp" || !fromCpu) {
    pushUndoSnapshot();
  }

  const player = state.turn;
  const prevBoard = state.board;
  const capturing =
    action.kind === "move" &&
    prevBoard.has(cellKeyOf(action.to));

  const text = formatKifuActionDetailed(
    state.board,
    player,
    action,
    action.kind === "move" && couldPromoteFlag,
    lastMove?.to ?? null
  );

  const deferMateFor = gameMode === "cpu" ? humanPlayer : undefined;
  const next = tryMove(state, action, { deferMateFor });
  if (!next) {
    if (gameMode === "pvp" || !fromCpu) undoStack.pop();
    clearSelection();
    clearCpuCountdown();
    cpuThinking = false;
    render();
    return;
  }

  if (action.kind === "drop") playSfx("drop");
  else if (capturing) playSfx("capture");
  else playSfx("move");
  if (action.kind === "move" && action.promote) playSfx("promote");

  kifu = [
    ...kifu,
    {
      moveNumber: kifu.length + 1,
      player,
      action,
      text,
      from: action.kind === "move" ? { ...action.from } : null,
      to: { ...action.to },
    },
  ];
  lastMove = {
    from: action.kind === "move" ? { ...action.from } : null,
    to: { ...action.to },
  };

  state = next;
  clearSelection();
  clearCpuCountdown();
  cpuThinking = false;

  if (state.lastMoveWasCheck && !state.result) {
    playSfx("check");
  }

  if (state.result) {
    finishGameWithResult();
    return;
  }

  // ユーザーが詰んでも強制終了せず、投了を促す
  if (
    gameMode === "cpu" &&
    state.turn === humanPlayer &&
    isCheckmate(state)
  ) {
    showNotice("詰みです。投了してください");
  }

  render();

  if (!fromCpu) {
    scheduleCpuIfNeeded();
  } else if (
    gameMode === "cpu" &&
    !state.result &&
    state.turn === cpuPlayer()
  ) {
    scheduleCpuIfNeeded();
  }
}

window.addEventListener("resize", () => {
  // リサイズ時のみ縮尺を再計算。対局中の再描画だけでは変えない
  lockBoardMetrics();
  if (phase === "playing" || phase === "setup") render();
});

lockBoardMetrics();
render();
