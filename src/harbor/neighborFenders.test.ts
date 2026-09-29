import { describe, expect, it } from 'vitest';
import { DEFAULT_ENV } from '../physics/environment';
import { SAILING_YACHT_36 } from '../physics/yachtConfig';
import { Simulation } from '../sim/simulation';
import { buildBoxengasse, buildLaengsseits } from './harbor';
import { fenderQualityFor, neighborFenders } from './neighborFenders';

const CALM = { ...DEFAULT_ENV, windSpeedKn: 0, gustiness: 0, currentSpeedKn: 0 };

describe('Fender der Nachbarboote', () => {
  const h = buildBoxengasse();
  const boxBoats = h.boats.filter((b) => b.inBox).length;

  it('leicht: drei Fender je Seite an jedem Boot in einer Box, nur Boxen', () => {
    expect(neighborFenders(h, 'good', 1)).toHaveLength(boxBoats * 6);
    const l = buildLaengsseits();
    // längsseits liegende Boote bekommen keine Boxen-Fender
    expect(neighborFenders(l, 'good', 1)).toHaveLength(l.boats.filter((b) => b.inBox).length * 6);
  });

  it('schwerer: weniger Fender, bei „poor“ meist an den Enden', () => {
    const good = neighborFenders(h, 'good', 3).length;
    const sparse = neighborFenders(h, 'sparse', 3).length;
    const poor = neighborFenders(h, 'poor', 3).length;
    expect(sparse).toBeLessThan(good * 0.5);
    expect(poor).toBeLessThan(good * 0.5);
    expect(neighborFenders(h, 'none', 3)).toHaveLength(0);
    // deterministisch je Seed
    expect(neighborFenders(h, 'sparse', 3)).toEqual(neighborFenders(h, 'sparse', 3));
  });

  it('Stufe → Qualität', () => {
    expect(fenderQualityFor(1)).toBe('good');
    expect(fenderQualityFor(2)).toBe('good');
    expect(fenderQualityFor(4)).toBe('sparse');
    expect(fenderQualityFor(5)).toBe('poor');
  });

  /** Yacht in Box Nord 10 langsam seitlich gegen das Boot in Box 11 schieben. */
  function pushIntoNeighbor(withFenders: boolean) {
    const sim = new Simulation(buildBoxengasse(), SAILING_YACHT_36, CALM);
    if (!withFenders) sim.collisions.soft = [];
    const st = sim.yacht.state;
    st.pos = { x: 40.0, y: -7.3 };
    st.psi = 0;
    st.u = st.r = 0;
    st.v = 0.25; // nach Stb (Osten), ca. 0,5 kn
    for (let i = 0; i < 240 * 3; i++) sim.stepOnce();
    return sim;
  }

  it('Kontakt über den Nachbarfender kostet bei langsamer Fahrt nichts', () => {
    const sim = pushIntoNeighbor(true);
    expect(sim.status.contacts).toBe(0);
    expect(sim.log.some((e) => e.text.includes('Fender an anderes Boot'))).toBe(true);
  });

  it('ohne Nachbarfender gibt es eine Berührung mit dem Rumpf', () => {
    const sim = pushIntoNeighbor(false);
    expect(sim.status.contacts).toBeGreaterThan(0);
  });
});
