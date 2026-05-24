'use strict';
// ── Lines page — Elo-based predictions for upcoming games ─────
// Fetches schedule from ESPN (no API key needed)
// Reads Elo from existing CSVs in docs/SPORT/data/
// Shows: win%, spread, American moneyline odds
// Default Elo = 1500 if team not yet in CSV (start of season)

(function () {

  // ── Sport configs ─────────────────────────────────────────────
  var SPORTS = {
    NFL:   { path:'americanfootball/nfl',               nameField:'displayName',      hca:45,  scale:35,  unit:'pts',   csv:'NFL/data/NFL_Elo_' },
    NBA:   { path:'basketball/nba',                      nameField:'displayName',      hca:50,  scale:10,  unit:'pts',   csv:'NBA/data/NBA_Elo_' },
    MLB:   { path:'baseball/mlb',                        nameField:'displayName',      hca:20,  scale:150, unit:'runs',  csv:'MLB/data/MLB_Elo_' },
    NHL:   { path:'icehockey/nhl',                       nameField:'displayName',      hca:25,  scale:150, unit:'goals', csv:'NHL/data/NHL_Elo_' },
    CFB:   { path:'football/college-football',           nameField:'shortDisplayName', hca:55,  scale:35,  unit:'pts',   csv:'CFB/data/CFB_Elo_',  extra:'&groups=80' },
    CBB:   { path:'basketball/mens-college-basketball',  nameField:'shortDisplayName', hca:60,  scale:10,  unit:'pts',   csv:'CBB/data/CBB_Elo_',  extra:'&groups=50' },
    CBASE: { path:'baseball/college-baseball',           nameField:'shortDisplayName', hca:20,  scale:150, unit:'runs',  csv:'CBASE/data/CBASE_Elo_' },
    Soccer:[
      { league:'EPL',        path:'soccer/eng.1',              nameField:'displayName', hca:60, scale:150, unit:'goals', draw:true, csv:'Soccer/data/Soccer_Elo_' },
      { league:'La Liga',    path:'soccer/esp.1',              nameField:'displayName', hca:60, scale:150, unit:'goals', draw:true, csv:'Soccer/data/Soccer_Elo_' },
      { league:'Bundesliga', path:'soccer/ger.1',              nameField:'displayName', hca:60, scale:150, unit:'goals', draw:true, csv:'Soccer/data/Soccer_Elo_' },
      { league:'Serie A',    path:'soccer/ita.1',              nameField:'displayName', hca:60, scale:150, unit:'goals', draw:true, csv:'Soccer/data/Soccer_Elo_' },
      { league:'Ligue 1',    path:'soccer/fra.1',              nameField:'displayName', hca:60, scale:150, unit:'goals', draw:true, csv:'Soccer/data/Soccer_Elo_' },
      { league:'MLS',        path:'soccer/usa.1',              nameField:'displayName', hca:60, scale:150, unit:'goals', draw:true, csv:'Soccer/data/Soccer_Elo_' },
      { league:'UCL',        path:'soccer/uefa.champions',     nameField:'displayName', hca:60, scale:150, unit:'goals', draw:true, csv:'Soccer/data/Soccer_Elo_' },
    ]
  };

  // ESPN name → CSV name corrections (only where they differ)
  var NAME_FIX = {
    'Athletics':         'Sacramento Athletics',
    'Oakland Athletics': 'Sacramento Athletics'
  };

  // ── Date window: now → +14 days ──────────────────────────────
  var NOW    = new Date();
  var CUTOFF = new Date(NOW.getTime() + 14 * 24 * 60 * 60 * 1000);

  function inWindow(dateStr) {
    if (!dateStr) return false;
    var d = new Date(dateStr);
    return !isNaN(d) && d >= NOW && d <= CUTOFF;
  }

  // ── Season year per sport ─────────────────────────────────────
  function seasonYear(sport) {
    var yr = NOW.getFullYear();
    var mo = NOW.getMonth() + 1;
    switch (sport) {
      case 'NFL':   return mo >= 9 ? yr : yr - 1;
      case 'NBA':   return mo >= 10 ? yr + 1 : yr;
      case 'NHL':   return mo >= 10 ? yr + 1 : yr;
      case 'CFB':   return mo >= 8 ? yr : yr - 1;
      case 'CBASE': return mo >= 2 ? yr : yr - 1;
      case 'Soccer':return mo >= 8 ? yr : yr - 1;
      default:      return mo >= 3 ? yr : yr - 1; // MLB, CBB
    }
  }

  // ── Elo math ──────────────────────────────────────────────────
  function eloProb(eA, eB, hca) {
    return 1 / (1 + Math.pow(10, (eB - (eA + hca)) / 400));
  }
  function eloSpread(eA, eB, hca, scale) {
    return ((eA + hca - eB) / scale).toFixed(1);
  }
  function drawProb(eA, eB, hca) {
    return Math.max(0.03, 0.28 * Math.max(0, 1 - Math.abs(eA + hca - eB) / 500));
  }
  function toAmerican(p) {
    if (p <= 0 || p >= 1) return '—';
    if (p >= 0.5) return String(Math.round(-(p / (1 - p)) * 100));
    return '+' + Math.round(((1 - p) / p) * 100);
  }

  // ── Fetch helpers ─────────────────────────────────────────────
  function fetchJSON(url) {
    return fetch(url, { mode: 'cors' })
      .then(function (r) { return r.ok ? r.json() : { events: [] }; })
      .catch(function () { return { events: [] }; });
  }

  var csvCache = {};
  function fetchElo(csvPrefix, sport) {
    var yr  = seasonYear(sport);
    var key = csvPrefix + yr;
    if (csvCache[key]) return Promise.resolve(csvCache[key]);
    var tries = [yr, yr - 1];
    function next(i) {
      if (i >= tries.length) return Promise.resolve({});
      return fetch(csvPrefix + tries[i] + '.csv')
        .then(function (r) {
          if (!r.ok) return next(i + 1);
          return r.text().then(function (text) {
            var rows = text.trim().split('\n');
            var hdrs = rows[0].split(',').map(function (h) { return h.trim().replace(/^"|"$/g, ''); });
            var ti = hdrs.indexOf('team'), ei = hdrs.indexOf('elo');
            if (ti < 0 || ei < 0) return next(i + 1);
            var map = {};
            for (var j = 1; j < rows.length; j++) {
              var c = rows[j].split(',').map(function (x) { return x.trim().replace(/^"|"$/g, ''); });
              if (c[ti]) map[c[ti]] = parseFloat(c[ei]) || 1500;
            }
            csvCache[key] = map;
            return map;
          });
        }).catch(function () { return next(i + 1); });
    }
    return next(0);
  }

  // ── Parse ESPN events into game objects ───────────────────────
  function parseEvents(events, cfg, eloMap) {
    var games = [];
    var seen  = {};
    (events || []).forEach(function (ev) {
      if (!inWindow(ev.date)) return;
      var comp = (ev.competitions || [])[0];
      if (!comp) return;
      if (comp.status && comp.status.type && comp.status.type.completed) return;

      var competitors = comp.competitors || [];
      var home = null, away = null;
      competitors.forEach(function (c) {
        if (c.homeAway === 'home') home = c; else away = c;
      });
      if (!home || !away) return;

      var hn = (home.team[cfg.nameField] || home.team.displayName || '').trim();
      var an = (away.team[cfg.nameField] || away.team.displayName || '').trim();
      if (!hn || !an) return;
      var lhn = hn.toLowerCase(), lan = an.toLowerCase();
      if (lhn === 'tbd' || lan === 'tbd' || lhn.includes('tbd') || lan.includes('tbd')) return;
      if (lhn.includes('flex') || lan.includes('flex')) return;

      hn = NAME_FIX[hn] || hn;
      an = NAME_FIX[an] || an;

      var key = ev.id || (hn + '|' + an + '|' + ev.date);
      if (seen[key]) return;
      seen[key] = 1;

      // Default 1500 if not in CSV (start of season / new team)
      var eH = eloMap[hn] || 1500;
      var eA = eloMap[an] || 1500;
      var neutral = !!(comp.neutralSite);
      var hca = neutral ? 0 : cfg.hca;

      var pH = eloProb(eH, eA, hca);
      var pA = 1 - pH;
      var pD = cfg.draw ? drawProb(eH, eA, hca) : 0;
      if (pD) { pH = (1 - pD) * pH; pA = (1 - pD) * pA; }

      var spd = parseFloat(eloSpread(eH, eA, hca, cfg.scale));

      games.push({
        id:       key,
        date:     ev.date,
        league:   cfg.league || '',
        homeTeam: hn, awayTeam: an,
        eH: eH, eA: eA,
        pH: pH, pA: pA, pD: pD,
        spd: spd,
        unit: cfg.unit,
        neutral: neutral,
        newTeams: (!eloMap[hn] || !eloMap[an])
      });
    });
    games.sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
    return games;
  }

  // ── Render a list of games ────────────────────────────────────
  function renderGames(games, sport) {
    if (!games.length) {
      return '<div class="empty-state" style="padding:2rem;text-align:center">'
        + '<div style="font-size:1rem;font-weight:600;margin-bottom:0.4rem">Off-Season</div>'
        + '<div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-dim)">No ' + sport + ' games in the next 2 weeks</div>'
        + '</div>';
    }

    var html = '<div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim);margin-bottom:0.85rem">'
      + games.length + ' game' + (games.length !== 1 ? 's' : '') + ' · next 14 days</div>';

    games.forEach(function (g) {
      var dateStr = '—';
      if (g.date) {
        var d = new Date(g.date);
        if (!isNaN(d)) {
          dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        }
      }

      var pH   = (g.pH * 100).toFixed(1) + '%';
      var pA   = (g.pA * 100).toFixed(1) + '%';
      var pD   = g.pD > 0 ? (g.pD * 100).toFixed(1) + '%' : null;
      var mlH  = toAmerican(g.pH);
      var mlA  = toAmerican(g.pA);
      var absS = Math.abs(g.spd).toFixed(1);
      var unitL = g.unit !== 'pts' ? ' ' + g.unit : '';
      // spread: home favored = home gets minus, away gets plus
      var spdH = g.spd > 0.05  ? '-' + absS + unitL
               : g.spd < -0.05 ? '+' + absS + unitL : 'PK';
      var spdA = g.spd > 0.05  ? '+' + absS + unitL
               : g.spd < -0.05 ? '-' + absS + unitL : 'PK';
      var barH = (g.pH * 100).toFixed(1);
      var barD = (g.pD * 100).toFixed(1);

      html += '<div class="lines-game-card">'
        // meta row
        + '<div class="lines-meta">'
          + (g.league ? '<span class="lines-badge">' + g.league + '</span>' : '')
          + '<span class="lines-time">' + dateStr + '</span>'
          + (g.neutral ? '<span class="lines-neutral">Neutral</span>' : '')
          + (g.newTeams ? '<span class="lines-neutral" style="color:var(--text-dim)">★ default Elo</span>' : '')
        + '</div>'
        // matchup grid: home | bar | away
        + '<div class="lines-matchup">'
          // home
          + '<div class="lines-team">'
            + '<div class="lines-tname">' + g.homeTeam + '</div>'
            + '<div class="lines-elo">' + g.eH.toFixed(0) + ' Elo</div>'
          + '</div>'
          // center
          + '<div class="lines-mid">'
            // probability bar
            + '<div class="lines-prob-bar">'
              + '<div style="width:' + barH + '%;background:var(--accent)"></div>'
              + (g.pD > 0 ? '<div style="width:' + barD + '%;background:var(--text-dim);opacity:0.4"></div>' : '')
              + '<div style="flex:1;background:var(--blue-hi)"></div>'
            + '</div>'
            // win %
            + '<div class="lines-probs">'
              + '<span style="color:var(--accent)">' + pH + '</span>'
              + (pD ? '<span class="lines-draw">' + pD + ' draw</span>'
                    : '<span style="color:var(--text-dim);font-size:0.75rem">vs</span>')
              + '<span style="color:var(--blue-hi)">' + pA + '</span>'
            + '</div>'
            // spread row
            + '<div class="lines-row2">'
              + '<span class="lines-spd-val">' + spdH + '</span>'
              + '<span class="lines-row2-label">Spread</span>'
              + '<span class="lines-spd-val">' + spdA + '</span>'
            + '</div>'
            // odds row
            + '<div class="lines-row2">'
              + '<span class="lines-ml ' + (g.pH >= 0.5 ? 'lines-fav' : 'lines-dog') + '">' + mlH + '</span>'
              + '<span class="lines-row2-label">Elo Odds</span>'
              + '<span class="lines-ml ' + (g.pA >= 0.5 ? 'lines-fav' : 'lines-dog') + '">' + mlA + '</span>'
            + '</div>'
          + '</div>'
          // away
          + '<div class="lines-team lines-team-r">'
            + '<div class="lines-tname">' + g.awayTeam + '</div>'
            + '<div class="lines-elo">' + g.eA.toFixed(0) + ' Elo</div>'
          + '</div>'
        + '</div>'
        + '</div>';
    });

    html += '<div class="lines-note">Win %, spread and odds from Elo ratings · Home advantage applied unless neutral site · ★ = team not yet in current season CSV, using base Elo 1500 · Not financial advice</div>';
    return html;
  }

  // ── Fetch all sports up front ─────────────────────────────────
  var cache = {}; // sport → games[]
  var activeSport  = 'NFL';
  var activeLeague = 'All';
  var panel = document.getElementById('linesPanel');

  function showSport(sport) {
    panel.innerHTML = '<div class="loading"><div class="spinner"></div>Loading ' + sport + ' games…</div>';

    // Soccer league sub-tabs
    var leagueDiv = document.getElementById('soccerLeagueTabs');
    if (leagueDiv) leagueDiv.hidden = (sport !== 'Soccer');

    if (cache[sport] !== undefined) {
      renderSport(sport);
      return;
    }

    var cfg = SPORTS[sport];
    if (!cfg) { panel.innerHTML = '<div class="empty-state">Unknown sport</div>'; return; }

    if (Array.isArray(cfg)) {
      // Soccer: fetch all leagues in parallel
      Promise.all(cfg.map(function (lc) {
        var url = 'https://site.api.espn.com/apis/site/v2/sports/' + lc.path + '/scoreboard?limit=200';
        return Promise.all([fetchJSON(url), fetchElo(lc.csv, 'Soccer')])
          .then(function (res) { return parseEvents(res[0].events, lc, res[1]); });
      })).then(function (allLeagueGames) {
        // tag each game with its league and flatten
        var flat = [];
        cfg.forEach(function (lc, i) {
          allLeagueGames[i].forEach(function (g) { flat.push(g); });
        });
        flat.sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
        cache['Soccer'] = flat;
        renderSport('Soccer');
      });
    } else {
      var url = 'https://site.api.espn.com/apis/site/v2/sports/' + cfg.path + '/scoreboard?limit=200' + (cfg.extra || '');
      Promise.all([fetchJSON(url), fetchElo(cfg.csv, sport)])
        .then(function (res) {
          cache[sport] = parseEvents(res[0].events, cfg, res[1]);
          renderSport(sport);
        });
    }
  }

  function renderSport(sport) {
    var games = cache[sport] || [];
    if (sport !== 'Soccer') {
      panel.innerHTML = renderGames(games, sport);
      return;
    }
    // Soccer: filter by active league
    var filtered = activeLeague === 'All' ? games
      : games.filter(function (g) { return g.league === activeLeague; });
    panel.innerHTML = renderGames(filtered, 'Soccer');
  }

  // ── Wire up sport tabs ────────────────────────────────────────
  document.querySelectorAll('#sportTabs .tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#sportTabs .tab').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeSport = btn.getAttribute('data-sport');
      activeLeague = 'All';
      // reset soccer sub-tab highlight
      document.querySelectorAll('.lines-sub-btn').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-league') === 'All');
      });
      showSport(activeSport);
    });
  });

  // ── Wire up soccer league sub-tabs ───────────────────────────
  document.querySelectorAll('.lines-sub-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.lines-sub-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeLeague = btn.getAttribute('data-league');
      renderSport('Soccer');
    });
  });

  // ── Initial load ──────────────────────────────────────────────
  showSport(activeSport);

})();
