'use strict';
// season-tracker.js
//
// Strategy (matches R engine exactly):
//   1. Fetch ALL games for the full season, tagged with which week they belong to
//   2. Run the complete R elo_engine on ALL games (10 iters, same k, same penalty)
//      → this produces the authoritative final Elo matching the CSV
//   3. For each week snapshot: re-run R engine on only games UP TO that week
//      → gives the "what would rankings look like at this point" value
//   The final week snapshot == the CSV value exactly.

window.SeasonTracker = (function () {

  const SPORT_CFG = {
    NFL: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
      startMonth: 9, endMonth: 2, crossesYear: true, stepDays: 7,
      k: 30, minGames: 4, iters: 10,
      query: ds => ({ dates: ds, limit: 20 }),
      name: c => c.team && (c.team.abbreviation || c.team.displayName) || ''
    },
    NBA: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
      startMonth: 10, endMonth: 6, crossesYear: true, stepDays: 3,
      k: 25, minGames: 4, iters: 10,
      query: ds => ({ dates: ds, limit: 20 }),
      name: c => c.team && c.team.displayName || ''
    },
    CBB: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
      startMonth: 11, endMonth: 4, crossesYear: true, stepDays: 7,
      k: 30, minGames: 4, iters: 10,
      query: ds => ({ dates: ds, limit: 200, groups: 50 }),
      name: c => c.team && (c.team.shortDisplayName || c.team.displayName) || ''
    },
    NHL: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
      startMonth: 10, endMonth: 6, crossesYear: true, stepDays: 3,
      k: 25, minGames: 4, iters: 10,
      query: ds => ({ dates: ds, limit: 20 }),
      name: c => c.team && c.team.displayName || ''
    },
    MLB: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
      startMonth: 3, endMonth: 10, crossesYear: false, stepDays: 7,
      k: 20, minGames: 4, iters: 10,
      query: ds => ({ dates: ds, limit: 30 }),
      name: c => c.team && c.team.displayName || ''
    },
    CFB: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
      startMonth: 8, endMonth: 1, crossesYear: true, stepDays: 7,
      k: 30, minGames: 4, iters: 10,
      query: ds => ({ dates: ds, groups: 80, limit: 300 }),
      name: c => c.team && (c.team.shortDisplayName || c.team.displayName) || ''
    },
    CBASE: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard',
      startMonth: 2, endMonth: 6, crossesYear: false, stepDays: 7,
      k: 30, minGames: 5, iters: 10,
      query: ds => ({ dates: ds, limit: 1000 }),
      name: c => c.team && (c.team.shortDisplayName || c.team.displayName) || ''
    },
    Soccer: { url: null }
  };

  // ── Week date strings for a sport+season ──────────────────
  function getWeekDates(sport, season) {
    const sc = SPORT_CFG[sport];
    if (!sc || !sc.url) return [];
    const startYr = sc.crossesYear ? season - 1 : season;
    const endYr   = sc.crossesYear ? season     : season;
    const start   = new Date(startYr, sc.startMonth - 1, 1);
    const end     = new Date(endYr,   sc.endMonth,       1);
    const cap     = end < new Date() ? end : new Date();
    const dates   = [];
    let d = new Date(start);
    while (d < cap) {
      dates.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
      d.setDate(d.getDate() + (sc.stepDays || 7));
    }
    return dates;
  }

  // ── Fetch one week from ESPN ──────────────────────────────
  async function fetchWeek(sport, dateStr) {
    const sc = SPORT_CFG[sport];
    const params = new URLSearchParams(sc.query(dateStr));
    try {
      const res = await fetch(sc.url + '?' + params, { mode: 'cors' });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data.events || !data.events.length) return [];
      const out = [];
      for (const ev of data.events) {
        try {
          const comp = ev.competitions?.[0];
          if (!comp?.status?.type?.completed) continue;
          const [a, b] = comp.competitors || [];
          if (!a || !b) continue;
          const hs = parseFloat(a.homeAway === 'home' ? a.score : b.score);
          const as = parseFloat(a.homeAway === 'home' ? b.score : a.score);
          const hn = sc.name(a.homeAway === 'home' ? a : b);
          const an = sc.name(a.homeAway === 'home' ? b : a);
          if (!isNaN(hs) && !isNaN(as) && hs !== as && hn && an)
            out.push({ winner: hs>as?hn:an, loser: hs>as?an:hn,
                       winnerPts: Math.max(hs,as), loserPts: Math.min(hs,as) });
        } catch(_) {}
      }
      return out;
    } catch(e) {
      console.warn('tracker fetch', dateStr, e.message);
      return [];
    }
  }

  // ── R elo_engine.R: run_elo(games, k, iters, min_games) ──
  // Exact JS port — same loop structure, same penalty, same math.
  // Returns { teamName: eloValue } after iters full passes.
  function runElo(games, k, iters, minGames) {
    if (!games.length) return {};
    const teams = [...new Set(games.flatMap(g => [g.winner, g.loser]))];
    const elo   = Object.fromEntries(teams.map(t => [t, 1500.0]));
    const wins  = Object.fromEntries(teams.map(t => [t, 0]));
    const loss  = Object.fromEntries(teams.map(t => [t, 0]));

    for (let iter = 0; iter < iters; iter++) {
      for (const g of games) {
        const rw = elo[g.winner], rl = elo[g.loser];
        const ew = 1.0 / (1.0 + Math.pow(10, (rl - rw) / 400.0));
        const margin = Math.max(g.winnerPts - g.loserPts, 1);
        const delta  = k * Math.log(margin + 1) * (1.0 - ew);
        elo[g.winner] = rw + delta;
        elo[g.loser]  = rl - delta;
        wins[g.winner]++;
        loss[g.loser]++;
      }
      // Penalty: same as R — halve rating of teams below minGames threshold
      // wins+loss accumulates across iters exactly as R does
      for (const t of teams) {
        if (wins[t] + loss[t] < minGames) elo[t] /= 2.0;
      }
    }

    // Round to 1 decimal
    return Object.fromEntries(teams.map(t => [t, Math.round(elo[t] * 10) / 10]));
  }

  // ── Main ─────────────────────────────────────────────────
  // Phase 1: fetch every week → build flat array of all games, each tagged
  //          with which weekIndex it belongs to
  // Phase 2: for each week boundary i, call runElo on games[0..i]
  //          → snapshot of ALL teams at that point in time
  // Return:  { history, weeks, allTeams }
  //   history: { teamName: [ { week: dateStr, elo: number } ] }

  async function buildTracker(sport, season, onProgress) {
    const sc = SPORT_CFG[sport];
    if (!sc) return null;
    if (!sc.url) return {
      noData: true,
      reason: 'Soccer uses CSV files — live week-by-week tracking not available.'
    };

    const dates = getWeekDates(sport, season);
    if (!dates.length) return null;

    const total = dates.length;

    // ── Phase 1: collect all games ──────────────────────────
    // weekGames[i] = games that occurred in week i
    const weekGames = new Array(total).fill(null).map(() => []);

    for (let i = 0; i < total; i++) {
      const games = await fetchWeek(sport, dates[i]);
      weekGames[i] = games;
      onProgress && onProgress(i + 1, total * 2, games.length,
        `Fetching week ${i+1} of ${total}… (${games.length} games)`);
      await new Promise(r => setTimeout(r, 150));
    }

    // ── Phase 2: snapshot each week ─────────────────────────
    // Accumulate games week by week; for each boundary run the FULL
    // R engine on all games so far → authoritative snapshot for that week.
    const history  = {};    // team → [{week, elo}]
    const weeks    = [];    // dateStr for each snapshot
    const allGames = [];    // growing list of all games seen so far

    for (let i = 0; i < total; i++) {
      allGames.push(...weekGames[i]);

      onProgress && onProgress(total + i + 1, total * 2, allGames.length,
        `Computing ratings for week ${i+1} of ${total}…`);

      if (!allGames.length) continue;

      // Run the FULL R engine on all games collected so far
      const ratings = runElo(allGames, sc.k, sc.iters, sc.minGames);

      weeks.push(dates[i]);
      for (const [team, eloVal] of Object.entries(ratings)) {
        if (!history[team]) history[team] = [];
        history[team].push({ week: dates[i], elo: eloVal });
      }

      // Yield to keep browser responsive
      await new Promise(r => setTimeout(r, 0));
    }

    return { history, weeks };
  }

  return { buildTracker, SPORT_CFG };
})();
