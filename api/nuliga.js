// api/nuliga.js — v19 (dynamische Saisonen)
const CLUB_ID = '26684';
const BASE = 'https://wtv.liga.nu/cgi-bin/WebObjects/nuLigaTENDE.woa/wa';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// Mannschaften, die NICHT angezeigt werden sollen (zurückgezogen / Fehler)
const EXCLUDED_TEAM_IDS = new Set([
  '3654372', // Herren 55 4er 1 – Sommer 2026 (Mannschaft zurückgezogen)
]);

// Vergangene Saisons, die nuLiga nicht mehr auf der clubTeams-Seite zeigt
// → werden immer mit geladen (als fester Fallback)
const PAST_TEAMS = [
  // Winter 2025/26 – Herren
  { id: '3491050', name: 'Herren 4er 1',       championship: 'MS+Winter+25%2F26', season: 'Winter 2025/26' },
  { id: '3469632', name: 'Herren 30 4er 1',    championship: 'MS+Winter+25%2F26', season: 'Winter 2025/26' },
  { id: '3491051', name: 'Herren 30 4er 2',    championship: 'MS+Winter+25%2F26', season: 'Winter 2025/26' },
  { id: '3491052', name: 'Herren 40 4er 1',    championship: 'MS+Winter+25%2F26', season: 'Winter 2025/26' },
];

// Championship-Parameter aus Saison-String ableiten
// "Sommer 2026"      → "MS+2026"
// "Winter 2025/26"   → "MS+Winter+25%2F26"
// "Winter 2026/27"   → "MS+Winter+26%2F27"
// "Vereinspokal 2026"→ "WTV+VP+2026"
function seasonToChampionship(season) {
  if (!season) return '';
  const s = season.trim();

  const vereinspokal = s.match(/Vereinspokal\s+(\d{4})/i);
  if (vereinspokal) return 'WTV+VP+' + vereinspokal[1];

  // "Winter 2026/2027" (4+4), "Winter 2026/27" (4+2), "Winter 25/26" (2+2)
  const winter44 = s.match(/Winter\s+(\d{4})\/(\d{4})/i);
  if (winter44) {
    return 'MS+Winter+' + winter44[1].slice(2) + '%2F' + winter44[2].slice(2);
  }
  const winter42 = s.match(/Winter\s+(\d{4})\/(\d{2})/i);
  if (winter42) {
    return 'MS+Winter+' + winter42[1].slice(2) + '%2F' + winter42[2];
  }
  const winter22 = s.match(/Winter\s+(\d{2})\/(\d{2})/i);
  if (winter22) return 'MS+Winter+' + winter22[1] + '%2F' + winter22[2];

  const sommer = s.match(/Sommer\s+(\d{4})/i);
  if (sommer) return 'MS+' + sommer[1];

  return '';
}

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
    if (type === 'discovery') return res.status(200).json(await discoverTeams());
    return res.status(200).json(await fetchMatches());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  return r.text();
}

// ─── DYNAMISCHE TEAMERKENNUNG ────────────────────────────────────────────────

// Liest alle Mannschaften direkt von der clubTeams-Seite.
// Gibt zurück: [{ id, name, season, championship }]
async function discoverTeams() {
  const html = await get(BASE + '/clubTeams?club=' + CLUB_ID);
  const teams = [];
  const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  let currentSeason = '';

  while ((m = re.exec(html)) !== null) {
    const row = m[1];
    // Saison-Header erkennen
    const s = row.match(/(Sommer \d{4}|Winter \d{4}\/\d{4}|Vereinspokal \d{4})/i);
    if (s) {
      currentSeason = s[1];
      continue;
    }
    const tm = row.match(/teamPortrait\?team=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/);
    if (!tm) continue;
    const teamId = tm[1];
    const teamName = tm[2].trim();
    if (EXCLUDED_TEAM_IDS.has(teamId)) continue;
    if (!currentSeason) continue;

    const championship = seasonToChampionship(currentSeason);
    if (!championship) continue;

    teams.push({ id: teamId, name: teamName, season: currentSeason, championship: championship });
  }

  return { teams: teams, fetchedAt: new Date().toISOString() };
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
      const result = strip(cells[8]);
      if (!result.match(/\d:\d/)) continue;
      singles.push({ player1: p1.name, player1lk: p1.lk, player2: p2.name, player2lk: p2.lk, set1: s1, set2: s2, set3: s3, result: result });
    }
  }

  // Doppel: 12 Zellen
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
  const m = html.match(/title="Spielerportrait"[^>]*>([^<]+)<\/a>/);
  if (m) {
    const raw = m[1].trim();
    const lkMatch = raw.match(/LK(\d+[\.,]\d+)/);
    const name = raw.replace(/\s*\(.*?\)\s*/g, '').replace(/\s+/g, ' ').trim();
    return { name: name, lk: lkMatch ? lkMatch[1].replace(',', '.') : null };
  }
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
  const re = /title="Spielerportrait"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1].replace(/\s*\(.*?\)\s*/g, '').replace(/\s+/g, ' ').trim();
    if (name && name.length > 2) names.push(name);
  }
  if (names.length) return names;
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
        if (EXCLUDED_TEAM_IDS.has(tm[1])) continue;
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
  // Teams dynamisch von clubTeams-Seite holen (aktuelle Saison/en)
  const discoveryResult = await discoverTeams();
  const dynamicTeams = discoveryResult.teams;

  // Vergangene Teams ergänzen, sofern nicht bereits enthalten
  const dynamicIds = new Set(dynamicTeams.map(function(t) { return t.id; }));
  const allTeams = dynamicTeams.slice();
  for (var pi = 0; pi < PAST_TEAMS.length; pi++) {
    if (!dynamicIds.has(PAST_TEAMS[pi].id) && !EXCLUDED_TEAM_IDS.has(PAST_TEAMS[pi].id)) {
      allTeams.push(PAST_TEAMS[pi]);
    }
  }

  // Alle teamPortrait-Seiten parallel laden
  const teamHtmls = await Promise.all(
    allTeams.map(function(t) {
      return get(BASE + '/teamPortrait?team=' + t.id + '&championship=' + t.championship);
    })
  );

  const allTeamMatches = [];
  for (var i = 0; i < allTeams.length; i++) {
    var matches = parseTeamPortrait(teamHtmls[i], allTeams[i].name, allTeams[i].season);
    for (var j = 0; j < matches.length; j++) allTeamMatches.push(matches[j]);
  }

  // Deduplizieren
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
    teamsLoaded: allTeams.length,
  };
}

function parseTeamPortrait(html, btvTeamName, season) {
  const matches = [];

  let startIdx = html.indexOf('Spieltermine');
  if (startIdx === -1) startIdx = html.indexOf('Begegnungen');
  if (startIdx === -1) return matches;

  const secondH2 = html.indexOf('<h2', startIdx + 100);
  const spielerIdx = html.indexOf('Spieler -', startIdx);
  let endIdx = html.length;
  if (secondH2 !== -1) endIdx = Math.min(endIdx, secondH2);
  if (spielerIdx !== -1) endIdx = Math.min(endIdx, spielerIdx);

  const tableHtml = html.slice(startIdx, endIdx);

  const ligaMatch = tableHtml.match(/Spieltermine[^<\n]*?[-–]\s*([^\n<]+)/);
  const liga = ligaMatch ? ligaMatch[1].replace(/&nbsp;/g, '').replace(/\u00a0/g, '').trim() : season;

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  let currentDate = '';
  let currentTime = '';

  while ((m = rowRe.exec(tableHtml)) !== null) {
    const cells = [];
    const cr = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cm;
    while ((cm = cr.exec(m[1])) !== null) cells.push(cm[1]);
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
    if (awayRaw.toLowerCase() === 'spielfrei' || homeRaw.toLowerCase() === 'spielfrei') continue;
    if (homeRaw.includes('Sieger aus') || awayRaw.includes('Sieger aus')) continue;

    const isHome = homeRaw.includes('Nottuln') || homeRaw.includes('BTV');
    const isBTVAway = awayRaw.includes('Nottuln') || awayRaw.includes('BTV');
    if (!isHome && !isBTVAway) continue;

    const home = isHome ? btvTeamName : homeRaw;
    const away = isBTVAway ? btvTeamName : awayRaw;

    const opponentCell = isHome ? cells[4] : cells[3];
    const opponentId = extractTeamId(opponentCell);
    const opponentUrl = opponentId ? BASE + '/teamPortrait?federation=WTV&team=' + opponentId : null;

    const scoreText = strip(cells[5] || '');
    const scoreM = scoreText.match(/^(\d+):(\d+)$/);

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
      championship: champMatch ? decodeURIComponent(champMatch[1]) : seasonToChampionship(season),
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
