/**
 * Gespeicherte Anleger-Ergebnisse (im Browser). Bestleistung je Szenario und
 * Liegeplatz: mehr Sterne zuerst, bei Gleichstand die kürzere Zeit.
 */
import type { ManeuverResult } from '../sim/simulation';
import { load, save } from './storage';

const KEY = 'results';
const MAX_RESULTS = 100;

export function loadResults(): ManeuverResult[] {
  const r = load<{ list: ManeuverResult[] }>(KEY, { list: [] }).list;
  return Array.isArray(r) ? r : [];
}

export function isBetter(a: ManeuverResult, b: ManeuverResult | undefined): boolean {
  if (!b) return true;
  return a.stars !== b.stars ? a.stars > b.stars : a.time < b.time;
}

export function bestFor(results: ManeuverResult[], scenarioId: string, berthId: string): ManeuverResult | undefined {
  let best: ManeuverResult | undefined;
  for (const r of results) {
    if (r.scenarioId === scenarioId && r.berthId === berthId && isBetter(r, best)) best = r;
  }
  return best;
}

/** Ergebnis speichern; gibt zurück, ob es eine neue Bestleistung ist. */
export function addResult(r: ManeuverResult): boolean {
  const list = loadResults();
  const newBest = isBetter(r, bestFor(list, r.scenarioId, r.berthId));
  list.push(r);
  save(KEY, { list: list.slice(-MAX_RESULTS) });
  return newBest;
}
