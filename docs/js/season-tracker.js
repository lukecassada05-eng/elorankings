'use strict';
// season-tracker.js  — in-browser week-by-week Elo progression
// ESPN public API is CORS-enabled (Access-Control-Allow-Origin: *)
// so direct browser fetch works fine from GitHub Pages.

window.SeasonTracker = (function () {

  const CFG = {
    NFL: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
      startMonth: 9, endMonth: 2, crossesYear: true,
      query: ds => ({ dates: ds, limit: 20 }),
      name: c => c.team && (c.team.abbreviation || c.team.displayName) || ''
    },
    NBA: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
      startMonth: 10, endMonth: 6, crossesYear: true,
      query: ds => ({ dates: ds, limit: 20 }),
      name: c => c.team && c.team.displayName || ''
    },
    CBB: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
      startMonth: 11, endMonth: 4, crossesYear: true,
      query: ds => ({ dates: ds, limit: 200, groups: 50 }),
      name: c => c.team && (c.team.shortDisplayName || c.team.displayName) || ''
    },
    NHL: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
      startMonth: 10, endMonth: 6, crossesYear: true,
      query: ds => ({ dates: ds, limit: 20 }),
      name: c => c.team && c.team.displayName || ''
    },
    MLB: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
      startMonth: 3, endMonth: 10, crossesYear: false,
      query: ds => ({ dates: ds, limit: 30 }),
      name: c => c.team && c.team.displayName || ''
    },
    CFB: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
      startMonth: 8, endMonth: 1, crossesYear: true,
      query: ds => ({ dates: ds, groups: 80, limit: 300 }),
      name: c => c.team && (c.team.shortDisplayName || c.team.displayName) || ''
    },
    CBASE: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard',
      startMonth: 2, endMonth: 6, crossesYear: false,
      query: ds => ({ dates: ds, limit: 1000 }),
      name: c => c.team && (c.team.shortDisplayName || c.team.displayName) || ''
    },
    Soccer: { url: null }
  };

  // Build array of weekly date strings (YYYYMMDD) for a sport+season
  function getWeekDates(sport, season) {
    const sc = CFG[sport];
    if (!sc || !sc.url) return [];
    const startYr = sc.crossesYear ? season - 1 : season;
    const start = new Date(startYr, sc.startMonth - 1, 1);
    const endYr = sc.crossesYear ? season : season;
    const end   = new Date(endYr,  sc.endMonth,     1); // first of NEXT month
    const today = new Date();
    const cap   = end < today ? end : today;
    const dates = [];
    let d = new Date(start);
    while (d < cap) {
      const ds = d.toISOString().slice(0,10).replace(/-/g,'');
      dates.push(ds);
      d.setDate(d.getDate() + 7);
    }
    return dates;
  }

  // Fetch one week's completed games
  async function fetchWeek(sport, dateStr) {
    const sc = CFG[sport];
    const params = new URLSearchParams(sc.query(dateStr));
    const url = sc.url + '?' + params;
    try {
      const res = await fetch(url, { method: 'GET', mode: 'cors' });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data.events || !data.events.length) return [];
      const games = [];
      for (const ev of data.events) {
        try {
          const comp = ev.competitions && ev.competitions[0];
          if (!comp || !comp.status || !comp.status.type || !comp.status.type.completed) continue;
          const comps = comp.competitors;
          if (!comps || comps.length !== 2) continue;
          const [a, b] = comps;
          const hs = parseFloat(a.homeAway === 'home' ? a.score : b.score);
          const as = parseFloat(a.homeAway === 'home' ? b.score : a.score);
          const hn = sc.name(a.homeAway === 'home' ? a : b);
          const an = sc.name(a.homeAway === 'home' ? b : a);
          if (!isNaN(hs) && !isNaN(as) && hs !== as && hn && an) {
            games.push({
              winner: hs > as ? hn : an,
              loser:  hs > as ? an : hn,
              winnerPts: Math.max(hs, as),
              loserPts:  Math.min(hs, as)
            });
          }
        } catch (_) {}
      }
      return games;
    } catch (e) {
      console.warn('SeasonTracker fetch error', dateStr, e.message);
      return [];
    }
  }

  // Single-pass Elo update
  function updateElo(ratings, winner, loser, wPts, lPts, k) {
    if (!ratings[winner]) ratings[winner] = 1500;
    if (!ratings[loser])  ratings[loser]  = 1500;
    const rw = ratings[winner], rl = ratings[loser];
    const ew = 1 / (1 + Math.pow(10, (rl - rw) / 400));
    const margin = Math.max(wPts - lPts, 1);
    const delta = (k * Math.log(margin + 1)) * (1 - ew);
    ratings[winner] = Math.round((rw + delta) * 10) / 10;
    ratings[loser]  = Math.round((rl - delta) * 10) / 10;
  }

  // Main: returns { history: {team: [{week, elo}]}, weeks: [dateStr] }
  async function buildTracker(sport, season, onProgress) {
    const sc = CFG[sport];
    if (!sc) return null;
    if (!sc.url) return { noData: true, reason: 'Soccer data comes from CSV files — live tracking not available.' };

    const dates = getWeekDates(sport, season);
    if (!dates.length) return null;

    const ratings = {};
    const history = {};
    const weeks   = [];
    const k = sport === 'MLB' ? 18 : sport === 'NBA' ? 22 : 28;

    for (let i = 0; i < dates.length; i++) {
      const ds = dates[i];
      const games = await fetchWeek(sport, ds);
      for (const g of games) {
        updateElo(ratings, g.winner, g.loser, g.winnerPts, g.loserPts, k);
      }
      // Snapshot every active team
      for (const [team, elo] of Object.entries(ratings)) {
        if (!history[team]) history[team] = [];
        history[team].push({ week: ds, elo });
      }
      weeks.push(ds);
      if (onProgress) onProgress(i + 1, dates.length, games.length);
      await new Promise(r => setTimeout(r, 200));
    }

    return { history, weeks };
  }

  return { buildTracker, CFG };
})();
