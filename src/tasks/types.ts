/**
 * Aufgaben-Format. Eine Aufgabe ist ein reiner Datensatz: Hafen, Liegeplatz,
 * Bedingungen, Startlage, Schwierigkeit, Einweisung. Neue Aufgaben werden in
 * `catalog.ts` ergänzt; `tasks.test.ts` prüft jede automatisch auf
 * Gültigkeit und grundsätzliche Lösbarkeit.
 */
import type { EnvironmentSettings } from '../physics/environment';
import type { FenderSide } from '../physics/fenders';
import type { Vec2 } from '../physics/vec';

/** 1 Einsteiger · 2 Leicht · 3 Mittel · 4 Schwer · 5 Experte */
export type Difficulty = 1 | 2 | 3 | 4 | 5;

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  1: 'Einsteiger',
  2: 'Leicht',
  3: 'Mittel',
  4: 'Schwer',
  5: 'Experte',
};

/**
 * Ausrichtung im Liegeplatz:
 *  - Box: `bowToPier` (vorwärts rein) oder `sternToPier` (rückwärts rein)
 *  - längsseits: `portSide` / `starboardSide` zum Steg
 */
export type Orientation = 'bowToPier' | 'sternToPier' | 'portSide' | 'starboardSide';

export const ORIENTATION_LABEL: Record<Orientation, string> = {
  bowToPier: 'Bug zum Steg',
  sternToPier: 'Heck zum Steg',
  portSide: 'Backbord zum Steg',
  starboardSide: 'Steuerbord zum Steg',
};

export type TaskGoal =
  /** Anlegen: im Liegeplatz festmachen (Leinen nach den Anforderungen des Liegeplatzes) */
  | { kind: 'moor'; berth: string; orientation?: Orientation }
  /** Ablegen: Boot liegt festgemacht in `berth`; alle Leinen los und in die Zielzone */
  | { kind: 'depart'; berth: string; zone: Vec2[]; zoneLabel: string };

export interface TaskDef {
  id: string;
  title: string;
  difficulty: Difficulty;
  /** Szenario-ID aus `SCENARIOS` */
  harbor: string;
  goal: TaskGoal;
  /** Einweisung / Tipp für den Skipper */
  briefing: string;
  /** Bedingungen; nicht angegebene Werte sind 0 (Flaute, keine Strömung) */
  env?: Partial<EnvironmentSettings>;
  /** abweichende Startlage (Standard: Start des Hafens) */
  start?: { pos: Vec2; headingDeg: number; speedKn: number };
  /**
   * Boot startet festgemacht im Ziel-Liegeplatz (für Ablegen): Lage und
   * Leinen berechnet die Simulation passend zur Yacht; längsseits hängen die
   * Fender auf der Stegseite. Alternative zu `start` + `initialLines`.
   */
  startMoored?: Orientation;
  /** Leinen, die zu Beginn belegt sind: [Klampe an Bord, Festpunkt-ID] */
  initialLines?: [string, string][];
  /** Fender, die zu Beginn schon hängen */
  fenders?: FenderSide[];
  /** Yacht-Vorlage (ID aus PRESETS); ohne Angabe die eigene Yacht */
  yacht?: string;
  tags?: string[];
}

/** Zielzone als Rechteck (Hilfsfunktion für Katalog-Einträge). */
export const zoneRect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Bedingungen einer Aufgabe vervollständigen (Standard: Flaute). */
export function taskEnv(task: TaskDef): EnvironmentSettings {
  let seed = 7;
  for (const ch of task.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    windSpeedKn: 0,
    windFromDeg: 0,
    gustiness: 0,
    windShiftDeg: 0,
    currentSpeedKn: 0,
    currentTowardDeg: 0,
    seed,
    ...task.env,
  };
}
