/**
 * Befehle an Deck (Leinen, Fender). Sie laufen über die Besatzung: mit
 * Mannschaft sofort, Einhand muss der Skipper erst hingehen und arbeiten
 * (siehe `crew.ts`). Rückgabe: Fehlermeldung, wenn der Befehl gar nicht
 * möglich ist (für einen Hinweis in der Oberfläche), sonst null.
 */
import { BALL_FENDER, nearestHullPoint, type FenderSide } from '../physics/fenders';
import type { LineMode, MooringLine, ShoreAnchor } from '../physics/lines';
import { MAX_SLIP_LINES } from '../physics/lines';
import { worldToBody, type Vec2 } from '../physics/vec';
import type { CrewStep } from './crew';
import type { Simulation } from './simulation';

/** Arbeitszeiten Einhand [s] */
export const SOLO_SECONDS = {
  takeLine: 1.5,
  prepare: 4,
  throwLine: 2,
  leadSlip: 2.5,
  leadAft: 3,
  lineMode: 1,
  cockpitLineMode: 0.5,
  release: 1.5,
  haulSlip: 3,
  fendersSide: 6,
  ball: 4,
  ballRemove: 2,
};
/** Einhand darf der Wurf schon angesagt werden, wenn der Festpunkt bis zu so viel weiter weg ist [m] */
const SOLO_PLAN_AHEAD = 4;

const MODE_TEXT: Record<LineMode, string> = { hand: 'von Hand gehalten', heave: 'wird dichtgeholt', ease: 'wird gefiert', cleated: 'belegt' };
const MODE_WORK: Record<LineMode, string> = { hand: 'hält Leine', heave: 'holt dicht', ease: 'fiert', cleated: 'belegt' };

const solo = (sim: Simulation) => sim.crew.mode === 'solo';

function cleatPos(sim: Simulation, id: string): Vec2 {
  return sim.yacht.model.cleats.find((c) => c.id === id)?.pos ?? sim.crew.helm;
}

export function cleatName(sim: Simulation, id: string): string {
  return sim.yacht.model.cleats.find((c) => c.id === id)?.name ?? id;
}

/** Wurfstelle an Deck: Punkt der Bordkante, der dem Festpunkt am nächsten liegt (etwas binnenbords). */
function throwSpot(sim: Simulation, anchor: ShoreAnchor): Vec2 {
  const st = sim.yacht.state;
  const body = worldToBody({ x: anchor.pos.x - st.pos.x, y: anchor.pos.y - st.pos.y }, st.psi);
  const e = nearestHullPoint(sim.yacht.model.outline, body);
  return { x: e.p.x - e.n.x * 0.3, y: e.p.y - e.n.y * 0.3 };
}

function reachError(sim: Simulation, cleat: string, anchor: ShoreAnchor, slack = 0): string | null {
  const r = sim.lines.canReach(sim.yacht, cleat, anchor);
  if (r.distance > r.range + slack) {
    return `Zu weit: ${r.distance.toFixed(1)} m (${anchor.kind === 'ring' ? 'Reichweite' : 'Wurfweite'} ${r.range} m)`;
  }
  if (r.cleatDistance + 0.4 > sim.lines.settings.maxLength) {
    return `Leine zu kurz: ${r.cleatDistance.toFixed(1)} m ab Klampe (max. ${sim.lines.settings.maxLength} m)`;
  }
  return null;
}

/** Wurfschritt: zur Reling an der günstigsten Stelle, werfen; prüft die Reichweite beim Wurf. */
function throwStep(sim: Simulation, cleat: string, anchor: ShoreAnchor, what: string): CrewStep {
  return {
    at: throwSpot(sim, anchor),
    seconds: SOLO_SECONDS.throwLine,
    label: `wirft ${what} zu ${anchor.label}`,
    check: () => {
      const e = reachError(sim, cleat, anchor);
      return e ? `Wurf zu ${anchor.label} daneben – ${e}` : null;
    },
  };
}

/**
 * Wurf: Klampe → Festpunkt. Liegt an der Klampe eine vorbereitete Leine,
 * muss der Skipper nur noch zur Reling und werfen; eine vorbereitete
 * Manöverleine wird als Manöverleine ausgebracht.
 */
export function orderThrow(sim: Simulation, cleat: string, anchor: ShoreAnchor): string | null {
  const prep = sim.lines.preparedAt(cleat);
  if (prep?.slip) return orderSlip(sim, cleat, anchor, prep.slip.workCleatId);
  const pre = reachError(sim, cleat, anchor, solo(sim) ? SOLO_PLAN_AHEAD : 0);
  if (pre) {
    sim.addLog(`Wurf von ${cleatName(sim, cleat)} zu ${anchor.label}: ${pre}`, 'warn');
    return pre;
  }
  const steps: CrewStep[] = prep
    ? [throwStep(sim, cleat, anchor, 'vorbereitete Leine')]
    : [
        { at: cleatPos(sim, cleat), seconds: SOLO_SECONDS.takeLine, label: `belegt Leine auf ${cleatName(sim, cleat)}` },
        throwStep(sim, cleat, anchor, 'Leine'),
      ];
  sim.crew.order({
    label: `Leine von ${cleatName(sim, cleat)} zu ${anchor.label}`,
    steps,
    run: () => {
      const line = sim.lines.attach(sim.yacht, cleat, anchor);
      if (!line) return;
      const used = sim.lines.preparedAt(cleat);
      if (used && !used.slip) sim.lines.unprepare(used.id);
      const r = sim.lines.canReach(sim.yacht, cleat, anchor);
      sim.addLog(`Leine ${line.id}: ${cleatName(sim, cleat)} → ${anchor.label} (Wurf ${r.distance.toFixed(1)} m), von Hand gehalten`, 'info');
      sim.onLineAttached?.(line);
      return { attend: line.id };
    },
  });
  return null;
}

/**
 * Manöverleine: erste Klampe → Festpunkt → zweite Klampe. Ist sie an der
 * ersten Klampe schon vorbereitet (Holepart klar bzw. im Cockpit), bleibt
 * nur der Wurf.
 */
export function orderSlip(sim: Simulation, fixedCleat: string, anchor: ShoreAnchor, workCleat: string): string | null {
  if (fixedCleat === workCleat) return 'Zweite, andere Klampe wählen';
  const prep = sim.lines.preparedAt(fixedCleat);
  const ready = prep?.slip && prep.slip.workCleatId === workCleat ? prep : undefined;
  if (!ready && sim.lines.slipsInUse >= MAX_SLIP_LINES) return `Beide Manöverleinen sind schon in Gebrauch (${MAX_SLIP_LINES} an Bord)`;
  const pre = reachError(sim, fixedCleat, anchor, solo(sim) ? SOLO_PLAN_AHEAD : 0);
  if (pre) return pre;
  const failTooShort = () => `Manöverleine zu kurz (max. ${sim.lines.settings.slipMaxLength} m)`;
  const steps: CrewStep[] = ready
    ? [throwStep(sim, fixedCleat, anchor, 'vorbereitete Manöverleine')]
    : [
        { at: cleatPos(sim, fixedCleat), seconds: SOLO_SECONDS.takeLine, label: `belegt Manöverleine auf ${cleatName(sim, fixedCleat)}` },
        throwStep(sim, fixedCleat, anchor, 'Bucht'),
        { at: cleatPos(sim, workCleat), seconds: SOLO_SECONDS.leadSlip, label: `führt Holepart zu ${cleatName(sim, workCleat)}` },
      ];
  sim.crew.order({
    label: `Manöverleine ${cleatName(sim, fixedCleat)} → ${anchor.label} → ${cleatName(sim, workCleat)}`,
    steps,
    run: () => {
      const line = sim.lines.attachSlip(sim.yacht, fixedCleat, anchor, workCleat);
      if (!line) {
        sim.addLog(sim.lines.slipCount >= MAX_SLIP_LINES ? 'Keine Manöverleine mehr frei' : failTooShort(), 'warn');
        return;
      }
      const used = sim.lines.preparedAt(fixedCleat);
      const cockpit = !!(used?.slip && used.slip.workCleatId === workCleat && used.slip.cockpit);
      if (used?.slip) sim.lines.unprepare(used.id);
      if (cockpit) {
        // Holepart liegt schon auf der Winsch im Cockpit
        line.cockpit = true;
        line.mode = 'cleated';
      }
      sim.addLog(
        `Manöverleine ${line.id}: ${cleatName(sim, fixedCleat)} → ${anchor.label} → ${cockpit ? 'Cockpit' : cleatName(sim, workCleat)}, ${
          cockpit ? 'auf der Winsch belegt' : 'Holepart von Hand gehalten'
        }`,
        'info',
      );
      sim.onLineAttached?.(line);
      return cockpit ? undefined : { attend: line.id };
    },
  });
  return null;
}

// ---------------------------------------------------------------------------
// Leinen vorbereiten (solange das Ziel noch weit weg ist)
// ---------------------------------------------------------------------------
/** Mindestabstand zum Ziel-Liegeplatz, ab dem noch Zeit zum Vorbereiten ist [m] */
export const PREP_MIN_DISTANCE = 20;

/** Abstand zum Ziel-Liegeplatz (Mitte der Markierung) [m]. */
export function distanceToTarget(sim: Simulation): number {
  const b = sim.targetBerth;
  if (!b) return Infinity;
  const c = b.poly.reduce((a, q) => ({ x: a.x + q.x / b.poly.length, y: a.y + q.y / b.poly.length }), { x: 0, y: 0 });
  return Math.hypot(sim.yacht.state.pos.x - c.x, sim.yacht.state.pos.y - c.y);
}

/** Grund, warum gerade nicht vorbereitet werden kann (sonst null). */
export function prepBlocked(sim: Simulation): string | null {
  const d = distanceToTarget(sim);
  return d < PREP_MIN_DISTANCE ? `Zu nah am Ziel (${d.toFixed(0)} m) – Leinen vorbereiten nur ab ${PREP_MIN_DISTANCE} m Abstand` : null;
}

const tooLate = (sim: Simulation) => {
  const e = prepBlocked(sim);
  return e ? `Vorbereiten abgebrochen – ${e}` : null;
};

/** Festmacher an einer Klampe belegen und klar über die Reling legen. */
export function orderPrepare(sim: Simulation, cleat: string): string | null {
  const blocked = prepBlocked(sim);
  if (blocked) return blocked;
  if (sim.lines.preparedAt(cleat)) return `An ${cleatName(sim, cleat)} liegt schon eine Leine bereit`;
  sim.crew.order({
    label: `Leine an ${cleatName(sim, cleat)} vorbereiten`,
    steps: [{ at: cleatPos(sim, cleat), seconds: SOLO_SECONDS.prepare, label: `belegt Leine auf ${cleatName(sim, cleat)}, klar über die Reling`, check: () => tooLate(sim) }],
    run: () => {
      if (sim.lines.prepare(cleat)) sim.addLog(`Leine an ${cleatName(sim, cleat)} liegt bereit`, 'info');
    },
  });
  return null;
}

/** Manöverleine vorbereiten: feste Part an `fixedCleat` belegt, Holepart an `workCleat` klar. */
export function orderPrepareSlip(sim: Simulation, fixedCleat: string, workCleat: string): string | null {
  const blocked = prepBlocked(sim);
  if (blocked) return blocked;
  if (fixedCleat === workCleat) return 'Zweite, andere Klampe wählen';
  if (sim.lines.preparedAt(fixedCleat)) return `An ${cleatName(sim, fixedCleat)} liegt schon eine Leine bereit`;
  if (sim.lines.slipsInUse >= MAX_SLIP_LINES) return `Beide Manöverleinen sind schon in Gebrauch (${MAX_SLIP_LINES} an Bord)`;
  sim.crew.order({
    label: `Manöverleine ${cleatName(sim, fixedCleat)} / ${cleatName(sim, workCleat)} vorbereiten`,
    steps: [
      { at: cleatPos(sim, fixedCleat), seconds: SOLO_SECONDS.prepare, label: `belegt Manöverleine auf ${cleatName(sim, fixedCleat)}`, check: () => tooLate(sim) },
      { at: cleatPos(sim, workCleat), seconds: SOLO_SECONDS.leadSlip, label: `legt Holepart an ${cleatName(sim, workCleat)} klar`, check: () => tooLate(sim) },
    ],
    run: () => {
      if (sim.lines.prepare(fixedCleat, { workCleatId: workCleat })) {
        sim.addLog(`Manöverleine ${cleatName(sim, fixedCleat)} → ${cleatName(sim, workCleat)} liegt bereit`, 'info');
      }
    },
  });
  return null;
}

/** Holepart einer vorbereiteten Manöverleine schon ins Cockpit führen. */
export function orderPreparedLeadAft(sim: Simulation, id: number): string | null {
  const p = sim.lines.prepared.find((x) => x.id === id);
  if (!p?.slip || p.slip.cockpit) return null;
  const blocked = prepBlocked(sim);
  if (blocked) return blocked;
  sim.crew.order({
    label: `Manöverleine an ${cleatName(sim, p.cleatId)} ins Cockpit führen`,
    steps: [{ at: cleatPos(sim, p.slip.workCleatId), seconds: SOLO_SECONDS.leadAft, label: 'führt Holepart nach achtern', check: () => tooLate(sim) }],
    run: () => {
      const q = sim.lines.prepared.find((x) => x.id === id);
      if (!q?.slip) return;
      q.slip.cockpit = true;
      sim.addLog(`Vorbereitete Manöverleine an ${cleatName(sim, q.cleatId)}: Holepart liegt im Cockpit`, 'info');
    },
  });
  return null;
}

/** Vorbereitete Leine wieder wegstauen. */
export function orderUnprepare(sim: Simulation, id: number): void {
  const p = sim.lines.prepared.find((x) => x.id === id);
  if (!p) return;
  sim.crew.order({
    label: `Leine an ${cleatName(sim, p.cleatId)} wegstauen`,
    steps: [{ at: cleatPos(sim, p.cleatId), seconds: SOLO_SECONDS.release, label: 'staut Leine weg' }],
    run: () => {
      sim.lines.unprepare(id);
      sim.addLog(`Vorbereitete Leine an ${cleatName(sim, p.cleatId)} weggestaut`, 'info');
    },
  });
}

/** Wo die Holepart einer Leine bedient wird. */
function workStation(sim: Simulation, l: MooringLine): Vec2 | 'helm' {
  return l.cockpit ? 'helm' : cleatPos(sim, l.cleatId);
}

/** Leine halten / holen / fieren / belegen oder loswerfen. */
export function orderLine(sim: Simulation, id: number, act: LineMode | 'release'): void {
  const l = sim.lines.lines.find((x) => x.id === id);
  if (!l) return;
  const at = workStation(sim, l);
  if (act === 'release') {
    sim.crew.order({
      label: `${l.slip ? 'Manöverleine' : 'Leine'} ${id} los`,
      lineId: id,
      steps: [{ at, seconds: l.slip ? SOLO_SECONDS.haulSlip : SOLO_SECONDS.release, label: l.slip ? `holt Leine ${id} über Slip ein` : `wirft Leine ${id} los` }],
      run: () => {
        if (!sim.lines.lines.some((x) => x.id === id)) return;
        sim.lines.release(id);
        sim.addLog(l.slip ? `Manöverleine ${id} über Slip eingeholt` : `Leine ${id} losgeworfen`, 'info');
      },
    });
    return;
  }
  sim.crew.order({
    label: `Leine ${id}: ${MODE_TEXT[act]}`,
    lineId: id,
    steps: [{ at, seconds: l.cockpit ? SOLO_SECONDS.cockpitLineMode : SOLO_SECONDS.lineMode, label: `${MODE_WORK[act]} (Leine ${id})` }],
    run: () => {
      if (!sim.lines.lines.some((x) => x.id === id)) return;
      sim.lines.setMode(id, act);
      sim.addLog(`Leine ${id} ${MODE_TEXT[act]}`, 'info');
      // Hand, Holen, Fieren braucht jemanden an der Leine – außer im Cockpit
      return act !== 'cleated' && !l.cockpit ? { attend: id } : undefined;
    },
  });
}

/** Holepart einer Manöverleine an Deck nach achtern ins Cockpit führen (oder zurück an die Klampe). */
export function orderLeadAft(sim: Simulation, id: number, aft: boolean): void {
  const l = sim.lines.lines.find((x) => x.id === id);
  if (!l?.slip || !!l.cockpit === aft) return;
  sim.crew.order({
    label: aft ? `Manöverleine ${id} ins Cockpit führen` : `Manöverleine ${id} an die Klampe`,
    lineId: id,
    steps: [{ at: cleatPos(sim, l.cleatId), seconds: SOLO_SECONDS.leadAft, label: aft ? `führt Leine ${id} nach achtern` : `belegt Leine ${id} an der Klampe` }],
    run: () => {
      const line = sim.lines.lines.find((x) => x.id === id);
      if (!line) return;
      line.cockpit = aft;
      if (aft && line.mode !== 'cleated') line.mode = 'cleated';
      sim.addLog(aft ? `Manöverleine ${id} ins Cockpit geführt – Bedienung vom Ruder aus` : `Manöverleine ${id} wieder an der Klampe`, 'info');
    },
  });
}

/** Fender einer Seite ausbringen bzw. einholen. */
export function orderFenders(sim: Simulation, side: FenderSide): void {
  const out = sim.fenders.sideState(side, sim.time).out === 0;
  const name = side === 'p' ? 'Bb' : 'Stb';
  const beam = sim.yacht.model.cfg.hull.beam;
  sim.crew.order({
    label: `Fender ${name} ${out ? 'ausbringen' : 'einholen'}`,
    steps: [{ at: { x: 0, y: (side === 's' ? 1 : -1) * beam * 0.35 }, seconds: SOLO_SECONDS.fendersSide, label: `Fender ${name} ${out ? 'ausbringen' : 'einholen'}` }],
    run: () => {
      // Einhand hat der Skipper die Fender schon beim Arbeiten angesteckt
      sim.fenders.setSide(side, out, solo(sim) ? sim.time - 10 : sim.time);
      sim.addLog(`Fender ${name} ${out ? (solo(sim) ? 'hängen' : 'werden ausgebracht …') : 'eingeholt'}`, 'info');
    },
  });
}

/** Ballfender an die Rumpfstelle nahe `bodyPoint`; Fehlermeldung, wenn zu weit vom Rumpf. */
export function orderBall(sim: Simulation, bodyPoint: Vec2): string | null {
  const e = nearestHullPoint(sim.yacht.model.outline, bodyPoint);
  if (e.dist > 2.5) return 'Näher am Rumpf klicken';
  sim.crew.order({
    label: 'Ballfender setzen',
    steps: [{ at: { x: e.p.x - e.n.x * 0.3, y: e.p.y - e.n.y * 0.3 }, seconds: SOLO_SECONDS.ball, label: 'bringt Ballfender aus' }],
    run: () => {
      sim.fenders.placeBall(sim.yacht.model, bodyPoint, solo(sim) ? sim.time - BALL_FENDER.seconds : sim.time);
      sim.addLog(solo(sim) ? 'Ballfender hängt' : 'Ballfender wird ausgebracht …', 'info');
    },
  });
  return null;
}

export function orderBallRemove(sim: Simulation): void {
  const b = sim.fenders.ball;
  if (!b) return;
  sim.crew.order({
    label: 'Ballfender einholen',
    steps: [{ at: b.pos, seconds: SOLO_SECONDS.ballRemove, label: 'holt Ballfender ein' }],
    run: () => {
      if (!sim.fenders.ball) return;
      sim.fenders.removeBall();
      sim.addLog('Ballfender eingeholt', 'info');
    },
  });
}
