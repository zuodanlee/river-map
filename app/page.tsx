"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TrashTier = {
  name: string;
  color: string;
  radius: number;
  score: number;
};

type Piece = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tier: number;
  radius: number;
  bornAt: number;
};

type WorldState = {
  pieces: Piece[];
  cursorX: number;
  activeTier: number;
  nextTier: number;
  score: number;
  gameOver: boolean;
  overflowFrames: number;
  lastDropAt: number;
  idCounter: number;
};

const WIDTH = 420;
const HEIGHT = 640;
const OVERFLOW_Y = 104;
const DROP_COOLDOWN_MS = 550;
const OVERFLOW_FRAMES_TO_LOSE = 120;
const SPAWN_TOP = 38;
const SPAWNABLE_TIERS = 5;
const BIN_FRAME_LEFT = 6;
const BIN_FRAME_RIGHT = WIDTH - 6;
const BIN_FRAME_TOP = 8;
const BIN_FRAME_BOTTOM = HEIGHT - 8;
const BIN_WALL_THICKNESS = 10;
const BIN_LEFT = BIN_FRAME_LEFT + BIN_WALL_THICKNESS;
const BIN_RIGHT = BIN_FRAME_RIGHT - BIN_WALL_THICKNESS;
const BIN_TOP = BIN_FRAME_TOP + BIN_WALL_THICKNESS;
const BIN_BOTTOM = BIN_FRAME_BOTTOM - BIN_WALL_THICKNESS;
const MAX_TIER_TOUCH_BONUS = 5000;

const TIERS: TrashTier[] = [
  { name: "Cigarette Butt", color: "#f4d8b6", radius: 12, score: 5 },
  { name: "Candy Wrapper", color: "#fde68a", radius: 15, score: 10 },
  { name: "Plastic Straw", color: "#fcd34d", radius: 18, score: 18 },
  { name: "Sachet Packet", color: "#fb923c", radius: 21, score: 30 },
  { name: "Plastic Cup", color: "#f97316", radius: 24, score: 46 },
  { name: "Takeout Box", color: "#ef4444", radius: 28, score: 70 },
  { name: "Foam Container", color: "#dc2626", radius: 32, score: 105 },
  { name: "PET Bottle", color: "#ec4899", radius: 36, score: 155 },
  { name: "Bottle Bale", color: "#a855f7", radius: 41, score: 225 },
  { name: "Trash Bag", color: "#2563eb", radius: 47, score: 320 },
  { name: "Compacted Bundle", color: "#0284c7", radius: 53, score: 450 },
  { name: "Mega Waste Block", color: "#14532d", radius: 58, score: 650 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomSpawnTier(): number {
  return Math.floor(Math.random() * SPAWNABLE_TIERS);
}

export default function Home() {
  const initialActiveTier = useMemo(() => randomSpawnTier(), []);
  const initialNextTier = useMemo(() => randomSpawnTier(), []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef<WorldState>({
    pieces: [],
    cursorX: WIDTH / 2,
    activeTier: initialActiveTier,
    nextTier: initialNextTier,
    score: 0,
    gameOver: false,
    overflowFrames: 0,
    lastDropAt: 0,
    idCounter: 1,
  });

  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [activeTier, setActiveTier] = useState(initialActiveTier);
  const [nextTier, setNextTier] = useState(initialNextTier);

  const activeTierMeta = useMemo(() => TIERS[activeTier], [activeTier]);
  const nextTierMeta = useMemo(() => TIERS[nextTier], [nextTier]);

  const syncHud = useCallback(() => {
    const state = worldRef.current;
    setScore(state.score);
    setGameOver(state.gameOver);
    setActiveTier(state.activeTier);
    setNextTier(state.nextTier);
  }, []);

  const restart = useCallback(() => {
    worldRef.current = {
      pieces: [],
      cursorX: WIDTH / 2,
      activeTier: randomSpawnTier(),
      nextTier: randomSpawnTier(),
      score: 0,
      gameOver: false,
      overflowFrames: 0,
      lastDropAt: 0,
      idCounter: 1,
    };
    syncHud();
  }, [syncHud]);

  const dropPiece = useCallback(() => {
    const state = worldRef.current;
    if (state.gameOver) {
      return;
    }

    const now = performance.now();
    if (now - state.lastDropAt < DROP_COOLDOWN_MS) {
      return;
    }

    const tier = state.activeTier;
    const tierMeta = TIERS[tier];
    const x = clamp(
      state.cursorX,
      BIN_LEFT + tierMeta.radius,
      BIN_RIGHT - tierMeta.radius,
    );

    state.pieces.push({
      id: state.idCounter++,
      x,
      y: SPAWN_TOP,
      vx: 0,
      vy: 0,
      tier,
      radius: tierMeta.radius,
      bornAt: now,
    });

    state.activeTier = state.nextTier;
    state.nextTier = randomSpawnTier();
    state.lastDropAt = now;
    syncHud();
  }, [syncHud]);

  const updateCursorFromClientPoint = useCallback((clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const xInCanvasPixels = clientX - rect.left;
    const worldX = (xInCanvasPixels / rect.width) * WIDTH;
    worldRef.current.cursorX = clamp(worldX, BIN_LEFT + 12, BIN_RIGHT - 12);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = worldRef.current;
      if (event.key === "ArrowLeft") {
        state.cursorX = clamp(
          state.cursorX - 22,
          BIN_LEFT + 12,
          BIN_RIGHT - 12,
        );
      }
      if (event.key === "ArrowRight") {
        state.cursorX = clamp(
          state.cursorX + 22,
          BIN_LEFT + 12,
          BIN_RIGHT - 12,
        );
      }
      if (event.key === " " || event.key === "ArrowDown") {
        event.preventDefault();
        dropPiece();
      }
      if (event.key.toLowerCase() === "r") {
        restart();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dropPiece, restart]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let rafId = 0;
    const gravity = 0.34;

    const tick = () => {
      const state = worldRef.current;
      const now = performance.now();

      if (!state.gameOver) {
        for (const piece of state.pieces) {
          piece.vy += gravity;
          piece.vx *= 0.996;
          piece.vy *= 0.996;
          piece.x += piece.vx;
          piece.y += piece.vy;

          if (piece.x - piece.radius < BIN_LEFT) {
            piece.x = BIN_LEFT + piece.radius;
            piece.vx *= -0.35;
          }
          if (piece.x + piece.radius > BIN_RIGHT) {
            piece.x = BIN_RIGHT - piece.radius;
            piece.vx *= -0.35;
          }
          if (piece.y + piece.radius > BIN_BOTTOM) {
            piece.y = BIN_BOTTOM - piece.radius;
            piece.vy *= -0.25;
            piece.vx *= 0.98;
          }
          if (piece.y - piece.radius < BIN_TOP) {
            piece.y = BIN_TOP + piece.radius;
            piece.vy = Math.max(0, piece.vy);
          }
        }

        const toRemove = new Set<number>();
        const toAdd: Piece[] = [];

        for (let i = 0; i < state.pieces.length; i += 1) {
          const a = state.pieces[i];
          for (let j = i + 1; j < state.pieces.length; j += 1) {
            const b = state.pieces[j];
            if (toRemove.has(a.id) || toRemove.has(b.id)) {
              continue;
            }

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const minDist = a.radius + b.radius;
            const distSq = dx * dx + dy * dy;

            if (distSq >= minDist * minDist) {
              continue;
            }

            const dist = Math.sqrt(distSq) || 0.0001;
            const nx = dx / dist;
            const ny = dy / dist;
            const overlap = minDist - dist;

            a.x -= nx * overlap * 0.5;
            a.y -= ny * overlap * 0.5;
            b.x += nx * overlap * 0.5;
            b.y += ny * overlap * 0.5;

            if (
              a.tier === b.tier &&
              a.tier === TIERS.length - 1 &&
              now - a.bornAt > 70 &&
              now - b.bornAt > 70
            ) {
              toRemove.add(a.id);
              toRemove.add(b.id);
              state.score += TIERS[a.tier].score + MAX_TIER_TOUCH_BONUS;
              continue;
            }

            if (
              a.tier === b.tier &&
              a.tier < TIERS.length - 1 &&
              now - a.bornAt > 70 &&
              now - b.bornAt > 70
            ) {
              const nextTierIndex = a.tier + 1;
              const nextTierMeta = TIERS[nextTierIndex];

              toRemove.add(a.id);
              toRemove.add(b.id);

              toAdd.push({
                id: state.idCounter++,
                x: (a.x + b.x) / 2,
                y: (a.y + b.y) / 2,
                vx: (a.vx + b.vx) * 0.25,
                vy: (a.vy + b.vy) * 0.25,
                tier: nextTierIndex,
                radius: nextTierMeta.radius,
                bornAt: now,
              });

              state.score += nextTierMeta.score;
              continue;
            }

            const rvx = b.vx - a.vx;
            const rvy = b.vy - a.vy;
            const velAlongNormal = rvx * nx + rvy * ny;

            if (velAlongNormal > 0) {
              continue;
            }

            const restitution = 0.24;
            const impulse = (-(1 + restitution) * velAlongNormal) / 2;
            const ix = impulse * nx;
            const iy = impulse * ny;

            a.vx -= ix;
            a.vy -= iy;
            b.vx += ix;
            b.vy += iy;
          }
        }

        for (const piece of state.pieces) {
          if (piece.x - piece.radius < BIN_LEFT) {
            piece.x = BIN_LEFT + piece.radius;
            piece.vx = Math.abs(piece.vx) * 0.2;
          }
          if (piece.x + piece.radius > BIN_RIGHT) {
            piece.x = BIN_RIGHT - piece.radius;
            piece.vx = -Math.abs(piece.vx) * 0.2;
          }
          if (piece.y - piece.radius < BIN_TOP) {
            piece.y = BIN_TOP + piece.radius;
            piece.vy = Math.max(0, piece.vy) * 0.2;
          }
          if (piece.y + piece.radius > BIN_BOTTOM) {
            piece.y = BIN_BOTTOM - piece.radius;
            piece.vy = -Math.abs(piece.vy) * 0.2;
          }
        }

        if (toRemove.size > 0) {
          state.pieces = state.pieces.filter(
            (piece) => !toRemove.has(piece.id),
          );
          state.pieces.push(...toAdd);
          syncHud();
        }

        const overflowing = state.pieces.some(
          (piece) => piece.y - piece.radius < OVERFLOW_Y,
        );

        state.overflowFrames = overflowing ? state.overflowFrames + 1 : 0;

        if (state.overflowFrames > OVERFLOW_FRAMES_TO_LOSE) {
          state.gameOver = true;
          syncHud();
        }
      }

      context.clearRect(0, 0, WIDTH, HEIGHT);

      const interiorWidth = BIN_RIGHT - BIN_LEFT;
      const interiorHeight = BIN_BOTTOM - BIN_TOP;
      const gradient = context.createLinearGradient(0, BIN_TOP, 0, BIN_BOTTOM);
      gradient.addColorStop(0, "#d5f0ff");
      gradient.addColorStop(0.65, "#eaf7ea");
      gradient.addColorStop(1, "#bfe2ff");
      context.fillStyle = gradient;
      context.fillRect(BIN_LEFT, BIN_TOP, interiorWidth, interiorHeight);

      context.fillStyle = "#65a30d";
      context.fillRect(BIN_LEFT, BIN_BOTTOM - 30, interiorWidth, 30);

      context.fillStyle = "#7c2d12";
      context.fillRect(
        BIN_FRAME_LEFT,
        BIN_FRAME_TOP,
        BIN_WALL_THICKNESS,
        BIN_FRAME_BOTTOM - BIN_FRAME_TOP,
      );
      context.fillRect(
        BIN_FRAME_RIGHT - BIN_WALL_THICKNESS,
        BIN_FRAME_TOP,
        BIN_WALL_THICKNESS,
        BIN_FRAME_BOTTOM - BIN_FRAME_TOP,
      );
      context.fillRect(
        BIN_FRAME_LEFT,
        BIN_FRAME_BOTTOM - BIN_WALL_THICKNESS,
        BIN_FRAME_RIGHT - BIN_FRAME_LEFT,
        BIN_WALL_THICKNESS,
      );

      context.strokeStyle = "#ef4444";
      context.setLineDash([8, 6]);
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(BIN_LEFT, OVERFLOW_Y);
      context.lineTo(BIN_RIGHT, OVERFLOW_Y);
      context.stroke();
      context.setLineDash([]);

      const cursorTier = TIERS[state.activeTier];
      const clampedCursorX = clamp(
        state.cursorX,
        BIN_LEFT + cursorTier.radius,
        BIN_RIGHT - cursorTier.radius,
      );
      context.fillStyle = "rgba(15, 23, 42, 0.22)";
      context.beginPath();
      context.arc(clampedCursorX, SPAWN_TOP, cursorTier.radius, 0, Math.PI * 2);
      context.fill();

      context.save();
      context.beginPath();
      context.rect(
        BIN_LEFT,
        BIN_TOP,
        BIN_RIGHT - BIN_LEFT,
        BIN_BOTTOM - BIN_TOP,
      );
      context.clip();

      for (const piece of state.pieces) {
        const tier = TIERS[piece.tier];
        context.fillStyle = tier.color;
        context.beginPath();
        context.arc(piece.x, piece.y, piece.radius, 0, Math.PI * 2);
        context.fill();

        context.strokeStyle = "rgba(15, 23, 42, 0.35)";
        context.lineWidth = 2;
        context.stroke();

        context.fillStyle = "rgba(15, 23, 42, 0.8)";
        context.font = "bold 11px var(--font-geist-mono)";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(piece.tier + 1), piece.x, piece.y);
      }

      context.restore();

      if (state.gameOver) {
        context.fillStyle = "rgba(15, 23, 42, 0.7)";
        context.fillRect(0, 0, WIDTH, HEIGHT);
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = "#ffffff";
        context.font = "700 34px var(--font-geist-sans)";
        context.fillText("River Polluted", WIDTH / 2, HEIGHT / 2 - 28);
        context.font = "600 16px var(--font-geist-sans)";
        context.fillText(
          "The bin overflowed into the river.",
          WIDTH / 2,
          HEIGHT / 2 + 5,
        );
        context.fillText("Press R or tap Restart.", WIDTH / 2, HEIGHT / 2 + 28);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [syncHud]);

  return (
    <main className="h-[100dvh] overflow-y-auto bg-[radial-gradient(circle_at_20%_10%,#fef9c3_0%,#d9f99d_30%,#bae6fd_70%,#a5f3fc_100%)] px-3 py-3 text-slate-900 lg:overflow-hidden sm:px-5 sm:py-4">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 pb-4 lg:h-full lg:pb-0">
        <section className="rounded-3xl border-2 border-slate-900/10 bg-white/75 p-3 backdrop-blur sm:p-4">
          <h1 className="text-xl font-black uppercase tracking-[0.08em] sm:text-2xl">
            Vietnam River Bin Compactor
          </h1>
          <p className="mt-1 text-xs sm:text-sm">
            Drop trash into the public bin. Merge identical items to compress
            waste and keep plastic out of the river.
          </p>
        </section>

        <section className="grid gap-3 lg:flex-1 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid gap-2 lg:hidden">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl border-2 border-slate-800/30 bg-white/85 p-2 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  Score
                </p>
                <p className="mt-1 text-lg font-black leading-none">{score}</p>
              </div>
              <div
                className="rounded-2xl border-2 border-slate-800/20 p-2 text-xs font-semibold shadow-[0_8px_20px_rgba(15,23,42,0.08)]"
                style={{ background: activeTierMeta.color }}
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700">
                  Now
                </p>
                <p className="mt-1 leading-tight">{activeTierMeta.name}</p>
              </div>
              <div
                className="rounded-2xl border-2 border-slate-800/20 p-2 text-xs font-semibold shadow-[0_8px_20px_rgba(15,23,42,0.08)]"
                style={{ background: nextTierMeta.color }}
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-700">
                  Next
                </p>
                <p className="mt-1 leading-tight">{nextTierMeta.name}</p>
              </div>
            </div>
            <button
              type="button"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
              onClick={restart}
            >
              Restart
            </button>
          </div>

          <div className="min-h-0 overflow-hidden rounded-3xl border-4 border-slate-800/70 bg-white/70 p-2 shadow-[0_18px_40px_rgba(15,23,42,0.16)] sm:p-3 lg:flex lg:items-center lg:justify-center">
            <canvas
              ref={canvasRef}
              width={WIDTH}
              height={HEIGHT}
              className="mx-auto aspect-[21/32] h-auto max-h-[calc(100dvh-260px)] w-auto max-w-full touch-none rounded-2xl bg-[#f8fafc] lg:max-h-[calc(100dvh-220px)]"
              onMouseMove={(event) =>
                updateCursorFromClientPoint(event.clientX)
              }
              onMouseDown={dropPiece}
              onTouchMove={(event) => {
                const touch = event.touches[0];
                if (touch) {
                  updateCursorFromClientPoint(touch.clientX);
                }
              }}
              onTouchStart={(event) => {
                const touch = event.touches[0];
                if (touch) {
                  updateCursorFromClientPoint(touch.clientX);
                }
                dropPiece();
              }}
            />
          </div>

          <aside className="hidden flex-col gap-3 lg:flex lg:min-h-0 lg:overflow-auto">
            <div className="rounded-3xl border-2 border-slate-800/30 bg-white/85 p-4 shadow-[0_10px_28px_rgba(15,23,42,0.1)]">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                Score
              </p>
              <p className="mt-1 text-3xl font-black">{score}</p>
              <p className="mt-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                Now Dropping
              </p>
              <div
                className="mt-2 rounded-xl p-3 text-sm font-semibold"
                style={{ background: activeTierMeta.color }}
              >
                {activeTierMeta.name}
              </div>
              <p className="mt-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                Next
              </p>
              <div
                className="mt-2 rounded-xl p-3 text-sm font-semibold"
                style={{ background: nextTierMeta.color }}
              >
                {nextTierMeta.name}
              </div>
              <button
                type="button"
                className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                onClick={restart}
              >
                Restart
              </button>
            </div>
          </aside>
        </section>

        <details className="rounded-2xl border-2 border-slate-800/30 bg-white/85 p-3 text-sm shadow-[0_10px_28px_rgba(15,23,42,0.08)] lg:mt-auto">
          <summary className="cursor-pointer font-bold uppercase tracking-[0.1em] text-slate-600">
            Controls and Rules
          </summary>
          <div className="mt-2 space-y-2">
            <p>Move mouse or finger to aim, then click or tap to drop.</p>
            <p>
              Keyboard: Left and Right arrows to aim, Space to drop, R to
              restart.
            </p>
            <p className="font-semibold text-rose-700">
              Overflow warning: If trash stays above the red line, wind pushes
              it into the river and the game ends.
            </p>
            <p className="font-semibold text-emerald-700">
              Two Mega Waste Blocks touching each other are hauled away for a
              major bonus.
            </p>
            {gameOver ? (
              <p className="font-bold text-rose-700">
                Game Over. Restart to try again.
              </p>
            ) : null}
          </div>
        </details>
      </div>
    </main>
  );
}
