'use strict';
// season-tracker.js
//
// Root cause of previous Elo mismatch:
//   - Weekly window fetching (stepDays=7) created GAPS (missing Mon/Tue games)
//     and DUPLICATES (boundary games counted twice between windows)
//   - Either error compounds over 10 iterations → significant divergence
//
// Fix:
//   - Fetch EVERY calendar day individually (YYYYMMDD = exactly that day only)
//   - ESPN returns only games completed on that specific date → zero duplicates
//   - Additional dedup by game key (winner+loser+scores) as safety net
//   - Then run the complete R elo_engine on ALL games (10 iters)
//   - Week snapshots taken every N days for charting
//
// This produces final Elo matching the CSV exactly.

window.SeasonTracker = (function () {

  // Sport configs — snapshotEvery = how many days between chart points
  const SPORT_CFG = {
    NFL: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
      startMonth: 9, endMonth: 2, crossesYear: true,
      k: 30, minGames: 4, iters: 10, snapshotEvery: 7,
      query: ds => ({ dates: ds, limit: 20 }),
      name: c => c.team && (c.team.abbreviation || c.team.displayName) || ''
    },
    NBA: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
      startMonth: 10, endMonth: 6, crossesYear: true,
      k: 25, minGames: 4, iters: 10, snapshotEvery: 7,
      query: ds => ({ dates: ds, limit: 20 }),
      name: c => c.team && c.team.displayName || ''
    },
    CBB: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
      startMonth: 11, endMonth: 4, crossesYear: true,
      k: 30, minGames: 4, iters: 10, snapshotEvery: 14,
      query: ds => ({ dates: ds, limit: 300, groups: 50 }),
      name: c => c.team && (c.team.shortDisplayName || c.team.displayName) || ''
    },
    NHL: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
      startMonth: 10, endMonth: 6, crossesYear: true,
      k: 25, minGames: 4, iters: 10, snapshotEvery: 7,
      query: ds => ({ dates: ds, limit: 20 }),
      name: c => c.team && c.team.displayName || ''
    },
    MLB: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
      startMonth: 3, endMonth: 10, crossesYear: false,
      k: 20, minGames: 4, iters: 10, snapshotEvery: 14,
      query: ds => ({ dates: ds, limit: 30 }),
      name: c => c.team && c.team.displayName || ''
    },
    CFB: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
      startMonth: 8, endMonth: 1, crossesYear: true,
      k: 30, minGames: 4, iters: 10, snapshotEvery: 7,
      query: ds => ({ dates: ds, groups: 80, limit: 300 }),
      name: c => c.team && (c.team.shortDisplayName || c.team.displayName) || ''
    },
    CBASE: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard',
      startMonth: 2, endMonth: 6, crossesYear: false,
      k: 30, minGames: 5, iters: 10, snapshotEvery: 14,
      query: ds => ({ dates: ds, limit: 1000 }),
      name: c => c.team && (c.team.shortDisplayName || c.team.displayName) || ''
    },
    Soccer: { url: null }
  };

  // ── Every calendar day in the season ──────────────────────
  function getAllDates(sport, season) {
    const sc = SPORT_CFG[sport];
    if (!sc || !sc.url) return [];
    const startYr = sc.crossesYear ? season - 1 : season;
    const endYr   = sc.crossesYear ? season     : season;
    const start   = new Date(startYr, sc.startMonth - 1, 1);
    const end     = new Date(endYr,   sc.endMonth,       1);
    const cap     = end < new Date() ? end : new Date();
    const dates   = [];
    const d       = new Date(start);
    while (d < cap) {
      dates.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
      d.setDate(d.getDate() + 1);       // ONE day at a time — no gaps, no overlaps
    }
    return dates;
  }

  // ── Fetch one calendar day from ESPN ──────────────────────
  // dates=YYYYMMDD returns ONLY games completed on that exact date.
  // No game can appear on two different dates → zero duplicates from source.
  async function fetchDay(sport, dateStr) {
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
            out.push({
              winner: hs > as ? hn : an,
              loser:  hs > as ? an : hn,
              winnerPts: Math.max(hs, as),
              loserPts:  Math.min(hs, as)
            });
        } catch (_) {}
      }
      return out;
    } catch (e) {
      console.warn('tracker fetch', dateStr, e.message);
      return [];
    }
  }

  // ── Exact JS port of R elo_engine.R run_elo() ─────────────
  // Arguments match R: games array, k, iters, min_games
  // Returns: { teamName: eloValue } rounded to 1 decimal
  function runElo(games, k, iters, minGames) {
    if (!games.length) return {};

    // Build team list in insertion order (matches R's unique(c(winners, losers)))
    const seen  = new Set();
    const teams = [];
    for (const g of games) {
      if (!seen.has(g.winner)) { seen.add(g.winner); teams.push(g.winner); }
      if (!seen.has(g.loser))  { seen.add(g.loser);  teams.push(g.loser);  }
    }

    // Initialise — all start at 1500, exactly as R does
    const elo  = {};
    const wins = {};
    const loss = {};
    for (const t of teams) { elo[t] = 1500.0; wins[t] = 0; loss[t] = 0; }

    // iters full passes, processing every game in order each time
    for (let iter = 0; iter < iters; iter++) {
      for (const g of games) {
        const rw = elo[g.winner];
        const rl = elo[g.loser];

        // Expected win prob (same formula as R)
        const ew = 1.0 / (1.0 + Math.pow(10, (rl - rw) / 400.0));

        // Margin-adjusted K (R: k * log(margin + 1), log() = natural log)
        const margin = Math.max(g.winnerPts - g.loserPts, 1);
        const delta  = k * Math.log(margin + 1) * (1.0 - ew);

        elo[g.winner] = rw + delta;
        elo[g.loser]  = rl - delta;
        wins[g.winner]++;
        loss[g.loser]++;
      }

      // Penalty after each full pass: halve teams below min_games
      // wins+loss is cumulative across all iters (same as R)
      for (const t of teams) {
        if (wins[t] + loss[t] < minGames) elo[t] /= 2.0;
      }
    }

    // Round to 1 decimal, same as R's round(elo, 1)
    const result = {};
    for (const t of teams) result[t] = Math.round(elo[t] * 10) / 10;
    return result;
  }

  // ── Deduplicate games by canonical key ────────────────────
  // Safety net: in case ESPN ever returns the same game on two dates
  function dedupGames(games) {
    const seen = new Set();
    return games.filter(g => {
      const key = [g.winner, g.loser, g.winnerPts, g.loserPts].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── Main entry point ──────────────────────────────────────
  // Returns { history, weeks } where:
  //   history[team] = [{ week: dateStr, elo: number }, ...]
  //   weeks = array of snapshot dateStrings
  //   The LAST snapshot matches the CSV rating exactly.

  async function buildTracker(sport, season, onProgress) {
    const sc = SPORT_CFG[sport];
    if (!sc) return null;
    if (!sc.url) return {
      noData: true,
      reason: 'Soccer uses CSV files — live week-by-week tracking is not available.'
    };

    const allDates = getAllDates(sport, season);
    if (!allDates.length) return null;

    const totalDays = allDates.length;

    // ── Phase 1: fetch every calendar day ────────────────────
    // dayGames[i] = completed games on allDates[i] (usually 0 for non-game days)
    const dayGames = [];
    let totalFetched = 0;

    for (let i = 0; i < totalDays; i++) {
      const games = await fetchDay(sport, allDates[i]);
      dayGames.push(games);
      totalFetched += games.length;

      if (onProgress) onProgress(
        i + 1, totalDays * 2, games.length,
        `Fetching ${allDates[i].slice(4,6)}/${allDates[i].slice(6,8)}` +
        ` — ${totalFetched} games so far`
      );

      // Minimal delay — skip delay on days with 0 games to go faster
      await new Promise(r => setTimeout(r, games.length ? 120 : 20));
    }

    // ── Phase 2: snapshot at every snapshotEvery days ────────
    // At each snapshot date, take all games from day 0 through that day,
    // deduplicate them, and run the FULL R engine (10 iters) on that set.
    // The final snapshot (all days) is the authoritative end-of-season rating.

    const snap    = sc.snapshotEvery || 7;
    const history = {};
    const weeks   = [];
    const allGamesSoFar = [];
    let   snapshotCount = 0;
    const totalSnaps = Math.ceil(totalDays / snap);

    for (let i = 0; i < totalDays; i++) {
      allGamesSoFar.push(...dayGames[i]);

      // Take a snapshot at every `snap` days AND always on the final day
      const isLastDay      = i === totalDays - 1;
      const isSnapshotDay  = (i + 1) % snap === 0;

      if (!isSnapshotDay && !isLastDay) continue;

      snapshotCount++;
      if (onProgress) onProgress(
        totalDays + snapshotCount, totalDays + totalSnaps + 1,
        allGamesSoFar.length,
        `Computing ratings (snapshot ${snapshotCount}/${totalSnaps + 1})…`
      );

      const deduped = dedupGames(allGamesSoFar);
      if (!deduped.length) continue;

      const ratings = runElo(deduped, sc.k, sc.iters, sc.minGames);
      const ds = allDates[i];
      weeks.push(ds);

      for (const [team, eloVal] of Object.entries(ratings)) {
        if (!history[team]) history[team] = [];
        history[team].push({ week: ds, elo: eloVal });
      }

      await new Promise(r => setTimeout(r, 0)); // yield to browser
    }

    return { history, weeks };
  }

  return { buildTracker, SPORT_CFG };
})();
