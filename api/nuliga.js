// api/nuliga.js — v14
const CLUB_ID = '26684';
const BASE = 'https://wtv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// Winter 25/26 Team-IDs (aus clubTeams-Seite)
const WINTER_TEAMS = [
  { id: '3491050', name: 'Herren 4er 1',    championship: 'MS+Winter+25%2F26' },
  { id: '3469632', name: 'Herren 30 4er 1', championship: 'MS+Winter+25%2F26' },
  { id: '3491051', name: 'Herren 30 4er 2', championship: 'MS+Winter+25%2F26' },
  { id: '3491052', name: 'Herren 40 4er 1', championship: 'MS+Winter+25%2F26' },
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 's-maxage=900, stale-while-revalidate=3600',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  Object.entries(CORS).forEach(function(e) { res.setHeader(e[0], e[1]); });
  try {
    const type = req.query.type || 'matches';
    if (type === 'teams') return res.status(200).json(await fetchTeams());
    return res.status(200).json(await fetchMatches());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  return r.text();
}

async function buildTeamMap() {
  const html = await get(BASE + '/clubTeams?club=' + CLUB_ID);
  const map = {};
  const re = /teamPortrait\?team=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    map[m[1]] = m[2].trim();
  }
  return map;
}

async function fetchTeams() {
  const html = await get(BASE + '/clubTeams?club=' + CLUB_ID);
  const teams = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  let currentSeason = '';
  while ((m = re.exec(html)) !== null) {
    const row = m[1];
    const s = row.match(/(Sommer \d{4}|Winter \d{4}\/\d{4}|Vereinspokal \d{4})/i);
    if (s) {
      currentSeason = s[1];
    } else {
      const teamMatch = row.match(/teamPortrait\?team=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/);
      if (teamMatch) {
        teams.push({
          season: currentSeason,
          teamId: teamMatch[1],
          name: teamMatch[2].trim(),
          league: (row.match(/groupPage[^"]*"[^>]*>([^<]+)<\/a>/) || [])[1] || '',
          rank: parseInt((row.match(/<td[^>]*>\s*(\d+)\s*<\/td>/) || [])[1]) || null,
          points: (row.match(/(\d+:\d+)\s*<\/td>/) || [])[1] || '0:0',
        });
      }
    }
  }
  return { teams: teams, fetchedAt: new Date().toISOString() };
}

async function fetchMatches() {
  const teamMap = await buildTeamMap();

  // Sommer: von clubMeetings (upcoming + played)
  const summerHtml = await get(BASE + '/clubMeetings?club=' + CLUB_ID);
  const summerMatches = parseClubMeetings(summerHtml, teamMap, 'Sommer 2026');

  // Winter: von jeder Mannschaftsseite einzeln (enthält Ergebnisse)
  const winterHtmls = await Promise.all(
    WINTER_TEAMS.map(function(t) {
      return get(BASE + '/teamPortrait?team=' + t.id + '&championship=' + t.championship);
    })
  );

  const winterMatches = [];
  for (let i = 0; i < WINTER_TEAMS.length; i++) {
    const team = WINTER_TEAMS[i];
    const matches = parseTeamPortrait(winterHtmls[i], team.name, 'Winter 2025/26');
    for (let j = 0; j < matches.length; j++) {
      winterMatches.push(matches[j]);
    }
  }

  // Zusammenführen + deduplizieren
  const combined = winterMatches.concat(summerMatches);
  const seen = {};
  const all = [];
  for (let i = 0; i < combined.length; i++) {
    const match = combined[i];
    const key = match.date + '|' + match.home + '|' + match.away;
    if (!seen[key]) {
      seen[key] = true;
      all.push(match);
    }
  }

  all.sort(function(a, b) {
    function ms(s) {
      const p = s.split('.');
      return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])).getTime();
    }
    return ms(a.date) - ms(b.date);
  });

  return {
    matches: all,
    upcoming: all.filter(function(m) { return m.status !== 'played'; }),
    played:   all.filter(function(m) { return m.status === 'played'; }),
    fetchedAt: new Date().toISOString(),
  };
}

// Parst clubMeetings-Seite (nur upcoming/rescheduled, keine Ergebnisse)
function parseClubMeetings(html, teamMap, season) {
  const matches = [];
  const start = html.indexOf('Begegnungen im Zeitraum');
  if (start === -1) return matches;

  const tableHtml = html.slice(start);
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  let currentDate = '';
  let currentTime = '';

  while ((m = rowRe.exec(tableHtml)) !== null) {
    const row = m[1];
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cellRe.exec(row)) !== null) cells.push(cm[1]);
    if (cells.length < 6) continue;

    const dt = strip(cells[1]);
    const dm = dt.match(/(\d{2}\.\d{2}\.\d{4})/);
    const tm = dt.match(/(\d{2}:\d{2})/);
    if (dm) currentDate = dm[1];
    if (tm) currentTime = tm[1];
    if (!currentDate) continue;

    const liga = strip(cells[3]);
    if (!liga || liga === 'Liga') continue;

    const homeId = extractTeamId(cells[4]);
    const awayId = extractTeamId(cells[5]);
    const homeIsBTV = homeId && teamMap[homeId] !== undefined;
    const awayIsBTV = awayId && teamMap[awayId] !== undefined;
    if (!homeIsBTV && !awayIsBTV) continue;

    const home = homeIsBTV ? teamMap[homeId] : (extractTeamName(cells[4]) || strip(cells[4]));
    const away = awayIsBTV ? teamMap[awayId] : (extractTeamName(cells[5]) || strip(cells[5]));
    if (!home || !away || home === 'Heimmannschaft') continue;

    const scoreM = strip(cells[6] || '').match(/(\d+):(\d+)/);
    const statusText = strip(cells[cells.length - 1]).toLowerCase();
    const status = scoreM ? 'played'
      : statusText.indexOf('urspr') !== -1 ? 'rescheduled'
      : 'upcoming';

    matches.push({
      date: currentDate,
      time: currentTime,
      season: season,
      league: liga,
      home: home,
      away: away,
      homeScore: scoreM ? scoreM[1] : null,
      awayScore: scoreM ? scoreM[2] : null,
      status: status,
      isHome: homeIsBTV,
    });
  }
  return matches;
}

// Parst teamPortrait-Seite (enthält Ergebnisse der Saison)
function parseTeamPortrait(html, btvTeamName, season) {
  const matches = [];

  // Liga aus Überschrift holen
  const ligaMatch = html.match(/Spieltermine[^<]*-\s*([^<\n]+)/);
  const liga = ligaMatch ? ligaMatch[1].trim() : season;

  // Tabelle "Spieltermine" finden
  const start = html.indexOf('Spieltermine');
  if (start === -1) return matches;
  const tableHtml = html.slice(start);

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  let currentDate = '';
  let currentTime = '';

  while ((m = rowRe.exec(tableHtml)) !== null) {
    const row = m[1];
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cellRe.exec(row)) !== null) cells.push(cm[1]);
    if (cells.length < 6) continue;

    // Zelle 0: Wochentag, Zelle 1: Datum+Zeit
    const dt = strip(cells[1]);
    const dm = dt.match(/(\d{2}\.\d{2}\.\d{4})/);
    const tm = dt.match(/(\d{2}:\d{2})/);
    if (dm) currentDate = dm[1];
    if (tm) currentTime = tm[1];
    if (!currentDate) continue;

    // Zelle 2: leer/Icon
    // Zelle 3: Heimmannschaft
    // Zelle 4: Gastmannschaft
    const homeRaw = strip(cells[3]);
    const awayRaw = strip(cells[4]);
    if (!homeRaw || !awayRaw) continue;

    // "BTV Nottuln 1" in lesbaren Teamnamen umwandeln
    const home = homeRaw.includes('BTV Nottuln') || homeRaw.includes('Nottuln')
      ? btvTeamName : homeRaw;
    const away = awayRaw.includes('BTV Nottuln') || awayRaw.includes('Nottuln')
      ? btvTeamName : awayRaw;

    const isHome = homeRaw.includes('Nottuln');

    // Zelle 5: Matches-Ergebnis
    const scoreText = strip(cells[5] || '');
    const scoreM = scoreText.match(/(\d+):(\d+)/);

    // Status
    const status = scoreM ? 'played' : 'upcoming';

    matches.push({
      date: currentDate,
      time: currentTime,
      season: season,
      league: liga,
      home: home,
      away: away,
      homeScore: scoreM ? scoreM[1] : null,
      awayScore: scoreM ? scoreM[2] : null,
      status: status,
      isHome: isHome,
    });
  }
  return matches;
}

function extractTeamId(html) {
  if (!html) return null;
  const m = html.match(/[?&;]team=(\d+)/);
  return m ? m[1] : null;
}

function extractTeamName(html) {
  if (!html) return null;
  const m = html.match(/teamPortrait[^"]*"[^>]*>([\s\S]*?)<\/a>/);
  if (m) return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return null;
}

function strip(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\[Routenplan\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
