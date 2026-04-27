// api/nuliga.js — v4 final
const CLUB_ID = '26684';
const BASE = 'https://wtv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 's-maxage=900, stale-while-revalidate=3600',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS_HEADERS); res.end(); return; }
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  try {
    const type = req.query.type || 'matches';
    res.status(200).json(type === 'teams' ? await fetchTeams() : await fetchMatches());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── TEAMS ───────────────────────────────────────────────────────────────────

async function fetchTeams() {
  const r = await fetch(`${BASE}/clubTeams?club=${CLUB_ID}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  return parseTeams(await r.text());
}

function parseTeams(html) {
  const teams = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let currentSeason = '';
  let m;
  while ((m = rowRegex.exec(html)) !== null) {
    const row = m[1];
    const s = row.match(/(Sommer \d{4}|Winter \d{4}\/\d{4}|Vereinspokal \d{4})/i);
    if (s) { currentSeason = s[1]; continue; }
    const teamMatch = row.match(/teamPortrait\?team=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/);
    if (!teamMatch) continue;
    teams.push({
      season: currentSeason,
      teamId: teamMatch[1],
      name: teamMatch[2].trim(),
      league: (row.match(/groupPage[^"]*"[^>]*>([^<]+)<\/a>/) || [])[1]?.trim() || '',
      rank: parseInt((row.match(/<td[^>]*>\s*(\d+)\s*<\/td>/) || [])[1]) || null,
      points: (row.match(/(\d+:\d+)\s*<\/td>/) || [])[1] || '0:0',
    });
  }
  return { teams, fetchedAt: new Date().toISOString() };
}

// ─── MATCHES ─────────────────────────────────────────────────────────────────

async function fetchMatches() {
  const r = await fetch(`${BASE}/clubMeetings?club=${CLUB_ID}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  return parseMatches(await r.text());
}

function parseMatches(html) {
  const matches = [];
  const start = html.indexOf('Begegnungen im Zeitraum');
  if (start === -1) return { matches: [], upcoming: [], played: [], fetchedAt: new Date().toISOString() };

  const tableHtml = html.slice(start);
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let currentDate = '';
  let currentTime = '';
  let m;

  while ((m = rowRegex.exec(tableHtml)) !== null) {
    const row = m[1];

    // Alle <td> als rohes HTML sammeln
    const cells = [];
    const cr = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cr.exec(row)) !== null) cells.push(cm[1]);
    if (cells.length < 5) continue;

    // Spalte 0: Wochentag (So., Mo., ...)  — nur wenn vorhanden neues Datum setzen
    // Spalte 1: Datum + Uhrzeit
    const dt = strip(cells[1]);
    const dm = dt.match(/(\d{2}\.\d{2}\.\d{4})/);
    const tm = dt.match(/(\d{2}:\d{2})/);
    if (dm) currentDate = dm[1];
    if (tm) currentTime = tm[1];

    // Spalte 2: leer / Heimspiel-Icon — überspringen
    // Spalte 3: Liga — direkt als Text, KEIN Link, z.B. "W34BK"
    const liga = strip(cells[3]);

    // Spalte 4: Heimmannschaft (Link)
    // Spalte 5: Gastmannschaft (Link)
    const home = extractTeam(cells[4]);
    const away = extractTeam(cells[5] || '');

    if (!home || !away) continue;
    if (home === 'Heimmannschaft' || liga === 'Liga' || liga === '') continue;
    if (!home.includes('Nottuln') && !away.includes('Nottuln')) continue;

    // Spalte 6: Matches-Ergebnis
    const scoreM = strip(cells[6] || '').match(/(\d+):(\d+)/);

    // Letzte Spalte: Spielbericht / Status
    const statusText = strip(cells[cells.length - 1]).toLowerCase();
    const status = scoreM ? 'played'
      : statusText.includes('urspr') ? 'rescheduled'
      : 'upcoming';

    matches.push({
      date: currentDate,
      time: currentTime,
      league: liga,
      home,
      away,
      homeScore: scoreM ? scoreM[1] : null,
      awayScore: scoreM ? scoreM[2] : null,
      status,
      isHome: home.includes('Nottuln'),
    });
  }

  return {
    matches,
    upcoming: matches.filter(m => m.status !== 'played'),
    played:   matches.filter(m => m.status === 'played'),
    fetchedAt: new Date().toISOString(),
  };
}

function extractTeam(html) {
  const lm = html.match(/teamPortrait[^"]*"[^>]*>([^<]+)<\/a>/);
  if (lm) return lm[1].trim();
  const plain = strip(html);
  return plain || null;
}

function strip(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
