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
| **Ruder** | Foil mit Stall, begrenzter Legegeschwindigkeit, getrennt in freie Anströmung und **Schraubenstrahl** (Impulstheorie) → Radschlag aus dem Stand wirkt, rückwärts steuert erst mit Fahrt. |
| **Radeffekt** | Querkraft am Propeller proportional zum Schub, achteraus ≈ 10× stärker als voraus, nimmt mit Fahrt ab; Drehrichtung und Stärke konfigurierbar (Welle/Saildrive). |
| **Maschine** | Standschub aus Leistung und Propeller-Ø (Impulstheorie), Schub fällt mit Fortschrittsgeschwindigkeit, Rückwärtsschub reduziert, Leerlauf eingekuppelt ≈ 2–3 kn, **Schaltverzögerung über Neutral**, Drehzahlträgheit. |
| **Wind** | Seiten-/Frontfläche, scheinbarer Wind, Angriffspunkt wandert zum Luv-Ende → **Bug fällt ab**. Böen und Winddreher als Ornstein-Uhlenbeck-Prozess (reproduzierbar per Seed). In der Karte als Windstreifen sichtbar, die mit Windrichtung und -geschwindigkeit ziehen und in Böen kräftiger werden; die kurzen Striche zeigen die Strömung. |
| **Strömung** | Alle hydrodynamischen Kräfte rechnen mit Fahrt durchs Wasser; Zusatzmassen-Terme mit Relativgeschwindigkeit. |
| **Leinen** | Elastisch (EA/L), nur Zug, Dämpfung. Crew hält (Törn um die Klampe, rutscht erst über ~1500 N durch), holt dicht (bis ~900 N, unter Last langsamer), fiert (Leine läuft kontrolliert aus, Zug bleibt bei ~150 N), belegt, wirft los. Wurfweite je Festpunkt (Dalbe 6 m, Stegklampe 7 m, einstellbar), gemessen ab der Bordkante: Die Crew läuft mit der belegten Leine an Deck zur günstigsten Stelle und wirft von dort; die Leine führt dann von der Klampe zum Festpunkt. **Eindampfen** entsteht physikalisch aus Leinenkraft + Schub + Ruder. |
| **Manöverleine** | Kraftdreieck: von einer Bordklampe um Dalbe/Stegklampe zurück zu einer zweiten Bordklampe. Beide Parten elastisch; am Festpunkt rutscht die Leine durch, sobald der Zugunterschied die Seilreibung übersteigt (60 N + Umschlingung 180°, μ = 0,1). Die Crew arbeitet an der Holepart; „Los“ holt die Leine über Slip von Bord ein. Zählt nicht als Festmacher. Zwei Manöverleinen an Bord; die Holepart lässt sich an Deck ins Cockpit führen. Liegen beide im Cockpit, erscheint ein Regler: Er fiert dosiert die linke oder rechte Leine (je weiter, desto weniger Bremskraft) – so lenkt der Skipper vom Ruder aus. |
| **Besatzung** | *Mannschaft*: Befehle werden sofort ausgeführt, der Skipper bleibt am Ruder. *Einhand*: Der Skipper läuft selbst an Deck (0,8 m/s; Heckklampen ~3 s, Bug ~10 s), nimmt die Leine, wirft von der Bordkante (Wurfweite wird beim Wurf geprüft – treibt das Boot weg, geht er daneben), belegt und kehrt zurück. Solange er nicht am Ruder ist, bleiben Gas und Ruder stehen, das Bugstrahlruder ist aus. Eine gehaltene Leine belegt er, bevor er weitergeht. Ins Cockpit geführte Manöverleinen bedient er vom Ruder aus. |
| **Kontakte** | Rumpfkontur gegen Dalben, Stege, Kaimauer und andere Boote (Feder/Dämpfer + Reibung), Aufprallgeschwindigkeit wird bewertet. |

Kalibrierung (automatisierte Tests in `src/physics/yacht.test.ts`): Höchstfahrt
6–7,5 kn, Standgas 2–3,5 kn, Auslaufen aus 4 kn > 2 Bootslängen, Drehkreis
≈ 1,5 Bootslängen (Spatenruder im Schraubenstrahl), Driftgeschwindigkeit 15 kn Wind querab 0,5–2 kn, Radeffekt
rückwärts Heck nach Bb (rechtsdrehend), Eindampfen in die Vorspring schwenkt
das Heck vom Steg. Empirische Beiwerte stehen zentral in `TUNING`
(`src/physics/yacht.ts`).

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
| `,` / `.` | Lenken mit beiden Manöverleinen im Cockpit (links/rechts fieren) |
| `Z` | Einhand: Skipper zurück ans Ruder |

Maus/Touch: Ziehen verschiebt die Karte, Mausrad/Pinch zoomt. Gashebel und
Ruder gibt es auch als Schieberegler (mobil bedienbar).

**Aufgaben** (Dialog „📋 Aufgaben“): 48 Aufgaben – je 24 zum Anlegen und
Ablegen, davon 10 für Einhandsegler – in fünf Schwierigkeitsstufen
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

Optional: `crew: 'solo'` (Einhand), `start` (Startlage), `initialLines` (belegte Leinen zu Beginn),
`fenders` (hängen schon), `yacht` (Vorlage, z. B. `'sy36-long'`).
`npm test` prüft jede Aufgabe automatisch: gültige Daten, kollisionsfreier
Start und grundsätzliche Lösbarkeit (ein Musterskipper legt korrekt an bzw.
ab). Eine fehlerhafte Aufgabe fällt sofort auf.

**Hafen:** Builder-Funktion in `src/harbor/harbor.ts` aus den Bausteinen
`addBoxRow` (Boxen mit Dalben) und `addAlongsideRow` (Längsseits-Steg mit
Lücken) oder eigenen Polygonen; in `SCENARIOS` registrieren. Liegeplätze
bringen ihre Leinen-Anforderungen und die Richtung zum Steg (`pierDir`) mit.

## Roadmap

- Weitere Häfen/Manöver (Mooring/Heckanker, Schwimmsteg, Tidenstrom) + Hafen-Editor
- Mehrere Crew-Mitglieder mit Positionen (Übersteigen an Land), Umlenken an der Winsch
- Windabdeckung durch Boote/Gebäude, räumlich variable Strömung, Bank-Effekt
- Schadensmodell
- Manöver-Replay, Zeitvorgaben für Aufgaben, weitere Aufgaben und Häfen
- Motorboote (Zwei-Maschinen, Joystick), Katamarane
