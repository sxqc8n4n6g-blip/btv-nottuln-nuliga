// api/nuliga.js — v10
const CLUB_ID = '26684';
const BASE = 'https://wtv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

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
    if (type === 'debug') {
      const html = await get(BASE + '/clubMeetings?club=' + CLUB_ID);
      const idx = html.indexOf('Begegnungen im Zeitraum');
      return res.status(200).json({
        htmlLength: html.length,
        containsBegegnungen: idx !== -1,
        tableStart: idx !== -1 ? html.slice(idx, idx + 1500) : 'NOT FOUND',
      });
    }
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

// Extrahiert alle <td>...</td> Inhalte aus einem Row-String
// Funktioniert auch bei <td nowrap="nowrap"> etc.
function extractCells(row) {
  const cells = [];
  // Regex die Attribute im td-Tag erlaubt
  const re = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(row)) !== null) {
    cells.push(m[1]);
  }
  return cells;
}

// Extrahiert alle <tr>...</tr> Blöcke aus HTML
function extractRows(html) {
  const rows = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    rows.push(m[1]);
  }
  return rows;
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
  const rows = extractRows(html);
  let currentSeason = '';
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
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
  const [summerHtml, winterHtml] = await Promise.all([
    get(BASE + '/clubMeetings?club=' + CLUB_ID),
    get(BASE + '/clubMeetings?club=' + CLUB_ID + '&championship=MS+Winter+25%2F26'),
  ]);

  const summer = parseMatches(summerHtml, teamMap, 'Sommer 2026');
  const winter = parseMatches(winterHtml, teamMap, 'Winter 2025/26');

  const all = winter.concat(summer).sort(function(a, b) {
    function ms(s) {
      const p = s.split('.');
      return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])).getTime();
    }
    return ms(a.date) - ms(b.date);
  });

  return {
    matches: all,
    upcoming: all.filter(function(m) { return m.status !== 'played'; }),
    played: all.filter(function(m) { return m.status === 'played'; }),
    fetchedAt: new Date().toISOString(),
  };
}

function parseMatches(html, teamMap, season) {
  const matches = [];

  const start = html.indexOf('Begegnungen im Zeitraum');
  if (start === -1) return matches;

  // Nur den Tabellenbereich nehmen
  const tableHtml = html.slice(start);
  const rows = extractRows(tableHtml);

  let currentDate = '';
  let currentTime = '';

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cells = extractCells(row);

    if (cells.length < 6) continue;

    // Zelle 1: Datum + Uhrzeit (z.B. "03.05.2026 10:00")
    const dt = strip(cells[1]);
    const dm = dt.match(/(\d{2}\.\d{2}\.\d{4})/);
    const tm = dt.match(/(\d{2}:\d{2})/);
    if (dm) currentDate = dm[1];
    if (tm) currentTime = tm[1];

    // Zelle 3: Liga (z.B. "W34BK")
    const liga = strip(cells[3]);

    // Zellen 4+5: Heim- und Gastteam
    const homeId = extractTeamId(cells[4]);
    const awayId = extractTeamId(cells[5]);
    const home = (homeId && teamMap[homeId]) || extractTeamName(cells[4]);
    const away = (awayId && teamMap[awayId]) || extractTeamName(cells[5]);

    if (!home || !away) continue;
    if (home === 'Heimmannschaft') continue;
    if (liga === 'Liga' || liga === '') continue;
    if (!home.includes('Nottuln') && !away.includes('Nottuln')) continue;

    // Zelle 6: Match-Ergebnis
    const scoreM = strip(cells[6] || '').match(/(\d+):(\d+)/);

    // Letzte Zelle: Status
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
      isHome: home.includes('Nottuln'),
    });
  }
  return matches;
}

function extractTeamId(html) {
  if (!html) return null;
  const m = html.match(/teamPortrait\?[^"]*team=(\d+)/);
  return m ? m[1] : null;
}

function extractTeamName(html) {
  if (!html) return null;
  const m = html.match(/teamPortrait[^"]*"[^>]*>([^<]+)<\/a>/);
  if (m) return m[1].trim();
  return strip(html) || null;
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
