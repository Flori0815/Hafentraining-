import { describe, expect, it } from 'vitest';
import { buildBoxengasse } from '../harbor/harbor';
import { DEFAULT_ENV } from '../physics/environment';
import { KN } from '../physics/vec';
import { SAILING_YACHT_36 } from '../physics/yachtConfig';
import { Simulation } from './simulation';

const CALM = { ...DEFAULT_ENV, windSpeedKn: 0, gustiness: 0, currentSpeedKn: 0 };

function place(sim: Simulation, x: number, y: number, headingDeg: number, speedKn = 0) {
  const st = sim.yacht.state;
  st.pos = { x, y };
  st.psi = (headingDeg * Math.PI) / 180;
  st.u = speedKn * KN;
  st.v = 0;
  st.r = 0;
}

function runFor(sim: Simulation, seconds: number) {
  const n = Math.round(seconds * 240);
  for (let i = 0; i < n; i++) sim.stepOnce();
}

describe('Hafen Boxengasse', () => {
  it('hat freie Zielbox mit Dalben und Stegklampen', () => {
    const h = buildBoxengasse();
    const target = h.berths.find((b) => b.id === h.defaultTarget)!;
    expect(target.occupied).toBe(false);
    expect(target.pileAnchors.every((id) => h.anchors.some((a) => a.id === id && a.kind === 'pile'))).toBe(true);
    expect(target.pierAnchors.every((id) => h.anchors.some((a) => a.id === id && a.kind === 'bollard'))).toBe(true);
  });
});

describe('Kollisionen', () => {
  it('Boot fährt mit 2 kn gegen den Steg: Kontakt, kein Durchdringen, harter Kontakt gezählt', () => {
    const sim = new Simulation(buildBoxengasse(), SAILING_YACHT_36, CALM);
    sim.reset();
    place(sim, 39.9, -8, 0, 2);
    let maxBowY = -Infinity;
    for (let i = 0; i < 240 * 6; i++) {
      sim.stepOnce();
      const bow = sim.yacht.toWorld({ x: SAILING_YACHT_36.hull.loa / 2 - SAILING_YACHT_36.hull.lcg, y: 0 });
      maxBowY = Math.max(maxBowY, bow.y);
    }
    expect(sim.status.contacts).toBeGreaterThan(0);
    expect(sim.status.hardContacts).toBeGreaterThan(0);
    // Stegkante bei y = 0: höchstens wenige Zentimeter Eindrückung (Fender/Scheuerleiste)
    expect(maxBowY).toBeLessThan(0.15);
    expect(sim.yacht.sogKn).toBeLessThan(1);
  });

  it('Boot treibt seitlich gegen eine Dalbe und bleibt davor hängen', () => {
    const sim = new Simulation(buildBoxengasse(), SAILING_YACHT_36, CALM);
    sim.reset();
    // quer zur Dalbenreihe, bewegt sich nach Norden auf Dalbe N5 (x = 21, y = -13.5) zu
    const st = sim.yacht.state;
    place(sim, 21, -15.9, 90);
    st.v = -0.6; // Body-y (Stb) zeigt bei Kurs 090 nach Süden → -0.6 = nach Norden
    runFor(sim, 5);
    expect(sim.collisions.contacts.length + sim.status.contacts).toBeGreaterThan(0);
    // Rumpf hat die Dalbe nicht "überfahren"
    expect(sim.yacht.state.pos.y).toBeLessThan(-13.5);
  });
});

describe('Bewertung', () => {
  it('festgemacht mit 2 Bug- und 2 Heckleinen in der Zielbox', () => {
    const sim = new Simulation(buildBoxengasse(), SAILING_YACHT_36, CALM);
    sim.reset();
    place(sim, 39.9, -6.7, 0);
    const pairs: [string, string][] = [
      ['bow-p', 'cleat-n10a'],
      ['bow-s', 'cleat-n10b'],
      ['stern-p', 'pile-n9'],
      ['stern-s', 'pile-n10'],
    ];
    for (const [c, a] of pairs) {
      const anchor = sim.harbor.anchors.find((x) => x.id === a)!;
      const l = sim.lines.attach(sim.yacht, c, anchor);
      expect(l, `${c} → ${a}`).not.toBeNull();
      sim.lines.setMode(l!.id, 'cleated');
    }
    runFor(sim, 5);
    expect(sim.status.completed).toBe(true);
    expect(sim.status.contacts).toBe(0);
  });

  it('nicht festgemacht, solange die Maschine eingekuppelt ist', () => {
    const sim = new Simulation(buildBoxengasse(), SAILING_YACHT_36, CALM);
    sim.reset();
    place(sim, 39.9, -6.7, 0);
    for (const [c, a] of [
      ['bow-p', 'cleat-n10a'],
      ['bow-s', 'cleat-n10b'],
      ['stern-p', 'pile-n9'],
      ['stern-s', 'pile-n10'],
    ]) {
      const l = sim.lines.attach(sim.yacht, c, sim.harbor.anchors.find((x) => x.id === a)!)!;
      sim.lines.setMode(l.id, 'cleated');
    }
    sim.yacht.controls.throttle = -0.2;
    runFor(sim, 6);
    expect(sim.status.completed).toBe(false);
    expect(sim.status.message).toContain('Maschine auskuppeln');
  });
});
