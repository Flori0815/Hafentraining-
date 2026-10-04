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
/** Einzelruder mittschiffs oder Doppelruder (außerhalb des Schraubenstrahls) */
export type RudderArrangement = 'single' | 'twin';

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
    /** Einzel- oder Doppelruder (fehlt: Einzelruder). Fläche = Summe beider Blätter. */
    arrangement?: RudderArrangement;
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
    gyrationRatio: 0.26,
  },
  // Langkiel bis in den Vorfuß; am Kiel angehängtes Ruder, Ausschlag durch die Schraubenöffnung begrenzt
  keel: { type: 'long', draft: 1.7, chord: 6.0, x: -0.5 },
  rudder: { type: 'keelHung', area: 0.6, span: 1.2, x: -3.5, maxAngleDeg: 30, rateDegPerS: 22 },
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

/**
 * Hauptdaten eines Serienboots. Unterwassergeometrie, Propeller und
 * Windangriff gibt kein Hersteller an – sie werden aus den Hauptdaten nach
 * den Verhältnissen der kalibrierten 36-Fuß-Referenz abgeleitet.
 */
interface ProductionYacht {
  id: string;
  name: string;
  /** Rumpflänge [m] (ohne Bugspriet/Badeplattform) */
  loa: number;
  lwl: number;
  beam: number;
  displacement: number;
  draft: number;
  keel: KeelType;
  rudder: RudderType;
  arrangement: RudderArrangement;
  powerKw: number;
  drive: DriveType;
  /** klassischer Rumpf: schmales Heck, Überhänge */
  classic?: boolean;
  bowThruster?: number;
}

function productionYacht(p: ProductionYacht): YachtConfig {
  const { loa, lwl, draft } = p;
  const long = p.keel === 'long';
  const twin = p.arrangement === 'twin';
  const canoeDraft = Math.min(draft - 0.3, lwl * (long ? 0.07 : 0.056));
  const keelChord = long ? 0.68 * lwl : p.rudder === 'skeg' ? 0.26 * lwl : 0.12 * lwl;
  const span = long ? 0.9 * (draft - 0.2) : Math.min(0.75 * draft, 1.7);
  // Ruderfläche ~ Lateralplan; Doppelruder: zwei kleinere Blätter, zusammen etwas mehr
  const rudderArea = (long ? 0.034 : 0.033) * lwl * draft * (twin ? 1.15 : 1);
  const rudderX = long ? -0.32 * loa : p.rudder === 'skeg' ? -0.37 * loa : -0.355 * loa;
  const propD = Math.round(0.38 * Math.pow(p.powerKw / 21, 0.25) * 100) / 100;
  const shaft = p.drive === 'shaft';
  return {
    schemaVersion: 1,
    id: p.id,
    name: p.name,
    hull: {
      loa,
      lwl,
      beam: p.beam,
      displacement: p.displacement,
      canoeDraft: Math.round(canoeDraft * 100) / 100,
      freeboard: Math.round(0.105 * loa * 100) / 100,
      transomRatio: p.classic ? 0.5 : 0.85,
      lcg: Math.round(-0.03 * loa * 100) / 100,
      gyrationRatio: long ? 0.26 : 0.24,
    },
    keel: { type: p.keel, draft, chord: Math.round(keelChord * 100) / 100, x: Math.round((long ? -0.05 : p.rudder === 'skeg' ? -0.02 : 0.01) * loa * 100) / 100 },
    rudder: {
      type: p.rudder,
      arrangement: p.arrangement,
      area: Math.round(rudderArea * 100) / 100,
      span: Math.round(span * 100) / 100,
      x: Math.round(rudderX * 100) / 100,
      maxAngleDeg: long ? 30 : 35,
      rateDegPerS: long ? 22 : 28,
    },
    engine: {
      powerKw: p.powerKw,
      propDiameter: propD,
      propPitch: Math.round(0.68 * propD * 100) / 100,
      maxPropRpm: shaft ? 1450 : 1300,
      propRotation: 'right',
      drive: p.drive,
      // Saildrive sitzt weiter vorn unter dem Rumpf, Welle kurz vor dem Ruder
      propX: Math.round((shaft ? (long ? -0.29 : -0.27) : -0.2) * loa * 100) / 100,
      reverseEfficiency: shaft ? 0.6 : 0.65,
      propWalk: shaft ? (long ? 1.6 : 1.1) : 0.5,
      idleFraction: 0.3,
      shiftDelay: 0.6,
      spoolTime: 0.7,
    },
    windage: {
      lateralArea: Math.round(0.158 * loa * loa * 10) / 10,
      frontalArea: Math.round(0.062 * loa * loa * 10) / 10,
      ceX: Math.round(0.04 * loa * 100) / 100,
      ceShift: Math.round(0.13 * loa * 100) / 100,
    },
    bowThruster: { enabled: !!p.bowThruster, thrust: p.bowThruster ?? 700, x: Math.round(0.42 * loa * 100) / 100 },
    cleats: defaultCleats(loa, p.beam),
  };
}

/**
 * Gängige Serienyachten von 30 bis 50 Fuß. Hauptdaten nach Hersteller-
 * angaben bzw. sailboatdata.com / Wikipedia (gerundet, Standardversion).
 */
export const PRODUCTION_YACHTS: YachtConfig[] = [
  // Bavaria Cruiser 34 (2013–): Farr Design, Spatenruder, Saildrive
  productionYacht({ id: 'bavaria-cruiser-34', name: 'Bavaria Cruiser 34', loa: 9.99, lwl: 9.15, beam: 3.42, displacement: 5300, draft: 2.04, keel: 'fin', rudder: 'spade', arrangement: 'single', powerKw: 21, drive: 'saildrive' }),
  // Jeanneau Sun Odyssey 349 (2014–): Marc Lombard, Doppelruder, Yanmar 21 PS
  productionYacht({ id: 'jeanneau-so-349', name: 'Jeanneau Sun Odyssey 349', loa: 9.97, lwl: 9.4, beam: 3.44, displacement: 5350, draft: 1.98, keel: 'fin', rudder: 'spade', arrangement: 'twin', powerKw: 16, drive: 'saildrive' }),
  // Hallberg-Rassy 352 (1978–1991): Flossenkiel, Ruder am Skeg, Welle, Volvo 30 PS
  productionYacht({ id: 'hr-352', name: 'Hallberg-Rassy 352', loa: 10.59, lwl: 8.71, beam: 3.38, displacement: 6700, draft: 1.68, keel: 'fin', rudder: 'skeg', arrangement: 'single', powerKw: 22, drive: 'shaft', classic: true }),
  // Westsail 32 (1971–1980): Langkieler, Ruder am Kiel, Welle
  productionYacht({ id: 'westsail-32', name: 'Westsail 32 (Langkiel)', loa: 9.75, lwl: 8.38, beam: 3.35, displacement: 8850, draft: 1.52, keel: 'long', rudder: 'keelHung', arrangement: 'single', powerKw: 18, drive: 'shaft', classic: true }),
  // Dehler 37 CWS (1990–1997): E. G. van de Stadt, Flossenkiel, Spatenruder, Yanmar 3GM30 (27 PS), Saildrive oder Welle
  productionYacht({ id: 'dehler-37-cws', name: 'Dehler 37 CWS (1997)', loa: 11.2, lwl: 8.6, beam: 3.5, displacement: 6000, draft: 1.8, keel: 'fin', rudder: 'spade', arrangement: 'single', powerKw: 20, drive: 'saildrive', classic: true }),
  // Hanse 388 (2018–): Judel/Vrolijk, tiefes Spatenruder, Saildrive 29 PS
  productionYacht({ id: 'hanse-388', name: 'Hanse 388', loa: 11.4, lwl: 10.39, beam: 3.91, displacement: 8270, draft: 1.99, keel: 'fin', rudder: 'spade', arrangement: 'single', powerKw: 21, drive: 'saildrive' }),
  // Hallberg-Rassy 40C (2016–): Germán Frers, Doppelruder, Volvo 60 PS
  productionYacht({ id: 'hr-40c', name: 'Hallberg-Rassy 40C', loa: 12.33, lwl: 11.74, beam: 4.18, displacement: 11000, draft: 1.92, keel: 'fin', rudder: 'spade', arrangement: 'twin', powerKw: 44, drive: 'shaft' }),
  // Beneteau Oceanis 46.1 (2018–): Finot-Conq, Doppelruder, Yanmar 57 PS, Bugstrahlruder
  productionYacht({ id: 'oceanis-46-1', name: 'Beneteau Oceanis 46.1', loa: 13.65, lwl: 13.23, beam: 4.5, displacement: 10600, draft: 2.1, keel: 'fin', rudder: 'spade', arrangement: 'twin', powerKw: 42, drive: 'saildrive', bowThruster: 1300 }),
];

export const PRESETS: YachtConfig[] = [SAILING_YACHT_36, LONG_KEEL_36, ...PRODUCTION_YACHTS];

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
