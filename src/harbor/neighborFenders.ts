/**
 * Fender der Nachbarboote in den Boxen. Wie gut die Nachbarn abgefendert
 * haben, hängt von der Aufgabe ab: bei leichten Aufgaben drei Fender je
 * Seite an der breitesten Stelle, bei schweren fehlen welche oder hängen
 * zu weit vorn/achtern, wo sie nichts nützen.
 */
import { STD_FENDER } from '../physics/fenders';
import type { Vec2 } from '../physics/vec';
import { halfBeamAt } from '../physics/yachtModel';
import type { Harbor, MooredBoat } from './harbor';

export type FenderQuality = 'good' | 'sparse' | 'poor' | 'none';

export const FENDER_QUALITY_LABEL: Record<FenderQuality, string> = {
  good: 'Nachbarn gut abgefendert',
  sparse: 'Nachbarn mit wenigen Fendern',
  poor: 'Nachbarfender fehlen oder hängen schlecht',
  none: 'Nachbarn ohne Fender',
};

export interface NeighborFender {
  id: string;
  /** Weltkoordinaten */
  pos: Vec2;
  r: number;
  k: number;
}

/** Standard je Schwierigkeit: leicht optimal, schwer lückenhaft. */
export function fenderQualityFor(difficulty: number): FenderQuality {
  return difficulty <= 2 ? 'good' : difficulty <= 4 ? 'sparse' : 'poor';
}

/** kleiner deterministischer Zufallsgenerator (mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Längspositionen (Anteil der Länge ab Heck) für eine Bootsseite. */
function sidePositions(q: FenderQuality, rand: () => number): number[] {
  const good = [0.3, 0.5, 0.7];
  switch (q) {
    case 'good':
      return good;
    case 'none':
      return [];
    case 'sparse': {
      const r = rand();
      const n = r < 0.2 ? 0 : r < 0.6 ? 1 : 2;
      const pick = [...good].sort(() => rand() - 0.5).slice(0, n);
      return pick.map((x) => x + (rand() - 0.5) * 0.1);
    }
    case 'poor': {
      const r = rand();
      const n = r < 0.35 ? 0 : r < 0.75 ? 1 : 2;
      // meist zu weit vorn oder achtern, wo der Rumpf schon schmal ist
      return Array.from({ length: n }, () => {
        const u = rand();
        return u < 0.4 ? 0.06 + rand() * 0.14 : u < 0.8 ? 0.82 + rand() * 0.1 : 0.35 + rand() * 0.3;
      });
    }
  }
}

function boatFenders(b: MooredBoat, positions: { xi: number; side: 1 | -1 }[], prefix: string): NeighborFender[] {
  const psi = (b.headingDeg * Math.PI) / 180;
  const s = Math.sin(psi);
  const c = Math.cos(psi);
  const r = STD_FENDER.r;
  return positions.map(({ xi, side }, i) => {
    const bx = -b.loa / 2 + xi * b.loa;
    const by = side * (halfBeamAt(xi, b.beam, 0.8) + r);
    return { id: `${prefix}-${i}`, pos: { x: b.pos.x + bx * s + by * c, y: b.pos.y + bx * c - by * s }, r, k: STD_FENDER.k };
  });
}

/** Fender aller Boote in Boxen eines Hafens. */
export function neighborFenders(h: Harbor, q: FenderQuality, seed: number): NeighborFender[] {
  const rand = rng(seed);
  const out: NeighborFender[] = [];
  h.boats.forEach((b, k) => {
    if (!b.inBox) return;
    const pos: { xi: number; side: 1 | -1 }[] = [];
    for (const side of [1, -1] as const) for (const xi of sidePositions(q, rand)) pos.push({ xi, side });
    out.push(...boatFenders(b, pos, `nfender-${k}`));
  });
  return out;
}
