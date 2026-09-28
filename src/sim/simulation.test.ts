import { describe, expect, it } from 'vitest';
import { buildBoxengasse, buildLaengsseits, buildScenario, boatOutline } from '../harbor/harbor';
import { DEFAULT_ENV } from '../physics/environment';
import { KN } from '../physics/vec';
import { SAILING_YACHT_36 } from '../physics/yachtConfig';
import { pointInPolygon } from '../physics/vec';
import { classifyLine, rateContact, starRating } from './evaluation';
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

describe('Fender und Kontaktwertung', () => {
  it('Wertungsregeln: Fender bis 0,6 kn frei, Dalbe bis 0,3 kn, Rumpf an Steg ab 0,1 kn', () => {
    expect(rateContact('fender', 'pier', 0.5)).toBe('free');
    expect(rateContact('fender', 'pier', 0.9)).toBe('light');
    expect(rateContact('fender', 'boat', 1.5)).toBe('hard');
    expect(rateContact('hull', 'pile', 0.25)).toBe('free');
    expect(rateContact('hull', 'pile', 0.4)).toBe('light');
    expect(rateContact('hull', 'pier', 0.15)).toBe('light');
    expect(rateContact('hull', 'boat', 0.6)).toBe('hard');
  });

  /** Längsseits: Boot treibt mit 0.5 kn seitlich (nach Bb) an den Steg. */
  function driftOntoPier(fendersOut: boolean) {
    const sim = new Simulation(buildLaengsseits(), SAILING_YACHT_36, CALM);
    sim.reset();
    place(sim, 29, -2.3, 90); // Kurs Ost, Steg an Bb, Rumpf ca. 0.5 m vom Steg
    if (fendersOut) {
      sim.fenders.setSide('p', true, 0);
      sim.time = 5; // Crew hat die Fender schon ausgebracht
    }
    sim.yacht.state.v = -0.5 * KN; // nach Bb
    let hullTouched = false;
    let fenderTouched = false;
    for (let i = 0; i < 240 * 6; i++) {
      sim.stepOnce();
      if (sim.collisions.contacts.some((c) => c.via === 'hull')) hullTouched = true;
      if (sim.collisions.contacts.some((c) => c.via === 'fender')) fenderTouched = true;
    }
    return { sim, hullTouched, fenderTouched };
  }

  it('mit Fendern: Boot liegt am Fender, Rumpf berührt den Steg nicht, kein Abzug', () => {
    const { sim, hullTouched, fenderTouched } = driftOntoPier(true);
    expect(fenderTouched).toBe(true);
    expect(hullTouched).toBe(false);
    expect(sim.status.contacts).toBe(0);
    expect(sim.log.some((l) => l.text.startsWith('Fender an Steg'))).toBe(true);
  });

  it('ohne Fender: derselbe Drift ist eine Berührung', () => {
    const { sim, hullTouched } = driftOntoPier(false);
    expect(hullTouched).toBe(true);
    expect(sim.status.contacts).toBe(1);
    expect(sim.status.hardContacts).toBe(0);
  });

  it('langsamer Kontakt mit einer Dalbe kostet nichts, schneller schon', () => {
    const run = (vKn: number) => {
      const sim = new Simulation(buildBoxengasse(), SAILING_YACHT_36, CALM);
      sim.reset();
      place(sim, 21, -15.95, 90);
      sim.yacht.state.v = -vKn * KN; // nach Norden auf Dalbe N5
      runFor(sim, 5);
      return sim;
    };
    const slow = run(0.25);
    expect(slow.status.maxImpactKn).toBeGreaterThan(0.05);
    expect(slow.status.contacts).toBe(0);
    expect(slow.log.some((l) => l.text.includes('Dalbe sanft berührt'))).toBe(true);
    const fast = run(1.2);
    expect(fast.status.contacts).toBeGreaterThan(0);
  });

  it('Ballfender am Bug fängt eine langsame Bugberührung am Steg ab', () => {
    const run = (ball: boolean) => {
      const sim = new Simulation(buildBoxengasse(), SAILING_YACHT_36, CALM);
      sim.reset();
      place(sim, 39.9, -7.2, 0, 0.5);
      if (ball) {
        const m = sim.yacht.model;
        const bow = m.outline.reduce((a, b) => (b.x > a.x ? b : a));
        expect(sim.fenders.placeBall(m, bow, 0)).toBe(true);
        sim.time = 5;
      }
      let hull = false;
      for (let i = 0; i < 240 * 6; i++) {
        sim.stepOnce();
        if (sim.collisions.contacts.some((c) => c.via === 'hull')) hull = true;
      }
      return { sim, hull };
    };
    const without = run(false);
    expect(without.hull).toBe(true);
    expect(without.sim.status.contacts).toBeGreaterThan(0);
    const withBall = run(true);
    expect(withBall.hull).toBe(false);
    expect(withBall.sim.status.contacts).toBe(0);
  });
});
