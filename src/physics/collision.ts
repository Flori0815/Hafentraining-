/**
 * Kontaktmodell: Rumpfkontur gegen Dalben (Kreise) und feste Polygone
 * (Stege, Mauern, andere Boote). Penalty-Verfahren mit Feder/Dämpfer
 * (entspricht Fender/Scheuerleiste) und Coulomb-Reibung.
 */
import { closestOnSegment, dot, pointInPolygon, sub, type Vec2 } from './vec';
import type { ExternalForce, Yacht } from './yacht';
import type { FenderCollider } from './fenders';

export interface CircleObstacle {
  id: string;
  pos: Vec2;
  radius: number;
}

export interface PolygonObstacle {
  id: string;
  kind: 'pier' | 'wall' | 'boat';
  poly: Vec2[];
}

export interface Contact {
  obstacleId: string;
  kind: 'pile' | PolygonObstacle['kind'];
  point: Vec2;
  normal: Vec2; // zeigt vom Hindernis zum Boot
  depth: number;
  /** Annäherungsgeschwindigkeit bei Kontakt [m/s] (>0 = aufeinander zu) */
  approachSpeed: number;
  force: number;
  /** über welchen Körper der Kontakt läuft: Rumpf oder ein Fender */
  via: 'hull' | 'fender';
  fenderId?: string;
}

const STIFFNESS = 1.5e5; // N/m
const FRICTION = 0.3;

function closestOnPolygon(p: Vec2, poly: Vec2[]): { point: Vec2; dist: number; edgeNormal: Vec2 } {
  let best = { point: poly[0], dist: Infinity, edgeNormal: { x: 0, y: 0 } };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const q = closestOnSegment(p, a, b);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.dist) {
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const l = Math.hypot(ex, ey) || 1;
      best = { point: q, dist: d, edgeNormal: { x: ey / l, y: -ex / l } };
    }
  }
  return best;
}

function bbox(poly: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export class CollisionSystem {
  circles: CircleObstacle[] = [];
  polygons: PolygonObstacle[] = [];
  contacts: Contact[] = [];
  private polyBoxes: ReturnType<typeof bbox>[] = [];

  setObstacles(circles: CircleObstacle[], polygons: PolygonObstacle[]): void {
    this.circles = circles;
    this.polygons = polygons;
    this.polyBoxes = polygons.map((p) => bbox(p.poly));
  }

  update(yacht: Yacht, fenders: FenderCollider[] = []): ExternalForce[] {
    const hull = yacht.outlineWorld(true);
    const hb = bbox(hull);
    const center = yacht.state.pos;
    const forces: ExternalForce[] = [];
    this.contacts = [];
    const m = yacht.model.mass;
    const dampingFor = (k: number) => 2 * 0.6 * Math.sqrt(k * m * 0.3);
    const hullDamping = dampingFor(STIFFNESS);

    const addContact = (
      id: string,
      kind: Contact['kind'],
      point: Vec2,
      normal: Vec2,
      depth: number,
      k = STIFFNESS,
      damping = hullDamping,
      fender?: FenderCollider,
    ) => {
      const vel = yacht.pointVelocity({
        // Punkt relativ zum Schwerpunkt im Body-System
        ...worldToBodyRel(point, center, yacht.state.psi),
      });
      const vn = dot(vel, normal); // > 0 = Boot entfernt sich
      const fn = Math.max(0, k * depth - damping * vn);
      const vt = { x: vel.x - normal.x * vn, y: vel.y - normal.y * vn };
      const vtl = Math.hypot(vt.x, vt.y);
      const ff = vtl > 1e-6 ? (FRICTION * fn * Math.tanh(vtl / 0.05)) / vtl : 0;
      forces.push({
        point,
        force: { x: normal.x * fn - vt.x * ff, y: normal.y * fn - vt.y * ff },
      });
      this.contacts.push({
        obstacleId: id,
        kind,
        point,
        normal,
        depth,
        approachSpeed: Math.max(0, -vn),
        force: fn,
        via: fender ? 'fender' : 'hull',
        fenderId: fender?.id,
      });
    };

    // Fender: Kreis um den Fendermittelpunkt gegen Dalben und Polygone
    for (const f of fenders) {
      const c = yacht.toWorld(f.pos);
      const damping = dampingFor(f.k);
      for (const pile of this.circles) {
        const dx = c.x - pile.pos.x;
        const dy = c.y - pile.pos.y;
        const d = Math.hypot(dx, dy);
        const reach = f.r + pile.radius;
        if (d >= reach || d < 1e-9) continue;
        const n = { x: dx / d, y: dy / d };
        addContact(pile.id, 'pile', { x: pile.pos.x + n.x * pile.radius, y: pile.pos.y + n.y * pile.radius }, n, reach - d, f.k, damping, f);
      }
      for (let i = 0; i < this.polygons.length; i++) {
        const b = this.polyBoxes[i];
        if (c.x < b.minX - f.r || c.x > b.maxX + f.r || c.y < b.minY - f.r || c.y > b.maxY + f.r) continue;
        const ob = this.polygons[i];
        const inside = pointInPolygon(c, ob.poly);
        const cp = closestOnPolygon(c, ob.poly);
        if (!inside && cp.dist >= f.r) continue;
        let n = inside ? sub(cp.point, c) : sub(c, cp.point);
        const l = Math.hypot(n.x, n.y) || 1;
        n = { x: n.x / l, y: n.y / l };
        addContact(ob.id, ob.kind, cp.point, n, inside ? f.r + cp.dist : f.r - cp.dist, f.k, damping, f);
      }
    }

    // Dalben
    for (const c of this.circles) {
      if (c.pos.x < hb.minX - c.radius || c.pos.x > hb.maxX + c.radius) continue;
      if (c.pos.y < hb.minY - c.radius || c.pos.y > hb.maxY + c.radius) continue;
      const inside = pointInPolygon(c.pos, hull);
      const cp = closestOnPolygon(c.pos, hull);
      if (!inside && cp.dist >= c.radius) continue;
      const depth = inside ? c.radius + cp.dist : c.radius - cp.dist;
      // Normale: vom Dalben zum Boot
      let n = sub(cp.point, c.pos);
      let l = Math.hypot(n.x, n.y);
      if (inside) {
        n = { x: -n.x, y: -n.y };
      }
      if (l < 1e-6) {
        n = { x: -cp.edgeNormal.x, y: -cp.edgeNormal.y };
        l = 1;
      }
      addContact(c.id, 'pile', cp.point, { x: n.x / l, y: n.y / l }, depth);
    }

    // Polygone
    for (let i = 0; i < this.polygons.length; i++) {
      const ob = this.polygons[i];
      const b = this.polyBoxes[i];
      if (b.maxX < hb.minX || b.minX > hb.maxX || b.maxY < hb.minY || b.minY > hb.maxY) continue;
      // Rumpfpunkte im Hindernis
      for (const p of hull) {
        if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) continue;
        if (!pointInPolygon(p, ob.poly)) continue;
        const cp = closestOnPolygon(p, ob.poly);
        const n = sub(cp.point, p);
        const l = Math.hypot(n.x, n.y) || 1;
        addContact(ob.id, ob.kind, p, { x: n.x / l, y: n.y / l }, cp.dist);
      }
      // Hindernis-Ecken im Rumpf
      for (const p of ob.poly) {
        if (p.x < hb.minX || p.x > hb.maxX || p.y < hb.minY || p.y > hb.maxY) continue;
        if (!pointInPolygon(p, hull)) continue;
        const cp = closestOnPolygon(p, hull);
        const n = sub(p, cp.point);
        const l = Math.hypot(n.x, n.y) || 1;
        addContact(ob.id, ob.kind, p, { x: n.x / l, y: n.y / l }, cp.dist);
      }
    }
    return forces;
  }
}

function worldToBodyRel(p: Vec2, center: Vec2, psi: number): Vec2 {
  const wx = p.x - center.x;
  const wy = p.y - center.y;
  const s = Math.sin(psi);
  const c = Math.cos(psi);
  return { x: wx * s + wy * c, y: wx * c - wy * s };
}
