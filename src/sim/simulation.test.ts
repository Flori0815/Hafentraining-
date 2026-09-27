import { describe, expect, it } from 'vitest';
import { buildBoxengasse, buildLaengsseits, buildScenario, boatOutline } from '../harbor/harbor';
import { DEFAULT_ENV } from '../physics/environment';
import { KN } from '../physics/vec';
import { SAILING_YACHT_36 } from '../physics/yachtConfig';
import { pointInPolygon } from '../physics/vec';
import { classifyLine, starRating } from './evaluation';
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

/** Leinen ausbringen, dichtholen und belegen – wie im Spiel. */
function moor(sim: Simulation, pairs: [string, string][], heave = true, heaveSeconds = 4) {
  const ids = pairs.map(([c, a]) => {
    const anchor = sim.harbor.anchors.find((x) => x.id === a);
    expect(anchor, a).toBeDefined();
    const l = sim.lines.attach(sim.yacht, c, anchor!);
    expect(l, `${c} → ${a}`).not.toBeNull();
    return l!.id;
  });
  if (heave) {
    ids.forEach((id) => sim.lines.setMode(id, 'heave'));
    runFor(sim, heaveSeconds);
  }
  ids.forEach((id) => sim.lines.setMode(id, 'cleated'));
  return ids;
}

const BOX_LINES: [string, string][] = [
  ['bow-p', 'cleat-n10a'],
  ['bow-s', 'cleat-n10b'],
  ['stern-p', 'pile-n9'],
  ['stern-s', 'pile-n10'],
];

/** Poller am Längsseits-Steg, der x am nächsten liegt. */
function bollardNear(sim: Simulation, x: number): string {
  const b = sim.harbor.anchors.filter((a) => a.id.startsWith('bollard-'));
  return b.reduce((best, a) => (Math.abs(a.pos.x - x) < Math.abs(best.pos.x - x) ? a : best)).id;
}

describe('Häfen', () => {
  it('Boxengasse: freie Zielbox mit Dalben und Stegklampen', () => {
    const h = buildBoxengasse();
    const target = h.berths.find((b) => b.id === h.defaultTarget)!;
    expect(target.occupied).toBe(false);
    const [pier, pile] = target.requirements;
    expect(pile.anchors.every((id) => h.anchors.some((a) => a.id === id && a.kind === 'pile'))).toBe(true);
    expect(pier.anchors.every((id) => h.anchors.some((a) => a.id === id && a.kind === 'bollard'))).toBe(true);
  });

  it('Längsseits: Lücken sind frei, 18 m und 14 m lang, mit Pollern', () => {
    const h = buildLaengsseits();
    const gaps = h.berths.filter((b) => b.kind === 'alongside');
    expect(gaps.map((g) => Math.max(...g.poly.map((p) => p.x)) - Math.min(...g.poly.map((p) => p.x)))).toEqual([18, 14]);
    for (const g of gaps) {
      // kein fremdes Boot ragt in die Lücke
      // (Punkte genau auf der Lückenkante zählen nicht: Nachbarboote enden dort)
      const xs = g.poly.map((p) => p.x);
      const [x0, x1] = [Math.min(...xs) + 0.01, Math.max(...xs) - 0.01];
      for (const b of h.boats) expect(boatOutline(b).some((p) => p.x > x0 && p.x < x1 && pointInPolygon(p, g.poly))).toBe(false);
      expect(g.requirements.map((r) => r.role)).toEqual(['bowLine', 'sternLine', 'fwdSpring', 'aftSpring']);
      expect(g.requirements[0].anchors.length).toBeGreaterThanOrEqual(6);
    }
    expect(h.berths.some((b) => b.id === h.defaultTarget && !b.occupied)).toBe(true);
  });

  it('Szenario-Register liefert beide Häfen', () => {
    expect(buildScenario('laengsseits').id).toBe('laengsseits');
    expect(buildScenario('unbekannt').id).toBe('boxengasse');
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
  it('Sterne: 3 ohne Kontakt, 2 mit leichter Berührung, 1 mit hartem Kontakt', () => {
    expect(starRating(0, 0)).toBe(3);
    expect(starRating(2, 0)).toBe(2);
    expect(starRating(3, 1)).toBe(1);
  });

  it('Box: 4 Leinen dichtgeholt und belegt → nach 5 s ruhig festgemacht, mit Ergebnis', () => {
    const sim = new Simulation(buildBoxengasse(), SAILING_YACHT_36, CALM);
    sim.reset();
    place(sim, 39.9, -6.7, 0);
    moor(sim, BOX_LINES);
    runFor(sim, 3);
    expect(sim.status.completed).toBe(false); // noch keine 5 s ruhig
    runFor(sim, 6);
    expect(sim.status.completed).toBe(true);
    expect(sim.status.contacts).toBe(0);
    const r = sim.status.result!;
    expect(r).toMatchObject({ scenarioId: 'boxengasse', berthId: 'box-n10', stars: 3, contacts: 0 });
  });

  it('Box: belegte, aber durchhängende Leinen reichen nicht', () => {
    const sim = new Simulation(buildBoxengasse(), SAILING_YACHT_36, CALM);
    sim.reset();
    place(sim, 39.9, -6.7, 0);
    moor(sim, BOX_LINES, false);
    runFor(sim, 8);
    expect(sim.status.completed).toBe(false);
    expect(sim.status.message).toContain('hängt durch');
  });

  it('nicht festgemacht, solange die Maschine eingekuppelt ist', () => {
    const sim = new Simulation(buildBoxengasse(), SAILING_YACHT_36, CALM);
    sim.reset();
    place(sim, 39.9, -6.7, 0);
    moor(sim, BOX_LINES);
    sim.yacht.controls.throttle = -0.2;
    runFor(sim, 8);
    expect(sim.status.completed).toBe(false);
    expect(sim.status.message).toContain('Maschine auskuppeln');
  });

  it('Längsseits: Leinen werden als Vorleine, Achterleine und Springs erkannt', () => {
    const sim = new Simulation(buildLaengsseits(), SAILING_YACHT_36, CALM);
    sim.reset();
    place(sim, 29, -2.05, 90); // Kurs Ost, Steg an Bb
    const at = (c: string, x: number) => sim.lines.attach(sim.yacht, c, sim.harbor.anchors.find((a) => a.id === bollardNear(sim, x))!)!;
    expect(classifyLine('alongside', sim.yacht, at('bow-p', 36))).toBe('bowLine');
    expect(classifyLine('alongside', sim.yacht, at('stern-p', 22))).toBe('sternLine');
    expect(classifyLine('alongside', sim.yacht, at('mid-p', 26))).toBe('fwdSpring');
    expect(classifyLine('alongside', sim.yacht, at('stern-p', 29))).toBe('aftSpring');
    expect(classifyLine('alongside', sim.yacht, at('bow-p', 29))).toBe('fwdSpring');
  });

  it('Längsseits: mit Vor-/Achterleine und beiden Springs festgemacht', () => {
    const sim = new Simulation(buildLaengsseits(), SAILING_YACHT_36, CALM);
    sim.reset();
    expect(sim.targetBerthId).toBe('gap-a');
    place(sim, 29, -2.05, 90);
    moor(sim, [
      ['bow-p', bollardNear(sim, 36)],
      ['stern-p', bollardNear(sim, 22)],
      ['mid-p', bollardNear(sim, 26)],
      ['stern-p', bollardNear(sim, 29)],
    ], true, 2); // nur die Lose herausnehmen, nicht gegen den Steg ziehen
    runFor(sim, 12);
    expect(sim.status.completed).toBe(true);
    const r = sim.status.result!;
    expect(r).toMatchObject({ scenarioId: 'laengsseits', berthId: 'gap-a', hardContacts: 0 });
    expect(r.stars).toBe(starRating(r.contacts, r.hardContacts));
  });

  it('Längsseits: ohne Springs nicht festgemacht', () => {
    const sim = new Simulation(buildLaengsseits(), SAILING_YACHT_36, CALM);
    sim.reset();
    place(sim, 29, -2.05, 90);
    moor(sim, [
      ['bow-p', bollardNear(sim, 36)],
      ['stern-p', bollardNear(sim, 22)],
    ]);
    runFor(sim, 8);
    expect(sim.status.completed).toBe(false);
    expect(sim.status.message).toContain('Vorspring ausbringen');
    expect(sim.status.message).toContain('Achterspring ausbringen');
  });

  it('Szenario wechseln setzt Hafen, Hindernisse und Ziel', () => {
    const sim = new Simulation(buildBoxengasse(), SAILING_YACHT_36, CALM);
    sim.setHarbor(buildLaengsseits(), 'gap-b');
    expect(sim.harbor.id).toBe('laengsseits');
    expect(sim.targetBerthId).toBe('gap-b');
    expect(sim.collisions.polygons.length).toBe(sim.harbor.solids.length);
    sim.setHarbor(buildBoxengasse(), 'gap-b');
    expect(sim.targetBerthId).toBe('box-n10');
  });
});
