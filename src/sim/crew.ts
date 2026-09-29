/**
 * Besatzung: Mannschaft oder Einhand.
 *
 * Mit Mannschaft steht der Skipper am Ruder, die Crew ist an Deck verteilt
 * und führt Befehle (Leinen, Fender) praktisch sofort aus.
 *
 * Einhand muss der Skipper selbst an Deck: Er läuft zur Klampe bzw. Wurf-
 * stelle, arbeitet dort und kehrt ins Cockpit zurück. Solange er nicht am
 * Ruder steht, bleiben Gashebel und Ruder in ihrer letzten Stellung und das
 * Bugstrahlruder ist aus. Eine Leine, die er von Hand hält, holt oder
 * fiert, belegt er, bevor er weitergeht. Ins Cockpit geführte
 * Manöverleinen bedient er vom Ruder aus.
 */
import { dist, type Vec2 } from '../physics/vec';
import type { YachtControls } from '../physics/yacht';
import type { YachtModel } from '../physics/yachtModel';

export type CrewMode = 'crew' | 'solo';

export const CREW_MODE_LABEL: Record<CrewMode, string> = { crew: 'Mannschaft', solo: 'Einhand' };

/** Gehgeschwindigkeit an Deck (Leine in der Hand, Boot in Bewegung) [m/s] */
export const WALK_SPEED = 0.8;
/** So lange wartet der Skipper ohne Auftrag, bevor er ans Ruder zurückgeht [s] */
const IDLE_BEFORE_RETURN = 1;

export interface CrewStep {
  /** Arbeitsplatz (Body-System) oder 'helm' = Cockpit am Ruder */
  at: Vec2 | 'helm';
  /** Arbeitsdauer am Ort [s] */
  seconds: number;
  /** was der Skipper dort tut (Anzeige) */
  label: string;
  /** Prüfung am Ende des Schritts; Rückgabe = Fehlermeldung → Auftrag abgebrochen */
  check?: () => string | null;
}

export interface CrewJob {
  label: string;
  steps: CrewStep[];
  /** Ausführung am Ende des letzten Schritts; optional die Leine, die der Skipper danach in der Hand hat */
  run: () => { attend?: number } | void;
  /** Leine, auf die sich der Auftrag bezieht (hält der Skipper sie schon, wird sie nicht erst belegt) */
  lineId?: number;
}

export interface CrewHooks {
  log: (text: string, level: 'info' | 'warn') => void;
  /** Leine belegen, weil der Skipper sie loslässt; true, wenn sie gehalten wurde */
  secureLine: (id: number) => boolean;
}

/** Cockpit/Ruderstand: Mittschiffs, gut ein Fünftel der Länge vor dem Heck. */
export function helmPosition(model: YachtModel): Vec2 {
  const { loa, lcg } = model.cfg.hull;
  return { x: -loa / 2 + 0.22 * loa - lcg, y: 0 };
}

export class Crew {
  mode: CrewMode;
  readonly helm: Vec2;
  /** Skipper-Position (Body-System) */
  pos: Vec2;
  queue: CrewJob[] = [];
  private current: { job: CrewJob; step: number; phase: 'walk' | 'work'; left: number } | null = null;
  private returning = false;
  private idle = 0;
  /** Leine, die der Skipper gerade von Hand bedient */
  attending: number | null = null;
  /** Hebelstellung, als der Skipper das Ruder verlassen hat */
  private frozen: YachtControls | null = null;
  private hooks: CrewHooks;

  constructor(model: YachtModel, mode: CrewMode, hooks: CrewHooks) {
    this.mode = mode;
    this.helm = helmPosition(model);
    this.pos = { ...this.helm };
    this.hooks = hooks;
  }

  get atHelm(): boolean {
    return this.mode === 'crew' || dist(this.pos, this.helm) < 0.05;
  }

  /** Auftrag erteilen. Mit Mannschaft sofort ausgeführt, Einhand in die Warteschlange. */
  order(job: CrewJob): void {
    if (this.mode === 'crew') {
      for (const s of job.steps) {
        const err = s.check?.();
        if (err) {
          this.hooks.log(err, 'warn');
          return;
        }
      }
      job.run();
      return;
    }
    this.queue.push(job);
    this.returning = false;
  }

  /** Einhand: zurück ans Ruder (vorher gehaltene Leine belegen, Aufträge verwerfen). */
  returnToHelm(): void {
    if (this.mode === 'crew') return;
    this.queue = [];
    this.current = null;
    this.release();
    this.returning = true;
  }

  /** Aufträge in der Warteschlange und der laufende Auftrag. */
  get busy(): boolean {
    return !!this.current || this.queue.length > 0;
  }

  /** Was der Skipper gerade tut (Anzeige). */
  get activity(): string {
    if (this.mode === 'crew') return 'Mannschaft an Deck – Skipper am Ruder';
    const c = this.current;
    const more = this.queue.length ? ` · noch ${this.queue.length} Auftrag${this.queue.length > 1 ? 'e' : ''}` : '';
    if (c) {
      const s = c.job.steps[c.step];
      return c.phase === 'walk' ? `geht: ${c.job.label}${more}` : `${s.label} (${Math.ceil(c.left)} s)${more}`;
    }
    if (this.returning) return 'geht zurück ans Ruder';
    if (this.atHelm) return 'am Ruder';
    return this.attending !== null ? `hält Leine ${this.attending}` : 'an Deck';
  }

  private target(at: Vec2 | 'helm'): Vec2 {
    return at === 'helm' ? this.helm : at;
  }

  /** gehaltene Leine belegen, bevor der Skipper weggeht */
  private release(keep?: number): void {
    if (this.attending === null || this.attending === keep) return;
    if (this.hooks.secureLine(this.attending)) this.hooks.log(`Leine ${this.attending} belegt – Skipper geht weiter`, 'info');
    this.attending = null;
  }

  /** Einen Schritt Richtung Ziel gehen; true, wenn angekommen. */
  private walk(to: Vec2, dt: number): boolean {
    const d = dist(this.pos, to);
    const s = WALK_SPEED * dt;
    if (d <= s) {
      this.pos = { ...to };
      return true;
    }
    this.pos = { x: this.pos.x + ((to.x - this.pos.x) * s) / d, y: this.pos.y + ((to.y - this.pos.y) * s) / d };
    return false;
  }

  /**
   * Fortschritt der Aufträge; hält Ruder und Gas fest, solange der Skipper
   * nicht im Cockpit ist.
   */
  update(dt: number, controls: YachtControls): void {
    if (this.mode === 'crew') return;
    const wasAtHelm = this.atHelm;
    if (!this.current && this.queue.length) {
      const job = this.queue.shift()!;
      this.release(job.lineId);
      this.current = { job, step: 0, phase: 'walk', left: 0 };
      this.returning = false;
    }
    const c = this.current;
    if (c) {
      const step = c.job.steps[c.step];
      if (c.phase === 'walk') {
        if (this.walk(this.target(step.at), dt)) {
          c.phase = 'work';
          c.left = step.seconds;
        }
      } else {
        c.left -= dt;
        if (c.left <= 0) {
          const err = step.check?.();
          if (err) {
            this.hooks.log(err, 'warn');
            this.current = null;
          } else if (c.step + 1 < c.job.steps.length) {
            c.step++;
            c.phase = 'walk';
          } else {
            const r = c.job.run();
            this.attending = r && r.attend !== undefined ? r.attend : null;
            this.current = null;
          }
          this.idle = 0;
        }
      }
    } else if (!this.atHelm) {
      // ohne Auftrag zurück ans Ruder – außer er bedient gerade eine Leine
      if (this.attending === null) this.idle += dt;
      if (this.returning || this.idle >= IDLE_BEFORE_RETURN) {
        this.returning = true;
        if (this.walk(this.helm, dt)) {
          this.returning = false;
          this.idle = 0;
        }
      }
    }
    // Hebel bleiben stehen, solange niemand am Ruder ist
    if (wasAtHelm && !this.atHelm) this.frozen = { ...controls, thruster: 0 };
    if (!this.atHelm && this.frozen) Object.assign(controls, this.frozen);
    if (this.atHelm) this.frozen = null;
  }
}
