/**
 * Prüfstand: Standardmanöver nach dem Muster der Versuchsfahrten
 * (Drehkreis, Aufstoppen – vgl. IMO MSC/Circ.1053, ITTC 7.5-04-02-01),
 * ergänzt um typische Hafenmanöver (Kick mit Ruder hart, Radeffekt
 * rückwärts). Jede Messung hat einen Referenzbereich mit Quelle.
 *
 * Für Fahrtenyachten gibt es kaum veröffentlichte Messwerte. Die Bereiche
 * sind daher bewusst weit gefasst: Physik (Rumpfgeschwindigkeit,
 * Impulssatz) und übereinstimmende Praxisbeschreibungen. Sie sollen grobe
 * Fehler aufdecken, nicht auf Prozent genau kalibrieren.
 */
import { KN, type Vec2 } from './vec';
import { IDLE_LEVER, Yacht } from './yacht';
import type { YachtConfig } from './yachtConfig';

const DT = 1 / 120;
const calm: Vec2 = { x: 0, y: 0 };

function run(y: Yacht, seconds: number, wind: Vec2 = calm, each?: () => boolean | void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    y.step(DT, calm, wind, []);
    if (each?.()) return;
  }
}

/** Kursänderung seit dem letzten Aufruf, ohne Sprung bei 0/360°. */
function unwrap(): (psi: number) => number {
  let prev: number | null = null;
  let total = 0;
  return (psi) => {
    if (prev !== null) {
      let d = psi - prev;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      total += d;
    }
    prev = psi;
    return total;
  };
}

/** Yacht mit konstanter Fahrt bei Hebelstellung `lever` (eingeschwungen). */
function steady(cfg: YachtConfig, lever: number): Yacht {
  const y = new Yacht(cfg, { x: 0, y: 0 }, 0, 0);
  y.controls.throttle = lever;
  run(y, 90);
  return y;
}

export interface TurnResult {
  startKn: number;
  /** taktischer Durchmesser: Querversatz nach 180° [m] */
  tactical: number;
  /** Vorausweg bis 90° [m] */
  advance: number;
  /** Zeit für 360° [s] (NaN, wenn nicht erreicht) */
  t360: number;
  /** Fahrt am Ende der ersten Drehung [kn] */
  endKn: number;
  /** Bahn des Schwerpunkts (für die Skizze) */
  track: Vec2[];
}

/** Drehkreis: eingeschwungene Fahrt mit Hebel 0,4, dann Ruder hart Stb. */
export function turningCircle(cfg: YachtConfig, lever = 0.4): TurnResult {
  const y = steady(cfg, lever);
  const startKn = y.sogKn;
  const p0 = { ...y.state.pos };
  const psi0 = y.state.psi;
  const turned = unwrap();
  turned(y.state.psi);
  y.controls.helm = 1;
  let tactical = 0;
  let advance = 0;
  let t = 0;
  let t360 = NaN;
  let endKn = 0;
  const track: Vec2[] = [];
  // Koordinaten relativ zum Start: x quer (Stb), y voraus
  const rel = () => {
    const dx = y.state.pos.x - p0.x;
    const dy = y.state.pos.y - p0.y;
    return { x: dx * Math.cos(psi0) - dy * Math.sin(psi0), y: dx * Math.sin(psi0) + dy * Math.cos(psi0) };
  };
  run(y, 150, calm, () => {
    t += DT;
    const a = Math.abs(turned(y.state.psi));
    const p = rel();
    if (a <= Math.PI) tactical = Math.max(tactical, Math.abs(p.x));
    if (a <= Math.PI / 2) advance = Math.max(advance, p.y);
    if (Math.round(t / DT) % 12 === 0) track.push(p);
    if (a >= 2 * Math.PI) {
      t360 = t;
      endKn = y.sogKn;
      return true;
    }
  });
  if (Number.isNaN(t360)) endKn = y.sogKn;
  return { startKn, tactical, advance, t360, endKn, track };
}

/** Kick aus dem Stand: Ruder hart, 3 s Gasstoß (Hebel 0,6), dann 4 s Neutral. Kursänderung [°], Weg [m]. */
export function kickTurn(cfg: YachtConfig): { heading: number; distance: number } {
  const y = new Yacht(cfg, { x: 0, y: 0 }, 0, 0);
  const turned = unwrap();
  turned(y.state.psi);
  y.controls.helm = 1;
  run(y, 1.5, calm, () => void turned(y.state.psi));
  y.controls.throttle = 0.6;
  run(y, 3, calm, () => void turned(y.state.psi));
  y.controls.throttle = 0;
  run(y, 4, calm, () => void turned(y.state.psi));
  return { heading: (Math.abs(turned(y.state.psi)) * 180) / Math.PI, distance: Math.hypot(y.state.pos.x, y.state.pos.y) };
}

/** Radeffekt: aus dem Stand 10 s halbe Kraft zurück, Ruder mittschiffs. Kursänderung [°] (+ = Bug nach Stb). */
export function propWalkAstern(cfg: YachtConfig): number {
  const y = new Yacht(cfg, { x: 0, y: 0 }, 0, 0);
  const turned = unwrap();
  turned(y.state.psi);
  y.controls.throttle = -0.5;
  run(y, 10, calm, () => void turned(y.state.psi));
  return (turned(y.state.psi) * 180) / Math.PI;
}

/** Aufstoppen: aus Fahrt mit Hebel 0,4 voll zurück bis zum Stillstand. Weg [m] und Zeit [s]. */
export function stopping(cfg: YachtConfig): { startKn: number; distance: number; time: number } {
  const y = steady(cfg, 0.4);
  const startKn = y.sogKn;
  const p0 = { ...y.state.pos };
  y.controls.throttle = -1;
  let t = 0;
  run(y, 60, calm, () => {
    t += DT;
    return y.state.u <= 0;
  });
  return { startKn, distance: Math.hypot(y.state.pos.x - p0.x, y.state.pos.y - p0.y), time: t };
}

/** Höchstfahrt (Vollgas) und Fahrt im Standgas [kn]. */
export function speeds(cfg: YachtConfig): { max: number; idle: number } {
  return { max: steady(cfg, 1).sogKn, idle: steady(cfg, IDLE_LEVER).sogKn };
}

/** Abdrift bei 15 kn Wind querab, Maschine aus [kn]. */
export function beamDrift(cfg: YachtConfig): number {
  const y = new Yacht(cfg, { x: 0, y: 0 }, 0, 0);
  run(y, 60, { x: -15 * KN, y: 0 });
  return y.sogKn;
}

/** Rumpfgeschwindigkeit 1,34·√(LWL in ft) [kn]. */
export const hullSpeedKn = (lwl: number) => 1.34 * Math.sqrt(lwl / 0.3048);

// ---------------------------------------------------------------------------
// Referenzen
// ---------------------------------------------------------------------------
export interface Source {
  label: string;
  url: string;
}

export const SOURCES: Record<string, Source> = {
  ittc: { label: 'ITTC 7.5-04-02-01 Full Scale Manoeuvring Trials', url: 'https://ittc.info/media/2131/75-04-02-01.pdf' },
  imo: { label: 'IMO MSC/Circ.1053 (Manövrierversuche)', url: 'https://www.register-iri.com/wp-content/uploads/MSC.1-Circ.1053.pdf' },
  pbo: { label: 'Practical Boat Owner: Keel types and how they affect performance', url: 'https://www.pbo.co.uk/boats/keel-types-and-how-they-affect-performance-76621' },
  ym: { label: 'Yachting Monthly: How keel type affects performance', url: 'https://www.yachtingmonthly.com/sailing-skills/keel-type-affects-performance-54322' },
  sailTwin: { label: 'SAIL: Docking with Twin Rudders', url: 'https://sailmagazine.com/cruising/boat-handling-docking-with-twin-rudders/' },
  nauticedTwin: { label: 'NauticEd: Dual Rudder – Maneuvering Under Power', url: 'https://sailing-blog.nauticed.org/dual-rudder-maneuvering-under-power/' },
  grenada: { label: 'Grenada Bluewater Sailing: Propellers, Rudders and Propwalk', url: 'https://www.grenadabluewatersailing.com/boat-handling-rudders-propellers/' },
  sailWalk: { label: 'SAIL: Walking the Prop', url: 'https://sailmagazine.com/cruising/walking-the-prop/' },
  segelplanet: { label: 'segelplanet.de: Radeffekt', url: 'https://segelplanet.de/radeffekt/' },
  practicalSailor: { label: 'Practical Sailor: Rudder Mods for Low-speed Docking', url: 'https://www.practical-sailor.com/systems-propulsion/rudder-mods-for-low-speed-docking/' },
  molland: { label: 'Molland & Turnock: Marine Rudders and Control Surfaces (Ruder im Schraubenstrahl)', url: 'https://www.sciencedirect.com/book/9780750669443/marine-rudders-and-control-surfaces' },
};

export type Verdict = 'ok' | 'off';

export interface CheckResult {
  id: string;
  label: string;
  value: number;
  unit: string;
  range: [number, number];
  verdict: Verdict;
  basis: string;
  sources: string[];
}

const LONG = (c: YachtConfig) => c.keel.type === 'long';
const TWIN = (c: YachtConfig) => c.rudder.arrangement === 'twin';

/** Alle Prüfungen für eine Yacht ausführen. */
export function runBench(cfg: YachtConfig): { checks: CheckResult[]; turn: TurnResult } {
  const L = cfg.hull.loa;
  const out: CheckResult[] = [];
  const add = (r: Omit<CheckResult, 'verdict'>) => {
    out.push({ ...r, verdict: r.value >= r.range[0] && r.value <= r.range[1] ? 'ok' : 'off' });
  };
  const sp = speeds(cfg);
  const vh = hullSpeedKn(cfg.hull.lwl);
  add({
    id: 'maxSpeed',
    label: 'Höchstfahrt unter Motor (Vollgas)',
    value: sp.max,
    unit: 'kn',
    range: [0.8 * vh, 1.05 * vh],
    basis: `Verdrängerrumpf: nahe der Rumpfgeschwindigkeit 1,34·√LWL[ft] = ${vh.toFixed(1)} kn`,
    sources: [],
  });
  add({
    id: 'idleSpeed',
    label: 'Fahrt eingekuppelt im Standgas',
    value: sp.idle,
    unit: 'kn',
    range: [1.2, 3.5],
    basis: 'Praxis: im Standgas voraus läuft eine Fahrtenyacht etwa 1,5–3 kn',
    sources: [],
  });
  const turn = turningCircle(cfg);
  add({
    id: 'tactical',
    label: `Drehkreis voraus (taktischer Durchmesser, Start ${turn.startKn.toFixed(1)} kn, Hartruder)`,
    value: turn.tactical / L,
    unit: 'L',
    range: LONG(cfg) ? [1.5, 4] : [0.8, 2.5],
    basis: LONG(cfg) ? 'Langkiel: weiter Drehkreis voraus' : 'Flossenkiel mit Spatenruder: dreht eng und schnell',
    sources: ['pbo', 'ym', 'ittc'],
  });
  add({
    id: 't360',
    label: 'Zeit für einen Vollkreis (dieselbe Drehung)',
    value: turn.t360,
    unit: 's',
    range: LONG(cfg) ? [35, 150] : [20, 75],
    basis: 'Vollkreis mit Hartruder und konstanter Hebelstellung (Versuchsablauf nach IMO/ITTC)',
    sources: ['imo', 'ittc'],
  });
  add({
    id: 'turnSpeed',
    label: 'Fahrt am Ende des Vollkreises / Anfangsfahrt',
    value: (Number.isNaN(turn.t360) ? 0 : turn.endKn) / turn.startKn,
    unit: '',
    range: [0.1, 0.85],
    basis: 'Hartruder bremst: das abgerissene Ruder erzeugt viel Widerstand, die Yacht behält aber etwas Fahrt',
    sources: ['practicalSailor'],
  });
  const kick = kickTurn(cfg);
  add({
    id: 'kick',
    label: 'Kick aus dem Stand (Ruder hart, 3 s Gas 60 %, 4 s auslaufen)',
    value: kick.heading,
    unit: '°',
    range: TWIN(cfg) ? [0, 12] : LONG(cfg) ? [5, 40] : [15, 70],
    basis: TWIN(cfg)
      ? 'Doppelruder: der Strahl läuft zwischen den Rudern durch – aus dem Stand dreht ein Gasstoß das Boot kaum'
      : 'Einzelruder im Schraubenstrahl: ein kurzer Gasstoß bei hartem Ruder dreht das Boot fast auf der Stelle',
    sources: TWIN(cfg) ? ['sailTwin', 'nauticedTwin'] : ['grenada', 'molland'],
  });
  add({
    id: 'kickDistance',
    label: 'Weg beim Kick',
    value: kick.distance / L,
    unit: 'L',
    range: [0, 0.6],
    basis: 'Drehen auf der Stelle: das Boot nimmt dabei kaum Fahrt auf',
    sources: ['grenada'],
  });
  const walk = propWalkAstern(cfg);
  const right = cfg.engine.propRotation === 'right';
  add({
    id: 'propWalk',
    label: `Radeffekt: 10 s halbe Kraft zurück, Ruder mittschiffs (Bug nach ${right ? 'Stb' : 'Bb'})`,
    value: right ? walk : -walk,
    unit: '°',
    range: cfg.engine.drive === 'saildrive' ? [2, 30] : [8, 90],
    basis:
      'Rechtsdrehende Schraube: rückwärts zieht das Heck nach Bb (Bug dreht nach Stb); Welle mit schräger Achse stärker als Saildrive',
    sources: ['segelplanet', 'sailWalk'],
  });
  const stop = stopping(cfg);
  add({
    id: 'stopping',
    label: `Aufstoppweg aus ${stop.startKn.toFixed(1)} kn mit Vollgas zurück`,
    value: stop.distance / L,
    unit: 'L',
    range: [0.4, 3],
    basis: 'Praxis: aus Manöverfahrt steht eine Yacht mit kräftig zurück nach ein bis zwei Bootslängen',
    sources: ['imo'],
  });
  add({
    id: 'drift',
    label: 'Abdrift bei 15 kn Wind querab (Maschine aus)',
    value: beamDrift(cfg),
    unit: 'kn',
    range: [0.4, 2.2],
    basis: 'Praxis: eine treibende Fahrtenyacht versetzt bei 15 kn querab mit gut 1 kn',
    sources: [],
  });
  return { checks: out, turn };
}
