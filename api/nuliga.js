// api/nuliga.js — v17
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
    if (type === 'report') {
      const meeting = req.query.meeting;
      const championship = req.query.championship || '';
      if (!meeting) return res.status(400).json({ error: 'meeting parameter required' });
      // championship kommt bereits URL-encoded von Framer an – direkt weitergeben
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
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? strip(titleMatch[1]) : '';

  const singlesStart = html.indexOf('Einzelspiele');
  const doublesStart = html.indexOf('Doppelspiele');

  // Einzel: 12 Zellen pro Zeile
  // 0=Nr, 1=Spieler1, 2=leer, 3=Nr, 4=Spieler2, 5=leer, 6=Satz1, 7=Satz2, 8=Satz3, 9=Matches, 10=Sätze, 11=Games
  if (singlesStart !== -1 && doublesStart !== -1) {
    const singlesHtml = html.slice(singlesStart, doublesStart);
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;
    while ((m = rowRe.exec(singlesHtml)) !== null) {
      const cells = [];
      const cr = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cm;
      while ((cm = cr.exec(m[1])) !== null) cells.push(cm[1]);
      if (cells.length < 12) continue;
      const p1 = extractPlayerName(cells[1]);
      const p2 = extractPlayerName(cells[4]);
      if (!p1 || !p2 || p1.length < 3 || p2.length < 3) continue;
      // Satzstände z.B. "4:6", "1:6"
      const s1 = strip(cells[6]);
      const s2 = strip(cells[7]);
      const s3 = strip(cells[8]);
      // Match-Ergebnis z.B. "0:1"
      const result = strip(cells[9]);
      if (!result.match(/\d:\d/)) continue;
      singles.push({ player1: p1, player2: p2, set1: s1, set2: s2, set3: s3, result: result });
    }
  }

  // Doppel: 15 Zellen pro Zeile
  // 0=Nr1, 1=Nr2, 2=Rang, 3=Spieler1a+1b, 4=leer, 5=Nr1, 6=Nr2, 7=Spieler2a+2b, 8=leer, 9=Satz1, 10=Satz2, 11=Satz3, 12=Matches, 13=Sätze, 14=Games
  if (doublesStart !== -1) {
    const doublesHtml = html.slice(doublesStart);
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;
    while ((m = rowRe.exec(doublesHtml)) !== null) {
      const cells = [];
      const cr = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cm;
      while ((cm = cr.exec(m[1])) !== null) cells.push(cm[1]);
      if (cells.length < 15) continue;
      const p1names = extractAllPlayerNames(cells[3]);
      const p2names = extractAllPlayerNames(cells[7]);
      if (!p1names.length || !p2names.length) continue;
      const s1 = strip(cells[9]);
      const s2 = strip(cells[10]);
      const s3 = strip(cells[11]);
      const result = strip(cells[12]);
      if (!result.match(/\d:\d/)) continue;
      doubles.push({
        player1: p1names.join(' / '), player2: p2names.join(' / '),
        set1: s1, set2: s2, set3: s3, result: result,
      });
    }
  }

  return { title: title, singles: singles, doubles: doubles };
}

function extractPlayerName(html) {
  if (!html) return null;
  // Spielerportrait steht als title-Attribut: <a ... title="Spielerportrait">Name</a>
  const m = html.match(/title="Spielerportrait"[^>]*>([^<]+)<\/a>/);
  if (m) return m[1].replace(/\s*\(.*?\)\s*/g, '').replace(/\s+/g, ' ').trim();
  return null;
}

function extractAllPlayerNames(html) {
  if (!html) return [];
  const names = [];
  const re = /title="Spielerportrait"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1].replace(/\s*\(.*?\)\s*/g, '').replace(/\s+/g, ' ').trim();
    if (name && name.length > 2) names.push(name);
  }
  return names;
}

// ─── TEAM MAP ────────────────────────────────────────────────────────────────

async function buildTeamMap() {
  const html = await get(BASE + '/clubTeams?club=' + CLUB_ID);
  const map = {};
  const re = /teamPortrait\?team=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) map[m[1]] = m[2].trim();
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
      const tm = row.match(/teamPortrait\?team=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/);
      if (tm) {
        teams.push({
          season: currentSeason, teamId: tm[1], name: tm[2].trim(),
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
  for (var i = 0; i < WINTER_TEAMS.length; i++) {
    var matches = parseTeamPortrait(winterHtmls[i], WINTER_TEAMS[i].name, 'Winter 2025/26');
    for (var j = 0; j < matches.length; j++) winterMatches.push(matches[j]);
  }

  const combined = winterMatches.concat(summerMatches);
  const seen = {};
  const all = [];
  for (var i = 0; i < combined.length; i++) {
    const match = combined[i];
    const key = match.date + '|' + match.home + '|' + match.away;
    if (!seen[key]) { seen[key] = true; all.push(match); }
  }

  all.sort(function(a, b) {
    function ms(s) { const p = s.split('.'); return new Date(+p[2], +p[1]-1, +p[0]).getTime(); }
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
    const cells = [];
    const cr = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cr.exec(m[1])) !== null) cells.push(cm[1]);
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
    const homeIsBTV = !!(homeId && teamMap[homeId]);
    const awayIsBTV = !!(awayId && teamMap[awayId]);
    if (!homeIsBTV && !awayIsBTV) continue;

    const home = homeIsBTV ? teamMap[homeId] : (extractTeamName(cells[4]) || strip(cells[4]));
    const away = awayIsBTV ? teamMap[awayId] : (extractTeamName(cells[5]) || strip(cells[5]));
    if (!home || !away || home === 'Heimmannschaft') continue;

    const opponentId = homeIsBTV ? awayId : homeId;
    const opponentUrl = opponentId ? BASE + '/teamPortrait?federation=WTV&team=' + opponentId : null;

    const scoreM = strip(cells[6] || '').match(/(\d+):(\d+)/);
    const lastCell = cells[cells.length - 1] || '';
    const statusText = strip(lastCell).toLowerCase();
    const status = scoreM ? 'played' : statusText.indexOf('urspr') !== -1 ? 'rescheduled' : 'upcoming';

    // meetingId aus letzter Zelle
    const meetingMatch = lastCell.match(/meeting=(\d+)/);
    const champMatch = lastCell.match(/championship=([^&"]+)/);

    matches.push({
      date: currentDate, time: currentTime, season: season, league: liga,
      home: home, away: away,
      homeScore: scoreM ? scoreM[1] : null, awayScore: scoreM ? scoreM[2] : null,
      status: status, isHome: homeIsBTV,
      opponentUrl: opponentUrl,
      meetingId: meetingMatch ? meetingMatch[1] : null,
      championship: champMatch ? decodeURIComponent(champMatch[1]) : '',
    });
  }
  return matches;
}

function parseTeamPortrait(html, btvTeamName, season) {
  const matches = [];

  // Bereich "Spieltermine" bis "Spieler -" isolieren
  const startIdx = html.indexOf('Spieltermine');
  if (startIdx === -1) return matches;

  // Suche nach dem zweiten h2 (Spieler-Abschnitt) NACH startIdx
  const secondH2 = html.indexOf('<h2', startIdx + 50);
  const spielerIdx = html.indexOf('Spieler -', startIdx);
  let endIdx = html.length;
  if (secondH2 !== -1) endIdx = Math.min(endIdx, secondH2);
  if (spielerIdx !== -1) endIdx = Math.min(endIdx, spielerIdx);

  const tableHtml = html.slice(startIdx, endIdx);

  const ligaMatch = tableHtml.match(/Spieltermine[^<\n]*?[-–]\s*([^\n<]+)/);
  const liga = ligaMatch ? ligaMatch[1].trim() : season;

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  let currentDate = '';
  let currentTime = '';

  while ((m = rowRe.exec(tableHtml)) !== null) {
    const cells = [];
    const cr = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cr.exec(m[1])) !== null) cells.push(cm[1]);
    // Spieltermin-Zeilen haben 9 Zellen: Wochentag, Datum, Icon, Heim, Gast, Matches, Sätze, Games, Spielbericht
    if (cells.length < 8) continue;

    const dt = strip(cells[1]);
    const dm = dt.match(/(\d{2}\.\d{2}\.\d{4})/);
    const tm = dt.match(/(\d{2}:\d{2})/);
    if (dm) currentDate = dm[1];
    if (tm) currentTime = tm[1];
    if (!currentDate) continue;

    const homeRaw = strip(cells[3]);
    const awayRaw = strip(cells[4]);
    if (!homeRaw || !awayRaw) continue;
    if (homeRaw.match(/^\d{7,}$/) || awayRaw.match(/^\d{7,}$/)) continue;
    if (homeRaw === 'Heimmannschaft' || homeRaw === 'Datum' || homeRaw === 'Dorstener TC 1' && awayRaw === 'BTV Nottuln') continue;

    const isHome = homeRaw.includes('Nottuln') || homeRaw.includes('BTV');
    const home = isHome ? btvTeamName : homeRaw;
    const away = isHome
      ? awayRaw
      : (awayRaw.includes('Nottuln') ? btvTeamName : awayRaw);

    // Gegner-URL
    const opponentCell = isHome ? cells[4] : cells[3];
    const opponentId = extractTeamId(opponentCell);
    const opponentUrl = opponentId ? BASE + '/teamPortrait?federation=WTV&team=' + opponentId : null;

    // Score aus Zelle 5 (Matches)
    const scoreText = strip(cells[5] || '');
    const scoreM = scoreText.match(/^(\d+):(\d+)$/);

    // meetingId aus letzter Zelle (Zelle 8 = Spielbericht)
    const lastCell = cells[cells.length - 1] || '';
    const meetingMatch = lastCell.match(/meeting=(\d+)/);
    const champMatch = lastCell.match(/championship=([^&"]+)/);

    const status = scoreM ? 'played' : 'upcoming';

    matches.push({
      date: currentDate, time: currentTime, season: season, league: liga,
      home: home, away: away,
      homeScore: scoreM ? scoreM[1] : null, awayScore: scoreM ? scoreM[2] : null,
      status: status, isHome: isHome,
      opponentUrl: opponentUrl,
      meetingId: meetingMatch ? meetingMatch[1] : null,
      championship: champMatch ? decodeURIComponent(champMatch[1]) : 'MS+Winter+25%2F26',
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
