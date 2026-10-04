import { describe, expect, it } from 'vitest';
import { PRESETS, PRODUCTION_YACHTS, validateConfig } from './yachtConfig';
import { kickTurn, propWalkAstern, runBench, turningCircle } from './validation';

const byId = (id: string) => PRESETS.find((p) => p.id === id)!;

describe('Prüfstand: alle Vorlagen liegen in den Referenzbereichen', () => {
  for (const cfg of PRESETS) {
    it(cfg.name, () => {
      expect(validateConfig(cfg)).toEqual([]);
      const { checks } = runBench(cfg);
      const off = checks.filter((c) => c.verdict !== 'ok').map((c) => `${c.id}=${c.value.toFixed(2)} ∉ [${c.range.join(', ')}]`);
      expect(off).toEqual([]);
    });
  }
});

describe('Prüfstand: Unterschiede zwischen Bauarten', () => {
  it('Langkieler dreht voraus weiter als Flossenkieler', () => {
    expect(turningCircle(byId('sy36-long')).tactical).toBeGreaterThan(1.25 * turningCircle(byId('sy36-fin')).tactical);
    expect(turningCircle(byId('westsail-32')).tactical / 9.75).toBeGreaterThan(turningCircle(byId('bavaria-cruiser-34')).tactical / 9.99);
  });

  it('Doppelruder: Gasstoß aus dem Stand dreht kaum, Einzelruder im Strahl deutlich', () => {
    const single = kickTurn(byId('bavaria-cruiser-34')).heading;
    const twin = kickTurn(byId('jeanneau-so-349')).heading;
    expect(single).toBeGreaterThan(15);
    expect(twin).toBeLessThan(0.4 * single);
  });

  it('Radeffekt: Welle stärker als Saildrive, Bug dreht rückwärts nach Stb (rechtsdrehend)', () => {
    const shaft = propWalkAstern(byId('hr-352'));
    const sail = propWalkAstern(byId('hanse-388'));
    expect(shaft).toBeGreaterThan(0);
    expect(sail).toBeGreaterThan(0);
    expect(shaft).toBeGreaterThan(2 * sail);
  });

  it('Serienyachten decken 30 bis 50 Fuß ab', () => {
    const ft = PRODUCTION_YACHTS.map((p) => p.hull.loa / 0.3048);
    expect(Math.min(...ft)).toBeLessThan(33);
    expect(Math.max(...ft)).toBeGreaterThan(44);
    expect(new Set(PRODUCTION_YACHTS.map((p) => p.keel.type)).size).toBeGreaterThanOrEqual(2);
    expect(PRODUCTION_YACHTS.some((p) => p.rudder.arrangement === 'twin')).toBe(true);
    expect(PRODUCTION_YACHTS.some((p) => p.engine.drive === 'shaft')).toBe(true);
  });
});
