/**
 * Aufgaben-Katalog. Neue Aufgabe = neuer Eintrag in `TASKS` (Format siehe
 * `types.ts`). Die Reihenfolge innerhalb einer Schwierigkeit ist die
 * vorgeschlagene Lernreihenfolge. `tasks.test.ts` prüft jeden Eintrag.
 *
 * Geometrie-Spickzettel:
 *  - Boxengasse: Nord-Boxen zwischen Steg (y = 0) und Dalben (y = −13,5),
 *    Box n = x (n−1)·4,2 … n·4,2; Süd-Boxen zwischen Dalben (y = −37,5) und
 *    Steg (y = −51). Freie Boxen: Nord 3, 7, 10, 12, 16 · Süd 2, 8, 13, 17.
 *  - Längsseits: Steg y = 0, Lücke A x 20…38, Lücke B x 62…76, Poller k bei
 *    x = −4 + 3·(k−1). Gegenüber Boxen (Dalben y = −24,5), frei: Süd 4, 11, 18.
 */
import type { TaskDef } from './types';
import { zoneRect } from './types';

/** Hafenausfahrt (Westende der Gasse) als Zielzone beim Ablegen */
const EXIT_BOXENGASSE = zoneRect(-42, -35, -25, -16);
const EXIT_LAENGSSEITS = zoneRect(-42, -22, -25, -6);

/** Festgemacht in Box Nord 10, Bug zum Steg */
const MOORED_BOX_N10 = {
  start: { pos: { x: 39.9, y: -6.7 }, headingDeg: 0, speedKn: 0 },
  initialLines: [
    ['bow-p', 'cleat-n10a'],
    ['bow-s', 'cleat-n10b'],
    ['stern-p', 'pile-n9'],
    ['stern-s', 'pile-n10'],
  ] as [string, string][],
};

/** Festgemacht längsseits in Lücke A, Backbord zum Steg, Fender Bb draußen */
const MOORED_GAP_A = {
  start: { pos: { x: 29, y: -2.05 }, headingDeg: 90, speedKn: 0 },
  initialLines: [
    ['bow-p', 'bollard-14'], // Vorleine
    ['stern-p', 'bollard-10'], // Achterleine
    ['mid-p', 'bollard-11'], // Vorspring
    ['stern-p', 'bollard-12'], // Achterspring
  ] as [string, string][],
  fenders: ['p'] as ('p' | 's')[],
};

export const TASKS: TaskDef[] = [
  // ------------------------------------------------------------ 1 Einsteiger
  {
    id: 'box-flaute',
    title: 'Erste Box bei Flaute',
    difficulty: 1,
    harbor: 'boxengasse',
    goal: { kind: 'moor', berth: 'box-n10', orientation: 'bowToPier' },
    briefing:
      'Kein Wind, keine Strömung: Gefühl für Gas, Ruder und Aufstoppen bekommen. Früh auskuppeln – die Yacht gleitet weit. Heckleinen im Vorbeifahren über die Dalben legen, dann Bugleinen an die Stegklampen.',
    tags: ['Box', 'Grundlagen'],
  },
  {
    id: 'box-brise-vorn',
    title: 'Leichte Brise von vorn',
    difficulty: 1,
    harbor: 'boxengasse',
    goal: { kind: 'moor', berth: 'box-n7', orientation: 'bowToPier' },
    env: { windSpeedKn: 6, windFromDeg: 0, gustiness: 0.1, windShiftDeg: 5 },
    briefing: 'Der Wind steht in die Box hinein und bremst mit. Etwas mehr Fahrt halten als bei Flaute, sonst treibt der Bug ab.',
    tags: ['Box', 'Wind'],
  },
  {
    id: 'laengsseits-flaute',
    title: 'Längsseits bei Flaute',
    difficulty: 1,
    harbor: 'laengsseits',
    goal: { kind: 'moor', berth: 'gap-a' },
    briefing:
      'Flach (ca. 20–30°) auf die Lücke zufahren, rechtzeitig Fender auf der Stegseite ausbringen. Vorleine, Achterleine und beide Springs belegen und dichtholen.',
    tags: ['Längsseits', 'Grundlagen', 'Fender'],
  },
  // ---------------------------------------------------------------- 2 Leicht
  {
    id: 'box-rueckenwind',
    title: 'Rückenwind in die Box',
    difficulty: 2,
    harbor: 'boxengasse',
    goal: { kind: 'moor', berth: 'box-n10', orientation: 'bowToPier' },
    env: { windSpeedKn: 10, windFromDeg: 180, gustiness: 0.2, windShiftDeg: 8 },
    briefing: 'Der Wind schiebt in die Box. Sehr früh auskuppeln, kurz rückwärts aufstoppen – und die Heckleinen an den Dalben als Bremse nutzen (fieren, dann belegen).',
    tags: ['Box', 'Wind', 'Aufstoppen'],
  },
  {
    id: 'laengsseits-auflandig',
    title: 'Auflandiger Wind längsseits',
    difficulty: 2,
    harbor: 'laengsseits',
    goal: { kind: 'moor', berth: 'gap-a' },
    env: { windSpeedKn: 10, windFromDeg: 180, gustiness: 0.2, windShiftDeg: 8 },
    briefing: 'Der Wind drückt Richtung Steg. Parallel neben die Lücke setzen und sich vertreiben lassen – vorher Fender raus, sonst gibt es Kontakt.',
    tags: ['Längsseits', 'Wind', 'Fender'],
  },
  {
    id: 'ablegen-box',
    title: 'Ablegen aus der Box',
    difficulty: 2,
    harbor: 'boxengasse',
    goal: { kind: 'depart', berth: 'box-n10', zone: EXIT_BOXENGASSE, zoneLabel: 'Hafenausfahrt (West)' },
    env: { windSpeedKn: 6, windFromDeg: 200, gustiness: 0.15, windShiftDeg: 8 },
    ...MOORED_BOX_N10,
    briefing: 'Bugleinen los, Heckleinen auf Slip halten und beim Rückwärtsfahren fieren. Radeffekt einplanen: rückwärts zieht das Heck nach Backbord. Dann zur Hafenausfahrt im Westen.',
    tags: ['Box', 'Ablegen'],
  },
  {
    id: 'box-eng',
    title: 'Enge Box zwischen Nachbarn',
    difficulty: 2,
    harbor: 'boxengasse',
    goal: { kind: 'moor', berth: 'box-n3', orientation: 'bowToPier' },
    env: { windSpeedKn: 6, windFromDeg: 250, gustiness: 0.15, windShiftDeg: 8 },
    briefing: 'Box 3 liegt nah an der Einfahrt – wenig Anlauf. Langsam und gerade zwischen die Dalben, auf beiden Seiten liegen Nachbarn.',
    tags: ['Box', 'Präzision'],
  },
  // ----------------------------------------------------------------- 3 Mittel
  {
    id: 'box-seitenwind',
    title: 'Seitenwind in der Box',
    difficulty: 3,
    harbor: 'boxengasse',
    goal: { kind: 'moor', berth: 'box-n10', orientation: 'bowToPier' },
    env: { windSpeedKn: 14, windFromDeg: 270, gustiness: 0.3, windShiftDeg: 10 },
    briefing: 'Wind quer zur Box: Luv-Dalbe zuerst belegen, das Boot hängt sich daran. Mit Fahrt einfahren, sonst fällt der Bug ab.',
    tags: ['Box', 'Wind'],
  },
  {
    id: 'box-rueckwaerts',
    title: 'Rückwärts in die Box',
    difficulty: 3,
    harbor: 'boxengasse',
    goal: { kind: 'moor', berth: 'box-n12', orientation: 'sternToPier' },
    env: { windSpeedKn: 5, windFromDeg: 200, gustiness: 0.1, windShiftDeg: 5 },
    briefing: 'Heck zum Steg. Erst mit etwas Fahrt achteraus Steuerwirkung aufbauen, Radeffekt (Heck nach Bb) vorhalten. Bugleinen an die Dalben, Heckleinen an den Steg.',
    tags: ['Box', 'Rückwärts', 'Radeffekt'],
  },
  {
    id: 'laengsseits-ablandig',
    title: 'Ablandiger Wind längsseits',
    difficulty: 3,
    harbor: 'laengsseits',
    goal: { kind: 'moor', berth: 'gap-a' },
    env: { windSpeedKn: 12, windFromDeg: 0, gustiness: 0.25, windShiftDeg: 8 },
    briefing: 'Der Wind drückt vom Steg weg. Steiler anfahren, zuerst die Vorspring belegen und in die Spring eindampfen – das Heck kommt an den Steg.',
    tags: ['Längsseits', 'Wind', 'Eindampfen'],
  },
  {
    id: 'laengsseits-stb',
    title: 'Steuerbord längsseits',
    difficulty: 3,
    harbor: 'laengsseits',
    goal: { kind: 'moor', berth: 'gap-a', orientation: 'starboardSide' },
    start: { pos: { x: 92, y: -14 }, headingDeg: 270, speedKn: 1.5 },
    env: { windSpeedKn: 6, windFromDeg: 200, gustiness: 0.15, windShiftDeg: 8 },
    briefing: 'Einfahrt von Osten, Steuerbordseite zum Steg. Fender an Steuerbord nicht vergessen – der Radeffekt beim Aufstoppen zieht das Heck vom Steg weg.',
    tags: ['Längsseits', 'Radeffekt'],
  },
  {
    id: 'box-stroemung',
    title: 'Strömung in der Gasse',
    difficulty: 3,
    harbor: 'boxengasse',
    goal: { kind: 'moor', berth: 'box-n16', orientation: 'bowToPier' },
    env: { currentSpeedKn: 0.8, currentTowardDeg: 90, windSpeedKn: 5, windFromDeg: 180, gustiness: 0.1 },
    briefing: 'Die Strömung setzt mit 0,8 kn die Gasse entlang nach Osten. Beim Eindrehen stromauf vorhalten, sonst versetzt es dich auf die Nachbarbox.',
    tags: ['Box', 'Strömung'],
  },
  // ------------------------------------------------------------------ 4 Schwer
  {
    id: 'ablegen-vorspring',
    title: 'Ablegen: Eindampfen in die Vorspring',
    difficulty: 4,
    harbor: 'laengsseits',
    goal: { kind: 'depart', berth: 'gap-a', zone: EXIT_LAENGSSEITS, zoneLabel: 'Hafenausfahrt (West)' },
    env: { windSpeedKn: 14, windFromDeg: 180, gustiness: 0.3, windShiftDeg: 8 },
    ...MOORED_GAP_A,
    briefing:
      'Auflandiger Wind drückt dich an den Steg. Alle Leinen außer der Vorspring los, Ruder zum Steg, langsam voraus eindampfen: das Heck schwenkt ab. Dann rückwärts frei und zur Ausfahrt. Ballfender am Bug hilft.',
    tags: ['Längsseits', 'Ablegen', 'Eindampfen'],
  },
  {
    id: 'luecke-b',
    title: 'Lücke B – 14 Meter',
    difficulty: 4,
    harbor: 'laengsseits',
    goal: { kind: 'moor', berth: 'gap-b' },
    env: { windSpeedKn: 8, windFromDeg: 220, gustiness: 0.2, windShiftDeg: 8 },
    briefing: 'Nur 1,5 Bootslängen Platz. Mit Achterspring eindampfen oder rückwärts einparken – Ballfender an die neuralgische Ecke.',
    tags: ['Längsseits', 'Präzision'],
  },
  {
    id: 'box-sued-rueckwaerts',
    title: 'Rückwärts gegen den Radeffekt',
    difficulty: 4,
    harbor: 'boxengasse',
    goal: { kind: 'moor', berth: 'box-s8', orientation: 'sternToPier' },
    env: { windSpeedKn: 10, windFromDeg: 330, gustiness: 0.25, windShiftDeg: 10 },
    briefing: 'Rückwärts in eine Süd-Box: hier arbeitet der Radeffekt gegen dich. Mit kurzen Gasstößen und Fahrt achteraus steuern, Wind von achtern-quer beachten.',
    tags: ['Box', 'Rückwärts', 'Radeffekt'],
  },
  {
    id: 'box-starkwind',
    title: 'Starkwind querab in die Box',
    difficulty: 4,
    harbor: 'boxengasse',
    goal: { kind: 'moor', berth: 'box-n10', orientation: 'bowToPier' },
    env: { windSpeedKn: 20, windFromDeg: 270, gustiness: 0.4, windShiftDeg: 12 },
    briefing: '20 kn mit Böen quer zur Box. Zügig einfahren, Luv-Dalbe sofort belegen, Maschine bleibt drin bis alle Leinen fest sind.',
    tags: ['Box', 'Wind'],
  },
  {
    id: 'langkieler-box',
    title: 'Langkieler in die Box',
    difficulty: 4,
    harbor: 'boxengasse',
    goal: { kind: 'moor', berth: 'box-n7', orientation: 'bowToPier' },
    env: { windSpeedKn: 10, windFromDeg: 240, gustiness: 0.2, windShiftDeg: 8 },
    yacht: 'sy36-long',
    briefing: 'Klassischer Langkieler: träge, großer Drehkreis, kräftiger Radeffekt. Früh eindrehen, Schraubenstrahl aufs Ruder nutzen.',
    tags: ['Box', 'Langkiel'],
  },
  {
    id: 'ablegen-seitenwind',
    title: 'Ablegen bei Seitenwind',
    difficulty: 4,
    harbor: 'boxengasse',
    goal: { kind: 'depart', berth: 'box-n10', zone: EXIT_BOXENGASSE, zoneLabel: 'Hafenausfahrt (West)' },
    env: { windSpeedKn: 16, windFromDeg: 270, gustiness: 0.3, windShiftDeg: 10 },
    ...MOORED_BOX_N10,
    briefing: 'Seitenwind drückt dich beim Rausfahren auf die Lee-Dalbe. Luv-Heckleine zuletzt los und damit das Heck führen, zügig rückwärts raus.',
    tags: ['Box', 'Ablegen', 'Wind'],
  },
  {
    id: 'laengsseits-strom-achtern',
    title: 'Strom von achtern längsseits',
    difficulty: 4,
    harbor: 'laengsseits',
    goal: { kind: 'moor', berth: 'gap-a' },
    env: { currentSpeedKn: 1, currentTowardDeg: 90, windSpeedKn: 6, windFromDeg: 200, gustiness: 0.15 },
    briefing: 'Strömung von achtern schiebt dich mit 1 kn. Lieber gegen den Strom anlegen (wenden!) – oder sehr früh aufstoppen und Achterspring zuerst.',
    tags: ['Längsseits', 'Strömung'],
  },
  // ----------------------------------------------------------------- 5 Experte
  {
    id: 'box-sturm-rueckwaerts',
    title: 'Sturmböen – rückwärts in Box Süd',
    difficulty: 5,
    harbor: 'boxengasse',
    goal: { kind: 'moor', berth: 'box-s13', orientation: 'sternToPier' },
    env: { windSpeedKn: 25, windFromDeg: 240, gustiness: 0.5, windShiftDeg: 12, currentSpeedKn: 0.5, currentTowardDeg: 60 },
    briefing: '25 kn, kräftige Böen, dazu Strömung. Rückwärts mit Schwung, Böen abwarten, Luv-Leinen zuerst. Fender auf beiden Seiten.',
    tags: ['Box', 'Rückwärts', 'Starkwind'],
  },
  {
    id: 'luecke-b-ablandig',
    title: 'Lücke B ablandig mit Böen',
    difficulty: 5,
    harbor: 'laengsseits',
    goal: { kind: 'moor', berth: 'gap-b' },
    env: { windSpeedKn: 18, windFromDeg: 10, gustiness: 0.45, windShiftDeg: 12 },
    briefing: '14 m Lücke, 18 kn vom Steg weg. Vorspring als erste Leine, dann eindampfen und die übrigen Leinen in Ruhe ausbringen.',
    tags: ['Längsseits', 'Starkwind', 'Eindampfen'],
  },
  {
    id: 'langkieler-luecke-b',
    title: 'Langkieler in Lücke B mit Strömung',
    difficulty: 5,
    harbor: 'laengsseits',
    goal: { kind: 'moor', berth: 'gap-b' },
    env: { currentSpeedKn: 0.8, currentTowardDeg: 270, windSpeedKn: 12, windFromDeg: 200, gustiness: 0.3, windShiftDeg: 10 },
    yacht: 'sy36-long',
    briefing: 'Träger Langkieler, 14 m Lücke, Strömung gegenan und auflandige Böen. Gegen den Strom anlegen, Radeffekt beim Aufstoppen einplanen.',
    tags: ['Längsseits', 'Langkiel', 'Strömung'],
  },
];

export function findTask(id: string | null | undefined): TaskDef | undefined {
  return TASKS.find((t) => t.id === id);
}

/** Aufgaben sortiert nach Schwierigkeit (stabile Reihenfolge innerhalb). */
export function tasksByDifficulty(): TaskDef[] {
  return TASKS.map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.difficulty - b.t.difficulty || a.i - b.i)
    .map((x) => x.t);
}

/** Nächste Aufgabe in Lernreihenfolge (oder undefined am Ende). */
export function nextTask(id: string): TaskDef | undefined {
  const list = tasksByDifficulty();
  const i = list.findIndex((t) => t.id === id);
  return i >= 0 ? list[i + 1] : undefined;
}
