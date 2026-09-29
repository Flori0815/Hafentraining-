/**
 * Hafen-Definition: reine Daten (Stege, Dalben, Festpunkte, Liegeplätze,
 * belegte Plätze). Szenarien werden aus wiederverwendbaren Bausteinen
 * (Boxenreihe, Längsseits-Steg) zusammengesetzt und stehen in `SCENARIOS`.
 */
import type { CircleObstacle, PolygonObstacle } from '../physics/collision';
import type { ShoreAnchor } from '../physics/lines';
import { halfBeamAt } from '../physics/yachtModel';
import type { Vec2 } from '../physics/vec';

/**
 * Aufgabe einer Leine. Box: Leine zum Steg bzw. zur Dalbe. Längsseits:
 * Vorleine, Achterleine, Vorspring (vom Vorschiff nach achtern) und
 * Achterspring (vom Achterschiff nach vorn).
 */
export type LineRole = 'pier' | 'pile' | 'bowLine' | 'sternLine' | 'fwdSpring' | 'aftSpring';

export interface LineRequirement {
  role: LineRole;
  label: string;
  count: number;
  /** zulässige Festpunkte (IDs) */
  anchors: string[];
}

export interface Berth {
  id: string;
  label: string;
  kind: 'box' | 'alongside';
  /** Markierung des Liegeplatzes */
  poly: Vec2[];
  /** Einheitsvektor vom Liegeplatz zum Steg (für Ausrichtungs-Vorgaben) */
  pierDir: Vec2;
  /** nötige Leinen, damit das Boot als festgemacht gilt */
  requirements: LineRequirement[];
  occupied: boolean;
}

export interface MooredBoat {
  pos: Vec2;
  headingDeg: number;
  loa: number;
  beam: number;
  color: string;
  /** liegt in einer Box (hat dann Fender zu den Nachbarn) */
  inBox?: boolean;
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

const COLORS = ['#e8e4d8', '#dfe7ee', '#f2efe6', '#d9e2d5', '#ece3e3', '#e6e6f0'];

/** Sammelcontainer beim Zusammensetzen eines Hafens. */
interface Parts {
  solids: PolygonObstacle[];
  piles: CircleObstacle[];
  anchors: ShoreAnchor[];
  berths: Berth[];
  boats: MooredBoat[];
}

const emptyParts = (): Parts => ({ solids: [], piles: [], anchors: [], berths: [], boats: [] });

/**
 * Reihe von Boxen zwischen einer Stegkante und einer Dalbenreihe.
 * `side` 'n': Steg liegt nördlich (Boxen nach Süden), 's': Steg südlich.
 */
function addBoxRow(
  p: Parts,
  opts: { side: 'n' | 's'; pierY: number; x0: number; nBoxes: number; boxWidth: number; boxLength: number; occupancy: number[] },
): void {
  const { side, pierY, x0, nBoxes, boxWidth, boxLength, occupancy } = opts;
  const dir = side === 'n' ? 1 : -1; // Richtung zum Steg
  const pileY = pierY - dir * boxLength;
  const S = side.toUpperCase();
  for (let i = 0; i <= nBoxes; i++) {
    const x = x0 + i * boxWidth;
    const id = `pile-${side}${i}`;
    p.piles.push({ id, pos: { x, y: pileY }, radius: 0.16 });
    p.anchors.push({ id, kind: 'pile', pos: { x, y: pileY }, label: `Dalbe ${S}${i}` });
  }
  for (let i = 0; i < nBoxes; i++) {
    const xa = x0 + i * boxWidth;
    const xb = xa + boxWidth;
    const num = i + 1;
    const pa = `cleat-${side}${num}a`;
    const pb = `cleat-${side}${num}b`;
    // Klampen auf dem Steg, 0.35 m hinter der Kante
    p.anchors.push({ id: pa, kind: 'bollard', pos: { x: xa + 0.55, y: pierY + dir * 0.35 }, label: `Klampe ${S}${num} W` });
    p.anchors.push({ id: pb, kind: 'bollard', pos: { x: xb - 0.55, y: pierY + dir * 0.35 }, label: `Klampe ${S}${num} O` });
    const occupied = occupancy[i] === 1;
    p.berths.push({
      id: `box-${side}${num}`,
      label: `Box ${side === 'n' ? 'Nord' : 'Süd'} ${num}`,
      kind: 'box',
      poly: rect(xa, Math.min(pierY, pileY), xb, Math.max(pierY, pileY)),
      pierDir: { x: 0, y: dir },
      requirements: [
        { role: 'pier', label: 'Leine zum Steg', count: 2, anchors: [pa, pb] },
        { role: 'pile', label: 'Leine zu den Dalben', count: 2, anchors: [`pile-${side}${i}`, `pile-${side}${i + 1}`] },
      ],
      occupied,
    });
    if (occupied) {
      const loa = 9.5 + ((i * 7 + (side === 'n' ? 3 : 5)) % 5) * 0.6;
      const beam = Math.min(boxWidth - 0.35, 3.3 + ((i * 3) % 4) * 0.12);
      // meist Bug zum Steg, einzelne Boote mit Heck zum Steg
      const sternTo = (i * 5 + (side === 'n' ? 1 : 2)) % 7 === 0;
      const heading = side === 'n' ? (sternTo ? 180 : 0) : sternTo ? 0 : 180;
      p.boats.push({
        pos: { x: (xa + xb) / 2, y: pierY - dir * (0.7 + loa / 2) },
        headingDeg: heading,
        loa,
        beam,
        color: COLORS[(i + (side === 'n' ? 0 : 3)) % COLORS.length],
        inBox: true,
      });
    }
  }
}

/**
 * Steg mit längsseits liegenden Yachten entlang der Kante `pierY` (Steg
 * nördlich davon). `gaps` sind freie Liegeplätze [xStart, xEnd].
 */
function addAlongsideRow(
  p: Parts,
  opts: { pierY: number; xFrom: number; xTo: number; gaps: { id: string; label: string; x0: number; x1: number }[]; bollardSpacing: number },
): void {
  const { pierY, xFrom, xTo, gaps, bollardSpacing } = opts;
  const spacing = 1.2; // Abstand zwischen Booten (Fender)
  const depth = 4.2; // Tiefe der Liegeplatz-Markierung ab Stegkante

  // Poller entlang der Stegkante
  let n = 0;
  for (let x = xFrom; x <= xTo + 1e-6; x += bollardSpacing) {
    n++;
    p.anchors.push({ id: `bollard-${n}`, kind: 'bollard', pos: { x, y: pierY + 0.35 }, label: `Poller ${n}` });
  }

  // Boote in den Abschnitten zwischen den Lücken
  const sorted = [...gaps].sort((a, b) => a.x0 - b.x0);
  const segments: [number, number][] = [];
  let cursor = xFrom;
  for (const g of sorted) {
    segments.push([cursor, g.x0]);
    cursor = g.x1;
  }
  segments.push([cursor, xTo]);
  let k = 0;
  for (const [a, b] of segments) {
    const len = b - a;
    const count = Math.max(0, Math.round((len + spacing) / (11.2 + spacing)));
    if (count === 0) continue;
    const loa = (len - (count - 1) * spacing) / count;
    for (let i = 0; i < count; i++) {
      const beam = 3.4 + ((k * 3) % 4) * 0.1;
      const x = a + i * (loa + spacing) + loa / 2;
      p.boats.push({
        pos: { x, y: pierY - 0.25 - beam / 2 },
        headingDeg: k % 3 === 1 ? 270 : 90,
        loa,
        beam,
        color: COLORS[k % COLORS.length],
      });
      k++;
    }
  }

  // Lücken als Liegeplätze; Leinen dürfen auch zu Pollern neben der Lücke gehen
  for (const g of sorted) {
    const near = p.anchors
      .filter((an) => an.kind === 'bollard' && an.id.startsWith('bollard-') && an.pos.x >= g.x0 - 7 && an.pos.x <= g.x1 + 7)
      .map((an) => an.id);
    const req = (role: LineRole, label: string): LineRequirement => ({ role, label, count: 1, anchors: near });
    p.berths.push({
      id: g.id,
      label: g.label,
      kind: 'alongside',
      pierDir: { x: 0, y: 1 },
      poly: rect(g.x0, pierY - depth, g.x1, pierY),
      requirements: [req('bowLine', 'Vorleine'), req('sternLine', 'Achterleine'), req('fwdSpring', 'Vorspring'), req('aftSpring', 'Achterspring')],
      occupied: false,
    });
  }
}

function finish(p: Parts): void {
  p.boats.forEach((b, k) => p.solids.push({ id: `boat-${k}`, kind: 'boat', poly: boatOutline(b) }));
}

/**
 * Boxengasse: zwei Reihen Boxen mit Dalben, Bug zum Steg. Fahrwasser
 * (Gasse) dazwischen ca. 24 m breit, Einfahrt von Westen.
 */
export function buildBoxengasse(): Harbor {
  const boxWidth = 4.2;
  const boxLength = 13.5;
  const nBoxes = 20;
  const northPier = 0;
  const southPier = -51;
  const xEnd = nBoxes * boxWidth;
  const p = emptyParts();
  p.solids.push(
    { id: 'pier-n', kind: 'pier', poly: rect(-45, northPier, xEnd + 6, northPier + 3) },
    { id: 'pier-s', kind: 'pier', poly: rect(-45, southPier - 3, xEnd + 6, southPier) },
    { id: 'quay-e', kind: 'wall', poly: rect(xEnd + 6, southPier - 3, xEnd + 10, northPier + 3) },
  );
  addBoxRow(p, { side: 'n', pierY: northPier, x0: 0, nBoxes, boxWidth, boxLength, occupancy: [1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1] });
  addBoxRow(p, { side: 's', pierY: southPier, x0: 0, nBoxes, boxWidth, boxLength, occupancy: [1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1] });
  finish(p);
  return {
    id: 'boxengasse',
    name: 'Boxengasse mit Dalben',
    description: 'Zwei Reihen Boxen (4,2 m × 13,5 m), Bug zum Steg, Gasse 24 m breit, Einfahrt von Westen.',
    bounds: { minX: -45, minY: southPier - 3, maxX: xEnd + 10, maxY: northPier + 3 },
    ...p,
    start: { pos: { x: -30, y: (northPier - boxLength + southPier + boxLength) / 2 }, headingDeg: 90, speedKn: 1.5 },
    defaultTarget: 'box-n10',
  };
}

/**
 * Längsseits: Steg an der Nordseite der Gasse mit längsseits liegenden
 * Yachten und zwei Lücken (18 m und 14 m). Gegenüber eine Boxenreihe mit
 * Dalben, dazwischen ca. 20 m Fahrwasser.
 */
export function buildLaengsseits(): Harbor {
  const northPier = 0;
  const southPier = -38;
  const boxWidth = 4.2;
  const boxLength = 13.5;
  const nBoxes = 24;
  const xEnd = 100;
  const p = emptyParts();
  p.solids.push(
    { id: 'pier-n', kind: 'pier', poly: rect(-45, northPier, xEnd + 6, northPier + 2.5) },
    { id: 'pier-s', kind: 'pier', poly: rect(-45, southPier - 3, xEnd + 6, southPier) },
    { id: 'quay-e', kind: 'wall', poly: rect(xEnd + 6, southPier - 3, xEnd + 10, northPier + 2.5) },
  );
  addAlongsideRow(p, {
    pierY: northPier,
    xFrom: -4,
    xTo: xEnd,
    bollardSpacing: 3,
    gaps: [
      { id: 'gap-a', label: 'Lücke A (18 m, leicht)', x0: 20, x1: 38 },
      { id: 'gap-b', label: 'Lücke B (14 m, schwer)', x0: 62, x1: 76 },
    ],
  });
  addBoxRow(p, {
    side: 's',
    pierY: southPier,
    x0: -2,
    nBoxes,
    boxWidth,
    boxLength,
    occupancy: [1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1],
  });
  finish(p);
  return {
    id: 'laengsseits',
    name: 'Längsseits in der Gasse',
    description: 'Steg mit längsseits liegenden Yachten, Lücken von 18 m und 14 m; gegenüber Boxen mit Dalben, Fahrwasser ca. 20 m.',
    bounds: { minX: -45, minY: southPier - 3, maxX: xEnd + 10, maxY: northPier + 2.5 },
    ...p,
    start: { pos: { x: -30, y: -14 }, headingDeg: 90, speedKn: 1.5 },
    defaultTarget: 'gap-a',
  };
}

export interface Scenario {
  id: string;
  name: string;
  build: () => Harbor;
}

export const SCENARIOS: Scenario[] = [
  { id: 'boxengasse', name: 'Boxengasse mit Dalben', build: buildBoxengasse },
  { id: 'laengsseits', name: 'Längsseits in der Gasse', build: buildLaengsseits },
];

export function buildScenario(id: string): Harbor {
  return (SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]).build();
}
