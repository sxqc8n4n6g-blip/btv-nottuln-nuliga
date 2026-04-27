// api/nuliga.js
// Vercel Serverless Function — nuLiga Proxy für BTV Nottuln
// Deploy auf Vercel: https://vercel.com/new → dieses File in /api/ ablegen

export const config = { runtime: 'edge' };

const CLUB_ID = '26684';
const BASE = 'https://wtv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa';

// CORS-Header für Framer
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 's-maxage=900, stale-while-revalidate=3600', // 15 Min Cache
  'Content-Type': 'application/json',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'matches'; // 'matches' | 'teams'

    if (type === 'teams') {
      const data = await fetchTeams();
      return new Response(JSON.stringify(data), { headers: CORS });
    } else {
      const data = await fetchMatches();
      return new Response(JSON.stringify(data), { headers: CORS });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: CORS,
    });
  }
}

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
  // Tabellenzeilen mit Mannschaften extrahieren
  const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  const rows = html.match(rowRegex) || [];

  let currentSeason = '';

  for (const row of rows) {
    // Saison-Header erkennen
    const seasonMatch = row.match(/Sommer \d{4}|Winter \d{4}\/\d{4}|Vereinspokal \d{4}/i);
    if (seasonMatch) {
      currentSeason = seasonMatch[0];
      continue;
    }

    // Mannschafts-Links extrahieren
    const teamMatch = row.match(/teamPortrait\?team=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/);
    if (!teamMatch) continue;

    const rankMatch = row.match(/<td[^>]*>\s*(\d+)\s*<\/td>/g);
    const pointsMatch = row.match(/(\d+:\d+)\s*<\/td>/);
    const leagueMatch = row.match(/groupPage[^"]*"[^>]*>([^<]+)<\/a>/);
    const leaderMatch = row.match(/<td[^>]*>([^<(]+)\s*\([^)]+\)\s*<\/td>/);

    teams.push({
      season: currentSeason,
      teamId: teamMatch[1],
      name: teamMatch[2].trim(),
      league: leagueMatch ? leagueMatch[1].trim() : '',
      rank: rankMatch ? parseInt(rankMatch[0].replace(/<[^>]+>/g, '').trim()) : null,
      points: pointsMatch ? pointsMatch[1] : '0:0',
      leader: leaderMatch ? leaderMatch[1].trim() : '',
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

  // Tabellen-Rows aus Begegnungsübersicht parsen
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  // Letzten relevanten Block nehmen (Begegnungstabelle)
  const mainTable = tableMatch[tableMatch.length - 1] || '';

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let currentDate = '';
  let currentTime = '';

  let match;
  while ((match = rowRegex.exec(mainTable)) !== null) {
    const row = match[1];
    const cells = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(row)) !== null) {
      cells.push(stripTags(cellMatch[1]).trim());
    }

    if (cells.length < 5) continue;

    // Datum-Zelle erkennen (Format: "So." oder "Sa." etc.)
    const dayMatch = cells[0].match(/^(Mo|Di|Mi|Do|Fr|Sa|So)\./);
    if (dayMatch) {
      currentDate = cells[1] ? cells[1].split(' ')[0] : currentDate;
      currentTime = cells[1] ? (cells[1].split(' ')[1] || '') : currentTime;
    }

    // Liga, Heim, Gast extrahieren
    const liga = cells[2] || '';
    const home = cells[3] || '';
    const away = cells[4] || '';

    if (!home || !away || home === 'Heimmannschaft') continue;
    if (liga === '' || liga === 'Liga') continue;

    // Ergebnis/Status
    const matchScore = cells[5] || '';
    const setScore = cells[6] || '';
    const status = cells[8] || cells[7] || 'offen';

    // Heimspiel für BTV Nottuln?
    const isHome = home.includes('BTV Nottuln') || home.includes('Nottuln');

    matches.push({
      date: currentDate,
      time: currentTime,
      league: liga,
      home: cleanTeamName(home),
      away: cleanTeamName(away),
      homeScore: matchScore.split(':')[0] || null,
      awayScore: matchScore.split(':')[1] || null,
      status: status.includes('offen') ? 'upcoming' : status.includes('urspr') ? 'rescheduled' : 'played',
      isHome,
      isBTVGame: home.includes('Nottuln') || away.includes('Nottuln'),
    });
  }

  // Nur BTV-relevante Spiele, ohne Duplikate
  const btv = matches.filter(m => m.isBTVGame);

  return {
    matches: btv,
    upcoming: btv.filter(m => m.status === 'upcoming' || m.status === 'rescheduled'),
    played: btv.filter(m => m.status === 'played'),
    fetchedAt: new Date().toISOString(),
  };
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanTeamName(name) {
  return name.replace(/\[\[Routenplan\]\]/g, '').replace(/\s+/g, ' ').trim();
}
