import { describe, expect, it } from 'vitest';
import { buildLaengsseits } from '../harbor/harbor';
import { DEFAULT_ENV } from '../physics/environment';
import { MAX_SLIP_LINES, type ShoreAnchor } from '../physics/lines';
import { dist } from '../physics/vec';
import { SAILING_YACHT_36 } from '../physics/yachtConfig';
import type { CrewMode } from './crew';
import { orderLeadAft, orderLine, orderSlip, orderThrow } from './orders';
import { Simulation } from './simulation';

const CALM = { ...DEFAULT_ENV, windSpeedKn: 0, gustiness: 0, currentSpeedKn: 0 };

/** Längsseits in Lücke A, Kurs Ost, Steg an Bb; Boot liegt still. */
function setup(mode: CrewMode, env = CALM) {
  const sim = new Simulation(buildLaengsseits(), SAILING_YACHT_36, env);
  sim.crewMode = mode;
  sim.reset();
  const st = sim.yacht.state;
  st.pos = { x: 29, y: -2.05 };
  st.psi = Math.PI / 2;
  st.u = st.v = st.r = 0;
  return sim;
}

/** nächstgelegener Poller zu einer Bordklampe */
function bollardAt(sim: Simulation, cleat: string): ShoreAnchor {
  const c = sim.yacht.cleatWorld(cleat)!;
  return sim.harbor.anchors
    .filter((a) => a.kind === 'bollard')
    .reduce((a, b) => (dist(a.pos, c) <= dist(b.pos, c) ? a : b));
}

function runUntil(sim: Simulation, cond: () => boolean, maxSeconds = 60): number {
  const t0 = sim.time;
  while (!cond() && sim.time - t0 < maxSeconds) sim.stepOnce();
  return sim.time - t0;
}

describe('Besatzung', () => {
  it('Mannschaft: Leine ist sofort ausgebracht, Skipper bleibt am Ruder', () => {
    const sim = setup('crew');
    expect(orderThrow(sim, 'bow-p', bollardAt(sim, 'bow-p'))).toBeNull();
    expect(sim.lines.lines).toHaveLength(1);
    expect(sim.crew.atHelm).toBe(true);
  });

  it('Einhand: Bugleine dauert deutlich länger als Heckleine (Skipper muss nach vorn)', () => {
    const time = (cleat: string) => {
      const sim = setup('solo');
      expect(orderThrow(sim, cleat, bollardAt(sim, cleat))).toBeNull();
      expect(sim.lines.lines).toHaveLength(0);
      return runUntil(sim, () => sim.lines.lines.length > 0);
    };
    const stern = time('stern-p');
    const bow = time('bow-p');
    expect(stern).toBeGreaterThan(3);
    expect(stern).toBeLessThan(10);
    expect(bow).toBeGreaterThan(stern + 5);
  });

  it('Einhand: ohne Skipper am Ruder bleiben Gas und Ruder stehen, danach geht er zurück', () => {
    const sim = setup('solo');
    orderThrow(sim, 'bow-p', bollardAt(sim, 'bow-p'));
    runUntil(sim, () => !sim.crew.atHelm);
    sim.yacht.controls.throttle = 0.8;
    sim.yacht.controls.helm = 1;
    sim.yacht.controls.thruster = 1;
    sim.stepOnce();
    expect(sim.yacht.controls).toEqual({ throttle: 0, helm: 0, thruster: 0 });
    // Leine ausgebracht und gehalten: Skipper bleibt an der Leine …
    runUntil(sim, () => sim.lines.lines.length > 0);
    const id = sim.lines.lines[0].id;
    expect(sim.crew.attending).toBe(id);
    runUntil(sim, () => sim.crew.atHelm, 5);
    expect(sim.crew.atHelm).toBe(false);
    // … bis er zurück ans Ruder geht; die Leine wird dabei belegt
    sim.crew.returnToHelm();
    expect(sim.lines.lines[0].mode).toBe('cleated');
    runUntil(sim, () => sim.crew.atHelm);
    expect(sim.crew.atHelm).toBe(true);
    sim.yacht.controls.throttle = 0.3;
    sim.stepOnce();
    expect(sim.yacht.controls.throttle).toBe(0.3);
  });

  it('Einhand: Wurf geht daneben, wenn das Boot inzwischen zu weit weg ist', () => {
    const sim = setup('solo');
    orderThrow(sim, 'bow-p', bollardAt(sim, 'bow-p'));
    // Boot ist inzwischen vom Steg weggetrieben
    sim.yacht.state.pos.y -= 8;
    runUntil(sim, () => !sim.crew.busy, 40);
    expect(sim.lines.lines).toHaveLength(0);
    expect(sim.log.some((e) => e.text.includes('daneben'))).toBe(true);
  });
});

describe('Zwei Manöverleinen, Lenken aus dem Cockpit', () => {
  function twoSlips(mode: CrewMode, env = CALM) {
    const sim = setup(mode, env);
    const a = bollardAt(sim, 'bow-p');
    const b = bollardAt(sim, 'stern-p');
    expect(orderSlip(sim, 'bow-p', a, 'mid-p')).toBeNull();
    expect(orderSlip(sim, 'stern-p', b, 'mid-p')).toBeNull();
    runUntil(sim, () => !sim.crew.busy, 120);
    expect(sim.lines.slipCount).toBe(2);
    return sim;
  }

  it(`höchstens ${MAX_SLIP_LINES} Manöverleinen an Bord`, () => {
    const sim = twoSlips('crew');
    expect(orderSlip(sim, 'mid-p', bollardAt(sim, 'mid-p'), 'bow-p')).toMatch(/Manöverleinen/);
  });

  it('Regler fiert dosiert eine der beiden Leinen, die andere hält', () => {
    const sim = twoSlips('crew');
    for (const l of sim.lines.lines) orderLeadAft(sim, l.id, true);
    const pair = sim.lines.cockpitPair(sim.yacht)!;
    expect(pair).not.toBeNull();
    // Leinen dichtholen, dann Boot mit Maschine gegen die Leinen arbeiten lassen
    for (const l of pair) orderLine(sim, l.id, 'heave');
    runUntil(sim, () => false, 6);
    for (const l of pair) orderLine(sim, l.id, 'cleated');
    sim.yacht.controls.throttle = -0.35;
    runUntil(sim, () => false, 3);
    const len = () => pair.map((l) => l.length + l.slip!.length);
    const [l0, r0] = len();
    sim.lines.steer = 0.8; // rechte Leine fieren
    runUntil(sim, () => false, 5);
    const [l1, r1] = len();
    expect(r1 - r0).toBeGreaterThan(0.3);
    expect(Math.abs(l1 - l0)).toBeLessThan(0.05);
  });

  it('„beide fieren“ lässt beide Leinen gleich auslaufen, Lenken verschiebt den Anteil', () => {
    // ablandiger Wind (von Norden, Steg im Norden) belastet beide Leinen
    const sim = twoSlips('crew', { ...CALM, windSpeedKn: 15, windFromDeg: 0 });
    for (const l of sim.lines.lines) orderLeadAft(sim, l.id, true);
    const pair = sim.lines.cockpitPair(sim.yacht)!;
    for (const l of pair) orderLine(sim, l.id, 'heave');
    runUntil(sim, () => false, 6);
    for (const l of pair) orderLine(sim, l.id, 'cleated');
    runUntil(sim, () => false, 4);
    expect(Math.min(...pair.map((l) => l.tension))).toBeGreaterThan(100);
    const len = () => pair.map((l) => l.length + l.slip!.length);
    sim.lines.ease = 0.6;
    expect(sim.lines.cockpitEase()).toEqual([0.6, 0.6]);
    const [l0, r0] = len();
    runUntil(sim, () => false, 4);
    const [l1, r1] = len();
    expect(l1 - l0).toBeGreaterThan(0.3);
    expect(r1 - r0).toBeGreaterThan(0.3);
    expect(Math.abs(l1 - l0 - (r1 - r0))).toBeLessThan(0.5 * Math.max(l1 - l0, r1 - r0));
    sim.lines.steer = -0.3;
    const [a, b] = sim.lines.cockpitEase();
    expect(a).toBeCloseTo(0.9);
    expect(b).toBeCloseTo(0.3);
  });

  it('Einhand: ins Cockpit geführte Leinen bedient der Skipper vom Ruder aus', () => {
    const sim = twoSlips('solo');
    for (const l of sim.lines.lines) orderLeadAft(sim, l.id, true);
    runUntil(sim, () => !sim.crew.busy && sim.crew.atHelm, 120);
    expect(sim.lines.cockpitPair(sim.yacht)).not.toBeNull();
    // Leine fieren ohne das Ruder zu verlassen
    orderLine(sim, sim.lines.lines[0].id, 'ease');
    let left = false;
    runUntil(sim, () => {
      left ||= !sim.crew.atHelm;
      return !sim.crew.busy;
    });
    expect(left).toBe(false);
    expect(sim.lines.lines[0].mode).toBe('ease');
  });
});
