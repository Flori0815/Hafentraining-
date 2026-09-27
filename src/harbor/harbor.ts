/**
 * Hafen-Definition: reine Daten (Stege, Dalben, Festpunkte, Liegeplätze,
 * belegte Boxen). Weitere Häfen lassen sich später als Datensätze oder per
 * Editor ergänzen.
 */
import type { CircleObstacle, PolygonObstacle } from '../physics/collision';
import type { ShoreAnchor } from '../physics/lines';
import { halfBeamAt } from '../physics/yachtModel';
import type { Vec2 } from '../physics/vec';

export interface Berth {
  id: string;
  label: string;
  /** Box-Fläche (Rechteck zwischen Steg und Dalbenreihe) */
  poly: Vec2[];
  /** Kurs, wenn Bug zum Steg zeigt [°] */
  bowInHeading: number;
  /** Festpunkte, die zu dieser Box gehören */
  pierAnchors: string[];
  pileAnchors: string[];
  occupied: boolean;
}

export interface MooredBoat {
  pos: Vec2;
  headingDeg: number;
  loa: number;
  beam: number;
  color: string;
}

export interface Harbor {
  id: string;
  name: string;
  description: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  solids: PolygonObstacle[];
  piles: CircleObstacle[];
  anchors: ShoreAnchor[];
  berths: Berth[];
  boats: MooredBoat[];
  start: { pos: Vec2; headingDeg: number; speedKn: number };
  defaultTarget: string;
}

export function boatOutline(b: MooredBoat, n = 10): Vec2[] {
  const pts: Vec2[] = [];
  const psi = (b.headingDeg * Math.PI) / 180;
  const s = Math.sin(psi);
  const c = Math.cos(psi);
  const toW = (bx: number, by: number) => ({ x: b.pos.x + bx * s + by * c, y: b.pos.y + bx * c - by * s });
  for (let k = 0; k <= n; k++) {
    const xi = k / n;
    pts.push(toW(-b.loa / 2 + xi * b.loa, halfBeamAt(xi, b.beam, 0.8)));
  }
  for (let k = n - 1; k >= 1; k--) {
    const xi = k / n;
    pts.push(toW(-b.loa / 2 + xi * b.loa, -halfBeamAt(xi, b.beam, 0.8)));
  }
  pts.push(toW(-b.loa / 2, -halfBeamAt(0, b.beam, 0.8)));
  return pts;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/**
 * Boxengasse: zwei Reihen Boxen mit Dalben, Bug zum Steg. Fahrwasser
 * (Gasse) dazwischen ca. 24 m breit, Einfahrt von Westen.
 */
export function buildBoxengasse(): Harbor {
  const boxWidth = 4.2;
  const boxLength = 13.5; // Steg bis Dalbenreihe
  const nBoxes = 20;
  const x0 = 0;
  const northPier = 0; // Stegkante Nord (Steg liegt bei y > 0)
  const southPier = -51; // Stegkante Süd (Steg liegt bei y < -51)
  const northPiles = northPier - boxLength;
  const southPiles = southPier + boxLength;
  const xEnd = x0 + nBoxes * boxWidth;

  const solids: PolygonObstacle[] = [
    { id: 'pier-n', kind: 'pier', poly: rect(-45, northPier, xEnd + 6, northPier + 3) },
    { id: 'pier-s', kind: 'pier', poly: rect(-45, southPier - 3, xEnd + 6, southPier) },
    { id: 'quay-e', kind: 'wall', poly: rect(xEnd + 6, southPier - 3, xEnd + 10, northPier + 3) },
  ];

  const piles: CircleObstacle[] = [];
  const anchors: ShoreAnchor[] = [];
  const berths: Berth[] = [];
  const boats: MooredBoat[] = [];

  // Belegungsmuster (true = belegt), Index = Box-Nummer von West nach Ost
  const occN = [1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1];
  const occS = [1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1];
  const colors = ['#e8e4d8', '#dfe7ee', '#f2efe6', '#d9e2d5', '#ece3e3', '#e6e6f0'];

  for (const side of ['n', 's'] as const) {
    const pileY = side === 'n' ? northPiles : southPiles;
    const pierY = side === 'n' ? northPier : southPier;
    const dir = side === 'n' ? 1 : -1; // Richtung zum Steg
    for (let i = 0; i <= nBoxes; i++) {
      const x = x0 + i * boxWidth;
      const id = `pile-${side}${i}`;
      piles.push({ id, pos: { x, y: pileY }, radius: 0.16 });
      anchors.push({ id, kind: 'pile', pos: { x, y: pileY }, label: `Dalbe ${side.toUpperCase()}${i}` });
    }
    for (let i = 0; i < nBoxes; i++) {
      const xa = x0 + i * boxWidth;
      const xb = xa + boxWidth;
      const num = i + 1;
      const pa = `cleat-${side}${num}a`;
      const pb = `cleat-${side}${num}b`;
      // Poller/Klampen auf dem Steg, 0.35 m hinter der Kante
      anchors.push({ id: pa, kind: 'bollard', pos: { x: xa + 0.55, y: pierY + dir * 0.35 }, label: `Klampe ${side.toUpperCase()}${num} W` });
      anchors.push({ id: pb, kind: 'bollard', pos: { x: xb - 0.55, y: pierY + dir * 0.35 }, label: `Klampe ${side.toUpperCase()}${num} O` });
      const occupied = (side === 'n' ? occN : occS)[i] === 1;
      berths.push({
        id: `box-${side}${num}`,
        label: `Box ${side === 'n' ? 'Nord' : 'Süd'} ${num}`,
        poly: rect(xa, Math.min(pierY, pileY), xb, Math.max(pierY, pileY)),
        bowInHeading: side === 'n' ? 0 : 180,
        pierAnchors: [pa, pb],
        pileAnchors: [`pile-${side}${i}`, `pile-${side}${i + 1}`],
        occupied,
      });
      if (occupied) {
        const loa = 9.5 + ((i * 7 + (side === 'n' ? 3 : 5)) % 5) * 0.6;
        const beam = Math.min(boxWidth - 0.35, 3.3 + ((i * 3) % 4) * 0.12);
        // meist Bug zum Steg, einzelne Boote mit Heck zum Steg
        const sternTo = (i * 5 + (side === 'n' ? 1 : 2)) % 7 === 0;
        const heading = side === 'n' ? (sternTo ? 180 : 0) : sternTo ? 0 : 180;
        boats.push({
          pos: { x: (xa + xb) / 2, y: pierY - dir * (0.7 + loa / 2) },
          headingDeg: heading,
          loa,
          beam,
          color: colors[(i + (side === 'n' ? 0 : 3)) % colors.length],
        });
      }
    }
  }

  boats.forEach((b, k) => solids.push({ id: `boat-${k}`, kind: 'boat', poly: boatOutline(b) }));

  return {
    id: 'boxengasse',
    name: 'Boxengasse mit Dalben',
    description: 'Zwei Reihen Boxen (4,2 m × 13,5 m), Bug zum Steg, Gasse 24 m breit, Einfahrt von Westen.',
    bounds: { minX: -45, minY: southPier - 3, maxX: xEnd + 10, maxY: northPier + 3 },
    solids,
    piles,
    anchors,
    berths,
    boats,
    start: { pos: { x: -30, y: (northPiles + southPiles) / 2 }, headingDeg: 90, speedKn: 1.5 },
    defaultTarget: 'box-n10',
  };
}
