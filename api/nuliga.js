// api/nuliga.js — v2 fixed
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
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  try {
    const type = req.query.type || 'matches';
    if (type === 'teams') {
      res.status(200).json(await fetchTeams());
    } else {
      res.status(200).json(await fetchMatches());
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── TEAMS ───────────────────────────────────────────────────────────────────

async function fetchTeams() {
  const res = await fetch(`${BASE}/clubTeams?club=${CLUB_ID}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const html = await res.text();
  return parseTeams(html);
}

function parseTeams(html) {
  const teams = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let currentSeason = '';
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    const row = match[1];
    const seasonMatch = row.match(/(Sommer \d{4}|Winter \d{4}\/\d{4}|Vereinspokal \d{4})/i);
    if (seasonMatch) { currentSeason = seasonMatch[1]; continue; }

    const teamMatch = row.match(/teamPortrait\?team=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/);
    if (!teamMatch) continue;

    const pointsMatch = row.match(/(\d+:\d+)\s*<\/td>/);
    const leagueMatch = row.match(/groupPage[^"]*"[^>]*>([^<]+)<\/a>/);
    const rankMatch = row.match(/<td[^>]*>\s*(\d+)\s*<\/td>/);

    teams.push({
      season: currentSeason,
      teamId: teamMatch[1],
      name: teamMatch[2].trim(),
      league: leagueMatch ? leagueMatch[1].trim() : '',
      rank: rankMatch ? parseInt(rankMatch[1]) : null,
      points: pointsMatch ? pointsMatch[1] : '0:0',
    });
  }
  return { teams, fetchedAt: new Date().toISOString() };
}

// ─── MATCHES ─────────────────────────────────────────────────────────────────

async function fetchMatches() {
  const res = await fetch(`${BASE}/clubMeetings?club=${CLUB_ID}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const html = await res.text();
  return parseMatches(html);
}

function parseMatches(html) {
  const matches = [];

  // Nur den Bereich ab der Begegnungstabelle parsen
  const tableStart = html.indexOf('Begegnungen im Zeitraum');
  if (tableStart === -1) return { matches: [], upcoming: [], played: [], fetchedAt: new Date().toISOString() };
  const tableHtml = html.slice(tableStart);

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let currentDate = '';
  let currentTime = '';
  let match;

  while ((match = rowRegex.exec(tableHtml)) !== null) {
    const row = match[1];

    // Alle <td>-Inhalte als rohes HTML
    const rawCells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(row)) !== null) {
      rawCells.push(cellMatch[1]);
    }
    if (rawCells.length < 5) continue;

    // Datum & Uhrzeit
    const dateTimeText = stripTags(rawCells[1] || '');
    const dateMatch = dateTimeText.match(/(\d{2}\.\d{2}\.\d{4})/);
    const timeMatch = dateTimeText.match(/(\d{2}:\d{2})/);
    if (dateMatch) currentDate = dateMatch[1];
    if (timeMatch) currentTime = timeMatch[1];

    // Liga: &nbsp; und Leerzeichen entfernen
    const liga = stripTags(rawCells[2] || '').replace(/[\u00a0\s]+/g, ' ').trim();

    // Teamnamen NUR aus <a>-Links (vermeidet Routenplan-Text)
    const homeName = extractTeamName(rawCells[3] || '');
    const awayName = extractTeamName(rawCells[4] || '');

    if (!homeName || !awayName) continue;
    if (homeName === 'Heimmannschaft') continue;
    if (!homeName.includes('Nottuln') && !awayName.includes('Nottuln')) continue;

    // Ergebnis
    const scoreText = stripTags(rawCells[5] || '');
    const scoreMatch2 = scoreText.match(/(\d+):(\d+)/);

    // Status: hat es ein Ergebnis? → played. Sonst upcoming/rescheduled
    const statusText = stripTags(rawCells[rawCells.length - 1] || '').toLowerCase();
    let status;
    if (scoreMatch2) {
      status = 'played';
    } else if (statusText.includes('urspr')) {
      status = 'rescheduled';
    } else {
      status = 'upcoming';
    }

    matches.push({
      date: currentDate,
      time: currentTime,
      league: liga,
      home: homeName,
      away: awayName,
      homeScore: scoreMatch2 ? scoreMatch2[1] : null,
      awayScore: scoreMatch2 ? scoreMatch2[2] : null,
      status,
      isHome: homeName.includes('Nottuln'),
    });
  }

  return {
    matches,
    upcoming: matches.filter(m => m.status !== 'played'),
    played:   matches.filter(m => m.status === 'played'),
    fetchedAt: new Date().toISOString(),
  };
}

function extractTeamName(html) {
  const linkMatch = html.match(/teamPortrait[^"]*"[^>]*>([^<]+)<\/a>/);
  if (linkMatch) return linkMatch[1].trim();
  const plain = stripTags(html).replace(/[\u00a0]+/g, '').trim();
  return plain || null;
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
