// api/nuliga.js
// Vercel Serverless Function — nuLiga Proxy für BTV Nottuln

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
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // CORS headers auf alle Antworten
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    const type = req.query.type || 'matches';

    if (type === 'teams') {
      const data = await fetchTeams();
      res.status(200).json(data);
    } else {
      const data = await fetchMatches();
      res.status(200).json(data);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── TEAMS ───────────────────────────────────────────────────────────────────

async function fetchTeams() {
  const res = await fetch(`${BASE}/clubTeams?club=${CLUB_ID}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BTVNottulnBot/1.0)' },
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
    if (seasonMatch) {
      currentSeason = seasonMatch[1];
      continue;
    }

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
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BTVNottulnBot/1.0)' },
  });
  const html = await res.text();
  return parseMatches(html);
}

function parseMatches(html) {
  const matches = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let currentDate = '';
  let currentTime = '';
  let match;

  while ((match = rowRegex.exec(html)) !== null) {
    const row = match[1];
    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(row)) !== null) {
      cells.push(stripTags(cellMatch[1]).trim());
    }

    if (cells.length < 5) continue;

    // Datum erkennen (z.B. "03.05.2026 10:00")
    const dateTimeMatch = cells[1] && cells[1].match(/(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})/);
    if (dateTimeMatch) {
      currentDate = dateTimeMatch[1];
      currentTime = dateTimeMatch[2];
    }

    const liga = cells[2] || '';
    const home = cleanTeamName(cells[3] || '');
    const away = cleanTeamName(cells[4] || '');

    if (!home || !away || liga === 'Liga' || liga === '') continue;
    if (!home.includes('Nottuln') && !away.includes('Nottuln')) continue;

    const statusRaw = cells[8] || cells[7] || '';
    const status = statusRaw.includes('urspr')
      ? 'rescheduled'
      : statusRaw.includes('offen') || statusRaw === ''
        ? 'upcoming'
        : 'played';

    const scoreMatch = (cells[5] || '').match(/(\d+):(\d+)/);

    matches.push({
      date: currentDate,
      time: currentTime,
      league: liga,
      home,
      away,
      homeScore: scoreMatch ? scoreMatch[1] : null,
      awayScore: scoreMatch ? scoreMatch[2] : null,
      status,
      isHome: home.includes('Nottuln'),
    });
  }

  return {
    matches,
    upcoming: matches.filter(m => m.status !== 'played'),
    played: matches.filter(m => m.status === 'played'),
    fetchedAt: new Date().toISOString(),
  };
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanTeamName(name) {
  return name.replace(/\[\[Routenplan\]\]/g, '').replace(/\s+/g, ' ').trim();
}
