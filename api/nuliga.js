// api/nuliga.js — v16
const CLUB_ID = '26684';
const BASE = 'https://wtv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

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

    // Spielbericht-Endpunkt: /api/nuliga?type=report&meeting=12463656&championship=MS+Winter+25%2F26
    if (type === 'report') {
      const meeting = req.query.meeting;
      const championship = req.query.championship || '';
      if (!meeting) return res.status(400).json({ error: 'meeting parameter required' });
      const url = BASE + '/meetingReport?meeting=' + meeting + '&federation=WTV' + (championship ? '&championship=' + championship : '');
      const html = await get(url);
      return res.status(200).json(parseMeetingReport(html));
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

// ─── SPIELBERICHT PARSER ─────────────────────────────────────────────────────

function parseMeetingReport(html) {
  const singles = [];
  const doubles = [];

  // Titelzeile für Kontext
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? strip(titleMatch[1]) : '';

  // Einzelspiele-Tabelle
  const singlesStart = html.indexOf('Einzelspiele');
  const doublesStart = html.indexOf('Doppelspiele');
  if (singlesStart !== -1 && doublesStart !== -1) {
    const singlesHtml = html.slice(singlesStart, doublesStart);
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;
    while ((m = rowRe.exec(singlesHtml)) !== null) {
      const row = m[1];
      const cells = [];
      const cr = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cm;
      while ((cm = cr.exec(row)) !== null) cells.push(cm[1]);
      if (cells.length < 10) continue;

      const p1 = extractPlayerName(cells[1]);
      const p2 = extractPlayerName(cells[4]);
      if (!p1 || !p2) continue;
      if (p1 === 'Dorstener TC 1' || p1 === 'BTV Nottuln') continue;

      const s1 = strip(cells[6]);
      const s2 = strip(cells[7]);
      const s3 = strip(cells[8]);
      const score = strip(cells[9]);

      singles.push({ player1: p1, player2: p2, set1: s1, set2: s2, set3: s3, result: score });
    }
  }

  // Doppelspiele-Tabelle
  if (doublesStart !== -1) {
    const doublesHtml = html.slice(doublesStart);
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;
    while ((m = rowRe.exec(doublesHtml)) !== null) {
      const row = m[1];
      const cells = [];
      const cr = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cm;
      while ((cm = cr.exec(row)) !== null) cells.push(cm[1]);
      if (cells.length < 10) continue;

      // Doppel hat zwei Spieler pro Seite in getrennten <a>-Tags
      const p1names = extractAllPlayerNames(cells[1]);
      const p2names = extractAllPlayerNames(cells[4]);
      if (!p1names.length || !p2names.length) continue;
      if (p1names[0].match(/^\d+$/) || p2names[0].match(/^\d+$/)) continue;

      const s1 = strip(cells[6]);
      const s2 = strip(cells[7]);
      const s3 = strip(cells[8]);
      const score = strip(cells[9]);

      doubles.push({
        player1: p1names.join(' / '),
        player2: p2names.join(' / '),
        set1: s1, set2: s2, set3: s3,
        result: score
      });
    }
  }

  return { title: title, singles: singles, doubles: doubles };
}

function extractPlayerName(html) {
  if (!html) return null;
  // Name steht im Link-Text, ohne LK und Jahrgang
  const m = html.match(/Spielerportrait[^>]*>([\s\S]*?)<\/a>/);
  if (m) {
    return m[1].replace(/<[^>]+>/g, '').replace(/\s*\(.*?\)\s*/g, '').replace(/\s+/g, ' ').trim();
  }
  const plain = strip(html);
  if (plain && !plain.match(/^\d+$/) && plain.length > 2) return plain;
  return null;
}

function extractAllPlayerNames(html) {
  if (!html) return [];
  const names = [];
  const re = /Spielerportrait[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1].replace(/<[^>]+>/g, '').replace(/\s*\(.*?\)\s*/g, '').replace(/\s+/g, ' ').trim();
    if (name && name.length > 2) names.push(name);
  }
  return names;
}

// ─── TEAMS ───────────────────────────────────────────────────────────────────

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

// ─── MATCHES ─────────────────────────────────────────────────────────────────

async function fetchMatches() {
  const teamMap = await buildTeamMap();

  const summerHtml = await get(BASE + '/clubMeetings?club=' + CLUB_ID);
  const summerMatches = parseClubMeetings(summerHtml, teamMap, 'Sommer 2026');

  const winterHtmls = await Promise.all(
    WINTER_TEAMS.map(function(t) {
      return get(BASE + '/teamPortrait?team=' + t.id + '&championship=' + t.championship);
    })
  );

  const winterMatches = [];
  for (let i = 0; i < WINTER_TEAMS.length; i++) {
    const matches = parseTeamPortrait(winterHtmls[i], WINTER_TEAMS[i].name, 'Winter 2025/26');
    for (let j = 0; j < matches.length; j++) winterMatches.push(matches[j]);
  }

  const combined = winterMatches.concat(summerMatches);
  const seen = {};
  const all = [];
  for (let i = 0; i < combined.length; i++) {
    const match = combined[i];
    const key = match.date + '|' + match.home + '|' + match.away;
    if (!seen[key]) { seen[key] = true; all.push(match); }
  }

  all.sort(function(a, b) {
    function ms(s) { const p = s.split('.'); return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0])).getTime(); }
    return ms(a.date) - ms(b.date);
  });

  return {
    matches: all,
    upcoming: all.filter(function(m) { return m.status !== 'played'; }),
    played:   all.filter(function(m) { return m.status === 'played'; }),
    fetchedAt: new Date().toISOString(),
  };
}

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
    const cr = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cr.exec(row)) !== null) cells.push(cm[1]);
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

    // Gegner-Team URL für Link
    const opponentId = homeIsBTV ? awayId : homeId;
    const opponentUrl = opponentId
      ? BASE + '/teamPortrait?federation=WTV&team=' + opponentId
      : null;

    const scoreM = strip(cells[6] || '').match(/(\d+):(\d+)/);
    const statusText = strip(cells[cells.length - 1]).toLowerCase();
    const status = scoreM ? 'played'
      : statusText.indexOf('urspr') !== -1 ? 'rescheduled'
      : 'upcoming';

    // Meeting-ID für Spielbericht
    const meetingMatch = (cells[cells.length - 1] || '').match(/meeting=(\d+)/);
    const meetingId = meetingMatch ? meetingMatch[1] : null;

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
      opponentUrl: opponentUrl,
      meetingId: meetingId,
    });
  }
  return matches;
}

function parseTeamPortrait(html, btvTeamName, season) {
  const matches = [];

  const startIdx = html.indexOf('Spieltermine');
  if (startIdx === -1) return matches;

  let endIdx = html.indexOf('Spieler -', startIdx);
  if (endIdx === -1) endIdx = html.indexOf('<h2', startIdx + 100);
  if (endIdx === -1) endIdx = startIdx + 5000;

  const tableHtml = html.slice(startIdx, endIdx);

  const ligaMatch = tableHtml.match(/Spieltermine[^<\n]*?[-–]\s*([^\n<]+)/);
  const liga = ligaMatch ? ligaMatch[1].trim() : season;

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  let currentDate = '';
  let currentTime = '';

  while ((m = rowRe.exec(tableHtml)) !== null) {
    const row = m[1];
    const cells = [];
    const cr = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cr.exec(row)) !== null) cells.push(cm[1]);
    if (cells.length < 6) continue;

    const dt = strip(cells[1]);
    const dm = dt.match(/(\d{2}\.\d{2}\.\d{4})/);
    const tm = dt.match(/(\d{2}:\d{2})/);
    if (dm) currentDate = dm[1];
    if (tm) currentTime = tm[1];
    if (!currentDate) continue;

    const homeRaw = strip(cells[3]);
    const awayRaw = strip(cells[4]);
    if (!homeRaw || !awayRaw) continue;
    if (homeRaw.match(/^\d{8,}$/) || awayRaw.match(/^\d{8,}$/)) continue;
    if (homeRaw === 'Heimmannschaft' || homeRaw === 'Datum') continue;

    const isHome = homeRaw.includes('Nottuln') || homeRaw.includes('BTV');
    const home = isHome ? btvTeamName : homeRaw;
    const away = isHome ? awayRaw : (awayRaw.includes('Nottuln') ? btvTeamName : awayRaw);

    // Gegner-URL
    const opponentCell = isHome ? cells[4] : cells[3];
    const opponentId = extractTeamId(opponentCell);
    const opponentUrl = opponentId
      ? BASE + '/teamPortrait?federation=WTV&team=' + opponentId
      : null;

    // Meeting-ID für Spielbericht (in "anzeigen"-Link)
    const meetingMatch = (cells[7] || cells[8] || '').match(/meeting=(\d+)/);
    const meetingId = meetingMatch ? meetingMatch[1] : null;
    const championshipMatch = (cells[7] || cells[8] || '').match(/championship=([^&"]+)/);
    const championship = championshipMatch ? decodeURIComponent(championshipMatch[1]) : '';

    const scoreText = strip(cells[5] || '');
    const scoreM = scoreText.match(/^(\d+):(\d+)$/);
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
      opponentUrl: opponentUrl,
      meetingId: meetingId,
      championship: championship,
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
