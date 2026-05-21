'use strict';
// season-tracker.js
// Fetches week-by-week Elo progression for the current season
// using the same ESPN scoreboard endpoints the R scripts use.
// Works for: NFL, NBA, CBB, NHL, MLB, CFB, College Baseball
// Called from sport-page.js renderSeasonTracker()

window.SeasonTracker = (function() {

  // ── ESPN endpoint configs per sport ───────────────────────
  const SPORT_CFG = {
    NFL: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
      seasonStart: yr => new Date(yr + '-09-01'),
      seasonEnd:   yr => new Date((yr+1) + '-02-15'),
      stepDays: 7,
      query: ds => ({ dates: ds, limit: 20 }),
      getName: c => c.team?.abbreviation || c.team?.displayName || ''
    },
    NBA: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard',
      seasonStart: yr => new Date((yr-1) + '-10-01'),
      seasonEnd:   yr => new Date(yr + '-06-30'),
      stepDays: 3,
      query: ds => ({ dates: ds, limit: 20 }),
      getName: c => c.team?.displayName || ''
    },
    CBB: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard',
      seasonStart: yr => new Date((yr-1) + '-11-01'),
      seasonEnd:   yr => new Date(yr + '-04-10'),
      stepDays: 7,
      query: ds => ({ dates: ds, limit: 200, groups: 50 }),
      getName: c => c.team?.shortDisplayName || c.team?.displayName || ''
    },
    NHL: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard',
      seasonStart: yr => new Date(yr + '-10-01'),
      seasonEnd:   yr => new Date((yr+1) + '-06-30'),
      stepDays: 3,
      query: ds => ({ dates: ds, limit: 20 }),
      getName: c => c.team?.displayName || ''
    },
    MLB: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard',
      seasonStart: yr => new Date(yr + '-03-20'),
      seasonEnd:   yr => new Date(yr + '-10-15'),
      stepDays: 7,
      query: ds => ({ dates: ds, limit: 30 }),
      getName: c => c.team?.displayName || ''
    },
    CFB: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard',
      seasonStart: yr => new Date(yr + '-08-24'),
      seasonEnd:   yr => new Date((yr+1) + '-01-22'),
      stepDays: 7,
      query: ds => ({ dates: ds, groups: 80, limit: 300 }),
      getName: c => c.team?.shortDisplayName || c.team?.displayName || ''
    },
    CBASE: {
      url: 'https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard',
      seasonStart: yr => new Date(yr + '-02-14'),
      seasonEnd:   yr => new Date(yr + '-06-30'),
      stepDays: 7,
      query: ds => ({ dates: ds, limit: 1000 }),
      getName: c => c.team?.shortDisplayName || c.team?.displayName || ''
    },
    Soccer: {
      url: null, // Soccer uses football-data.co.uk CSVs, no live API tracker
      stepDays: 7,
      getName: c => ''
    }
  };

  // ── Fetch one date's completed games ───────────────────────
  async function fetchGames(cfg, dateStr) {
    if (!cfg.url) return [];
    try {
      const params = new URLSearchParams(cfg.query(dateStr));
      const res = await fetch(cfg.url + '?' + params + '&t=' + Date.now());
      if (!res.ok) return [];
      const data = await res.json();
      if (!data.events) return [];

      return data.events.flatMap(ev => {
        try {
          const comp = ev.competitions?.[0];
          if (!comp?.status?.type?.completed) return [];
          const [a, b] = comp.competitors || [];
          if (!a || !b) return [];
          const hs = parseFloat(a.homeAway === 'home' ? a.score : b.score);
          const as = parseFloat(a.homeAway === 'home' ? b.score : a.score);
          const hn = cfg.getName(a.homeAway === 'home' ? a : b);
          const an = cfg.getName(a.homeAway === 'home' ? b : a);
          if (isNaN(hs) || isNaN(as) || hs === as || !hn || !an) return [];
          return [{
            winner: hs > as ? hn : an,
            loser:  hs > as ? an : hn,
            winnerPts: Math.max(hs, as),
            loserPts:  Math.min(hs, as),
            date: dateStr
          }];
        } catch { return []; }
      });
    } catch { return []; }
  }

  // ── Elo math ───────────────────────────────────────────────
  function updateElo(ratings, winner, loser, winnerPts, loserPts, k = 28) {
    if (!ratings[winner]) ratings[winner] = 1500;
    if (!ratings[loser])  ratings[loser]  = 1500;
    const rw = ratings[winner], rl = ratings[loser];
    const ew = 1 / (1 + Math.pow(10, (rl - rw) / 400));
    const margin = Math.max(winnerPts - loserPts, 1);
    const adjK = k * Math.log(margin + 1);
    const delta = adjK * (1 - ew);
    ratings[winner] = rw + delta;
    ratings[loser]  = rl - delta;
  }

  // ── Main: build weekly Elo snapshots for a sport+season ───
  async function buildTracker(sport, season, progressCb) {
    const cfg = SPORT_CFG[sport];
    if (!cfg || !cfg.url) return null;

    const start = cfg.seasonStart(season);
    const end   = new Date(Math.min(cfg.seasonEnd(season), Date.now()));
    if (start > end) return null;

    // Build week-step dates
    const dates = [];
    let d = new Date(start);
    while (d <= end) {
      dates.push(d.toISOString().slice(0,10).replace(/-/g,''));
      d = new Date(d.getTime() + cfg.stepDays * 86400000);
    }

    const ratings = {};       // team -> current Elo
    const history = {};       // team -> [{ week, elo }]
    const weeks   = [];

    let processed = 0;
    for (const ds of dates) {
      const games = await fetchGames(cfg, ds);
      for (const g of games) {
        updateElo(ratings, g.winner, g.loser, g.winnerPts, g.loserPts);
        if (!history[g.winner]) history[g.winner] = [];
        if (!history[g.loser])  history[g.loser]  = [];
      }
      // Snapshot all teams at this week
      for (const [team, elo] of Object.entries(ratings)) {
        if (!history[team]) history[team] = [];
        history[team].push({ week: ds, elo: Math.round(elo * 10) / 10 });
      }
      weeks.push(ds);
      processed++;
      if (progressCb) progressCb(processed, dates.length);
      await new Promise(r => setTimeout(r, 150)); // polite delay
    }

    return { history, weeks, finalRatings: ratings };
  }

  return { buildTracker, SPORT_CFG };
})();
