// api/nuliga.js — v7
const CLUB_ID = '26684';
const BASE = 'https://wtv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 's-maxage=900, stale-while-revalidate=3600',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS_HEADERS); res.end(); return; }
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    const type = req.query.type || 'matches';

    if (type === 'debug') {
      const r = await fetch(`${BASE}/clubMeetings?club=${CLUB_ID}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
      });
      const html = await r.text();
      const info = {
        httpStatus: r.status,
        htmlLength: html.length,
        containsBegegnungen: html.includes('Begegnungen im Zeitraum'),
        containsBegegnungenShort: html.includes('Begegnungen'),
        first500: html.slice(0, 500),
      };
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json(info);
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(type === 'teams' ? await fetchTeams() : await fetchMatches());
  } catch (err) {
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({ error: err.message });
  }
};

// ─── TEAMS ───────────────────────────────────────────────────────────────────

async function fetchTeams() {
  const r = await fetch(`${BASE}/clubTeams?club=${CLUB_ID}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
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

// ─── TEAM MAP ────────────────────────────────────────────────────────────────

async function buildTeamMap() {
  const r = await fetch(`${BASE}/clubTeams?club=${CLUB_ID}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  const html = await r.text();
  const map = {};
  const re = /teamPortrait\?team=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) map[m[1]] = m[2].trim();
  return map;
}

// ─── MATCHES ─────────────────────────────────────────────────────────────────

async function fetchMatches() {
  const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

  const [summerHtml, winterHtml, teamMap] = await Promise.all([
    fetch(`${BASE}/clubMeetings?club=${CLUB_ID}`, { headers }).then(r => r.text()),
    fetch(`${BASE}/clubMeetings?club=${CLUB_ID}&championship=MS+Winter+25%2F26`, { headers }).then(r => r.text()),
    buildTeamMap(),
  ]);

  const summerMatches = parseMatches(summerHtml, teamMap, 'Sommer 2026');
  const winterMatches = parseMatches(winterHtml, teamMap, 'Winter 2025/26');

  const all = [...winterMatches, ...summerMatches].sort((a, b) => {
    const toDate = s => { const [d, mo, y] = s.split('.'); return new Date(y, mo - 1, d); };
    return toDate(a.date) - toDate(b.date);
  });

  return {
    matches: all,
    upcoming: all.filter(m => m.status !== 'played'),
    played: all.filter(m => m.status === 'played'),
    fetchedAt: new Date().toISOString(),
  };
}

function parseMatches(html, teamMap, season) {
  const matches = [];

  let start = html.indexOf('Begegnungen im Zeitraum');
  if (start === -1) start = html.indexOf('Begegnungen');
  if (start === -1) start = 0;

  const tableHtml = html.slice(start);
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let currentDate = '';
  let currentTime = '';
  let m;

  while ((m = rowRegex.exec(tableHtml)) !== null) {
    const row = m[1];
    const cells = [];
    const cr = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cr.exec(row)) !== null) cells.push(cm[1]);
    if (cells.length < 5) continue;

    const dt = strip(cells[1]);
    const dm = dt.match(/(\d{2}\.\d{2}\.\d{4})/);
    const tm = dt.match(/(\d{2}:\d{2})/);
    if (dm) currentDate = dm[1];
    if (tm) currentTime = tm[1];

    const liga = strip(cells[3]);
    const homeId = extractTeamId(cells[4]);
    const awayId = extractTeamId(cells[5] || '');
    const home = (homeId && teamMap[homeId]) || extractTeamName(cells[4]);
    const away = (awayId && teamMap[awayId]) || extractTeamName(cells[5] || '');

    if (!home || !away) continue;
    if (home === 'Heimmannschaft' || liga === 'Liga' || liga === '') continue;
    if (!home.includes('Nottuln') && !away.includes('Nottuln')) continue;

    const scoreM = strip(cells[6] || '').match(/(\d+):(\d+)/);
    const statusText = strip(cells[cells.length - 1]).toLowerCase();
    const status = scoreM ? 'played'
      : statusText.includes('urspr') ? 'rescheduled'
      : 'upcoming';

    matches.push({
      date: currentDate,
      time: currentTime,
      season,
      league: liga,
      home,
      away,
      homeScore: scoreM ? scoreM[1] : null,
      awayScore: scoreM ? scoreM[2] : null,
      status,
      isHome: home.includes('Nottuln'),
    });
  }
  return matches;
}

function extractTeamId(html) {
  const m = html.match(/teamPortrait\?[^"]*team=(\d+)/);
  return m ? m[1] : null;
}

function extractTeamName(html) {
  const lm = html.match(/teamPortrait[^"]*"[^>]*>([^<]+)<\/a>/);
  if (lm) return lm[1].trim();
  return strip(html) || null;
}

function strip(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\[Routenplan\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
async function fetchTeams() {
  const r = await fetch(`${BASE}/clubTeams?club=${CLUB_ID}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
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

// ─── TEAM MAP ────────────────────────────────────────────────────────────────

async function buildTeamMap() {
  const r = await fetch(`${BASE}/clubTeams?club=${CLUB_ID}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  });
  const html = await r.text();
  const map = {};
  const re = /teamPortrait\?team=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) map[m[1]] = m[2].trim();
  return map;
}

// ─── MATCHES ─────────────────────────────────────────────────────────────────

async function fetchMatches() {
  const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };

  const [summerHtml, winterHtml, teamMap] = await Promise.all([
    fetch(`${BASE}/clubMeetings?club=${CLUB_ID}`, { headers }).then(r => r.text()),
    fetch(`${BASE}/clubMeetings?club=${CLUB_ID}&championship=MS+Winter+25%2F26`, { headers }).then(r => r.text()),
    buildTeamMap(),
  ]);

  const summerMatches = parseMatches(summerHtml, teamMap, 'Sommer 2026');
  const winterMatches = parseMatches(winterHtml, teamMap, 'Winter 2025/26');

  const all = [...winterMatches, ...summerMatches].sort((a, b) => {
    const toDate = s => { const [d,mo,y] = s.split('.'); return new Date(y, mo-1, d); };
    return toDate(a.date) - toDate(b.date);
  });

  return {
    matches: all,
    upcoming: all.filter(m => m.status !== 'played'),
    played:   all.filter(m => m.status === 'played'),
    fetchedAt: new Date().toISOString(),
  };
}

function parseMatches(html, teamMap, season) {
  const matches = [];

  // Verschiedene mögliche Marker suchen
  let start = html.indexOf('Begegnungen im Zeitraum');
  if (start === -1) start = html.indexOf('Begegnungen');
  if (start === -1) start = html.indexOf('<table');
  if (start === -1) return matches;

  const tableHtml = html.slice(start);
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let currentDate = '';
  let currentTime = '';
  let m;

  while ((m = rowRegex.exec(tableHtml)) !== null) {
    const row = m[1];
    const cells = [];
    const cr = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cr.exec(row)) !== null) cells.push(cm[1]);
    if (cells.length < 5) continue;

    const dt = strip(cells[1]);
    const dm = dt.match(/(\d{2}\.\d{2}\.\d{4})/);
    const tm = dt.match(/(\d{2}:\d{2})/);
    if (dm) currentDate = dm[1];
    if (tm) currentTime = tm[1];

    const liga = strip(cells[3]);
    const homeId = extractTeamId(cells[4]);
    const awayId = extractTeamId(cells[5] || '');
    const home = (homeId && teamMap[homeId]) || extractTeamName(cells[4]);
    const away = (awayId && teamMap[awayId]) || extractTeamName(cells[5] || '');

    if (!home || !away) continue;
    if (home === 'Heimmannschaft' || liga === 'Liga' || liga === '') continue;
    if (!home.includes('Nottuln') && !away.includes('Nottuln')) continue;

    const scoreM = strip(cells[6] || '').match(/(\d+):(\d+)/);
    const statusText = strip(cells[cells.length - 1]).toLowerCase();
    const status = scoreM ? 'played'
      : statusText.includes('urspr') ? 'rescheduled'
      : 'upcoming';

    matches.push({
      date: currentDate,
      time: currentTime,
      season,
      league: liga,
      home,
      away,
      homeScore: scoreM ? scoreM[1] : null,
      awayScore: scoreM ? scoreM[2] : null,
      status,
      isHome: home.includes('Nottuln'),
    });
  }
  return matches;
}

function extractTeamId(html) {
  const m = html.match(/teamPortrait\?[^"]*team=(\d+)/);
  return m ? m[1] : null;
}

function extractTeamName(html) {
  const lm = html.match(/teamPortrait[^"]*"[^>]*>([^<]+)<\/a>/);
  if (lm) return lm[1].trim();
  return strip(html) || null;
}

function strip(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\[Routenplan\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}    const row = m[1];
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

// ─── TEAM-ID → NAME MAPPING ──────────────────────────────────────────────────
// Aus clubTeams-Seite: team-ID → lesbarer Mannschaftsname

async function buildTeamMap() {
  const r = await fetch(`${BASE}/clubTeams?club=${CLUB_ID}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = await r.text();
  const map = {};
  const re = /teamPortrait\?team=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    map[m[1]] = m[2].trim();
  }
  return map;
}

// ─── MATCHES ─────────────────────────────────────────────────────────────────

async function fetchMatches() {
  // Beide Saisons parallel laden + Team-Map
  const [summerHtml, winterHtml, teamMap] = await Promise.all([
    fetch(`${BASE}/clubMeetings?club=${CLUB_ID}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.text()),
    fetch(`${BASE}/clubMeetings?club=${CLUB_ID}&championship=MS+Winter+25%2F26`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.text()),
    buildTeamMap(),
  ]);

  const summerMatches = parseMatches(summerHtml, teamMap, 'Sommer 2026');
  const winterMatches = parseMatches(winterHtml, teamMap, 'Winter 2025/26');

  // Zusammenführen, nach Datum sortieren
  const all = [...winterMatches, ...summerMatches].sort((a, b) => {
    const toDate = s => { const [d,mo,y] = s.split('.'); return new Date(y, mo-1, d); };
    return toDate(a.date) - toDate(b.date);
  });

  return {
    matches: all,
    upcoming: all.filter(m => m.status !== 'played'),
    played:   all.filter(m => m.status === 'played'),
    fetchedAt: new Date().toISOString(),
  };
}

function parseMatches(html, teamMap, season) {
  const matches = [];
  const start = html.indexOf('Begegnungen im Zeitraum');
  if (start === -1) return matches;
  const tableHtml = html.slice(start);

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let currentDate = '';
  let currentTime = '';
  let m;

  while ((m = rowRegex.exec(tableHtml)) !== null) {
    const row = m[1];
    const cells = [];
    const cr = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cr.exec(row)) !== null) cells.push(cm[1]);
    if (cells.length < 5) continue;

    // Datum & Uhrzeit
    const dt = strip(cells[1]);
    const dm = dt.match(/(\d{2}\.\d{2}\.\d{4})/);
    const tm = dt.match(/(\d{2}:\d{2})/);
    if (dm) currentDate = dm[1];
    if (tm) currentTime = tm[1];

    // Liga (Spalte 3)
    const liga = strip(cells[3]);

    // Team-IDs aus Links extrahieren
    const homeId = extractTeamId(cells[4]);
    const awayId = extractTeamId(cells[5] || '');

    // Teamnamen: erst aus Map (lesbarer Name), sonst aus Link-Text
    const home = (homeId && teamMap[homeId]) || extractTeamName(cells[4]);
    const away = (awayId && teamMap[awayId]) || extractTeamName(cells[5] || '');

    if (!home || !away) continue;
    if (home === 'Heimmannschaft' || liga === 'Liga' || liga === '') continue;
    if (!home.includes('Nottuln') && !away.includes('Nottuln')) continue;

    const scoreM = strip(cells[6] || '').match(/(\d+):(\d+)/);
    const statusText = strip(cells[cells.length - 1]).toLowerCase();
    const status = scoreM ? 'played'
      : statusText.includes('urspr') ? 'rescheduled'
      : 'upcoming';

    matches.push({
      date: currentDate,
      time: currentTime,
      season,
      league: liga,
      home,
      away,
      homeScore: scoreM ? scoreM[1] : null,
      awayScore: scoreM ? scoreM[2] : null,
      status,
      isHome: home.includes('Nottuln'),
    });
  }
  return matches;
}

function extractTeamId(html) {
  const m = html.match(/teamPortrait\?[^"]*team=(\d+)/);
  return m ? m[1] : null;
}

function extractTeamName(html) {
  const lm = html.match(/teamPortrait[^"]*"[^>]*>([^<]+)<\/a>/);
  if (lm) return lm[1].trim();
  return strip(html) || null;
}

function strip(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\[Routenplan\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
