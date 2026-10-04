# ⚓ Hafentraining – Hafenmanöver-Simulator

Browser-Simulator für Hafenmanöver mit Yachten in der 2D-Draufsicht: eine
**36-Fuß-Segelyacht** unter Maschine, wahlweise in einer **Boxengasse mit
Dalben** oder **längsseits in der Gasse** (Steg mit Lücken zwischen Yachten).
Die Yacht ist vollständig konfigurierbar, damit jeder sein eigenes Boot
abbilden kann.

Läuft komplett statisch im Browser (Vite + TypeScript, Canvas 2D, keine
Laufzeit-Abhängigkeiten) und wird per GitHub Actions auf GitHub Pages deployt.

## Schnellstart

```bash
npm install
npm run dev      # Entwicklungsserver
npm test         # Physik- und Simulationstests (vitest)
npm run build    # Produktionsbuild nach dist/
```

**GitHub Pages aktivieren:** Repository → *Settings → Pages → Source: GitHub
Actions*. Danach deployt `.github/workflows/deploy.yml` jeden Push auf `main`
(Tests laufen vorher; bei Pull Requests wird nur getestet und gebaut).

## Marktrecherche – was es schon gibt

| Produkt | Plattform | Stärken | Lücken, die wir adressieren |
|---|---|---|---|
| [Hafenskipper 2](https://play.google.com/store/apps/details?id=com.Hafenskipper2&hl=en_IN) | iOS, Android, Windows | 3D-Physik, 8 Schiffstypen, 20 Level, Leinen | Feste Bootstypen, keine eigene Yacht, geschlossene App |
| [Dock your Boat 3D](https://apps.apple.com/us/app/dock-your-boat-3d/id1122445520) | iOS, Android, Win, Mac | Leinen, Fender, Anker, Wind einstellbar, Szenen-Editor | Kauf-App, Physikparameter nicht offen/konfigurierbar |
| [Hafenmanöver 2.0](https://apps.apple.com/de/app/hafenman%C3%B6ver-2-0/id1548111761) (Blue-2) | iOS, Android | Interaktiver Kurs, Manöver als Film erklärt + Simulator | Fokus Lehrinhalt, Simulation eher schematisch |
| [VR-Yachtsimulator](https://www.sailingisland.de/seminare/hafenmanoever-am-vr-yacht-simulator) (XR-Naut) | VR vor Ort | Sehr immersiv, viele Manöver pro Stunde | Nur als Seminar, teuer, nicht zu Hause |

Aus der Recherche übernommene Pflicht-Elemente: Radeffekt, Windabdrift mit
abfallendem Bug, Strömung, Leinenarbeit mit Wurfweite, Szenario-Einstellungen
(Wind, Strömung, Zielplatz), Bewertung (Kontakte, Aufprallgeschwindigkeit,
Zeit). Unser Alleinstellungsmerkmal: **offenes, dokumentiertes Physikmodell
und frei konfigurierbare Yacht (JSON)** – kostenlos im Browser.

## Physikmodell

3 Freiheitsgrade (Längs, Quer, Gieren), Manövriermodell nach Fossen
(*Handbook of Marine Craft Hydrodynamics and Motion Control*, 2011), ergänzt um
Strip-Theorie für den Lateralplan. Integration mit festem Schritt 1/240 s.

| Effekt | Umsetzung |
|---|---|
| **Verdrängung / Massenträgheit** | Starrkörpermasse + Trägheitsmoment (Trägheitsradius ≈ 0,24·LOA) plus **hydrodynamische Zusatzmasse** aus dem Lateralplan (m₂₂ ≈ 0,9·m, Kopplung m₂₆, m₆₆). Volle 3×3-Massenmatrix mit Coriolis-/Zentripetaltermen → Yacht gleitet lange, Drehung braucht Zeit zum Aufbauen und Stoppen. |
| **Kielart** | Lateralplan in 48 Streifen (Kanu-Körper + Kiel). Kiel als Tragflügel (Auftriebsanstieg nach Helmbold aus Streckung, Stall, Rückwärtsanströmung), lange Kiele segmentiert. Flossen-, Bomben-, Lang- und Kimmkiel wählbar. Ergebnis: Langkieler kurshaltend und träge, Flossenkieler wendig und bei Fahrt null „ohne Grip“. |
| **Drehpunkt** | Ergibt sich aus Querumströmung (Strip-Theorie), Rumpfauftrieb und Munk-Moment (nur Kanu-Körper, viskos abgemindert). |
| **Ruder** | Foil mit Stall, begrenzter Legegeschwindigkeit, getrennt in freie Anströmung und **Schraubenstrahl** (Impulstheorie). Im Strahl reißt die Strömung später ab; die zusätzliche Ruderkraft aus dem Strahl ist durch dessen Impuls begrenzt (≤ 1 × Schub). → Ein kurzer Gasstoß mit Hartruder dreht die Yacht fast auf der Stelle, rückwärts steuert erst mit Fahrt. **Doppelruder**: der Strahl läuft zwischen den Blättern durch – aus dem Stand kaum Wirkung, rückwärts gut. |
| **Radeffekt** | Querkraft am Propeller proportional zum Schub, achteraus ≈ 10× stärker als voraus, nimmt mit Fahrt ab; Drehrichtung und Stärke konfigurierbar (Welle/Saildrive). |
| **Maschine** | Standschub aus Leistung und Propeller-Ø (Impulstheorie), Schub fällt mit Fortschrittsgeschwindigkeit, Rückwärtsschub reduziert, Leerlauf eingekuppelt ≈ 2–3 kn, **Schaltverzögerung über Neutral**, Drehzahlträgheit. |
| **Wind** | Seiten-/Frontfläche, scheinbarer Wind, Angriffspunkt wandert zum Luv-Ende → **Bug fällt ab**. Böen und Winddreher als Ornstein-Uhlenbeck-Prozess (reproduzierbar per Seed). In der Karte als Windstreifen sichtbar, die mit Windrichtung und -geschwindigkeit ziehen und in Böen kräftiger werden; die kurzen Striche zeigen die Strömung. |
| **Strömung** | Alle hydrodynamischen Kräfte rechnen mit Fahrt durchs Wasser; Zusatzmassen-Terme mit Relativgeschwindigkeit. |
| **Leinen** | Elastisch (EA/L), nur Zug, Dämpfung. Crew hält (Törn um die Klampe, rutscht erst über ~1500 N durch), holt dicht (bis ~900 N, unter Last langsamer), fiert (Leine läuft kontrolliert aus, Zug bleibt bei ~150 N), belegt, wirft los. Wurfweite je Festpunkt (Dalbe 6 m, Stegklampe 7 m, einstellbar), gemessen ab der Bordkante: Die Crew läuft mit der belegten Leine an Deck zur günstigsten Stelle und wirft von dort; die Leine führt dann von der Klampe zum Festpunkt. **Eindampfen** entsteht physikalisch aus Leinenkraft + Schub + Ruder. |
| **Manöverleine** | Kraftdreieck: von einer Bordklampe um Dalbe/Stegklampe zurück zu einer zweiten Bordklampe. Beide Parten elastisch; am Festpunkt rutscht die Leine durch, sobald der Zugunterschied die Seilreibung übersteigt (60 N + Umschlingung 180°, μ = 0,1). Die Crew arbeitet an der Holepart; „Los“ holt die Leine über Slip von Bord ein. Zählt nicht als Festmacher. Zwei Manöverleinen an Bord; die Holepart lässt sich an Deck ins Cockpit führen. Dieselbe Klampe zweimal gewählt: die Leine läuft doppelt über die Klampe (z. B. Achterklampe → Dalbe → Achterklampe) direkt ins Cockpit – das Einhand-Manöver rückwärts in die Box; die Umlenkung an der Klampe bremst beim Fieren ×1,5. Liegen beide im Cockpit, erscheinen zwei Regler: „beide fieren“ lässt beide Leinen gleich dosiert auslaufen (geradeaus), der Lenk-Regler fiert eine Seite mehr als die andere (je mehr, desto weniger Bremskraft) – so steuert der Skipper vom Ruder aus. |
| **Nachbarboote** | Boote in den Boxen haben Fender draußen (weiche Kontaktkörper; langsamer Kontakt über einen Nachbarfender kostet nichts). Stufe 1–2: drei je Seite an der breitesten Stelle; Stufe 3–4: nur einzelne; Stufe 5: fehlen oft oder hängen zu weit vorn/achtern. Im freien Training optimal. |
| **Besatzung** | *Mannschaft*: Befehle werden sofort ausgeführt, der Skipper bleibt am Ruder. *Einhand*: Der Skipper läuft selbst an Deck (0,8 m/s; Heckklampen ~3 s, Bug ~10 s), nimmt die Leine, wirft von der Bordkante (Wurfweite wird beim Wurf geprüft – treibt das Boot weg, geht er daneben), belegt und kehrt zurück. Solange er nicht am Ruder ist, bleiben Gas und Ruder stehen, das Bugstrahlruder ist aus. Eine gehaltene Leine belegt er, bevor er weitergeht. Ins Cockpit geführte Manöverleinen bedient er vom Ruder aus. **Vorbereiten:** Solange das Ziel mindestens 20 m entfernt ist, kann er Festmacher (`J`) und Manöverleinen (`N`, Holepart optional schon im Cockpit) an den Klampen belegen und klar über die Reling legen. Nah am Ziel muss er dann nur noch zur Reling und werfen. |
| **Kontakte** | Rumpfkontur gegen Dalben, Stege, Kaimauer und andere Boote (Feder/Dämpfer + Reibung), Aufprallgeschwindigkeit wird bewertet. |

Kalibrierung (automatisierte Tests in `src/physics/yacht.test.ts` und
`src/physics/validation.test.ts`): Höchstfahrt nahe Rumpfgeschwindigkeit,
Standgas 1,5–3 kn, Auslaufen aus 4 kn > 2 Bootslängen, Drehkreis voraus
≈ 1,3 Bootslängen (Flossenkiel/Spatenruder) bzw. ≈ 2 (Langkiel, Doppelruder),
Driftgeschwindigkeit 15 kn Wind querab 0,5–2 kn, Radeffekt rückwärts Heck nach
Bb (rechtsdrehend), Eindampfen in die Vorspring schwenkt das Heck vom Steg.
Empirische Beiwerte stehen zentral in `TUNING` (`src/physics/yacht.ts`).

### Validierung: der Prüfstand

Im Dialog „⛵ Yacht“ → **🧪 Prüfstand** fährt die Simulation Standardmanöver
bei Windstille und vergleicht sie mit Referenzbereichen; „Alle Vorlagen
vergleichen“ stellt die Yachten nebeneinander. Die Manöver folgen dem Muster
der Versuchsfahrten für Schiffe (Drehkreis, Aufstoppen – [IMO MSC/Circ.1053](https://www.register-iri.com/wp-content/uploads/MSC.1-Circ.1053.pdf),
[ITTC 7.5-04-02-01](https://ittc.info/media/2131/75-04-02-01.pdf)), ergänzt um
typische Hafenmanöver:

| Manöver | Referenz (Richtwert) | Grundlage |
|---|---|---|
| Höchstfahrt | 0,8–1,05 × Rumpfgeschwindigkeit | 1,34·√LWL[ft] |
| Drehkreis voraus (taktischer Ø, Hartruder) | Flosse 0,8–2,5 L, Langkiel 1,5–4 L | Langkiel „wide turning circle ahead“, Flosse/Spaten „turns tight and quick“ ([PBO](https://www.pbo.co.uk/boats/keel-types-and-how-they-affect-performance-76621), [Yachting Monthly](https://www.yachtingmonthly.com/sailing-skills/keel-type-affects-performance-54322)) |
| Kick aus dem Stand (Hartruder, 3 s Gas) | Einzelruder 15–70°, Doppelruder < 12° | Gasstoß auf das gelegte Ruder dreht das Boot ([Grenada Bluewater Sailing](https://www.grenadabluewatersailing.com/boat-handling-rudders-propellers/)); bei Doppelrudern läuft der Strahl zwischen den Rudern durch ([SAIL](https://sailmagazine.com/cruising/boat-handling-docking-with-twin-rudders/), [NauticEd](https://sailing-blog.nauticed.org/dual-rudder-maneuvering-under-power/)) |
| Radeffekt rückwärts (10 s halbe Kraft) | Welle 8–90°, Saildrive 2–30°, Bug nach Stb (rechtsdrehend) | [segelplanet.de](https://segelplanet.de/radeffekt/), [SAIL: Walking the Prop](https://sailmagazine.com/cruising/walking-the-prop/) |
| Aufstoppweg mit voll zurück | 0,4–3 L | Praxis |
| Abdrift 15 kn querab | 0,4–2,2 kn | Praxis |

Für Fahrtenyachten gibt es kaum veröffentlichte Manövriermessungen; die
Bereiche sind deshalb bewusst weit und sollen grobe Fehler aufdecken. Wer
eine Yacht genauer abgleichen will: im Hafen bei Flaute einen Kick (Hartruder,
3 s Gas) und einen Vollkreis aus Manöverfahrt fahren, Kursänderung und Zeit
stoppen (oder aus einem Video ablesen) und mit dem Prüfstand vergleichen.

Diese Kalibrierung hat den Prüfstand ausgelöst: Vorher bremste das voll
gelegte, abgerissene Ruder die Yacht im Drehkreis fast bis zum Stillstand,
und ein Gasstoß drehte kaum. Geändert: Rumpfauftrieb bei Schräganströmung
realistischer (vorher etwa 3× zu hoch), Strahlgeschwindigkeit am Ruder voll
entwickelt, späterer Strömungsabriss im Strahl (vgl. Molland & Turnock,
*Marine Rudders and Control Surfaces*), Impulsgrenze für die Strahlkraft,
geringere Querumströmung am runden Kanu-Körper.

### Yachtvorlagen

Neben den Referenzbooten (36 ft Flossen- und Langkiel) gibt es gängige
Serienyachten. Hauptdaten nach Herstellerangaben bzw. sailboatdata/Wikipedia
(gerundet, Standardversion); Unterwassergeometrie, Propeller und Windangriff
sind daraus abgeleitet (nicht veröffentlicht):

| Yacht | LOA | Kiel / Ruder / Antrieb |
|---|---|---|
| Bavaria Cruiser 34 | 9,99 m | Flosse / Spaten / Saildrive |
| Jeanneau Sun Odyssey 349 | 9,97 m | Flosse / Doppelruder / Saildrive |
| Hallberg-Rassy 352 | 10,59 m | Flosse / Skeg / Welle |
| Westsail 32 | 9,75 m | Langkiel / am Kiel / Welle |
| Hanse 388 | 11,40 m | Flosse / Spaten / Saildrive |
| Hallberg-Rassy 40C | 12,33 m | Flosse / Doppelruder / Welle |
| Beneteau Oceanis 46.1 | 13,65 m | Flosse / Doppelruder / Saildrive, Bugstrahlruder |

> Hinweis: „Randeffekt“ wurde als **Radeffekt** (Propeller-Querschub)
> umgesetzt. Ein Ufer-/Bank-Effekt (Sog zur Wand bei enger Passage) ist als
> Erweiterung vorgesehen.

## Bedienung

| Taste | Funktion |
|---|---|
| `↑`/`W`, `↓`/`S` | Gashebel voraus/zurück (rastet beim Durchfahren in Neutral ein) |
| `Leertaste` | Neutral |
| `Shift`+`↑` / `Shift`+`↓` | Eingekuppelt im Standgas voraus / zurück (auch als Knöpfe am Gashebel) |
| `←`/`A`, `→`/`D` | Steuerrad nach Bb/Stb (bleibt stehen wie ein echtes Rad) |
| `C` | Ruder mittschiffs |
| `Q`/`E` | Bugstrahlruder (falls konfiguriert) |
| Klick Klampe → Klick Festpunkt | Leine werfen (Wurfweite ab Bordkante) |
| `1`–`9` | Leine wählen |
| `G` / `H` / `F` / `B` / `L` | Halten / Dichtholen / Fieren / Belegen / Loswerfen |
| `V` `K` `P` `T` `R` | Kamera folgen, Kräfte anzeigen, Pause, Zeitraffer, Neustart |
| `U` / `I` | Fender Bb / Stb raus bzw. einholen |
| `O` | Ballfender setzen: danach Stelle am Rumpf anklicken |
| `M` | Manöverleine: Klampe → Festpunkt → zweite Klampe |
| `,` / `.` | Lenken mit beiden Manöverleinen im Cockpit (links/rechts mehr fieren) |
| `X` / `Y` | beide Manöverleinen im Cockpit mehr / weniger fieren |
| `Z` | Einhand: Skipper zurück ans Ruder |

Maus/Touch: Ziehen verschiebt die Karte, Mausrad/Pinch zoomt. Gashebel und
Ruder gibt es auch als Schieberegler (mobil bedienbar).

**Aufgaben** (Dialog „📋 Aufgaben“): 60 Aufgaben – je 30 zum Anlegen und
Ablegen, davon 12 für Einhandsegler – in fünf Schwierigkeitsstufen
(●○○○○ Einsteiger … ●●●●● Experte), filterbar nach Art, Stufe und Einhand, mit Wind, Böen,
Strömung, Ausrichtungs-Vorgaben (rückwärts in die Box, Steuerbord längsseits)
und Langkieler. Jede Aufgabe hat eine Einweisung; Bestleistung und Fortschritt
werden gespeichert, „Nächste Aufgabe“ führt durch die Lernreihenfolge. Eine
**Checkliste** im Panel zeigt jederzeit, welche Erfolgskriterien erfüllt sind
und was noch fehlt (z. B. „Vorspring belegt & stramm 0/1 – hängt durch“,
„5 s ruhig liegen 3/5 s“).
„Freies Training“ lässt Szenario, Liegeplatz und Bedingungen frei wählen.

**Szenarien** (Häfen):

| Szenario | Liegeplätze | nötige Leinen |
|---|---|---|
| Boxengasse mit Dalben | freie Boxen 4,2 m × 13,5 m | je 2 zum Steg und zu den Dalben |
| Längsseits in der Gasse | Lücke A 18 m (leicht), Lücke B 14 m (schwer), freie Boxen gegenüber | Vorleine, Achterleine, Vorspring, Achterspring |
| Enge Boxengasse | Boxen 4,0 m × 12,5 m, nur 15 m Fahrwasser, dicht belegt | je 2 zum Steg und zu den Dalben |
| Hafen mit Seitengassen | Südboxen am Hauptfahrwasser; zwei Sackgassen nach Norden (16 m und 12 m breit) – in Gasse 2 praktisch kein Wenden, also vorher entscheiden: vorwärts oder rückwärts hinein | je 2 zum Steg und zu den Dalben |

Längsseits wird die Aufgabe jeder Leine aus der Geometrie erkannt: Klampe im
Vor-/Achterschiff und ob der Poller vor oder hinter der Klampe liegt.

**Erfolg:** Das Boot liegt in der grünen Markierung, alle geforderten Leinen
sind **belegt und stramm** (höchstens 0,2 m Lose), die Maschine ist
ausgekuppelt, und das Boot liegt **5 s ruhig** (unter 0,2 kn und 1°/s).
Wertung: ★★★ ohne Kontakt, ★★ mit leichter Berührung, ★ mit hartem Kontakt.

| Kontakt | ohne Abzug | leichte Berührung | hart |
|---|---|---|---|
| über einen Fender | bis 0,6 kn | 0,6–1,2 kn | über 1,2 kn |
| Rumpf an Dalbe | bis 0,3 kn | 0,3–0,5 kn | über 0,5 kn |
| Rumpf an Steg, Mauer, Boot | bis 0,1 kn | 0,1–0,5 kn | über 0,5 kn |

**Fender:** Standardsatz 4 je Seite (Zylinderfender Ø 22 cm), anfangs
verstaut; die Crew bringt sie auf Knopfdruck aus (~1 s pro Fender). Dazu ein
Ballfender (Ø 60 cm, weicher), der an jede Stelle am Rumpf gebracht werden
kann (~4 s). Fender sind eigene Kontaktkörper: Sie federn und halten den Rumpf
auf Abstand. Jedes
Ergebnis wird im Browser gespeichert, die Bestleistung je Liegeplatz steht im
Panel.

## Architektur

```
src/
  physics/          reine Simulation, DOM-frei und testbar
    vec.ts            Vektoren & Koordinatensysteme (Nord oben, Kurs rechtweisend)
    yachtConfig.ts    YachtConfig-Schema (JSON), Presets, Validierung
    yachtModel.ts     abgeleitete Größen: Massenmatrix, Lateralplan, Foils, Kontur
    yacht.ts          Kräfte & Integration (3DOF), TUNING-Beiwerte
    validation.ts     Prüfstand: Standardmanöver, Referenzbereiche, Quellen
    environment.ts    Wind mit Böen, Strömung
    lines.ts          Festmacherleinen und Crew-Aktionen
    collision.ts      Kontaktmodell
  harbor/harbor.ts  Häfen als Daten, aus Bausteinen (Boxenreihe, Längsseits-Steg); SCENARIOS
  sim/simulation.ts Fester Zeitschritt, Kontakte, Ergebnis, Logbuch
  sim/evaluation.ts Leinen-Rollen, Anforderungen je Liegeplatz, Sterne
  sim/mooring.ts    "Musterskipper": festgemachte Lage und Leinen je Liegeplatz
  sim/crew.ts       Besatzung: Mannschaft / Einhand (Skipper läuft an Deck, Ruder unbesetzt)
  sim/orders.ts     Befehle an Deck (Leinen, Manöverleinen, Fender) über die Besatzung
  render/renderer.ts Canvas-Draufsicht
  tasks/            Aufgaben: Format (types.ts), Katalog (catalog.ts), Katalog-Prüfung (tasks.test.ts)
  ui/               Aufgaben-Dialog, Yacht-Editor, Ergebnisse/Bestleistungen, Persistenz
  main.ts           Eingabe, Panels, Dialoge
```

**Eigene Yacht:** Dialog „⛵ Yacht“ – alle Parameter (Rumpf, Kiel, Ruder,
Maschine/Propeller, Windangriff, Bugstrahlruder) editierbar, JSON-Export/-Import
zum Teilen. Neue Parameter werden im Feld-Schema von `src/ui/yachtEditor.ts`
mit einer Zeile ergänzt.

## Neue Aufgaben und Häfen hinzufügen

**Aufgabe:** ein Eintrag in `src/tasks/catalog.ts` (Format in
`src/tasks/types.ts`), z. B.

```ts
{
  id: 'box-rueckwaerts-boeig',            // eindeutig
  title: 'Rückwärts in die Box bei Böen',
  difficulty: 4,                          // 1 Einsteiger … 5 Experte
  harbor: 'boxengasse',                   // ID aus SCENARIOS
  goal: { kind: 'moor', berth: 'box-n12', orientation: 'sternToPier' },
  env: { windSpeedKn: 16, windFromDeg: 240, gustiness: 0.4 }, // Rest = 0
  briefing: 'Kurze Einweisung mit Tipp …',
  tags: ['Box', 'Rückwärts'],
}
```

Ablegen: `goal: { kind: 'depart', berth, zone, zoneLabel }` plus
`startMoored: 'bowToPier' | 'sternToPier' | 'portSide' | 'starboardSide'` –
Lage und Leinen im Liegeplatz berechnet die Simulation passend zur jeweiligen
Yacht (auch zu eigenen Yachten), längsseits hängen die Fender schon.

Optional: `crew: 'solo'` (Einhand), `neighborFenders: 'good' | 'sparse' | 'poor' | 'none'` (sonst nach Stufe), `start` (Startlage), `initialLines` (belegte Leinen zu Beginn),
`fenders` (hängen schon), `yacht` (Vorlage, z. B. `'sy36-long'`).
`npm test` prüft jede Aufgabe automatisch: gültige Daten, kollisionsfreier
Start und grundsätzliche Lösbarkeit (ein Musterskipper legt korrekt an bzw.
ab). Eine fehlerhafte Aufgabe fällt sofort auf.

**Hafen:** Builder-Funktion in `src/harbor/harbor.ts` aus den Bausteinen
`addBoxRow` (Boxen mit Dalben, mit `idPrefix` mehrfach je Hafen) und
`addAlongsideRow` (Längsseits-Steg mit Lücken) oder eigenen Polygonen;
`mergeRotated` dreht lokal gebaute Teile (z. B. eine Seitengasse) nach Norden; in `SCENARIOS` registrieren. Liegeplätze
bringen ihre Leinen-Anforderungen und die Richtung zum Steg (`pierDir`) mit.

## Roadmap

- Weitere Häfen/Manöver (Mooring/Heckanker, Schwimmsteg, Tidenstrom) + Hafen-Editor
- Mehrere Crew-Mitglieder mit Positionen (Übersteigen an Land), Umlenken an der Winsch
- Windabdeckung durch Boote/Gebäude, räumlich variable Strömung, Bank-Effekt
- Schadensmodell
- Manöver-Replay, Zeitvorgaben für Aufgaben, weitere Aufgaben und Häfen
- Motorboote (Zwei-Maschinen, Joystick), Katamarane
