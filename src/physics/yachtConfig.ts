/**
 * Yacht-Konfiguration: rein datengetrieben (JSON-serialisierbar), damit
 * Nutzer später ihre eigene Yacht beschreiben, speichern und teilen können.
 *
 * Alle Längspositionen `x` sind in Metern relativ zur Mitte der Länge über
 * alles (LOA) angegeben, positiv nach vorn. Querpositionen `y` positiv nach
 * Steuerbord. Das Physikmodell rechnet intern relativ zum Gewichtsschwerpunkt.
 */

export type KeelType = 'fin' | 'bulb' | 'long' | 'bilge';
export type RudderType = 'spade' | 'skeg' | 'keelHung';
export type PropRotation = 'right' | 'left';
export type DriveType = 'shaft' | 'saildrive';

export interface CleatConfig {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface YachtConfig {
  schemaVersion: 1;
  id: string;
  name: string;
  hull: {
    /** Länge über alles [m] */
    loa: number;
    /** Länge Wasserlinie [m] */
    lwl: number;
    /** Größte Breite [m] */
    beam: number;
    /** Verdrängung (Masse) [kg] */
    displacement: number;
    /** Tiefgang des Rumpfes ohne Kiel [m] */
    canoeDraft: number;
    /** Mittlerer Freibord [m] (nur Info/Darstellung) */
    freeboard: number;
    /** Heckspiegelbreite / Breite [-] */
    transomRatio: number;
    /** Längsposition Gewichtsschwerpunkt [m] */
    lcg: number;
    /** Trägheitsradius um Hochachse / LOA [-], typ. 0.22 … 0.27 */
    gyrationRatio: number;
  };
  keel: {
    type: KeelType;
    /** Gesamttiefgang [m] */
    draft: number;
    /** Mittlere Profiltiefe (Sehnenlänge) des Kiels [m] */
    chord: number;
    /** Längsposition Kielmitte [m] */
    x: number;
  };
  rudder: {
    type: RudderType;
    /** Ruderfläche [m²] */
    area: number;
    /** Ruderspannweite (Tiefe) [m] */
    span: number;
    /** Längsposition Ruderdrehachse / Druckpunkt [m] */
    x: number;
    /** Maximaler Ruderwinkel [°] */
    maxAngleDeg: number;
    /** Ruderlegegeschwindigkeit [°/s] (Hart-Bb → Hart-Stb braucht 2·max/rate) */
    rateDegPerS: number;
  };
  engine: {
    /** Motorleistung [kW] */
    powerKw: number;
    /** Propellerdurchmesser [m] */
    propDiameter: number;
    /** Propellersteigung [m] */
    propPitch: number;
    /** Propellerdrehzahl bei Vollgas [1/min] (nach Getriebe) */
    maxPropRpm: number;
    /** Drehrichtung vorwärts, von achtern gesehen */
    propRotation: PropRotation;
    drive: DriveType;
    /** Längsposition Propeller [m] */
    propX: number;
    /** Rückwärtsschub / Vorwärtsschub [-] */
    reverseEfficiency: number;
    /** Multiplikator Radeffekt [-], 1 = typisch Welle, ~0.5 Saildrive */
    propWalk: number;
    /** Leerlaufdrehzahl / Maximaldrehzahl [-] */
    idleFraction: number;
    /** Schaltzeit über Neutral [s] */
    shiftDelay: number;
    /** Zeitkonstante Drehzahländerung [s] */
    spoolTime: number;
  };
  windage: {
    /** Seitliche Windangriffsfläche (Rumpf, Rigg, Aufbauten) [m²] */
    lateralArea: number;
    /** Frontale Windangriffsfläche [m²] */
    frontalArea: number;
    /** Längsposition des Windangriffspunkts bei Wind querab [m] */
    ceX: number;
    /** Verschiebung des Angriffspunkts Richtung Luv-Ende [m] */
    ceShift: number;
  };
  bowThruster: {
    enabled: boolean;
    /** Schub [N] */
    thrust: number;
    /** Längsposition [m] */
    x: number;
  };
  cleats: CleatConfig[];
}

/** Standard-Klampen aus Hauptabmessungen erzeugen. */
export function defaultCleats(loa: number, beam: number): CleatConfig[] {
  const bowX = loa / 2 - 0.45;
  const midX = 0.2;
  const sternX = -loa / 2 + 0.35;
  const bowY = Math.min(0.45, beam * 0.13);
  const midY = beam / 2 - 0.12;
  const sternY = beam / 2 - 0.3;
  return [
    { id: 'bow-p', name: 'Bug Bb', x: bowX, y: -bowY },
    { id: 'bow-s', name: 'Bug Stb', x: bowX, y: bowY },
    { id: 'mid-p', name: 'Mitte Bb', x: midX, y: -midY },
    { id: 'mid-s', name: 'Mitte Stb', x: midX, y: midY },
    { id: 'stern-p', name: 'Heck Bb', x: sternX, y: -sternY },
    { id: 'stern-s', name: 'Heck Stb', x: sternX, y: sternY },
  ];
}

/** Referenz: moderne 36-Fuß-Fahrtenyacht mit Flossenkiel und Spatenruder. */
export const SAILING_YACHT_36: YachtConfig = {
  schemaVersion: 1,
  id: 'sy36-fin',
  name: 'Segelyacht 36 ft (Flossenkiel)',
  hull: {
    loa: 10.97,
    lwl: 9.6,
    beam: 3.6,
    displacement: 6500,
    canoeDraft: 0.55,
    freeboard: 1.15,
    transomRatio: 0.82,
    lcg: -0.35,
    gyrationRatio: 0.24,
  },
  keel: { type: 'fin', draft: 1.9, chord: 1.25, x: 0.1 },
  rudder: { type: 'spade', area: 0.62, span: 1.35, x: -3.9, maxAngleDeg: 35, rateDegPerS: 28 },
  engine: {
    powerKw: 21,
    propDiameter: 0.38,
    propPitch: 0.26,
    maxPropRpm: 1450,
    propRotation: 'right',
    drive: 'shaft',
    propX: -2.9,
    reverseEfficiency: 0.6,
    propWalk: 1,
    idleFraction: 0.3,
    shiftDelay: 0.6,
    spoolTime: 0.7,
  },
  windage: { lateralArea: 19, frontalArea: 7.5, ceX: 0.45, ceShift: 1.4 },
  bowThruster: { enabled: false, thrust: 700, x: 4.6 },
  cleats: defaultCleats(10.97, 3.6),
};

/** Vergleich: klassische 36-Fuß-Langkielyacht, Ruder am Kiel angehängt. */
export const LONG_KEEL_36: YachtConfig = {
  schemaVersion: 1,
  id: 'sy36-long',
  name: 'Segelyacht 36 ft (Langkiel)',
  hull: {
    loa: 10.97,
    lwl: 8.6,
    beam: 3.3,
    displacement: 7800,
    canoeDraft: 0.6,
    freeboard: 1.05,
    transomRatio: 0.45,
    lcg: -0.2,
    gyrationRatio: 0.25,
  },
  keel: { type: 'long', draft: 1.7, chord: 4.4, x: -1.0 },
  rudder: { type: 'keelHung', area: 0.75, span: 1.2, x: -3.2, maxAngleDeg: 35, rateDegPerS: 22 },
  engine: {
    powerKw: 29,
    propDiameter: 0.43,
    propPitch: 0.28,
    maxPropRpm: 1400,
    propRotation: 'right',
    drive: 'shaft',
    propX: -2.8,
    reverseEfficiency: 0.55,
    propWalk: 1.5,
    idleFraction: 0.3,
    shiftDelay: 0.8,
    spoolTime: 0.9,
  },
  windage: { lateralArea: 17, frontalArea: 7, ceX: 0.3, ceShift: 1.3 },
  bowThruster: { enabled: false, thrust: 700, x: 4.6 },
  cleats: defaultCleats(10.97, 3.3),
};

export const PRESETS: YachtConfig[] = [SAILING_YACHT_36, LONG_KEEL_36];

export function cloneConfig(c: YachtConfig): YachtConfig {
  return JSON.parse(JSON.stringify(c)) as YachtConfig;
}

/** Plausibilitätsprüfung; gibt Liste von Fehlermeldungen zurück (leer = ok). */
export function validateConfig(c: YachtConfig): string[] {
  const e: string[] = [];
  const pos = (v: number, n: string) => {
    if (!(Number.isFinite(v) && v > 0)) e.push(`${n} muss > 0 sein`);
  };
  pos(c.hull.loa, 'LOA');
  pos(c.hull.lwl, 'LWL');
  pos(c.hull.beam, 'Breite');
  pos(c.hull.displacement, 'Verdrängung');
  pos(c.hull.canoeDraft, 'Rumpftiefgang');
  pos(c.keel.draft, 'Tiefgang');
  pos(c.keel.chord, 'Kiel-Profiltiefe');
  pos(c.rudder.area, 'Ruderfläche');
  pos(c.rudder.span, 'Ruderspannweite');
  pos(c.engine.powerKw, 'Motorleistung');
  pos(c.engine.propDiameter, 'Propellerdurchmesser');
  if (c.hull.lwl > c.hull.loa) e.push('LWL darf nicht größer als LOA sein');
  if (c.keel.draft <= c.hull.canoeDraft) e.push('Tiefgang muss größer als Rumpftiefgang sein');
  if (Math.abs(c.rudder.x) > c.hull.loa / 2) e.push('Ruder liegt außerhalb des Rumpfes');
  if (Math.abs(c.keel.x) > c.hull.loa / 2) e.push('Kiel liegt außerhalb des Rumpfes');
  if (c.hull.beam > c.hull.loa / 1.5) e.push('Breite unplausibel groß');
  return e;
}
