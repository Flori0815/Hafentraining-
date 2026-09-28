/**
 * Fender: weiche Kontaktkörper außen am Rumpf. Standardsatz 4 Fender je
 * Seite (Zylinderfender, hängen senkrecht → in Draufsicht ein Kreis) und ein
 * großer Ballfender, den die Crew an eine beliebige Stelle bringen kann.
 * Die Crew braucht Zeit zum Ausbringen. Positionen im Body-System relativ
 * zum Schwerpunkt.
 */
import { closestOnSegment, pointInPolygon, type Vec2 } from './vec';
import { halfBeamAt, type YachtModel } from './yachtModel';

export type FenderSide = 'p' | 's';

export interface Fender {
  id: string;
  label: string;
  kind: 'std' | 'ball';
  /** Mittelpunkt des Fenders (Body-System, relativ SP) */
  pos: Vec2;
  /** Radius in der Draufsicht [m] */
  r: number;
  /** Federsteifigkeit beim Zusammendrücken [N/m] */
  k: number;
  side: FenderSide | null;
  out: boolean;
  /** Simulationszeit, ab der der Fender hängt [s] */
  readyAt: number;
}

export interface FenderCollider {
  id: string;
  kind: Fender['kind'];
  pos: Vec2;
  r: number;
  k: number;
}

export const STD_FENDER = { r: 0.11, k: 25000, perSide: 4, secondsEach: 1.0 };
export const BALL_FENDER = { r: 0.3, k: 12000, seconds: 4 };
/** Längspositionen des Standardsatzes als Anteil der LOA ab Heck */
const STD_XI = [0.24, 0.4, 0.56, 0.72];

/** Randpunkt und nach außen zeigende Normale der Rumpfkontur bei xi. */
function hullEdge(model: YachtModel, xi: number, sideSign: number): { p: Vec2; n: Vec2 } {
  const { loa, beam, transomRatio, lcg } = model.cfg.hull;
  const h = 1e-3;
  const hb = halfBeamAt(xi, beam, transomRatio);
  const dhb = (halfBeamAt(Math.min(1, xi + h), beam, transomRatio) - halfBeamAt(Math.max(0, xi - h), beam, transomRatio)) / (2 * h * loa);
  // Tangente (1, ±dhb) → Außennormale (-dhb, ±1): wo der Rumpf schmaler wird, kippt sie nach vorn/achtern
  const nx = -dhb;
  const ny = sideSign;
  const l = Math.hypot(nx, ny);
  return { p: { x: -loa / 2 + xi * loa - lcg, y: sideSign * hb }, n: { x: nx / l, y: ny / l } };
}

export class FenderSet {
  fenders: Fender[] = [];
  ball: Fender | null = null;

  constructor(model: YachtModel) {
    for (const side of ['p', 's'] as FenderSide[]) {
      const sign = side === 's' ? 1 : -1;
      STD_XI.forEach((xi, i) => {
        const { p, n } = hullEdge(model, xi, sign);
        this.fenders.push({
          id: `fender-${side}${i + 1}`,
          label: `Fender ${side === 's' ? 'Stb' : 'Bb'} ${i + 1}`,
          kind: 'std',
          pos: { x: p.x + n.x * STD_FENDER.r, y: p.y + n.y * STD_FENDER.r },
          r: STD_FENDER.r,
          k: STD_FENDER.k,
          side,
          out: false,
          readyAt: 0,
        });
      });
    }
  }

  /** Fender einer Seite ausbringen (nacheinander) oder einholen (sofort). */
  setSide(side: FenderSide, out: boolean, now: number): void {
    let i = 0;
    for (const f of this.fenders) {
      if (f.side !== side) continue;
      if (out && !f.out) f.readyAt = now + ++i * STD_FENDER.secondsEach;
      f.out = out;
    }
  }

  /** Anzahl hängender / insgesamt ausgebrachter Fender einer Seite. */
  sideState(side: FenderSide, now: number): { active: number; out: number; total: number } {
    const fs = this.fenders.filter((f) => f.side === side);
    return {
      active: fs.filter((f) => f.out && now >= f.readyAt).length,
      out: fs.filter((f) => f.out).length,
      total: fs.length,
    };
  }

  /**
   * Ballfender an die Rumpfstelle bringen, die `bodyPoint` am nächsten liegt.
   * Gibt false zurück, wenn der Punkt weiter als `maxDist` vom Rumpf entfernt ist.
   */
  placeBall(model: YachtModel, bodyPoint: Vec2, now: number, maxDist = 2.5): boolean {
    const edge = nearestHullPoint(model.outline, bodyPoint);
    if (edge.dist > maxDist) return false;
    const r = BALL_FENDER.r;
    this.ball = {
      id: 'fender-ball',
      label: 'Ballfender',
      kind: 'ball',
      pos: { x: edge.p.x + edge.n.x * r, y: edge.p.y + edge.n.y * r },
      r,
      k: BALL_FENDER.k,
      side: null,
      out: true,
      readyAt: now + BALL_FENDER.seconds,
    };
    return true;
  }

  removeBall(): void {
    this.ball = null;
  }

  all(): Fender[] {
    return this.ball ? [...this.fenders, this.ball] : this.fenders;
  }

  /** Fender, die gerade hängen und wirken. */
  colliders(now: number): FenderCollider[] {
    return this.all()
      .filter((f) => f.out && now >= f.readyAt)
      .map((f) => ({ id: f.id, kind: f.kind, pos: f.pos, r: f.r, k: f.k }));
  }
}

/** Nächster Punkt auf der Rumpfkontur (Body-System) mit Außennormale. */
export function nearestHullPoint(outline: Vec2[], q: Vec2): { p: Vec2; n: Vec2; dist: number } {
  let best = { p: outline[0], n: { x: 0, y: 1 }, dist: Infinity };
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const c = closestOnSegment(q, a, b);
    const d = Math.hypot(q.x - c.x, q.y - c.y);
    if (d < best.dist) {
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const l = Math.hypot(ex, ey) || 1;
      let n = { x: ey / l, y: -ex / l };
      // nach außen: liegt ein Punkt knapp neben der Kante im Rumpf, Normale umdrehen
      if (pointInPolygon({ x: c.x + n.x * 0.02, y: c.y + n.y * 0.02 }, outline)) n = { x: -n.x, y: -n.y };
      best = { p: c, n, dist: d };
    }
  }
  return best;
}
