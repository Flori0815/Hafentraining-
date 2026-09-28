import { describe, expect, it } from 'vitest';
import { BALL_FENDER, FenderSet, STD_FENDER } from './fenders';
import { pointInPolygon } from './vec';
import { buildYachtModel } from './yachtModel';
import { SAILING_YACHT_36 } from './yachtConfig';

const model = buildYachtModel(SAILING_YACHT_36);

describe('Fender', () => {
  it('Standardsatz: 4 je Seite, außen am Rumpf, anfangs verstaut', () => {
    const f = new FenderSet(model);
    expect(f.fenders.filter((x) => x.side === 'p')).toHaveLength(4);
    expect(f.fenders.filter((x) => x.side === 's')).toHaveLength(4);
    for (const x of f.fenders) {
      expect(pointInPolygon(x.pos, model.outline)).toBe(false);
      expect(Math.sign(x.pos.y)).toBe(x.side === 's' ? 1 : -1);
    }
    expect(f.colliders(0)).toHaveLength(0);
  });

  it('Ausbringen braucht Zeit: ein Fender pro Sekunde', () => {
    const f = new FenderSet(model);
    f.setSide('p', true, 10);
    expect(f.sideState('p', 10.5)).toEqual({ active: 0, out: 4, total: 4 });
    expect(f.sideState('p', 12.1).active).toBe(2);
    expect(f.sideState('p', 10 + 4 * STD_FENDER.secondsEach).active).toBe(4);
    expect(f.colliders(20)).toHaveLength(4);
    f.setSide('p', false, 21);
    expect(f.colliders(21)).toHaveLength(0);
  });

  it('Ballfender an der nächsten Rumpfstelle, außen anliegend; zu weit weg nicht möglich', () => {
    const f = new FenderSet(model);
    const bow = model.outline.reduce((a, b) => (b.x > a.x ? b : a));
    expect(f.placeBall(model, { x: bow.x + 0.5, y: 0.2 }, 0)).toBe(true);
    const b = f.ball!;
    expect(pointInPolygon(b.pos, model.outline)).toBe(false);
    expect(Math.hypot(b.pos.x - bow.x, b.pos.y - bow.y)).toBeLessThan(BALL_FENDER.r + 0.3);
    expect(f.colliders(1)).toHaveLength(0); // Crew bringt ihn noch
    expect(f.colliders(BALL_FENDER.seconds)).toHaveLength(1);
    expect(new FenderSet(model).placeBall(model, { x: 20, y: 0 }, 0)).toBe(false);
    f.removeBall();
    expect(f.ball).toBeNull();
  });
});
