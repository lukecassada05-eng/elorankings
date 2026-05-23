'use strict';
// ── Upcoming Games — Elo win probability & spread ──────────────
// All data from ESPN scoreboard. No API key needed.

window.initLinesPage = function() {
  var root = document.getElementById('lines-root');
  if (!root) return;

  // Detect if we're in docs/lines.html (base path = docs/) or docs/sports/ (base = docs/sports/)
  var isRoot = window.location.pathname.indexOf('/sports/') === -1;
  var csvBase = isRoot ? '' : '../';

  var SPORTS = [
    {sport:'NFL',    path:'americanfootball/nfl',                  name:'displayName',      hca:45,  scale:35, csv:'NFL/data/NFL_Elo_'},
    {sport:'NBA',    path:'basketball/nba',                         name:'displayName',      hca:50,  scale:10, csv:'NBA/data/NBA_Elo_'},
    {sport:'MLB',    path:'baseball/mlb',                           name:'displayName',      hca:20,  scale:2,  csv:'MLB/data/MLB_Elo_'},
    {sport:'NHL',    path:'icehockey/nhl',                          name:'displayName',      hca:25,  scale:1.5,csv:'NHL/data/NHL_Elo_'},
    {sport:'CFB',    path:'football/college-football',              name:'shortDisplayName', hca:55,  scale:35, csv:'CFB/data/CFB_Elo_', extra:'&groups=80'},
    {sport:'CBB',    path:'basketball/mens-college-basketball',     name:'shortDisplayName', hca:60,  scale:10, csv:'CBB/data/CBB_Elo_', extra:'&groups=50'},
    {sport:'Soccer', path:'soccer/eng.1',   name:'displayName', hca:60, scale:1, csv:'Soccer/data/Soccer_Elo_', draw:true, league:'EPL'},
    {sport:'Soccer', path:'soccer/esp.1',   name:'displayName', hca:60, scale:1, csv:'Soccer/data/Soccer_Elo_', draw:true, league:'La Liga'},
    {sport:'Soccer', path:'soccer/usa.1',   name:'displayName', hca:60, scale:1, csv:'Soccer/data/Soccer_Elo_', draw:true, league:'MLS'},
    {sport:'Soccer', path:'soccer/ger.1',   name:'displayName', hca:60, scale:1, csv:'Soccer/data/Soccer_Elo_', draw:true, league:'Bundesliga'},
    {sport:'Soccer', path:'soccer/ita.1',   name:'displayName', hca:60, scale:1, csv:'Soccer/data/Soccer_Elo_', draw:true, league:'Serie A'},
    {sport:'Soccer', path:'soccer/fra.1',   name:'displayName', hca:60, scale:1, csv:'Soccer/data/Soccer_Elo_', draw:true, league:'Ligue 1'},
    {sport:'Soccer', path:'soccer/uefa.champions', name:'displayName', hca:60, scale:1, csv:'Soccer/data/Soccer_Elo_', draw:true, league:'UCL'},
  ];

  // Name fixes: ESPN displayName → CSV team name (only where they differ)
  var NAME_FIX = {
    'Athletics':         'Sacramento Athletics',
    'Oakland Athletics': 'Sacramento Athletics',
  };
  function fixName(n){ return NAME_FIX[n] || n; }

  // Elo math
  function eloProb(eA, eB, hca){ return 1/(1+Math.pow(10,(eB-(eA+hca))/400)); }
  function eloSpread(eA, eB, hca, scale){
    var s = (eA+hca-eB)/scale;
    return s.toFixed(1);
  }
  function calcDraw(eA, eB, hca){
    var diff = Math.abs(eA+hca-eB);
    return Math.max(0.03, 0.28*Math.max(0, 1-diff/500));
  }

  // Fetch ESPN scoreboard
  function fetchESPN(cfg) {
    var url = 'https://site.api.espn.com/apis/site/v2/sports/'+cfg.path+'/scoreboard?limit=50'+(cfg.extra||'');
    return fetch(url, {mode:'cors'}).then(function(r){ return r.ok?r.json():{events:[]}; })
      .catch(function(){ return {events:[]}; });
  }

  // Parse Elo CSV
  var eloCache = {};
  function getEloMap(cfg) {
    var yr = new Date().getFullYear();
    if (cfg.sport==='CFB') yr -= 1;
    var key = cfg.csv + yr;
    if (eloCache[key]) return Promise.resolve(eloCache[key]);
    // Try current year, then prior
    var tries = [yr, yr-1];
    function tryNext(i) {
      if (i >= tries.length) return Promise.resolve({});
      var path = csvBase + cfg.csv + tries[i] + '.csv';
      return fetch(path).then(function(r){
        if (!r.ok) return tryNext(i+1);
        return r.text().then(function(text){
          var lines = text.trim().split('\n');
          var hdrs  = lines[0].split(',').map(function(h){return h.trim().replace(/^"|"$/g,'');});
          var ti = hdrs.indexOf('team'), ei = hdrs.indexOf('elo');
          if (ti<0||ei<0) return tryNext(i+1);
          var map = {};
          for (var j=1;j<lines.length;j++){
            var cols = lines[j].split(',').map(function(c){return c.trim().replace(/^"|"$/g,'');});
            if (cols[ti]) map[cols[ti]] = parseFloat(cols[ei])||1500;
          }
          eloCache[key] = map;
          return map;
        });
      }).catch(function(){ return tryNext(i+1); });
    }
    return tryNext(0);
  }

  // State
  var allGames = [];
  var activeSport = 'All';
  var activeLeague = 'All Leagues';
  var loaded = false;

  function renderGames() {
    var filtered = allGames.filter(function(g){
      if (activeSport !== 'All' && g.sport !== activeSport) return false;
      if (activeSport === 'Soccer' && activeLeague !== 'All Leagues' && g.league !== activeLeague) return false;
      return true;
    });

    if (!filtered.length) {
      root.innerHTML = '<div class="empty-state" style="padding:2rem;text-align:center">'
        +'<div style="font-size:0.95rem;margin-bottom:0.35rem">No upcoming games</div>'
        +'<div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim)">Check back when games are scheduled</div>'
        +'</div>';
      return;
    }

    var html = '<div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim);margin-bottom:0.75rem">'
      + filtered.length + ' upcoming game' + (filtered.length!==1?'s':'') + '</div>';

    filtered.forEach(function(g){
      var pH  = g.probH!=null ? (g.probH*100).toFixed(1)+'%' : '—';
      var pA  = g.probA!=null ? (g.probA*100).toFixed(1)+'%' : '—';
      var pD  = g.pDraw!=null ? (g.pDraw*100).toFixed(1)+'%' : null;
      var spd = g.spread!=null ? parseFloat(g.spread) : null;

      // Spread display: positive = home favored
      var spdHome = spd!=null ? (spd>0 ? '-'+Math.abs(spd) : '+'+Math.abs(spd)) : null;
      var spdAway = spd!=null ? (spd>0 ? '+'+Math.abs(spd) : '-'+Math.abs(spd)) : null;

      var barH = g.probH!=null?(g.probH*100).toFixed(1):50;
      var barD = g.pDraw!=null?(g.pDraw*100).toFixed(1):0;

      // Date formatting
      var dateStr = '—';
      if (g.commence) {
        var d = new Date(g.commence);
        if (!isNaN(d)) {
          dateStr = d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})
                  + ' ' + d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
        }
      }

      html += '<div class="lines-game-card">'
        // Meta row
        +'<div class="lines-meta">'
          +'<span class="lines-badge">'+g.league+'</span>'
          +'<span class="lines-time">'+dateStr+'</span>'
          +(g.neutral?'<span class="lines-neutral">Neutral</span>':'')
        +'</div>'
        // Matchup grid
        +'<div class="lines-matchup">'
          // Home team
          +'<div class="lines-team">'
            +'<div class="lines-tname">'+g.homeTeam+'</div>'
            +(g.homeElo?'<div class="lines-elo">'+g.homeElo.toFixed(0)+' Elo</div>':'')
            +(spdHome?'<div class="lines-spd">'+spdHome+'</div>':'')
          +'</div>'
          // Probability bar
          +'<div class="lines-mid">'
            +'<div class="lines-prob-bar">'
              +'<div style="width:'+barH+'%;background:var(--accent)"></div>'
              +(barD>0.5?'<div style="width:'+barD+'%;background:var(--text-dim);opacity:0.4"></div>':'')
              +'<div style="flex:1;background:var(--blue-hi)"></div>'
            +'</div>'
            +'<div class="lines-probs">'
              +'<span style="color:var(--accent)">'+pH+'</span>'
              +(pD?'<span class="lines-draw">'+pD+' draw</span>':'<span style="color:var(--text-dim);font-size:0.8rem">vs</span>')
              +'<span style="color:var(--blue-hi)">'+pA+'</span>'
            +'</div>'
          +'</div>'
          // Away team
          +'<div class="lines-team lines-team-r">'
            +'<div class="lines-tname">'+g.awayTeam+'</div>'
            +(g.awayElo?'<div class="lines-elo">'+g.awayElo.toFixed(0)+' Elo</div>':'')
            +(spdAway?'<div class="lines-spd lines-spd-r">'+spdAway+'</div>':'')
          +'</div>'
        +'</div>'
        +'</div>';
    });

    html += '<div class="lines-note">Win % and spread from Elo ratings. Home advantage included unless neutral site. Not financial advice.</div>';
    root.innerHTML = html;
  }

  // Expose filter function for tab buttons
  window._lf = function(sport, league) {
    activeSport  = sport || 'All';
    if (league) activeLeague = league;
    if (loaded) renderGames();
  };

  // Load all data
  root.innerHTML = '<div class="loading"><div class="spinner"></div>Loading upcoming games…</div>';

  Promise.all(SPORTS.map(function(cfg){
    return Promise.all([fetchESPN(cfg), getEloMap(cfg)]).then(function(res){
      var events = (res[0].events || []);
      var eloMap = res[1];
      events.forEach(function(ev){
        var comp = (ev.competitions||[])[0];
        if (!comp) return;
        var status = comp.status && comp.status.type;
        if (status && status.completed) return;

        var competitors = comp.competitors || [];
        var home=null, away=null;
        competitors.forEach(function(c){ if(c.homeAway==='home')home=c; else away=c; });
        if (!home||!away) return;

        var hn = (home.team[cfg.name]||home.team.displayName||'').trim();
        var an = (away.team[cfg.name]||away.team.displayName||'').trim();

        // Skip TBD / flex entries
        if (!hn||!an) return;
        var lhn=hn.toLowerCase(), lan=an.toLowerCase();
        if (lhn==='tbd'||lan==='tbd'||lhn.includes('tbd')||lan.includes('tbd')) return;
        if (lhn.includes('flex')||lan.includes('flex')) return;

        hn = fixName(hn); an = fixName(an);

        var eH = eloMap[hn]||0, eA = eloMap[an]||0;
        var neutral = !!(comp.neutralSite);
        var hca = neutral ? 0 : cfg.hca;

        var probH=null, probA=null, pDraw=null, spread=null;
        if (eH>0 && eA>0) {
          probH  = eloProb(eH, eA, hca);
          probA  = 1 - probH;
          spread = eloSpread(eH, eA, hca, cfg.scale);
          if (cfg.draw) {
            pDraw  = calcDraw(eH, eA, hca);
            probH  = (1-pDraw)*probH;
            probA  = (1-pDraw)*probA;
          }
        }

        allGames.push({
          sport:   cfg.sport,
          league:  cfg.league||cfg.sport,
          gameId:  ev.id,
          commence:ev.date||'',
          homeTeam:hn, awayTeam:an,
          homeElo: eH||null, awayElo: eA||null,
          probH:probH, probA:probA, pDraw:pDraw,
          spread:spread, neutral:neutral,
        });
      });
    });
  })).then(function(){
    // Deduplicate by gameId
    var seen={};
    allGames = allGames.filter(function(g){
      if (seen[g.gameId]) return false;
      seen[g.gameId]=1; return true;
    });
    // Sort by commence time
    allGames.sort(function(a,b){
      if(!a.commence&&!b.commence) return 0;
      if(!a.commence) return 1; if(!b.commence) return -1;
      return new Date(a.commence)-new Date(b.commence);
    });
    loaded = true;
    renderGames();
  });
};
