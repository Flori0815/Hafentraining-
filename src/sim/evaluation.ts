/**
 * Bewertung des Festmachens: Welche Aufgabe hat eine Leine (Vorleine,
 * Spring, …), sind die geforderten Leinen belegt und stramm, und wie gut
 * war das Manöver.
 */
import type { Berth, LineRequirement, LineRole } from '../harbor/harbor';
import type { MooringLine } from '../physics/lines';
import { dot, worldToBody } from '../physics/vec';
import type { Orientation } from '../tasks/types';
import type { Yacht } from '../physics/yacht';

/** Leine gilt als stramm, wenn sie höchstens so viel Lose hat [m]. */
export const TAUT_MAX_SLACK = 0.2;
/** So lange muss das Boot ruhig festgemacht liegen [s]. */
export const STABLE_SECONDS = 5;
/** Grenzwerte für „ruhig“ */
export const STABLE_MAX_SOG_KN = 0.2;
export const STABLE_MAX_ROT_DEG_S = 1;

export const ROLE_LABEL: Record<LineRole, string> = {
  pier: 'Stegleine',
  pile: 'Dalbenleine',
  bowLine: 'Vorleine',
  sternLine: 'Achterleine',
  fwdSpring: 'Vorspring',
  aftSpring: 'Achterspring',
};

/**
 * Aufgabe einer Leine. In Boxen zählt nur der Festpunkt (Steg oder Dalbe).
 * Längsseits aus der Geometrie: Klampe vorn/achtern und ob der Festpunkt
 * vor oder hinter der Klampe liegt.
 */
export function classifyLine(berthKind: Berth['kind'], yacht: Yacht, line: MooringLine): LineRole {
  if (berthKind === 'box') return line.anchor.kind === 'pile' ? 'pile' : 'pier';
  const cleat = yacht.model.cleats.find((c) => c.id === line.cleatId);
  if (!cleat) return 'pier';
  const st = yacht.state;
  const a = worldToBody({ x: line.anchor.pos.x - st.pos.x, y: line.anchor.pos.y - st.pos.y }, st.psi);
  const third = yacht.model.cfg.hull.loa / 6;
  const fore = cleat.pos.x > third;
  const aft = cleat.pos.x < -third;
  const ahead = a.x > cleat.pos.x;
  if (ahead) return fore ? 'bowLine' : 'aftSpring';
  return aft ? 'sternLine' : 'fwdSpring';
}

export const isTaut = (l: MooringLine): boolean => l.slack <= TAUT_MAX_SLACK;

export interface RequirementState {
  req: LineRequirement;
  /** belegt und stramm */
  ok: number;
  /** belegt, hängt aber durch */
  slack: MooringLine[];
  /** passende Leine, aber noch nicht belegt */
  notCleated: number;
}

export function checkRequirements(berth: Berth, yacht: Yacht, lines: MooringLine[]): RequirementState[] {
  const used = new Set<number>();
  return berth.requirements.map((req) => {
    const state: RequirementState = { req, ok: 0, slack: [], notCleated: 0 };
    for (const l of lines) {
      if (used.has(l.id) || !req.anchors.includes(l.anchor.id)) continue;
      if (classifyLine(berth.kind, yacht, l) !== req.role) continue;
      if (l.mode !== 'cleated') {
        state.notCleated++;
        continue;
      }
      if (isTaut(l)) {
        if (state.ok < req.count) {
          state.ok++;
          used.add(l.id);
        }
      } else {
        state.slack.push(l);
      }
    }
    return state;
  });
}

/**
 * Wertung eines Kontakts nach Art und Annäherungsgeschwindigkeit [kn]:
 *  - über einen Fender: bis 0,6 kn ohne Abzug, über 1,2 kn hart
 *  - Rumpf an Dalbe: bis 0,3 kn ohne Abzug (Dalben sind zum Anlehnen da)
 *  - Rumpf an Steg, Mauer, anderem Boot: schon ab 0,1 kn Berührung
 *  - Rumpf über 0,5 kn: hart
 */
export const CONTACT_LIMITS = {
  fender: { free: 0.6, hard: 1.2 },
  pile: { free: 0.3, hard: 0.5 },
  hull: { free: 0.1, hard: 0.5 },
};

export type ContactRating = 'free' | 'light' | 'hard';

export function rateContact(via: 'hull' | 'fender', kind: string, approachKn: number): ContactRating {
  const lim = via === 'fender' ? CONTACT_LIMITS.fender : kind === 'pile' ? CONTACT_LIMITS.pile : CONTACT_LIMITS.hull;
  if (approachKn < lim.free) return 'free';
  return approachKn > lim.hard ? 'hard' : 'light';
}

/** Sterne: 3 ohne jeden Kontakt, 2 nur leichte Berührungen, 1 mit hartem Kontakt. */
export function starRating(contacts: number, hardContacts: number): 1 | 2 | 3 {
  if (hardContacts > 0) return 1;
  return contacts > 0 ? 2 : 3;
}

/**
 * Ausrichtungs-Vorgabe erfüllt? Vergleicht Bug- bzw. Steuerbordrichtung mit
 * der Richtung zum Steg (±45°).
 */
export function orientationOk(o: Orientation, berth: Berth, yacht: Yacht): boolean {
  const psi = yacht.state.psi;
  const fwd = { x: Math.sin(psi), y: Math.cos(psi) };
  const stbd = { x: Math.cos(psi), y: -Math.sin(psi) };
  const d = berth.pierDir;
  const lim = Math.SQRT1_2;
  switch (o) {
    case 'bowToPier':
      return dot(fwd, d) > lim;
    case 'sternToPier':
      return dot(fwd, d) < -lim;
    case 'starboardSide':
      return dot(stbd, d) > lim;
    case 'portSide':
      return dot(stbd, d) < -lim;
  }
}
