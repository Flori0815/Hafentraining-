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

/** Bestleistung im freien Training (ohne Aufgaben-Ergebnisse). */
export function bestFor(results: ManeuverResult[], scenarioId: string, berthId: string): ManeuverResult | undefined {
  let best: ManeuverResult | undefined;
  for (const r of results) {
    if (!r.taskId && r.scenarioId === scenarioId && r.berthId === berthId && isBetter(r, best)) best = r;
  }
  return best;
}

/** Bestleistung einer Aufgabe. */
export function bestForTask(results: ManeuverResult[], taskId: string): ManeuverResult | undefined {
  let best: ManeuverResult | undefined;
  for (const r of results) {
    if (r.taskId === taskId && isBetter(r, best)) best = r;
  }
  return best;
}

/** Ergebnis speichern; gibt zurück, ob es eine neue Bestleistung ist. */
export function addResult(r: ManeuverResult): boolean {
  const list = loadResults();
  const newBest = isBetter(r, r.taskId ? bestForTask(list, r.taskId) : bestFor(list, r.scenarioId, r.berthId));
  list.push(r);
  // die letzten MAX_RESULTS Ergebnisse plus jede Bestleistung behalten
  const bestByKey = new Map<string, ManeuverResult>();
  for (const x of list) {
    const key = x.taskId ? `task:${x.taskId}` : `free:${x.scenarioId}|${x.berthId}`;
    if (isBetter(x, bestByKey.get(key))) bestByKey.set(key, x);
  }
  const keep = new Set<ManeuverResult>([...list.slice(-MAX_RESULTS), ...bestByKey.values()]);
  save(KEY, { list: list.filter((x) => keep.has(x)) });
  return newBest;
}
