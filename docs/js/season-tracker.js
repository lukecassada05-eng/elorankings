'use strict';
// season-tracker.js — week-by-week Elo progression matching the R engine exactly
//
// The R engine:
//   1. Collects ALL games for the season
//   2. Runs the entire game list 10 times (iters=10) in order
//   3. After each full pass, halves ratings of teams with < min_games total games
//   4. Final Elo = result after 10 passes
//
// To match this AND show weekly progression, we:
//   1. Fetch all games week by week (collecting them in order)
//   2. After each new week's games are added, run the FULL R algorithm
//      on all games collected so far
//   3. Record the resulting ratings as the snapshot for that week
//   4. Final snapshot matches the CSV exactly

window.SeasonTracker = (function () {

  const SPORT_CFG = {
    NFL: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
      startMonth: 9, endMonth: 2, crossesYear: true, stepDays: 7, k: 30, minGames: 4, iters: 10,
      query: ds => ({ dates: ds, limit: 20 }),
      name: c => c.team && (c.team.abbreviation || c.team.displayName) || ''
    },
    NBA: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
      startMonth: 10, endMonth: 6, crossesYear: true, stepDays: 3, k: 25, minGames: 4, iters: 10,
      query: ds => ({ dates: ds, limit: 20 }),
      name: c => c.team && c.team.displayName || ''
    },
    CBB: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
      startMonth: 11, endMonth: 4, crossesYear: true, stepDays: 7, k: 30, minGames: 4, iters: 10,
      query: ds => ({ dates: ds, limit: 200, groups: 50 }),
      name: c => c.team && (c.team.shortDisplayName || c.team.displayName) || ''
    },
    NHL: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
      startMonth: 10, endMonth: 6, crossesYear: true, stepDays: 3, k: 25, minGames: 4, iters: 10,
      query: ds => ({ dates: ds, limit: 20 }),
      name: c => c.team && c.team.displayName || ''
    },
    MLB: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
      startMonth: 3, endMonth: 10, crossesYear: false, stepDays: 7, k: 20, minGames: 4, iters: 10,
      query: ds => ({ dates: ds, limit: 30 }),
      name: c => c.team && c.team.displayName || ''
    },
    CFB: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
      startMonth: 8, endMonth: 1, crossesYear: true, stepDays: 7, k: 30, minGames: 4, iters: 10,
      query: ds => ({ dates: ds, groups: 80, limit: 300 }),
      name: c => c.team && (c.team.shortDisplayName || c.team.displayName) || ''
    },
    CBASE: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard',
      startMonth: 2, endMonth: 6, crossesYear: false, stepDays: 7, k: 30, minGames: 5, iters: 10,
      query: ds => ({ dates: ds, limit: 1000 }),
      name: c => c.team && (c.team.shortDisplayName || c.team.displayName) || ''
    },
    Soccer: { url: null }
  };

  // ── Date range ────────────────────────────────────────────
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

  // ── Fetch one week's completed games from ESPN ─────────────
  async function fetchWeek(sport, dateStr) {
    const sc = SPORT_CFG[sport];
    const params = new URLSearchParams(sc.query(dateStr));
    try {
      const res = await fetch(sc.url + '?' + params, { method: 'GET', mode: 'cors' });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data.events || !data.events.length) return [];
      const games = [];
      for (const ev of data.events) {
        try {
          const comp = ev.competitions && ev.competitions[0];
          if (!comp || !comp.status || !comp.status.type || !comp.status.type.completed) continue;
          const [a, b] = comp.competitors || [];
          if (!a || !b) continue;
          const hs = parseFloat(a.homeAway === 'home' ? a.score : b.score);
          const as = parseFloat(a.homeAway === 'home' ? b.score : a.score);
          const hn = sc.name(a.homeAway === 'home' ? a : b);
          const an = sc.name(a.homeAway === 'home' ? b : a);
          if (!isNaN(hs) && !isNaN(as) && hs !== as && hn && an)
            games.push({ winner: hs > as ? hn : an, loser: hs > as ? an : hn,
                         winnerPts: Math.max(hs, as), loserPts: Math.min(hs, as) });
        } catch (_) {}
      }
      return games;
    } catch (e) {
      console.warn('SeasonTracker fetch:', dateStr, e.message);
      return [];
    }
  }

  // ── Run the full R Elo algorithm on a game list ────────────
  // Exactly mirrors elo_engine.R: run_elo(games, k, iters, min_games)
  function runElo(games, k, iters, minGames) {
    // Collect all unique teams
    const teamSet = new Set();
    games.forEach(g => { teamSet.add(g.winner); teamSet.add(g.loser); });
    const teams = [...teamSet];

    // Initialize
    const elo  = {};
    const wins = {};
    const loss = {};
    teams.forEach(t => { elo[t] = 1500.0; wins[t] = 0; loss[t] = 0; });

    // iters full passes — exactly what R does
    for (let iter = 0; iter < iters; iter++) {
      for (const g of games) {
        const rw = elo[g.winner];
        const rl = elo[g.loser];
        const ew = 1.0 / (1.0 + Math.pow(10, (rl - rw) / 400.0));
        const margin = Math.max(g.winnerPts - g.loserPts, 1);
        const delta  = k * Math.log(margin + 1) * (1.0 - ew);
        elo[g.winner] = rw + delta;
        elo[g.loser]  = rl - delta;
        wins[g.winner]++;
        loss[g.loser]++;
      }
      // After each full pass, penalise teams below minGames
      // wins+loss here is cumulative across iters, just like R
      teams.forEach(t => {
        if ((wins[t] + loss[t]) < minGames) {
          elo[t] = elo[t] / 2.0;
        }
      });
    }

    // Round to 1 decimal, same as R
    const result = {};
    teams.forEach(t => { result[t] = Math.round(elo[t] * 10) / 10; });
    return result;
  }

  // ── Main: build weekly snapshots ──────────────────────────
  // Phase 1: fetch all game weeks (show progress)
  // Phase 2: for each week boundary, run full R algorithm on
  //          games-so-far and record ratings as the snapshot
  async function buildTracker(sport, season, onProgress) {
    const sc = SPORT_CFG[sport];
    if (!sc) return null;
    if (!sc.url) return { noData: true, reason: 'Soccer data comes from CSV files — live tracking not available.' };

    const dates = getWeekDates(sport, season);
    if (!dates.length) return null;

    // ── Phase 1: Fetch all weeks ──────────────────────────────
    onProgress && onProgress(0, dates.length * 2, 0, 'Fetching games…');
    const weekGames = []; // array of {date, games[]}
    for (let i = 0; i < dates.length; i++) {
      const ds    = dates[i];
      const games = await fetchWeek(sport, ds);
      weekGames.push({ date: ds, games });
      onProgress && onProgress(i + 1, dates.length * 2, games.length, 'Fetching week ' + (i+1) + '/' + dates.length);
      await new Promise(r => setTimeout(r, 150));
    }

    // ── Phase 2: Build snapshots by running full R algorithm ──
    // at each week boundary on the games collected up to that point
    const history = {};
    const weeks   = [];
    const allGamesSoFar = [];

    // Decide snapshot frequency — don't recompute every single week
    // for long seasons (MLB 26 weeks = 26 × 10 iters each = manageable)
    for (let i = 0; i < weekGames.length; i++) {
      allGamesSoFar.push(...weekGames[i].games);
      const totalGames = allGamesSoFar.length;

      onProgress && onProgress(
        dates.length + i + 1,
        dates.length * 2,
        totalGames,
        'Computing Elo for week ' + (i+1) + '/' + weekGames.length
      );

      if (totalGames === 0) continue; // no games yet, skip

      // Run the full R algorithm on all games so far
      const ratings = runElo(allGamesSoFar, sc.k, sc.iters, sc.minGames);

      // Record snapshot
      const ds = weekGames[i].date;
      weeks.push(ds);
      for (const [team, eloVal] of Object.entries(ratings)) {
        if (!history[team]) history[team] = [];
        history[team].push({ week: ds, elo: eloVal });
      }

      // Small yield to keep browser responsive
      await new Promise(r => setTimeout(r, 0));
    }

    return { history, weeks };
  }

  return { buildTracker, SPORT_CFG };
})();
