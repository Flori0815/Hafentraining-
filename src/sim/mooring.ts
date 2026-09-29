/**
 * "Musterskipper": berechnet für eine Yacht die festgemachte Lage in einem
 * Liegeplatz und die passenden Leinen. Genutzt für den Startzustand von
 * Ablegeaufgaben (passt sich jeder Yacht an, auch eigenen) und für die
 * Lösbarkeitsprüfung aller Aufgaben.
 */
import type { Berth, Harbor, LineRole } from '../harbor/harbor';
import type { FenderSide } from '../physics/fenders';
import { dist, dot, type Vec2 } from '../physics/vec';
import type { Yacht } from '../physics/yacht';
import type { Orientation } from '../tasks/types';

/** Abstand Bug bzw. Heck zur Stegkante in der Box [m] */
const BOX_GAP = 0.8;
/** Abstand Bordwand zur Stegkante längsseits (Fender) [m] */
const ALONGSIDE_GAP = 0.4;

export function defaultOrientation(berth: Berth): Orientation {
  return berth.kind === 'box' ? 'bowToPier' : 'portSide';
}

/** Seite, die beim Längsseitsliegen am Steg liegt. */
export function pierSide(o: Orientation): FenderSide {
  return o === 'starboardSide' ? 's' : 'p';
}

/** Festgemachte Lage (Schwerpunkt und Kurs in rad) mittig im Liegeplatz. */
export function mooredPose(yacht: Yacht, berth: Berth, o: Orientation): { pos: Vec2; psi: number } {
  const d = berth.pierDir;
  const hull = yacht.model.cfg.hull;
  const hd = (Math.atan2(d.x, d.y) * 180) / Math.PI;
  const heading = o === 'bowToPier' ? hd : o === 'sternToPier' ? hd + 180 : o === 'portSide' ? hd + 90 : hd - 90;
  const n = berth.poly.length;
  const c = berth.poly.reduce((a, q) => ({ x: a.x + q.x / n, y: a.y + q.y / n }), { x: 0, y: 0 });
  const edge = Math.max(...berth.poly.map((q) => dot(q, d)));
  const offset =
    o === 'bowToPier'
      ? BOX_GAP + hull.loa / 2 - hull.lcg
      : o === 'sternToPier'
        ? BOX_GAP + hull.loa / 2 + hull.lcg
        : ALONGSIDE_GAP + hull.beam / 2;
  const along = edge - dot(c, d) - offset;
  return { pos: { x: c.x + d.x * along, y: c.y + d.y * along }, psi: (heading * Math.PI) / 180 };
}

/** Yacht in die festgemachte Lage setzen (ohne Fahrt). */
export function placeMoored(yacht: Yacht, berth: Berth, o: Orientation): void {
  const p = mooredPose(yacht, berth, o);
  Object.assign(yacht.state, { pos: p.pos, psi: p.psi, u: 0, v: 0, r: 0 });
}

/**
 * Leinen für alle Anforderungen des Liegeplatzes: [Klampe, Festpunkt-ID].
 * Setzt voraus, dass die Yacht bereits im Liegeplatz liegt.
 */
export function mooringPlan(yacht: Yacht, harbor: Harbor, berth: Berth, o: Orientation): [string, string][] {
  const anchorsOf = (ids: string[]) => harbor.anchors.filter((a) => ids.includes(a.id));
  const nearest = (ids: string[], p: Vec2) => anchorsOf(ids).reduce((a, b) => (dist(b.pos, p) < dist(a.pos, p) ? b : a)).id;
  const plan: [string, string][] = [];
  if (berth.kind === 'box') {
    const pierEnd = o === 'sternToPier' ? 'stern' : 'bow';
    const pileEnd = pierEnd === 'bow' ? 'stern' : 'bow';
    for (const req of berth.requirements) {
      const end = req.role === 'pier' ? pierEnd : pileEnd;
      for (const side of ['p', 's']) {
        const cleat = `${end}-${side}`;
        plan.push([cleat, nearest(req.anchors, yacht.cleatWorld(cleat)!)]);
      }
    }
    return plan;
  }
  // längsseits: Klampe und gewünschte Lage des Pollers (voraus + / achteraus −)
  const side = pierSide(o);
  const psi = yacht.state.psi;
  const f = { x: Math.sin(psi), y: Math.cos(psi) };
  const layout: Partial<Record<LineRole, [string, number]>> = {
    bowLine: [`bow-${side}`, 2],
    sternLine: [`stern-${side}`, -2],
    fwdSpring: [`mid-${side}`, -3.5],
    aftSpring: [`stern-${side}`, 4],
  };
  for (const req of berth.requirements) {
    const entry = layout[req.role];
    if (!entry) continue;
    const [cleat, ahead] = entry;
    const c = yacht.cleatWorld(cleat)!;
    plan.push([cleat, nearest(req.anchors, { x: c.x + f.x * ahead, y: c.y + f.y * ahead })]);
  }
  return plan;
}
