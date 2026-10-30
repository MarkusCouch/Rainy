# Rainy

Rainy ist eine mobile, installierbare Regenradar-PWA. Sie verwendet ausschließlich die aktuelle Position oder einen manuell gewählten Kartenpunkt und verarbeitet die Radardaten vollständig im Browser.

## Funktionen

- aktuelle GPS-Position mit schneller Erstbestimmung und präziser Aktualisierung
- reduzierte helle OpenFreeMap-Karte mit schwebender Rainy-Chrome und kompakter Radar/Verlauf-Navigation
- pixeliges Live-Radar in fünf klar getrennten Intensitätsklassen von Grün über Cyan bis Violett
- Bewegungsanalyse aus den letzten drei RainViewer-Radarständen
- Herkunftsrichtung und Geschwindigkeit vorhandener Regengebiete
- geografisch skalierte Stundenpunkte bis `+4 h`; `+1 h` und `+3 h` erscheinen ab Zoomstufe 8, sobald zwischen den Stundenpunkten genügend Platz ist
- automatischer Kartenmaßstab, der die vollständige Vier-Stunden-Strecke zeigt
- antippbare Regen-Silhouette in 15-Minuten-Schritten bis `+4 h`, inklusive geschätzter Regenrate in `mm/h`
- minimalistischer Bewegungspfeil mit feiner Linie und schlichten Stundenmarken
- bei zu wenig Radarregen: gleicher Pfeil aus modelliertem Höhenwind (700 hPa), sichtbar als „Höhenwind“ gekennzeichnet; der Regenverlauf bleibt unabhängig davon
- freie Kartenfläche ohne Pull-Menü und pulsierender Standort
- direkt lesbarer Regeneintritt bzw. Regenende, wenn die Radar-Hochrechnung dies hergibt
- fester Intensitätsfarbverlauf und echte Lücken bei nicht verfügbaren Zukunftswerten
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
- Pfeil bei fehlenden Regenechos: [Open-Meteo Höhenwind](https://open-meteo.com/en/docs) auf 700 hPa (etwa 3 km Höhe), keine gemessene Regenzugrichtung. Bei fehlenden, veralteten oder windstillen Modelldaten bleibt der Standortpunkt sichtbar.
- Basiskarte: [OpenFreeMap](https://openfreemap.org/) / [OpenStreetMap](https://www.openstreetmap.org/copyright)

RainViewer benötigt für den öffentlichen Community-Zugang keinen API-Key. Die App ruft Metadaten und Kacheln direkt vom Endgerät ab; es gibt keinen eigenen Anwendungsserver.

## Datenschutz

Die Position wird nicht an Rainy oder einen eigenen Server übertragen. Sie wird nur lokal im Browser verwendet. Für die Bewegungsanalyse werden zentrierte Radarbildausschnitte direkt bei RainViewer abgerufen; dadurch erhält der Datenanbieter technisch die angefragten Kartenkoordinaten.

Wenn Radarregen für einen Bewegungspfeil fehlt, werden die Standortkoordinaten zusätzlich an Open-Meteo übermittelt, um den Höhenwind für den gekennzeichneten Ersatzpfeil zu laden.

## Lizenz

Quellcode: MIT. Für Karten- und Radardaten gelten die Bedingungen der jeweiligen Anbieter.
