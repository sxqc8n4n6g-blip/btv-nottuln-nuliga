// api/nuliga.js — v18
const CLUB_ID = '26684';
const BASE = 'https://wtv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// Alle Mannschaften mit teamPortrait-ID – Sommer, Winter, Vereinspokal
const ALL_TEAMS = [
  // Sommer 2026 – Damen
  { id: '3531446', name: 'Damen 30 4er 1',                     championship: 'MS+2026',           season: 'Sommer 2026' },
  { id: '3654270', name: 'Damen 30 4er 2',                     championship: 'MS+2026',           season: 'Sommer 2026' },
  { id: '3529551', name: 'Damen 50 Doppel 1',                  championship: 'MS+2026',           season: 'Sommer 2026' },
  // Sommer 2026 – Herren
  { id: '3670513', name: 'Herren 6er 1',                       championship: 'MS+2026',           season: 'Sommer 2026' },
  { id: '3531896', name: 'Herren 4er 2',                       championship: 'MS+2026',           season: 'Sommer 2026' },
  { id: '3670517', name: 'Herren 30 4er 1',                    championship: 'MS+2026',           season: 'Sommer 2026' },
  { id: '3530933', name: 'Herren 30 4er 2',                    championship: 'MS+2026',           season: 'Sommer 2026' },
  { id: '3534887', name: 'Herren 40 4er 1',                    championship: 'MS+2026',           season: 'Sommer 2026' },
  { id: '3530112', name: 'Herren 50 4er 1',                    championship: 'MS+2026',           season: 'Sommer 2026' },
  { id: '3654372', name: 'Herren 55 4er 1',                    championship: 'MS+2026',           season: 'Sommer 2026' },
  { id: '3533302', name: 'Herren 60 Doppel 1',                 championship: 'MS+2026',           season: 'Sommer 2026' },
  // Sommer 2026 – Jugend
  { id: '3528879', name: 'Junioren U15 2er 1',                 championship: 'MS+2026',           season: 'Sommer 2026' },
  { id: '3666813', name: 'Junioren U12 2er Gruener Ball 1',    championship: 'MS+2026',           season: 'Sommer 2026' },
  { id: '3532988', name: 'Juniorinnen U18 2er 1',              championship: 'MS+2026',           season: 'Sommer 2026' },
  { id: '3666814', name: 'Gemischt U10 Midcourt 2er 1',        championship: 'MS+2026',           season: 'Sommer 2026' },
  { id: '3659367', name: 'Gemischt U8 Kleinfeld 2er 1',        championship: 'MS+2026',           season: 'Sommer 2026' },
  // Vereinspokal 2026
  { id: '3535767', name: 'Herren Offen Generali LK 13-25,0 1', championship: 'WTV+VP+2026',      season: 'Vereinspokal 2026' },
  { id: '3659835', name: 'Damen Ue40 Generali LK 15,0-25,0 1', championship: 'WTV+VP+2026',      season: 'Vereinspokal 2026' },
  // Winter 2025/26 – Herren
  { id: '3491050', name: 'Herren 4er 1',                       championship: 'MS+Winter+25%2F26', season: 'Winter 2025/26' },
  { id: '3469632', name: 'Herren 30 4er 1',                    championship: 'MS+Winter+25%2F26', season: 'Winter 2025/26' },
  { id: '3491051', name: 'Herren 30 4er 2',                    championship: 'MS+Winter+25%2F26', season: 'Winter 2025/26' },
  { id: '3491052', name: 'Herren 40 4er 1',                    championship: 'MS+Winter+25%2F26', season: 'Winter 2025/26' },
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
      if (req.query.debug === '1') {
        const si = html.indexOf('Einzelspiele');
        const di = html.indexOf('Doppelspiele');
        const rows = [];
        if (si !== -1) {
          const section = di !== -1 ? html.slice(si, di) : html.slice(si, si+3000);
          const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
          let rm;
          while ((rm = rowRe.exec(section)) !== null) {
            const cells = [];
            const cr = /<td[^>]*>([\s\S]*?)<\/td>/gi;
            let cm2;
            while ((cm2 = cr.exec(rm[1])) !== null) {
              cells.push(cm2[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,60));
            }
            if (cells.length) rows.push({ n: cells.length, c: cells });
          }
        }
        return res.status(200).json({ singlesFound: si !== -1, doublesFound: di !== -1, rows });
      }
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

  // Einzel: 10 Zellen pro Zeile
  // 0=Nr, 1=Spieler1, 2=Nr, 3=Spieler2, 4=Satz1, 5=Satz2, 6=Satz3, 7=Sätze, 8=Matches, 9=Games
  if (singlesStart !== -1 && doublesStart !== -1) {
    const singlesHtml = html.slice(singlesStart, doublesStart);
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;
    while ((m = rowRe.exec(singlesHtml)) !== null) {
      const cells = [];
      const cr = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cm;
      while ((cm = cr.exec(m[1])) !== null) cells.push(cm[1]);
      if (cells.length < 10) continue;
      const p1 = extractPlayerName(cells[1]);
      const p2 = extractPlayerName(cells[3]);
      if (!p1 || !p2 || p1.name.length < 3 || p2.name.length < 3) continue;
      const s1 = strip(cells[4]);
      const s2 = strip(cells[5]);
      const s3 = strip(cells[6]);
      // Zelle 8 = Matches-Ergebnis (z.B. "2:1"), Zelle 7 = Sätze, Zelle 9 = Games
      const result = strip(cells[8]);
      if (!result.match(/\d:\d/)) continue;
      singles.push({ player1: p1.name, player1lk: p1.lk, player2: p2.name, player2lk: p2.lk, set1: s1, set2: s2, set3: s3, result: result });
    }
  }

  // Doppel: 12 Zellen
  // 0=Nr1+Nr2, 1=Rang, 2=Spieler1a+1b, 3=Nr1+Nr2, 4=Rang, 5=Spieler2a+2b, 6=Satz1, 7=Satz2, 8=Satz3, 9=Matches, 10=Sätze, 11=Games
  if (doublesStart !== -1) {
    const doublesHtml = html.slice(doublesStart);
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;
    while ((m = rowRe.exec(doublesHtml)) !== null) {
      const cells = [];
      const cr = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cm;
      while ((cm = cr.exec(m[1])) !== null) cells.push(cm[1]);
      if (cells.length < 12) continue;
      const p1names = extractAllPlayerNames(cells[2]);
      const p2names = extractAllPlayerNames(cells[5]);
      if (!p1names.length || !p2names.length) continue;
      const s1 = strip(cells[6]);
      const s2 = strip(cells[7]);
      const s3 = strip(cells[8]);
      const result = strip(cells[9]);
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
  // Spielerportrait als title-Attribut: <a title="Spielerportrait">Name (Nr, LKxx,x)</a>
  const m = html.match(/title="Spielerportrait"[^>]*>([^<]+)<\/a>/);
  if (m) {
    const raw = m[1].trim();
    const lkMatch = raw.match(/LK(\d+[\.,]\d+)/);
    const name = raw.replace(/\s*\(.*?\)\s*/g, '').replace(/\s+/g, ' ').trim();
    return { name: name, lk: lkMatch ? lkMatch[1].replace(',', '.') : null };
  }
  // Fallback: plain text
  const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const lkMatch = plain.match(/LK(\d+[\.,]\d+)/);
  const nameMatch = plain.match(/^([A-ZÄÖÜa-zäöüß\s,\-]+?)\s*\(\d/);
  const name = nameMatch ? nameMatch[1].trim() : plain.split('(')[0].trim();
  if (!name || name.length < 3) return null;
  return { name: name, lk: lkMatch ? lkMatch[1].replace(',', '.') : null };
}

function extractAllPlayerNames(html) {
  if (!html) return [];
  const names = [];
  // Erst mit title="Spielerportrait" suchen
  const re = /title="Spielerportrait"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1].replace(/\s*\(.*?\)\s*/g, '').replace(/\s+/g, ' ').trim();
    if (name && name.length > 2) names.push(name);
  }
  if (names.length) return names;
  // Fallback: plain text, mehrere Spieler durch Zeilenumbruch getrennt
  const plain = html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
  const lines = plain.split('\n');
  for (var i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const nameMatch = line.match(/^([A-ZÄÖÜa-zäöüß\s,\-]+?)\s*\(\d/);
    if (nameMatch && nameMatch[1].trim().length > 2) names.push(nameMatch[1].trim());
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

  // Alle Mannschaften über teamPortrait laden (enthält Ergebnisse + anstehende Spiele)
  const teamHtmls = await Promise.all(
    ALL_TEAMS.map(function(t) {
      return get(BASE + '/teamPortrait?team=' + t.id + '&championship=' + t.championship);
    })
  );

  const allTeamMatches = [];
  for (var i = 0; i < ALL_TEAMS.length; i++) {
    var matches = parseTeamPortrait(teamHtmls[i], ALL_TEAMS[i].name, ALL_TEAMS[i].season);
    for (var j = 0; j < matches.length; j++) allTeamMatches.push(matches[j]);
  }

  // Deduplizieren: gleiche Partie kann in Heim- und Gastteam-Seite auftauchen
  const seen = {};
  const all = [];
  for (var i = 0; i < allTeamMatches.length; i++) {
    const match = allTeamMatches[i];
    const key = match.date + '|' + match.home + '|' + match.away + '|' + match.season;
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

  // Bereich "Spieltermine" finden – auch "Begegnungen" als Fallback
  let startIdx = html.indexOf('Spieltermine');
  if (startIdx === -1) startIdx = html.indexOf('Begegnungen');
  if (startIdx === -1) return matches;

  // Suche nach dem nächsten Abschnitt NACH dem Spieltermine-Block
  const secondH2 = html.indexOf('<h2', startIdx + 100);
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
    if (homeRaw === 'Heimmannschaft' || homeRaw === 'Datum') continue;
    // Spielfreie Spieltage überspringen
    if (awayRaw.toLowerCase() === 'spielfrei' || homeRaw.toLowerCase() === 'spielfrei') continue;
    // Sieger aus Begegnung (noch nicht ausgelost) überspringen
    if (homeRaw.includes('Sieger aus') || awayRaw.includes('Sieger aus')) continue;

    const isHome = homeRaw.includes('Nottuln') || homeRaw.includes('BTV');
    const isBTVAway = awayRaw.includes('Nottuln') || awayRaw.includes('BTV');
    // Wenn keines der Teams BTV ist, überspringen
    if (!isHome && !isBTVAway) continue;

    const home = isHome ? btvTeamName : homeRaw;
    const away = isBTVAway ? btvTeamName : awayRaw;

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
