/**
 * Aus der YachtConfig abgeleitete Modellgrößen: Massenmatrix inkl.
 * hydrodynamischer Zusatzmassen, Lateralplan-Streifen, Foil-Parameter,
 * Propellerkennwerte und Rumpfkontur. Alles im Body-System mit Ursprung
 * im Gewichtsschwerpunkt.
 */
import type { Vec2 } from './vec';
import type { YachtConfig } from './yachtConfig';

export const RHO_WATER = 1025; // kg/m³ Salzwasser
export const RHO_AIR = 1.225; // kg/m³

export interface Strip {
  x: number;
  dx: number;
  /** lokale Tauchtiefe (Lateralplan-Höhe) [m] */
  depth: number;
  /** Kielanteil am Streifen 0 … 1 (bestimmt Querumströmungsbeiwert) */
  cd: number;
  /** 2D-Zusatzmasse pro Meter [kg/m] */
  addedMass: number;
  /** Beiwert für linearen Rumpfauftrieb bei Schräganströmung (0 für Kielstreifen) */
  liftCoeff: number;
}

export interface FoilParams {
  x: number;
  area: number;
  aspectRatio: number;
  /** Auftriebsanstieg dCL/dα [1/rad] */
  clAlpha: number;
  stallRad: number;
  cd0: number;
  /** Querumströmungsbeiwert (nur wenn nicht schon im Streifenmodell) */
  crossCd: number;
  /** Wirksamkeit bei Rückwärtsanströmung */
  reverseEff: number;
  /** Faktor für Anbauart (angehängtes Ruder wirkt schwächer) */
  efficiency: number;
}

export interface YachtModel {
  cfg: YachtConfig;
  mass: number;
  iz: number;
  m11: number;
  m22: number;
  m26: number;
  m66: number;
  /** Zusatzmassen nur des Kanu-Körpers (für das Munk-Moment) */
  m22Hull: number;
  m26Hull: number;
  /** Inverse der 3x3-Massenmatrix (Starrkörper + Zusatzmasse), zeilenweise */
  mInv: number[];
  strips: Strip[];
  keel: FoilParams;
  /** Anzahl Kiel-Segmente entlang der Sehne */
  keelSegments: number;
  rudder: FoilParams;
  wettedArea: number;
  /** Positionen relativ zum Schwerpunkt */
  propX: number;
  bowThrusterX: number;
  windCeX: number;
  bollardThrust: number;
  pitchSpeed: number;
  /** Anteil der Ruderfläche im Schraubenstrahl */
  rudderInWash: number;
  /** Rumpfkontur (Body-System, relativ Schwerpunkt), im Uhrzeigersinn */
  outline: Vec2[];
  /** Kontur für Kollisionen (etwas gröber) */
  collisionOutline: Vec2[];
  cleats: { id: string; name: string; pos: Vec2 }[];
}

/** Helmbold-Formel für Auftriebsanstieg eines Flügels endlicher Streckung. */
export function helmboldClAlpha(ar: number): number {
  return (2 * Math.PI * ar) / (2 + Math.sqrt(ar * ar + 4));
}

/** Halbe Rumpfbreite an Position xi ∈ [0 (Heck), 1 (Bug)]. */
export function halfBeamAt(xi: number, beam: number, transomRatio: number): number {
  const xm = 0.42; // Lage der größten Breite
  if (xi <= xm) {
    const t = (xm - xi) / xm;
    return (beam / 2) * (1 - (1 - transomRatio) * t * t);
  }
  const t = Math.min(1, (xi - xm) / (1 - xm));
  return (beam / 2) * Math.pow(Math.max(0, 1 - Math.pow(t, 2.1)), 0.62);
}

function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = [
    A,
    -(b * i - c * h),
    b * f - c * e,
    B,
    a * i - c * g,
    -(a * f - c * d),
    C,
    -(a * h - b * g),
    a * e - b * d,
  ];
  return inv.map((v) => v / det);
}

export function buildYachtModel(cfg: YachtConfig): YachtModel {
  const { hull, keel, rudder, engine, windage } = cfg;
  const lcg = hull.lcg;
  const mass = hull.displacement;
  const iz = mass * Math.pow(hull.gyrationRatio * hull.loa, 2);

  // --- Lateralplan in Streifen: Rumpf (Kanu-Körper) + Kiel -------------------
  const overhang = hull.loa - hull.lwl;
  const wlFwd = hull.loa / 2 - 0.65 * overhang;
  const wlAft = -hull.loa / 2 + 0.35 * overhang;
  const n = 48;
  const dx = (wlFwd - wlAft) / n;
  const keelSpan = Math.max(0.05, keel.draft - hull.canoeDraft);
  const keelFwd = keel.x + keel.chord / 2;
  const keelAft = keel.x - keel.chord / 2;
  const bilge = keel.type === 'bilge';
  const hullDepthAt = (x: number) => {
    const xi = Math.min(1, Math.max(0, (x - wlAft) / (wlFwd - wlAft)));
    return hull.canoeDraft * Math.pow(Math.sin(Math.PI * Math.min(1, xi * 0.9 + 0.1)), 0.6);
  };
  const strips: Strip[] = [];
  for (let k = 0; k < n; k++) {
    const xc = wlAft + (k + 0.5) * dx;
    const xi = (xc - wlAft) / (wlFwd - wlAft);
    // Kanu-Körper: vorn spitz auslaufend, achtern flacher
    const hullDepth = hullDepthAt(xc);
    let depth = hullDepth;
    let cd = 0; // Anteil scharfkantiger Kiel (0 = Rundspant)
    let keelShare = 0;
    if (xc >= keelAft && xc <= keelFwd) {
      keelShare = 1;
    } else if (xc > keelAft - dx && xc < keelFwd + dx) {
      keelShare = Math.max(0, 1 - Math.min(Math.abs(xc - keelAft), Math.abs(xc - keelFwd)) / dx);
    }
    if (keelShare > 0) {
      // Langkiel: Tiefe fällt nach vorn ab (Kielsohle ansteigend)
      let span = keelSpan;
      if (keel.type === 'long') {
        const t = (xc - keelAft) / keel.chord; // 0 achtern … 1 vorn
        span = keelSpan * (1 - 0.55 * Math.max(0, t - 0.3));
      }
      // Kimmkiel: zwei Flossen, geringere Tiefe aber doppelte Fläche
      const eff = bilge ? 1.6 : 1;
      depth = hullDepth + span * keelShare * eff;
      cd = keelShare;
    }
    // 2D-Zusatzmasse einer senkrechten Platte an freier Oberfläche: ρπd²/2
    // 3D-Abminderung für kurze Flossen (Flosse viel kürzer als tief)
    // (strip theory überschätzt bei kurzen/tiefen Körpern; Werte aus
    // Vergleich mit Yacht-Versuchen, Y_v̇ ≈ 0.6 … 1.0·m)
    const red = keelShare > 0 ? (keel.type === 'long' ? 0.45 : 0.5) : 0.75;
    const addedMass = (RHO_WATER * Math.PI * depth * depth * red) / 2;
    // Rumpfauftrieb (viskose Ablösung am Achterschiff) – nimmt nach achtern zu
    const liftCoeff = keelShare > 0 ? 0 : 1 + 2.5 * Math.max(0, 0.5 - xi);
    strips.push({ x: xc - lcg, dx, depth, cd, addedMass, liftCoeff });
  }

  let m22 = 0;
  let m26 = 0;
  let m66 = 0;
  let m22Hull = 0;
  let m26Hull = 0;
  for (const s of strips) {
    m22 += s.addedMass * s.dx;
    m26 += s.addedMass * s.x * s.dx;
    m66 += s.addedMass * s.x * s.x * s.dx;
    // Kanu-Körper allein (Kielanteil entfernt): Tiefe ohne Kiel
    const hd = s.depth - (s.cd > 0 ? (s.depth - hullDepthAt(s.x + lcg)) : 0);
    const ah = (RHO_WATER * Math.PI * hd * hd * 0.75) / 2;
    m22Hull += ah * s.dx;
    m26Hull += ah * s.x * s.dx;
  }
  const m11 = 0.06 * mass;

  const M = [mass + m11, 0, 0, 0, mass + m22, m26, 0, m26, iz + m66];
  const mInv = invert3(M);

  // --- Foils -----------------------------------------------------------------
  // Spiegelung am Rumpf verdoppelt die effektive Streckung
  const keelArea = keelSpan * keel.chord * (bilge ? 2 : 1);
  const keelAR = (2 * keelSpan) / keel.chord;
  const keelFoil: FoilParams = {
    x: keel.x - lcg,
    area: keelArea,
    aspectRatio: keelAR,
    clAlpha: helmboldClAlpha(keelAR),
    stallRad: ((14 + 22 / Math.max(keelAR, 0.5)) * Math.PI) / 180,
    cd0: 0.012,
    crossCd: 0, // Querumströmung steckt im Streifenmodell
    reverseEff: 0.75,
    efficiency: 1,
  };
  const rudderAR = (2 * rudder.span * rudder.span) / rudder.area;
  const rudderEff = rudder.type === 'spade' ? 1 : rudder.type === 'skeg' ? 0.85 : 0.65;
  const twin = rudder.arrangement === 'twin';
  const rudderFoil: FoilParams = {
    x: rudder.x - lcg,
    area: rudder.area,
    aspectRatio: rudderAR,
    clAlpha: helmboldClAlpha(rudderAR),
    stallRad: ((14 + 22 / Math.max(rudderAR, 0.5)) * Math.PI) / 180,
    cd0: 0.015,
    crossCd: 1.1,
    // Doppelruder steuern rückwärts gut (kein Ruder im Abstrom des Rumpfes mittschiffs)
    reverseEff: twin ? 0.85 : rudder.type === 'spade' ? 0.7 : 0.5,
    efficiency: rudderEff,
  };

  // --- Benetzte Fläche (Kanu-Körper), Näherung -------------------------------
  const vol = mass / RHO_WATER;
  const wettedArea = 2.6 * Math.sqrt(vol * hull.lwl);

  // --- Propeller: Standschub aus Impulstheorie (Figure of Merit ≈ 0.5) --------
  const diskArea = (Math.PI * engine.propDiameter * engine.propDiameter) / 4;
  const shaftPower = engine.powerKw * 1000 * 0.9;
  const bollardThrust = Math.cbrt(2 * RHO_WATER * diskArea * Math.pow(0.5 * shaftPower, 2));
  const pitchSpeed = (engine.propPitch * engine.maxPropRpm) / 60;
  // Saildrive sitzt weiter vorn, Strahl trifft Ruder trotzdem; Anteil über Geometrie
  // Doppelruder: der Strahl läuft zwischen beiden Blättern hindurch
  const rudderInWash = twin ? 0.02 : Math.min(0.9, (engine.propDiameter / rudder.span) * (rudder.type === 'keelHung' ? 1.6 : 1.1));

  // --- Kontur ------------------------------------------------------------------
  const outline: Vec2[] = [];
  const nOut = 36;
  // Stb-Seite vom Heck zum Bug, dann Bb-Seite zurück
  for (let k = 0; k <= nOut; k++) {
    const xi = k / nOut;
    const x = -hull.loa / 2 + xi * hull.loa;
    outline.push({ x: x - lcg, y: halfBeamAt(xi, hull.beam, hull.transomRatio) });
  }
  for (let k = nOut - 1; k >= 0; k--) {
    const xi = k / nOut;
    const x = -hull.loa / 2 + xi * hull.loa;
    outline.push({ x: x - lcg, y: -halfBeamAt(xi, hull.beam, hull.transomRatio) });
  }
  const collisionOutline: Vec2[] = [];
  const nCol = 14;
  for (let k = 0; k <= nCol; k++) {
    const xi = k / nCol;
    collisionOutline.push({ x: -hull.loa / 2 + xi * hull.loa - lcg, y: halfBeamAt(xi, hull.beam, hull.transomRatio) });
  }
  for (let k = nCol - 1; k >= 0; k--) {
    const xi = k / nCol;
    collisionOutline.push({ x: -hull.loa / 2 + xi * hull.loa - lcg, y: -halfBeamAt(xi, hull.beam, hull.transomRatio) });
  }
  // Doppelte Punkte am Bug entfernen (halbe Breite = 0)
  const dedup = (pts: Vec2[]) =>
    pts.filter((p, i) => {
      const q = pts[(i + pts.length - 1) % pts.length];
      return Math.hypot(p.x - q.x, p.y - q.y) > 1e-6;
    });

  return {
    cfg,
    mass,
    iz,
    m11,
    m22,
    m26,
    m66,
    m22Hull,
    m26Hull,
    mInv,
    strips,
    keel: keelFoil,
    keelSegments: Math.max(1, Math.round(keel.chord / 0.5)),
    rudder: rudderFoil,
    wettedArea,
    propX: engine.propX - lcg,
    bowThrusterX: cfg.bowThruster.x - lcg,
    windCeX: windage.ceX - lcg,
    bollardThrust,
    pitchSpeed,
    rudderInWash,
    outline: dedup(outline),
    collisionOutline: dedup(collisionOutline),
    cleats: cfg.cleats.map((c) => ({ id: c.id, name: c.name, pos: { x: c.x - lcg, y: c.y } })),
  };
}
