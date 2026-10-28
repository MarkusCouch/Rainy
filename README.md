# Rainy

Rainy ist eine mobile, installierbare Regenradar-PWA. Sie verwendet ausschließlich die aktuelle Position oder einen manuell gewählten Kartenpunkt und verarbeitet die Radardaten vollständig im Browser.

## Funktionen

- aktuelle GPS-Position mit schneller Erstbestimmung und präziser Aktualisierung
- reduzierte helle OpenFreeMap-Karte mit schwarzem App-Chrome und fester Radar/Verlauf-Navigation
- pixeliges Live-Radar in fünf klar getrennten Intensitätsklassen von Grün über Cyan bis Violett
- Bewegungsanalyse aus den letzten drei RainViewer-Radarständen
- Herkunftsrichtung und Geschwindigkeit vorhandener Regengebiete
- geografisch skalierte `+2 h`- und `+4 h`-Marken
- automatischer Kartenmaßstab, der die vollständige Vier-Stunden-Strecke zeigt
- antippbarer Regenverlauf in 15-Minuten-Schritten bis `+4 h`, inklusive geschätzter Regenrate in `mm/h`
- herunterziehbares Infofenster mit drei Rastpositionen
- einheitliche SVG-Icons und ein vollbreites, iOS-artiges Bottom-Sheet
- PWA-Installation und grundlegender Offline-Fallback
- automatische Veröffentlichung über GitHub Pages

Die Stundenmarken und der 4-h-Verlauf sind eine lineare Fortschreibung der beobachteten Bewegung und keine meteorologische Modellvorhersage. Die Regenrate wird mit der üblichen Radar-Näherung `Z = 200 · R^1,6` aus der Reflektivität abgeleitet. Bei uneindeutiger Bewegung zeigt die App bewusst nur den aktuellen Wert statt erfundener Zukunftswerte.

## Lokal starten

```bash
npm run dev
```

Anschließend `http://localhost:4173` öffnen. Für eine echte GPS-Abfrage außerhalb von `localhost` ist HTTPS erforderlich.

## Prüfen

```bash
npm run check
npm test
```

## GitHub Pages aktivieren

Das Repository enthält bereits den Workflow `.github/workflows/pages.yml`. Einmalig in GitHub:

1. **Settings** öffnen.
2. Unter **Pages** bei **Build and deployment** als Quelle **GitHub Actions** wählen.
3. Den Workflow unter **Actions** bei Bedarf erneut ausführen.

Danach wird jeder erfolgreiche Push auf `main` automatisch unter `https://markuscouch.github.io/Rainy/` veröffentlicht.

## Datenquellen

- Radar: [RainViewer Weather Maps API](https://www.rainviewer.com/api.html)
- Basiskarte: [OpenFreeMap](https://openfreemap.org/) / [OpenStreetMap](https://www.openstreetmap.org/copyright)

RainViewer benötigt für den öffentlichen Community-Zugang keinen API-Key. Die App ruft Metadaten und Kacheln direkt vom Endgerät ab; es gibt keinen eigenen Anwendungsserver.

## Datenschutz

Die Position wird nicht an Rainy oder einen eigenen Server übertragen. Sie wird nur lokal im Browser verwendet. Für die Bewegungsanalyse werden zentrierte Radarbildausschnitte direkt bei RainViewer abgerufen; dadurch erhält der Datenanbieter technisch die angefragten Kartenkoordinaten.

## Lizenz

Quellcode: MIT. Für Karten- und Radardaten gelten die Bedingungen der jeweiligen Anbieter.
