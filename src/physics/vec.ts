/**
 * Kleine 2D-Vektorbibliothek.
 *
 * Koordinatensysteme:
 *  - Erde (world): x = Ost, y = Nord, Meter.
 *  - Boot (body):  x = voraus, y = Steuerbord, Ursprung im Gewichtsschwerpunkt.
 *  - Kurs ψ: rechtweisend, 0 = Nord, im Uhrzeigersinn positiv (wie Kompass).
 *  - Drehrate r > 0: Bug dreht nach Steuerbord.
 */
export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};

/** Body-Vektor (voraus, Stb) → Erd-Vektor (Ost, Nord) bei Kurs psi. */
export function bodyToWorld(b: Vec2, psi: number): Vec2 {
  const s = Math.sin(psi);
  const c = Math.cos(psi);
  return { x: b.x * s + b.y * c, y: b.x * c - b.y * s };
}

/** Erd-Vektor (Ost, Nord) → Body-Vektor (voraus, Stb) bei Kurs psi. */
export function worldToBody(w: Vec2, psi: number): Vec2 {
  const s = Math.sin(psi);
  const c = Math.cos(psi);
  return { x: w.x * s + w.y * c, y: w.x * c - w.y * s };
}

/** Einheitsvektor (Ost, Nord), der in Kompassrichtung `deg` zeigt. */
export function compassDir(deg: number): Vec2 {
  const a = (deg * Math.PI) / 180;
  return { x: Math.sin(a), y: Math.cos(a) };
}

export const KN = 0.514444; // m/s pro Knoten
export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Kompasswinkel in [0, 360). */
export function wrapDeg360(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** Nächster Punkt auf Strecke ab zu p. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) return a;
  const t = clamp(dot(sub(p, a), ab) / l2, 0, 1);
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

/** Punkt-in-Polygon (ray casting). */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Deterministischer Zufallsgenerator (mulberry32) für reproduzierbare Böen. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standardnormalverteilte Zufallszahl aus gleichverteiltem RNG. */
export function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
