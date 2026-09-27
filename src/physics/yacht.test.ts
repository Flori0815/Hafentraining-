import { describe, expect, it } from 'vitest';
import { KN, bodyToWorld, type Vec2 } from './vec';
import { Yacht, foilForce } from './yacht';
import { LONG_KEEL_36, SAILING_YACHT_36, cloneConfig, validateConfig } from './yachtConfig';
import { LineSystem, type ShoreAnchor } from './lines';

const calm: Vec2 = { x: 0, y: 0 };
const DT = 1 / 240;

function run(y: Yacht, seconds: number, current: Vec2 = calm, wind: Vec2 = calm, each?: (t: number) => void) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    y.step(DT, current, wind, []);
    each?.(i * DT);
  }
}

describe('Konfiguration', () => {
  it('Presets sind gültig', () => {
    expect(validateConfig(SAILING_YACHT_36)).toEqual([]);
    expect(validateConfig(LONG_KEEL_36)).toEqual([]);
  });

  it('abgeleitete Kennwerte sind plausibel', () => {
    const y = new Yacht(SAILING_YACHT_36);
    const m = y.model;
    // Standschub eines 21-kW-Diesels mit 15"-Propeller: ca. 2 … 4 kN
    expect(m.bollardThrust).toBeGreaterThan(2000);
    expect(m.bollardThrust).toBeLessThan(4000);
    // Quer-Zusatzmasse in der Größenordnung der Verdrängung
    expect(m.m22 / m.mass).toBeGreaterThan(0.3);
    expect(m.m22 / m.mass).toBeLessThan(1.5);
  });
});

describe('Foil-Modell', () => {
  const p = new Yacht(SAILING_YACHT_36).model.rudder;
  it('Querkraft wirkt der Querbewegung entgegen – vorwärts und rückwärts', () => {
    expect(foilForce(2, 0.3, 1, p).fn).toBeLessThan(0);
    expect(foilForce(-2, 0.3, 1, p).fn).toBeLessThan(0);
    expect(foilForce(0, 1, 1, p).fn).toBeLessThan(0);
  });
});

describe('Antrieb', () => {
  it('Höchstfahrt voraus ca. 6–7.5 kn', () => {
    const y = new Yacht(SAILING_YACHT_36);
    y.controls.throttle = 1;
    run(y, 90);
    expect(y.sogKn).toBeGreaterThan(6);
    expect(y.sogKn).toBeLessThan(7.5);
  });

  it('eingekuppelt im Standgas ca. 2–3.5 kn', () => {
    const y = new Yacht(SAILING_YACHT_36);
    y.controls.throttle = 0.12;
    run(y, 120);
    expect(y.sogKn).toBeGreaterThan(2);
    expect(y.sogKn).toBeLessThan(3.5);
  });

  it('Aufstoppen: aus 4 kn in Neutral gleitet die Yacht weit (Massenträgheit)', () => {
    const y = new Yacht(SAILING_YACHT_36, { x: 0, y: 0 }, 0, 4);
    run(y, 30);
    // nach 30 s noch spürbare Fahrt und >2 Bootslängen Strecke
    expect(y.sogKn).toBeGreaterThan(0.5);
    expect(y.state.pos.y).toBeGreaterThan(2 * 11);
  });

  it('Schalten braucht Zeit (über Neutral)', () => {
    const y = new Yacht(SAILING_YACHT_36);
    y.controls.throttle = -0.5;
    y.step(DT, calm, calm, []);
    expect(y.state.gear).toBe(0);
    run(y, 2);
    expect(y.state.gear).toBe(-1);
  });
});

describe('Radeffekt', () => {
  it('rechtsdrehender Propeller: rückwärts geht das Heck nach Bb (Bug nach Stb)', () => {
    const y = new Yacht(SAILING_YACHT_36);
    y.controls.throttle = -0.6;
    run(y, 8);
    expect(y.state.u).toBeLessThan(0);
    expect(y.state.r).toBeGreaterThan(0.005);
  });

  it('linksdrehender Propeller: umgekehrt', () => {
    const cfg = cloneConfig(SAILING_YACHT_36);
    cfg.engine.propRotation = 'left';
    const y = new Yacht(cfg);
    y.controls.throttle = -0.6;
    run(y, 8);
    expect(y.state.r).toBeLessThan(-0.005);
  });
});

describe('Ruder', () => {
  it('Ruder Stb bei Fahrt voraus dreht nach Stb', () => {
    const y = new Yacht(SAILING_YACHT_36, { x: 0, y: 0 }, 0, 4);
    y.controls.throttle = 0.4;
    y.controls.helm = 1;
    run(y, 5);
    expect(y.state.r).toBeGreaterThan(0.05);
  });

  it('Radschlag: Ruder hart + kurzer Schub aus dem Stand dreht das Boot', () => {
    const y = new Yacht(SAILING_YACHT_36);
    y.controls.helm = -1;
    run(y, 1.5);
    y.controls.throttle = 0.8;
    run(y, 3);
    y.controls.throttle = 0;
    // deutliche Drehung nach Bb bei geringer Fahrt
    expect(y.state.r).toBeLessThan(-0.05);
    expect(y.sogKn).toBeLessThan(2.5);
  });

  it('Drehkreis mit Hartruder ca. 1.3–4 Bootslängen', () => {
    const y = new Yacht(SAILING_YACHT_36, { x: 0, y: 0 }, 0, 4);
    y.controls.throttle = 0.4;
    y.controls.helm = 1;
    let minX = Infinity;
    let maxX = -Infinity;
    run(y, 60, calm, calm, () => {
      minX = Math.min(minX, y.state.pos.x);
      maxX = Math.max(maxX, y.state.pos.x);
    });
    const d = maxX - minX;
    expect(d).toBeGreaterThan(1.3 * 11);
    expect(d).toBeLessThan(4 * 11);
  });

  it('Langkieler dreht bei gleicher Anfangsfahrt träger als Flossenkieler', () => {
    // Auslaufen mit Hartruder ohne Schraubenstrahl: Kursänderung pro Meter Weg
    const curvature = (cfg = SAILING_YACHT_36) => {
      const y = new Yacht(cfg, { x: 0, y: 0 }, 0, 4);
      y.controls.helm = 1;
      let d = 0;
      run(y, 10, calm, calm, () => (d += Math.hypot(y.state.u, y.state.v) * DT));
      return y.headingDeg / d;
    };
    expect(curvature(LONG_KEEL_36)).toBeLessThan(0.8 * curvature(SAILING_YACHT_36));
  });

  it('rückwärts: Ruder Stb bringt Heck nach Stb (Bug nach Bb)', () => {
    const y = new Yacht(SAILING_YACHT_36, { x: 0, y: 0 }, 0, -2.5);
    y.controls.throttle = -0.3;
    y.controls.helm = 1;
    run(y, 10);
    expect(y.state.r).toBeLessThan(0);
  });
});

describe('Wind und Strömung', () => {
  it('Wind querab: Boot treibt nach Lee, Bug fällt ab', () => {
    const y = new Yacht(SAILING_YACHT_36);
    // Wind aus West (weht nach Ost), Boot liegt nach Nord: Wind von Bb querab
    const wind = { x: 15 * KN, y: 0 };
    run(y, 30, calm, wind);
    expect(y.state.pos.x).toBeGreaterThan(3);
    // Bug fällt nach Lee (Ost = Stb) ab → Kurs wächst
    expect(y.headingDeg).toBeGreaterThan(10);
    expect(y.headingDeg).toBeLessThan(180);
  });

  it('Driftgeschwindigkeit bei 15 kn Wind querab realistisch (0.5–2 kn)', () => {
    const y = new Yacht(SAILING_YACHT_36, { x: 0, y: 0 }, 90);
    // Wind aus Nord → querab, Bug im Wind gehalten durch Ausgangslage
    const wind = { x: 0, y: -15 * KN };
    run(y, 20, calm, wind);
    const lateral = Math.hypot(y.state.u, y.state.v) / KN;
    expect(lateral).toBeGreaterThan(0.5);
    expect(lateral).toBeLessThan(2);
  });

  it('Strömung versetzt die treibende Yacht mit Strömungsgeschwindigkeit', () => {
    const y = new Yacht(SAILING_YACHT_36);
    const current = { x: 1 * KN, y: 0 };
    run(y, 240, current, calm);
    const vw = bodyToWorld({ x: y.state.u, y: y.state.v }, y.state.psi);
    expect(vw.x / KN).toBeGreaterThan(0.93);
    expect(vw.x / KN).toBeLessThan(1.01);
    expect(Math.abs(vw.y / KN)).toBeLessThan(0.1);
  });

  it('Fahrt durchs Wasser bleibt bei Strömung von vorn gleich, Fahrt über Grund sinkt', () => {
    const y1 = new Yacht(SAILING_YACHT_36);
    const y2 = new Yacht(SAILING_YACHT_36);
    y1.controls.throttle = 0.5;
    y2.controls.throttle = 0.5;
    run(y1, 60);
    run(y2, 60, { x: 0, y: -1 * KN }, calm);
    expect(y1.sogKn - y2.sogKn).toBeCloseTo(1, 1);
  });
});

describe('Leinen', () => {
  const anchor: ShoreAnchor = { id: 'p', kind: 'pile', pos: { x: 0, y: -5 }, label: 'Dalbe' };

  it('Leine nur innerhalb der Wurfweite', () => {
    const y = new Yacht(SAILING_YACHT_36);
    const ls = new LineSystem();
    expect(ls.attach(y, 'stern-p', anchor)).not.toBeNull();
    const far: ShoreAnchor = { ...anchor, id: 'q', pos: { x: 30, y: 0 } };
    expect(ls.attach(y, 'bow-p', far)).toBeNull();
  });

  it('zwei belegte Heckleinen halten das Boot gegen Motorschub', () => {
    const y = new Yacht(SAILING_YACHT_36);
    const ls = new LineSystem();
    const a: ShoreAnchor = { id: 'a', kind: 'pile', pos: y.toWorld({ x: -9, y: 0 }), label: '' };
    for (const c of ['stern-p', 'stern-s']) {
      const l = ls.attach(y, c, a)!;
      expect(l).not.toBeNull();
      ls.setMode(l.id, 'cleated');
    }
    y.controls.throttle = 0.4;
    for (let i = 0; i < 240 * 40; i++) {
      const f = ls.update(y, DT);
      y.step(DT, calm, calm, f);
    }
    // Boot steht in den Leinen, Leinen tragen den Schub
    expect(y.sogKn).toBeLessThan(0.1);
    const total = ls.lines.reduce((s, l) => s + l.tension, 0);
    expect(total).toBeGreaterThan(300);
    expect(Math.abs(y.headingDeg - 0) < 5 || Math.abs(y.headingDeg - 360) < 5).toBe(true);
  });

  it('Eindampfen in die Vorspring dreht das Heck vom Steg weg', () => {
    // Boot liegt längsseits, Steg an Stb (Osten), Kurs Nord
    const y = new Yacht(SAILING_YACHT_36, { x: 0, y: 0 }, 0, 0);
    const ls = new LineSystem();
    const mid = y.cleatWorld('mid-s')!;
    const springAnchor: ShoreAnchor = { id: 'k', kind: 'bollard', pos: { x: mid.x + 1.0, y: mid.y + 4 }, label: '' };
    const l = ls.attach(y, 'mid-s', springAnchor)!;
    ls.setMode(l.id, 'cleated');
    y.controls.throttle = 0.35;
    y.controls.helm = 1; // Ruder zum Steg: Heck geht vom Steg weg
    const stern0 = y.toWorld({ x: -5, y: 0 });
    for (let i = 0; i < 240 * 20; i++) {
      const f = ls.update(y, DT);
      y.step(DT, calm, calm, f);
    }
    const stern1 = y.toWorld({ x: -5, y: 0 });
    // Heck wandert nach Westen (weg vom Steg im Osten)
    expect(stern1.x - stern0.x).toBeLessThan(-1.5);
    expect(ls.lines.length).toBe(1);
  });

  it('von Hand gehaltene Leine rutscht bei zu hoher Last', () => {
    const y = new Yacht(SAILING_YACHT_36, { x: 0, y: 0 }, 0, 3);
    const ls = new LineSystem();
    const a: ShoreAnchor = { id: 'x', kind: 'pile', pos: { x: 0, y: -5 }, label: '' };
    const l = ls.attach(y, 'stern-p', a)!;
    const len0 = l.length;
    for (let i = 0; i < 240 * 5; i++) {
      const f = ls.update(y, DT);
      y.step(DT, calm, calm, f);
    }
    expect(ls.lines[0].length).toBeGreaterThan(len0 + 1);
    expect(ls.lines[0].tension).toBeLessThanOrEqual(ls.settings.handHoldForce + 1);
  });

  it('Fieren erzeugt wenig Zug, Halten viel', () => {
    // Boot läuft mit 1.5 kn von der Dalbe weg; maximaler Leinenzug je Modus
    const maxTension = (mode: 'hand' | 'ease') => {
      const y = new Yacht(SAILING_YACHT_36, { x: 0, y: 0 }, 0, 1.5);
      const ls = new LineSystem();
      const a: ShoreAnchor = { id: 'x', kind: 'pile', pos: { x: 0, y: -8 }, label: '' };
      const l = ls.attach(y, 'stern-p', a)!;
      ls.setMode(l.id, mode);
      let max = 0;
      for (let i = 0; i < 240 * 6; i++) {
        const f = ls.update(y, DT);
        y.step(DT, calm, calm, f);
        max = Math.max(max, ls.lines[0].tension);
      }
      return max;
    };
    const ease = maxTension('ease');
    const hold = maxTension('hand');
    expect(ease).toBeLessThanOrEqual(new LineSystem().settings.easeForce + 1);
    expect(hold).toBeGreaterThan(1000);
    expect(hold).toBeGreaterThan(5 * ease);
  });

  it('Dichtholen zieht das Boot gegen 15 kn Seitenwind heran', () => {
    // Kurs Nord, Wind aus West drückt nach Ost; Leine von Mitte Bb zu Klampe im Westen
    const y = new Yacht(SAILING_YACHT_36);
    const ls = new LineSystem();
    const mid = y.cleatWorld('mid-p')!;
    const a: ShoreAnchor = { id: 'k', kind: 'bollard', pos: { x: mid.x - 5, y: mid.y }, label: '' };
    const l = ls.attach(y, 'mid-p', a)!;
    ls.setMode(l.id, 'heave');
    const wind = { x: 15 * KN, y: 0 };
    for (let i = 0; i < 240 * 30; i++) {
      const f = ls.update(y, DT);
      y.step(DT, calm, wind, f);
    }
    const d = Math.hypot(y.cleatWorld('mid-p')!.x - a.pos.x, y.cleatWorld('mid-p')!.y - a.pos.y);
    expect(d).toBeLessThan(3);
  });
});
