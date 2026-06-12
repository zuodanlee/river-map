"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TrashTier = {
  name: string;
  sprite: string;
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
  angle: number;
  angularVel: number;
  restFrames: number;
  anchorX: number;
  anchorY: number;
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
const CONTACT_SOLVER_PASSES = 5;
const CONTACT_RESTITUTION = 0.08;
const CONTACT_FRICTION = 0;
const CONTACT_PERCENT = 0.94;
const CONTACT_SLOP = 0.02;

// Rotation / friction tuning.
const PAIR_FRICTION = 0.35; // Coulomb coefficient for piece-vs-piece contacts.
const SURFACE_FRICTION = 0.45; // Rolling friction against bin walls/floor.
const ANGULAR_DAMPING = 0.985;
// Constant rolling resistance (rad/frame) subtracted toward zero each frame so
// spin actually settles to a full stop instead of multiplicatively lingering.
const ANGULAR_FRICTION = 0.0035;
const MAX_ANGULAR_VEL = 0.45;
// Below this contact-point relative speed (px/frame, squared) a piece-vs-piece
// contact is treated as resting: friction locks it instead of converting the
// gravity-driven micro-slip into endless rolling, and residual spin is bled off.
const REST_CONTACT_SPEED_SQ = 0.5;
const REST_SPIN_BLEED = 0.8;
// Settle lock: a piece that stays within SETTLE_RADIUS (px, squared) of an
// anchored position for SETTLE_FRAMES consecutive frames is treated as at rest,
// and its spin is forced to zero. Using net displacement (not instantaneous
// speed) means a piece wedged between neighbors — which jitters in place but
// never actually travels — is correctly detected as settled. A piece that is
// genuinely rolling or sliding steadily walks away from its anchor and is never
// caught.
const SETTLE_RADIUS_SQ = 4; // 2px
const SETTLE_FRAMES = 10;

// 11 tiers. Sprites live in /public/sprites and are drawn into the
// circular hitbox (square bounding box of side = 2 * radius).
const TIERS: TrashTier[] = [
  {
    name: "タバコの吸殻",
    sprite: "1_cigarette.png",
    color: "#f4d8b6",
    radius: 18,
    score: 10,
  },
  {
    name: "キャンディーの包装紙",
    sprite: "2_candy.png",
    color: "#fde68a",
    radius: 22,
    score: 18,
  },
  {
    name: "プラスチックストロー",
    sprite: "3_straw.png",
    color: "#fcd34d",
    radius: 27,
    score: 32,
  },
  {
    name: "パンの袋",
    sprite: "4_bread.png",
    color: "#fbbf24",
    radius: 32,
    score: 54,
  },
  {
    name: "プラスチックカップ",
    sprite: "5_cup.png",
    color: "#fb923c",
    radius: 37,
    score: 83,
  },
  {
    name: "テイクアウト容器",
    sprite: "6_takeout1.png",
    color: "#f97316",
    radius: 44,
    score: 126,
  },
  {
    name: "テイクアウトボックス",
    sprite: "7_takeout2.png",
    color: "#ef4444",
    radius: 52,
    score: 190,
  },
  {
    name: "ペットボトル",
    sprite: "8_bottles.png",
    color: "#ec4899",
    radius: 62,
    score: 278,
  },
  {
    name: "ゴミ袋",
    sprite: "9_trashbag.png",
    color: "#a855f7",
    radius: 74,
    score: 406,
  },
  {
    name: "圧縮ゴミ",
    sprite: "10_trashball.png",
    color: "#2563eb",
    radius: 90,
    score: 576,
  },
  {
    name: "メガゴミ丸",
    sprite: "11_gomimaru.png",
    color: "#14532d",
    radius: 110,
    score: 810,
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomSpawnTier(): number {
  return Math.floor(Math.random() * SPAWNABLE_TIERS);
}

// Apply rolling friction against a static bin surface whose outward normal
// (pointing from the surface into the piece) is (nx, ny). This bleeds the
// tangential surface velocity and converts it into spin, so pieces roll
// as they slide along walls and floor.
function applySurfaceFriction(
  piece: Piece,
  nx: number,
  ny: number,
  friction: number,
): void {
  const r = piece.radius;
  const tx = -ny;
  const ty = nx;
  // Tangential velocity of the contact point (includes spin contribution).
  const vt = piece.vy * nx - piece.vx * ny - piece.angularVel * r;
  const invMass = 1 / (r * r); // mass = r^2
  const invInertia = 2 / (r * r * r * r); // I = 0.5 * mass * r^2
  const tangentMass = 1 / (invMass + r * r * invInertia);
  const jt = -vt * tangentMass * friction;

  piece.vx += jt * tx * invMass;
  piece.vy += jt * ty * invMass;
  piece.angularVel += jt * -r * invInertia;
}

export default function Home() {
  const initialActiveTier = useMemo(() => randomSpawnTier(), []);
  const initialNextTier = useMemo(() => randomSpawnTier(), []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const spriteImagesRef = useRef<(HTMLImageElement | null)[]>([]);
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
  const [nextTier, setNextTier] = useState(initialNextTier);
  const nextTierMeta = useMemo(() => TIERS[nextTier], [nextTier]);

  // Preload sprite images once.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    spriteImagesRef.current = TIERS.map((tier) => {
      const img = new window.Image();
      img.src = `/sprites/${tier.sprite}`;
      return img;
    });
  }, []);

  const syncHud = useCallback(() => {
    const state = worldRef.current;
    setScore(state.score);
    setGameOver(state.gameOver);
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
      angle: 0,
      angularVel: 0,
      restFrames: 0,
      anchorX: x,
      anchorY: SPAWN_TOP,
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

          // Integrate rotation, then apply rolling resistance. Multiplicative
          // damping alone never reaches zero, so a constant friction term is
          // subtracted toward zero and snaps the spin to a full stop once it
          // is small enough — pieces no longer rotate in place when settled.
          piece.angle += piece.angularVel;

          piece.angularVel *= ANGULAR_DAMPING;
          if (piece.angularVel > ANGULAR_FRICTION) {
            piece.angularVel -= ANGULAR_FRICTION;
          } else if (piece.angularVel < -ANGULAR_FRICTION) {
            piece.angularVel += ANGULAR_FRICTION;
          } else {
            piece.angularVel = 0;
          }

          piece.angularVel = clamp(
            piece.angularVel,
            -MAX_ANGULAR_VEL,
            MAX_ANGULAR_VEL,
          );

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
            const aMass = a.radius * a.radius;
            const bMass = b.radius * b.radius;
            const massSum = aMass + bMass;
            const aShare = bMass / massSum;
            const bShare = aMass / massSum;
            const correction =
              Math.max(overlap - CONTACT_SLOP, 0) * CONTACT_PERCENT;

            a.x -= nx * correction * aShare;
            a.y -= ny * correction * aShare;
            b.x += nx * correction * bShare;
            b.y += ny * correction * bShare;

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
                angle: Math.random() * Math.PI * 2,
                angularVel: (a.angularVel + b.angularVel) * 0.5,
                restFrames: 0,
                anchorX: (a.x + b.x) / 2,
                anchorY: (a.y + b.y) / 2,
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

            const invMassA = 1 / aMass;
            const invMassB = 1 / bMass;
            const invMassSum = invMassA + invMassB;
            const impulse =
              (-(1 + CONTACT_RESTITUTION) * velAlongNormal) / invMassSum;
            const ix = impulse * nx;
            const iy = impulse * ny;

            a.vx -= ix * invMassA;
            a.vy -= iy * invMassA;
            b.vx += ix * invMassB;
            b.vy += iy * invMassB;

            // Rotation-aware tangential friction (Coulomb-clamped by the
            // normal impulse). Uses the surface velocity at the contact
            // point of each disc, so collisions impart spin.
            const tx = -ny;
            const ty = nx;
            const invInertiaA = 2 / (a.radius * a.radius * a.radius * a.radius);
            const invInertiaB = 2 / (b.radius * b.radius * b.radius * b.radius);

            // Contact point relative to each centre: a -> +n*ra, b -> -n*rb.
            // Surface velocity from spin: omega x r = omega * (-r.y, r.x).
            const aSpinX = -a.angularVel * (ny * a.radius);
            const aSpinY = a.angularVel * (nx * a.radius);
            const bSpinX = -b.angularVel * (-ny * b.radius);
            const bSpinY = b.angularVel * (-nx * b.radius);

            const contactRvx = b.vx + bSpinX - (a.vx + aSpinX);
            const contactRvy = b.vy + bSpinY - (a.vy + aSpinY);
            const vt = contactRvx * tx + contactRvy * ty;

            // cross(r, t): for a -> +ra, for b -> -rb.
            const raCrossT = a.radius;
            const rbCrossT = -b.radius;
            const tangentMass =
              1 /
              (invMassA +
                invMassB +
                raCrossT * raCrossT * invInertiaA +
                rbCrossT * rbCrossT * invInertiaB);

            const maxFriction = PAIR_FRICTION * Math.abs(impulse);
            const jt = clamp(-vt * tangentMass, -maxFriction, maxFriction);

            // Always damp tangential sliding.
            a.vx -= jt * tx * invMassA;
            a.vy -= jt * ty * invMassA;
            b.vx += jt * tx * invMassB;
            b.vy += jt * ty * invMassB;

            const contactSpeedSq =
              contactRvx * contactRvx + contactRvy * contactRvy;

            if (contactSpeedSq > REST_CONTACT_SPEED_SQ) {
              // Energetic contact (collision / tumbling): impart spin.
              a.angularVel -= jt * raCrossT * invInertiaA;
              b.angularVel += jt * rbCrossT * invInertiaB;
            } else {
              // Near-resting contact: lock instead of rolling forever and
              // actively bleed residual spin so touching/stacked pieces stop.
              a.angularVel *= REST_SPIN_BLEED;
              b.angularVel *= REST_SPIN_BLEED;
            }
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

        // Rolling friction against the FLOOR only. Walls and ceiling are
        // intentionally excluded: a smooth vertical wall must not convert a
        // piece's gravity-driven downward motion into spin, which made
        // wall-touching pieces (and their neighbors) rotate in place forever.
        for (const piece of state.pieces) {
          if (piece.y + piece.radius >= BIN_BOTTOM - 0.75) {
            applySurfaceFriction(piece, 0, -1, SURFACE_FRICTION);
          }
        }

        if (toRemove.size > 0) {
          state.pieces = state.pieces.filter(
            (piece) => !toRemove.has(piece.id),
          );
          state.pieces.push(...toAdd);
          syncHud();
        }

        for (let pass = 0; pass < CONTACT_SOLVER_PASSES; pass += 1) {
          for (const piece of state.pieces) {
            if (piece.x - piece.radius < BIN_LEFT) {
              piece.x = BIN_LEFT + piece.radius;
              piece.vx = Math.max(piece.vx, 0) * 0.12;
            }
            if (piece.x + piece.radius > BIN_RIGHT) {
              piece.x = BIN_RIGHT - piece.radius;
              piece.vx = Math.min(piece.vx, 0) * 0.12;
            }
            if (piece.y - piece.radius < BIN_TOP) {
              piece.y = BIN_TOP + piece.radius;
              piece.vy = Math.max(piece.vy, 0) * 0.12;
            }
            if (piece.y + piece.radius > BIN_BOTTOM) {
              piece.y = BIN_BOTTOM - piece.radius;
              piece.vy = Math.min(piece.vy, 0) * 0.12;
            }
          }

          for (let i = 0; i < state.pieces.length; i += 1) {
            const a = state.pieces[i];
            for (let j = i + 1; j < state.pieces.length; j += 1) {
              const b = state.pieces[j];
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
              const aMass = a.radius * a.radius;
              const bMass = b.radius * b.radius;
              const massSum = aMass + bMass;
              const aShare = bMass / massSum;
              const bShare = aMass / massSum;
              const correction =
                Math.max(overlap - CONTACT_SLOP, 0) * CONTACT_PERCENT;

              a.x -= nx * correction * aShare;
              a.y -= ny * correction * aShare;
              b.x += nx * correction * bShare;
              b.y += ny * correction * bShare;

              const rvx = b.vx - a.vx;
              const rvy = b.vy - a.vy;
              const velAlongNormal = rvx * nx + rvy * ny;

              if (velAlongNormal > 0) {
                continue;
              }

              const invMassSum = 1 / aMass + 1 / bMass;
              const impulse =
                (-(1 + CONTACT_RESTITUTION) * velAlongNormal) / invMassSum;
              const ix = impulse * nx;
              const iy = impulse * ny;

              a.vx -= ix / aMass;
              a.vy -= iy / aMass;
              b.vx += ix / bMass;
              b.vy += iy / bMass;

              const tangentX = rvx - velAlongNormal * nx;
              const tangentY = rvy - velAlongNormal * ny;
              const tangentLengthSq = tangentX * tangentX + tangentY * tangentY;

              if (tangentLengthSq > 0.000001) {
                const tangentLength = Math.sqrt(tangentLengthSq);
                const frictionScale = CONTACT_FRICTION / tangentLength;

                a.vx += tangentX * frictionScale * aShare;
                a.vy += tangentY * frictionScale * aShare;
                b.vx -= tangentX * frictionScale * bShare;
                b.vy -= tangentY * frictionScale * bShare;
              }
            }
          }
        }

        for (const piece of state.pieces) {
          const minX = BIN_LEFT + piece.radius;
          const maxX = BIN_RIGHT - piece.radius;
          const minY = BIN_TOP + piece.radius;
          const maxY = BIN_BOTTOM - piece.radius;

          if (piece.x < minX) {
            piece.x = minX;
            if (piece.vx < 0) {
              piece.vx = 0;
            }
          }
          if (piece.x > maxX) {
            piece.x = maxX;
            if (piece.vx > 0) {
              piece.vx = 0;
            }
          }
          if (piece.y < minY) {
            piece.y = minY;
            if (piece.vy < 0) {
              piece.vy = 0;
            }
          }
          if (piece.y > maxY) {
            piece.y = maxY;
            if (piece.vy > 0) {
              piece.vy = 0;
            }
          }
        }

        // Settle lock (runs after all velocity/position resolution): track how
        // far each piece has drifted from an anchor point. A piece wedged
        // between neighbors jitters but stays near its anchor, so it accrues
        // rest frames and has its spin forced to zero; once it has been still
        // long enough, residual spin re-injected by contact friction keeps
        // getting wiped. Any real travel beyond the radius re-anchors it and
        // lets it spin/roll again.
        for (const piece of state.pieces) {
          const adx = piece.x - piece.anchorX;
          const ady = piece.y - piece.anchorY;
          if (adx * adx + ady * ady < SETTLE_RADIUS_SQ) {
            piece.restFrames += 1;
            if (piece.restFrames > SETTLE_FRAMES) {
              piece.angularVel = 0;
            }
          } else {
            piece.anchorX = piece.x;
            piece.anchorY = piece.y;
            piece.restFrames = 0;
          }
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

      context.save();
      context.beginPath();
      context.rect(
        BIN_LEFT,
        BIN_TOP,
        BIN_RIGHT - BIN_LEFT,
        BIN_BOTTOM - BIN_TOP,
      );
      context.clip();

      context.strokeStyle = "rgba(15, 23, 42, 0.16)";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(clampedCursorX, SPAWN_TOP);
      context.lineTo(clampedCursorX, BIN_BOTTOM);
      context.stroke();

      for (const piece of state.pieces) {
        const tier = TIERS[piece.tier];
        const img = spriteImagesRef.current[piece.tier];
        const diameter = piece.radius * 2;

        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.angle);

        if (img && img.complete && img.naturalWidth > 0) {
          context.drawImage(
            img,
            -piece.radius,
            -piece.radius,
            diameter,
            diameter,
          );
        } else {
          // Fallback while the sprite is still loading.
          context.fillStyle = tier.color;
          context.beginPath();
          context.arc(0, 0, piece.radius, 0, Math.PI * 2);
          context.fill();
          context.strokeStyle = "rgba(15, 23, 42, 0.35)";
          context.lineWidth = 2;
          context.stroke();
        }

        context.restore();
      }

      context.restore();

      // Held piece preview at the top (not rotated).
      const cursorImg = spriteImagesRef.current[state.activeTier];
      const cursorDiameter = cursorTier.radius * 2;
      if (cursorImg && cursorImg.complete && cursorImg.naturalWidth > 0) {
        context.drawImage(
          cursorImg,
          clampedCursorX - cursorTier.radius,
          SPAWN_TOP - cursorTier.radius,
          cursorDiameter,
          cursorDiameter,
        );
      } else {
        context.fillStyle = cursorTier.color;
        context.beginPath();
        context.arc(
          clampedCursorX,
          SPAWN_TOP,
          cursorTier.radius,
          0,
          Math.PI * 2,
        );
        context.fill();
        context.strokeStyle = "rgba(15, 23, 42, 0.35)";
        context.lineWidth = 2;
        context.stroke();
      }

      if (state.gameOver) {
        context.fillStyle = "rgba(15, 23, 42, 0.7)";
        context.fillRect(0, 0, WIDTH, HEIGHT);
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = "#ffffff";
        context.font = "700 28px var(--font-geist-sans)";
        context.fillText("川が汚染されました", WIDTH / 2, HEIGHT / 2 - 28);
        context.font = "600 16px var(--font-geist-sans)";
        context.fillText(
          "ゴミ箱が川にあふれました。",
          WIDTH / 2,
          HEIGHT / 2 + 12,
        );
        context.font = "600 14px var(--font-geist-sans)";
        context.fillText(
          "Rキーを押すか、リスタートをタップしてください。",
          WIDTH / 2,
          HEIGHT / 2 + 46,
        );
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
            ベトナム川ゴミ箱コンパクター
          </h1>
          <p className="mt-1 text-xs sm:text-sm">
            公共ゴミ箱にゴミを落とします。同じアイテムを統合してゴミを圧縮し、プラスチックが川に入るのを防ぎます。
          </p>
        </section>

        <section className="grid gap-3 lg:flex-1 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid gap-2 lg:hidden">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex h-[104px] flex-col rounded-2xl border-2 border-slate-800/30 bg-white/85 p-2 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  スコア
                </p>
                <p className="mt-1 text-lg font-black leading-none">{score}</p>
              </div>
              <div className="flex h-[104px] flex-col rounded-2xl border-2 border-slate-800/20 bg-white/85 p-2 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
                  次
                </p>
                <div className="mt-1 flex flex-1 items-center justify-center">
                  {/* Fixed 74px slot fits the largest spawnable sprite so the box never resizes. */}
                  <div className="flex h-[74px] w-[74px] items-center justify-center">
                    <img
                      src={`/sprites/${nextTierMeta.sprite}`}
                      alt={nextTierMeta.name}
                      style={{
                        width: nextTierMeta.radius * 2,
                        height: nextTierMeta.radius * 2,
                      }}
                      className="object-contain"
                    />
                  </div>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
              onClick={restart}
            >
              リスタート
            </button>
          </div>

          <div className="min-h-0 overflow-hidden rounded-3xl border-4 border-slate-800/70 bg-white/70 p-2 shadow-[0_18px_40px_rgba(15,23,42,0.16)] sm:p-3 lg:flex lg:items-center lg:justify-center">
            <canvas
              ref={canvasRef}
              width={WIDTH}
              height={HEIGHT}
              className="mx-auto aspect-[21/32] h-auto max-h-[calc(100dvh-260px)] w-auto max-w-full touch-none rounded-2xl bg-[#f8fafc] lg:max-h-[calc(100dvh-220px)]"
              onPointerDown={(event) => {
                updateCursorFromClientPoint(event.clientX);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                updateCursorFromClientPoint(event.clientX);
              }}
              onPointerUp={(event) => {
                updateCursorFromClientPoint(event.clientX);
                dropPiece();
              }}
              onPointerCancel={() => {
                /* Keep the held piece in place if the gesture is interrupted. */
              }}
            />
          </div>

          <aside className="hidden flex-col gap-3 lg:flex lg:min-h-0 lg:overflow-auto">
            <div className="rounded-3xl border-2 border-slate-800/30 bg-white/85 p-4 shadow-[0_10px_28px_rgba(15,23,42,0.1)]">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                スコア
              </p>
              <p className="mt-1 text-3xl font-black">{score}</p>
              <p className="mt-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                次
              </p>
              {/* Fixed-height slot (fits the 74px 5th-tier sprite) so the panel never jumps. */}
              <div className="mt-2 flex h-[92px] items-center justify-center rounded-xl bg-slate-100 p-2">
                <div className="flex h-[74px] w-[74px] items-center justify-center">
                  <img
                    src={`/sprites/${nextTierMeta.sprite}`}
                    alt={nextTierMeta.name}
                    style={{
                      width: nextTierMeta.radius * 2,
                      height: nextTierMeta.radius * 2,
                    }}
                    className="object-contain"
                  />
                </div>
              </div>
              <button
                type="button"
                className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                onClick={restart}
              >
                リスタート
              </button>
            </div>
          </aside>
        </section>

        <details className="rounded-2xl border-2 border-slate-800/30 bg-white/85 p-3 text-sm shadow-[0_10px_28px_rgba(15,23,42,0.08)] lg:mt-auto">
          <summary className="cursor-pointer font-bold uppercase tracking-[0.1em] text-slate-600">
            操作とルール
          </summary>
          <div className="mt-2 space-y-2">
            <p>
              マウスまたは指を動かして照準を合わせ、押したまま狙って離すと落とします。
            </p>
            <p>
              キーボード：左右の矢印キーで照準、スペースキーで落とす、Rでリスタート。
            </p>
            <p className="font-semibold text-rose-700">
              オーバーフロー警告：ゴミが赤い線より上にとどまると、風がそれを川に押し入れてゲームが終了します。
            </p>
            <p className="font-semibold text-emerald-700">
              2つのメガゴミ丸が互いに接触すると、大きなボーナスのために取り除かれます。
            </p>
            {gameOver ? (
              <p className="font-bold text-rose-700">
                ゲームオーバー。もう一度試すにはリスタートしてください。
              </p>
            ) : null}
          </div>
        </details>
      </div>
    </main>
  );
}
