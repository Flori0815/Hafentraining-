/**
 * Prüft JEDE Aufgabe im Katalog automatisch: Datenkonsistenz und
 * grundsätzliche Lösbarkeit (ein "Musterskipper" legt das Boot korrekt in den
 * Liegeplatz und belegt die geforderten Leinen). Neue Katalog-Einträge sind
 * damit ohne weiteren Test-Code abgesichert.
 */
import { describe, expect, it } from 'vitest';
import { SCENARIOS, buildScenario, type Berth } from '../harbor/harbor';
import { DEFAULT_ENV } from '../physics/environment';
import { pointInPolygon } from '../physics/vec';
import { PRESETS, SAILING_YACHT_36, cloneConfig } from '../physics/yachtConfig';
import { orientationOk } from '../sim/evaluation';
import { mooringPlan, pierSide, placeMoored } from '../sim/mooring';
import { Simulation } from '../sim/simulation';
import { TASKS, nextTask, tasksByDifficulty } from './catalog';
import { taskEnv, type Orientation, type TaskDef } from './types';

const CALM = { ...DEFAULT_ENV, windSpeedKn: 0, gustiness: 0, windShiftDeg: 0, currentSpeedKn: 0 };

function yachtFor(t: TaskDef) {
  return cloneConfig(PRESETS.find((p) => p.id === t.yacht) ?? SAILING_YACHT_36);
}

function newSim(t: TaskDef, env = taskEnv(t)) {
  const sim = new Simulation(buildScenario(t.harbor), yachtFor(t), env);
  sim.setTask(t, buildScenario(t.harbor), yachtFor(t), env);
  return sim;
}

function runFor(sim: Simulation, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 240); i++) sim.stepOnce();
}

describe('Aufgaben-Katalog', () => {
  it('rund 20 Aufgaben, eindeutige IDs, alle Schwierigkeitsstufen vertreten', () => {
    expect(TASKS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(TASKS.length);
    for (const d of [1, 2, 3, 4, 5]) expect(TASKS.some((t) => t.difficulty === d)).toBe(true);
    // gleich viele Ablege- wie Anlegeaufgaben
    const depart = TASKS.filter((t) => t.goal.kind === 'depart').length;
    expect(depart).toBe(TASKS.length - depart);
    const sorted = tasksByDifficulty();
    expect(sorted.map((t) => t.difficulty)).toEqual([...sorted.map((t) => t.difficulty)].sort());
    expect(nextTask(sorted[0].id)?.id).toBe(sorted[1].id);
    expect(nextTask(sorted[sorted.length - 1].id)).toBeUndefined();
  });
});

describe.each(TASKS.map((t) => [t.id, t] as const))('Aufgabe %s', (_id, t) => {
  it('Daten gültig: Hafen, Liegeplatz, Festpunkte, Yacht, Startlage', () => {
    expect(SCENARIOS.some((s) => s.id === t.harbor)).toBe(true);
    const h = buildScenario(t.harbor);
    const berth = h.berths.find((b) => b.id === t.goal.berth);
    expect(berth, `Liegeplatz ${t.goal.berth}`).toBeDefined();
    if (t.goal.kind === 'moor') expect(berth!.occupied).toBe(false);
    if (t.yacht) expect(PRESETS.some((p) => p.id === t.yacht)).toBe(true);
    expect(t.title.length).toBeGreaterThan(3);
    expect(t.briefing.length).toBeGreaterThan(20);
    const env = taskEnv(t);
    expect(env.windSpeedKn).toBeGreaterThanOrEqual(0);
    expect(env.windSpeedKn).toBeLessThanOrEqual(40);
    expect(env.currentSpeedKn).toBeLessThanOrEqual(3);

    const sim = newSim(t);
    // Startlage im Hafen und ohne Kollision
    const b = h.bounds;
    const p = sim.yacht.state.pos;
    expect(p.x > b.minX && p.x < b.maxX && p.y > b.minY && p.y < b.maxY).toBe(true);
    sim.collisions.update(sim.yacht);
    expect(sim.collisions.contacts.filter((c) => c.via === 'hull')).toHaveLength(0);
    // vorbelegte Leinen existieren und sind plausibel lang
    const planned = t.startMoored ? berth!.requirements.reduce((n, r) => n + r.count, 0) : 0;
    expect(sim.lines.lines).toHaveLength((t.initialLines?.length ?? 0) + planned);
    if (t.startMoored) expect(t.goal.kind).toBe('depart');
    for (const l of sim.lines.lines) expect(l.length).toBeLessThan(8);
    if (t.goal.kind === 'depart') {
      const zone = t.goal.zone;
      expect(zone.length).toBeGreaterThanOrEqual(3);
      expect(pointInPolygon(p, zone)).toBe(false);
      // Zielzone liegt auf freiem Wasser
      const c = zone.reduce((a, q) => ({ x: a.x + q.x / zone.length, y: a.y + q.y / zone.length }), { x: 0, y: 0 });
      expect(h.solids.some((s) => pointInPolygon(c, s.poly))).toBe(false);
    }
  });

  if (t.goal.kind === 'moor') {
    it('lösbar: korrekt ausgerichtet einlegen, Leinen dichtholen und belegen → festgemacht', () => {
      const sim = newSim(t, { ...CALM, seed: 1 });
      const berth = sim.targetBerth!;
      const o = t.goal.kind === 'moor' && t.goal.orientation ? t.goal.orientation : berth.kind === 'box' ? 'bowToPier' : 'portSide';
      placeInBerth(sim, berth, o);
      expect(orientationOk(o, berth, sim.yacht)).toBe(true);
      const ids = attachRequiredLines(sim, berth, o);
      ids.forEach((id) => sim.lines.setMode(id, 'heave'));
      runFor(sim, berth.kind === 'box' ? 4 : 2);
      ids.forEach((id) => sim.lines.setMode(id, 'cleated'));
      runFor(sim, 14);
      expect(sim.status.completed, `offen: ${sim.status.message}`).toBe(true);
      expect(sim.status.checklist.every((c) => c.done)).toBe(true);
      expect(sim.status.result).toMatchObject({ taskId: t.id, berthId: berth.id });
    });
  } else {
    it('lösbar: festgemacht gestartet, Leinen los, in der Zielzone → abgelegt', () => {
      const sim = newSim(t);
      // startet festgemacht: alle Anforderungen des Liegeplatzes erfüllt
      const berth = sim.targetBerth!;
      const need = berth.requirements.reduce((n, r) => n + r.count, 0);
      expect(sim.lines.lines.length).toBeGreaterThanOrEqual(need);
      runFor(sim, 3); // liegt ruhig in den Leinen, auch bei Wind
      expect(sim.status.hardContacts).toBe(0);
      expect(sim.status.completed).toBe(false);
      expect(sim.status.checklist.map((c) => c.done)).toEqual([false, false]);
      for (const l of [...sim.lines.lines]) sim.lines.release(l.id);
      const zone = t.goal.kind === 'depart' ? t.goal.zone : [];
      const c = zone.reduce((a, q) => ({ x: a.x + q.x / zone.length, y: a.y + q.y / zone.length }), { x: 0, y: 0 });
      Object.assign(sim.yacht.state, { pos: c, u: 0, v: 0, r: 0 });
      runFor(sim, 0.5);
      expect(sim.status.completed).toBe(true);
      expect(sim.status.result).toMatchObject({ taskId: t.id });
      expect(sim.status.checklist.every((c) => c.done)).toBe(true);
    });
  }
});

/** Boot mittig in den Liegeplatz legen, mit geforderter Ausrichtung. */
function placeInBerth(sim: Simulation, berth: Berth, o: Orientation) {
  placeMoored(sim.yacht, berth, o);
  if (berth.kind === 'alongside') sim.fenders.setSide(pierSide(o), true, -10);
}

/** Für jede Anforderung des Liegeplatzes eine passende Leine werfen (mit Wurfweiten-Prüfung). */
function attachRequiredLines(sim: Simulation, berth: Berth, o: Orientation): number[] {
  return mooringPlan(sim.yacht, sim.harbor, berth, o).map(([cleat, anchorId]) => {
    const anchor = sim.harbor.anchors.find((a) => a.id === anchorId)!;
    const l = sim.lines.attach(sim.yacht, cleat, anchor);
    expect(l, `${cleat} → ${anchorId} (Wurfweite)`).not.toBeNull();
    return l!.id;
  });
}
