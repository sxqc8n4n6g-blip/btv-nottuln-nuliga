// api/nuliga.js — v12
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

  // Alle relevanten URLs laden:
  // 1. Sommer 2026 (aktuelle Saison, enthält upcoming + played)
  // 2. Winter 25/26 komplett (alle Ergebnisse)
  // 3. Vereinspokal 2026
  const [summerHtml, winterHtml, pokalHtml] = await Promise.all([
    get(BASE + '/clubMeetings?club=' + CLUB_ID),
    get(BASE + '/clubMeetings?club=' + CLUB_ID + '&timeRange=season&championship=MS+Winter+25%2F26'),
    get(BASE + '/clubMeetings?club=' + CLUB_ID + '&timeRange=season&championship=WTV+VP+2026'),
  ]);

  const summer = parseMatches(summerHtml, teamMap, 'Sommer 2026');
  const winter = parseMatches(winterHtml, teamMap, 'Winter 2025/26');
  const pokal  = parseMatches(pokalHtml,  teamMap, 'Vereinspokal 2026');

  // Zusammenführen
  const combined = winter.concat(summer).concat(pokal);

  // Deduplizieren: gleicher Key = selbes Spiel
  const seen = {};
  const all = [];
  for (let i = 0; i < combined.length; i++) {
    const match = combined[i];
    const key = match.date + '|' + match.time + '|' + match.home + '|' + match.away;
    if (!seen[key]) {
      seen[key] = true;
      all.push(match);
    }
  }

  // Nach Datum sortieren
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
    played: all.filter(function(m) { return m.status === 'played'; }),
    fetchedAt: new Date().toISOString(),
  };
}

function parseMatches(html, teamMap, season) {
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
    while ((cm = cellRe.exec(row)) !== null) {
      cells.push(cm[1]);
    }
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
