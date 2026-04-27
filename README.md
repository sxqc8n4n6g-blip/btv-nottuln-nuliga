# BTV Nottuln – nuLiga Integration für Framer

Dieses Setup holt Spielplan- und Mannschaftsdaten von wtv.liga.nu und stellt
sie als saubere JSON-API bereit, die du in Framer per Custom Component nutzen kannst.

---

## Architektur

```
wtv.liga.nu (HTML)
      ↓  scraping
api/nuliga.js  ← Vercel Edge Function (Proxy + Parser)
      ↓  JSON
Framer Custom Component (NuLigaWidget.tsx)
      ↓  UI
Deine BTV Nottuln Website
```

---

## Schritt 1: Vercel API deployen

### Option A: Vercel CLI (empfohlen)

```bash
# 1. Vercel CLI installieren
npm install -g vercel

# 2. In diesen Ordner wechseln
cd btv-nottuln-nuliga

# 3. Deployen
vercel

# → Du bekommst eine URL wie: https://btv-nottuln-xyz.vercel.app
```

### Option B: GitHub + Vercel Web UI

1. Diesen Ordner in ein GitHub-Repo pushen
2. https://vercel.com → "New Project" → Repo verbinden
3. Deploy klicken → fertig

### API testen

Nach dem Deploy:
```
https://deine-url.vercel.app/api/nuliga?type=matches
https://deine-url.vercel.app/api/nuliga?type=teams
```

---

## Schritt 2: Framer Component einrichten

1. Framer öffnen → dein BTV Nottuln Projekt
2. Linke Sidebar → **Assets** → **Code** → **+ New File**
3. Datei `NuLigaWidget.tsx` benennen
4. Den kompletten Inhalt aus `framer/NuLigaWidget.tsx` einfügen
5. **WICHTIG**: In Zeile 11 deine Vercel-URL eintragen:
   ```js
   const API_URL = "https://deine-url.vercel.app/api/nuliga"
   ```
6. Speichern → die Komponente erscheint in der Asset-Liste

### Komponente platzieren

- Komponente per Drag & Drop auf die Seite ziehen
- Rechts in den **Property Controls** anpassen:
  - **Ansicht**: Spielplan oder Mannschaften
  - **Akzentfarbe**: Vereinsfarbe des BTV Nottuln
  - **Max. Einträge**: wie viele Spiele anzeigen
  - **Titel**: beliebig

---

## API-Endpunkte

### GET /api/nuliga?type=matches

Gibt alle Spiele des BTV Nottuln zurück:

```json
{
  "matches": [...],
  "upcoming": [
    {
      "date": "03.05.2026",
      "time": "10:00",
      "league": "W34BK",
      "home": "BTV Nottuln 1",
      "away": "SV Union Wessum 1",
      "homeScore": null,
      "awayScore": null,
      "status": "upcoming",
      "isHome": true,
      "isBTVGame": true
    }
  ],
  "played": [...],
  "fetchedAt": "2026-04-27T..."
}
```

### GET /api/nuliga?type=teams

Gibt alle Mannschaften zurück:

```json
{
  "teams": [
    {
      "season": "Sommer 2026",
      "teamId": "3531446",
      "name": "Damen 30 4er 1",
      "league": "Damen 30 4er Bezirksklasse Gr. 021",
      "rank": 1,
      "points": "0:0",
      "leader": "Hollenhorst Melanie"
    }
  ],
  "fetchedAt": "2026-04-27T..."
}
```

---

## Caching

Die API cached Antworten **15 Minuten** via Vercel Edge Cache.
Das bedeutet: keine unnötigen Anfragen an nuLiga, schnelle Ladezeiten.

---

## Hinweise

- nuLiga liefert kein offizielles API – dies ist Web Scraping öffentlicher Daten
- Die HTML-Struktur könnte sich bei nuLiga-Updates ändern → dann muss der Parser
  in `api/nuliga.js` angepasst werden
- Vercel Free Tier reicht vollkommen aus (100k Requests/Monat)

---

## Vereins-ID

BTV Nottuln hat die nuLiga-ID: **26684**
Direkte Links:
- Mannschaften: https://wtv.liga.nu/.../clubTeams?club=26684
- Spielplan: https://wtv.liga.nu/.../clubMeetings?club=26684
