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

/** Wurf: Klampe → Festpunkt. */
export function orderThrow(sim: Simulation, cleat: string, anchor: ShoreAnchor): string | null {
  const pre = reachError(sim, cleat, anchor, solo(sim) ? SOLO_PLAN_AHEAD : 0);
  if (pre) {
    sim.addLog(`Wurf von ${cleatName(sim, cleat)} zu ${anchor.label}: ${pre}`, 'warn');
    return pre;
  }
  sim.crew.order({
    label: `Leine von ${cleatName(sim, cleat)} zu ${anchor.label}`,
    steps: [
      { at: cleatPos(sim, cleat), seconds: SOLO_SECONDS.takeLine, label: `belegt Leine auf ${cleatName(sim, cleat)}` },
      {
        at: throwSpot(sim, anchor),
        seconds: SOLO_SECONDS.throwLine,
        label: `wirft zu ${anchor.label}`,
        check: () => {
          const e = reachError(sim, cleat, anchor);
          return e ? `Wurf zu ${anchor.label} daneben – ${e}` : null;
        },
      },
    ],
    run: () => {
      const line = sim.lines.attach(sim.yacht, cleat, anchor);
      if (!line) return;
      const r = sim.lines.canReach(sim.yacht, cleat, anchor);
      sim.addLog(`Leine ${line.id}: ${cleatName(sim, cleat)} → ${anchor.label} (Wurf ${r.distance.toFixed(1)} m), von Hand gehalten`, 'info');
      sim.onLineAttached?.(line);
      return { attend: line.id };
    },
  });
  return null;
}

/** Manöverleine: erste Klampe → Festpunkt → zweite Klampe. */
export function orderSlip(sim: Simulation, fixedCleat: string, anchor: ShoreAnchor, workCleat: string): string | null {
  if (fixedCleat === workCleat) return 'Zweite, andere Klampe wählen';
  if (sim.lines.slipCount >= MAX_SLIP_LINES) return `Beide Manöverleinen sind schon ausgebracht (${MAX_SLIP_LINES} an Bord)`;
  const pre = reachError(sim, fixedCleat, anchor, solo(sim) ? SOLO_PLAN_AHEAD : 0);
  if (pre) return pre;
  const failTooShort = () => `Manöverleine zu kurz (max. ${sim.lines.settings.slipMaxLength} m)`;
  const steps: CrewStep[] = [
    { at: cleatPos(sim, fixedCleat), seconds: SOLO_SECONDS.takeLine, label: `belegt Manöverleine auf ${cleatName(sim, fixedCleat)}` },
    {
      at: throwSpot(sim, anchor),
      seconds: SOLO_SECONDS.throwLine,
      label: `wirft Bucht über ${anchor.label}`,
      check: () => {
        const e = reachError(sim, fixedCleat, anchor);
        return e ? `Manöverleine: Wurf zu ${anchor.label} daneben – ${e}` : null;
      },
    },
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
      sim.addLog(
        `Manöverleine ${line.id}: ${cleatName(sim, fixedCleat)} → ${anchor.label} → ${cleatName(sim, workCleat)}, Holepart von Hand gehalten`,
        'info',
      );
      sim.onLineAttached?.(line);
      return { attend: line.id };
    },
  });
  return null;
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
