'use strict';
// ── Upcoming Games — win probability & Elo spread ─────────────
// Fetches directly from ESPN scoreboard (no API key needed)
// Matches team names to Elo CSV data using sport-specific name fields

window.initLinesPage = async function() {
  const root = document.getElementById('lines-root');
  if (!root) return;
  root.innerHTML = '<div class="loading"><div class="spinner"></div>Loading upcoming games…</div>';

  // ESPN configs per sport
  const SPORTS = [
    {sport:'NFL',    path:'americanfootball/nfl',                  name:'displayName',      hca:45,  scale:35, csvPath:'NFL/data/NFL_Elo_'},
    {sport:'NBA',    path:'basketball/nba',                         name:'displayName',      hca:50,  scale:10, csvPath:'NBA/data/NBA_Elo_'},
    {sport:'MLB',    path:'baseball/mlb',                           name:'displayName',      hca:20,  scale:2,  csvPath:'MLB/data/MLB_Elo_'},
    {sport:'NHL',    path:'icehockey/nhl',                          name:'displayName',      hca:25,  scale:1.5,csvPath:'NHL/data/NHL_Elo_'},
    {sport:'CFB',    path:'football/college-football',              name:'shortDisplayName', hca:55,  scale:35, csvPath:'CFB/data/CFB_Elo_',  extra:'&groups=80'},
    {sport:'CBB',    path:'basketball/mens-college-basketball',     name:'shortDisplayName', hca:60,  scale:10, csvPath:'CBB/data/CBB_Elo_',  extra:'&groups=50'},
    {sport:'Soccer', path:'soccer/eng.1',                           name:'displayName',      hca:60,  scale:1,  csvPath:'Soccer/data/Soccer_Elo_', draw:true, league:'EPL'},
    {sport:'Soccer', path:'soccer/esp.1',                           name:'displayName',      hca:60,  scale:1,  csvPath:'Soccer/data/Soccer_Elo_', draw:true, league:'La Liga'},
    {sport:'Soccer', path:'soccer/usa.1',                           name:'displayName',      hca:60,  scale:1,  csvPath:'Soccer/data/Soccer_Elo_', draw:true, league:'MLS'},
    {sport:'Soccer', path:'soccer/ger.1',                           name:'displayName',      hca:60,  scale:1,  csvPath:'Soccer/data/Soccer_Elo_', draw:true, league:'Bundesliga'},
    {sport:'Soccer', path:'soccer/ita.1',                           name:'displayName',      hca:60,  scale:1,  csvPath:'Soccer/data/Soccer_Elo_', draw:true, league:'Serie A'},
    {sport:'Soccer', path:'soccer/fra.1',                           name:'displayName',      hca:60,  scale:1,  csvPath:'Soccer/data/Soccer_Elo_', draw:true, league:'Ligue 1'},
    {sport:'Soccer', path:'soccer/uefa.champions',                  name:'displayName',      hca:60,  scale:1,  csvPath:'Soccer/data/Soccer_Elo_', draw:true, league:'UCL'},
  ];

  // Name corrections: ESPN displayName → CSV team name
  // Only needed where they differ
  var NAME_FIX = {
    'Athletics':         'Sacramento Athletics',
    'Oakland Athletics': 'Sacramento Athletics',
  };
  function fixName(n){ return NAME_FIX[n] || n; }

  // Elo math
  function eloProb(eA, eB, hca){ return 1/(1+Math.pow(10,(eB-(eA+hca))/400)); }
  function eloSpread(eA, eB, hca, scale){ return ((eA+hca-eB)/scale).toFixed(1); }
  function drawProb(eA, eB, hca){
    var diff = Math.abs(eA+hca-eB);
    return Math.max(0.03, 0.28*Math.max(0, 1-diff/500));
  }

  // Fetch ESPN scoreboard (upcoming + in-progress, not completed)
  async function fetchESPN(cfg) {
    var url = 'https://site.api.espn.com/apis/site/v2/sports/'+cfg.path+'/scoreboard?limit=50'+(cfg.extra||'');
    try {
      var res = await fetch(url, {mode:'cors'});
      if (!res.ok) return [];
      var data = await res.json();
      return data.events || [];
    } catch(e){ return []; }
  }

  // Fetch Elo CSV and parse into {teamName: elo}
  var eloCache = {};
  async function getEloMap(cfg) {
    var yr = new Date().getFullYear();
    // CFB uses prior year (season ended)
    if (cfg.sport==='CFB') yr -= 1;
    var key = cfg.csvPath + yr;
    if (eloCache[key]) return eloCache[key];
    // Try current year, fall back to prior
    for (var y = yr; y >= yr-1; y--) {
      try {
        var path = (cfg.csvPath.startsWith('http') ? '' : '../') + cfg.csvPath + y + '.csv';
        var res = await fetch(path);
        if (!res.ok) continue;
        var text = await res.text();
        var lines = text.trim().split('\n');
        var headers = lines[0].split(',').map(h=>h.trim().replace(/^"|"$/g,''));
        var teamIdx = headers.indexOf('team');
        var eloIdx  = headers.indexOf('elo');
        if (teamIdx<0||eloIdx<0) continue;
        var map = {};
        for (var i=1;i<lines.length;i++){
          var cols = lines[i].split(',').map(c=>c.trim().replace(/^"|"$/g,''));
          if (cols[teamIdx]) map[cols[teamIdx]] = parseFloat(cols[eloIdx])||1500;
        }
        eloCache[key] = map;
        return map;
      } catch(e){}
    }
    return {};
  }

  // Fetch all sports in parallel
  var allGames = [];
  var seenSoccerElo = {}; // reuse soccer elo map across leagues

  await Promise.all(SPORTS.map(async function(cfg){
    var [events, eloMap] = await Promise.all([fetchESPN(cfg), getEloMap(cfg)]);
    events.forEach(function(ev){
      var comp = (ev.competitions||[])[0];
      if (!comp) return;
      var completed = comp.status && comp.status.type && comp.status.type.completed;
      if (completed) return; // skip finished games

      var competitors = comp.competitors||[];
      var home = null, away = null;
      competitors.forEach(function(c){
        if(c.homeAway==='home') home=c; else away=c;
      });
      if (!home||!away) return;

      var hn = (home.team[cfg.name]||home.team.displayName||'').trim();
      var an = (away.team[cfg.name]||away.team.displayName||'').trim();

      // Skip TBD or flex entries
      if (!hn||!an||hn==='TBD'||an==='TBD'||hn.toLowerCase().includes('tbd')||an.toLowerCase().includes('tbd')) return;

      // Fix any known name mismatches
      hn = fixName(hn); an = fixName(an);

      // Look up Elo
      var eH = eloMap[hn]||0;
      var eA = eloMap[an]||0;
      var hasElo = eH>0 && eA>0;

      // Compute probabilities
      var probH=null, probA=null, pDraw=null, spread=null;
      if (hasElo) {
        var neutral = !!(comp.neutralSite);
        var hca = neutral ? 0 : cfg.hca;
        probH  = eloProb(eH, eA, hca);
        probA  = 1 - probH;
        spread = eloSpread(eH, eA, hca, cfg.scale);
        if (cfg.draw) {
          pDraw = drawProb(eH, eA, hca);
          probH = (1-pDraw)*probH;
          probA = (1-pDraw)*probA;
        }
      }

      var commence = ev.date || (comp.date);
      allGames.push({
        sport:   cfg.sport,
        league:  cfg.league || cfg.sport,
        gameId:  ev.id,
        commence:commence,
        homeTeam:hn, awayTeam:an,
        homeElo: eH||null, awayElo: eA||null,
        probH:probH, probA:probA, pDraw:pDraw,
        spread:spread,
        hasElo:hasElo,
        neutral: !!(comp.neutralSite),
      });
    });
  }));

  // Deduplicate (same gameId)
  var seen={};
  allGames = allGames.filter(function(g){
    if(seen[g.gameId]) return false;
    seen[g.gameId]=1; return true;
  });

  // Sort by commence time
  allGames.sort(function(a,b){
    if(!a.commence&&!b.commence) return 0;
    if(!a.commence) return 1; if(!b.commence) return -1;
    return new Date(a.commence)-new Date(b.commence);
  });

  if (!allGames.length) {
    root.innerHTML = '<div class="empty-state" style="padding:2rem;text-align:center">'
      +'<div style="font-size:1rem;margin-bottom:0.4rem">No upcoming games right now</div>'
      +'<div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-dim)">Check back when games are scheduled</div>'
      +'</div>';
    return;
  }

  // ── Render ────────────────────────────────────────────────────
  var activeSport = 'All';
  var sports = ['All'].concat([...new Set(allGames.map(function(g){return g.sport;}))]);

  function fmt(g){
    var d = g.commence ? new Date(g.commence) : null;
    if (!d || isNaN(d)) return 'TBD';
    return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})
         + ' ' + d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  }

  function renderGame(g){
    var pH  = g.probH != null ? (g.probH*100).toFixed(1)+'%' : '—';
    var pA  = g.probA != null ? (g.probA*100).toFixed(1)+'%' : '—';
    var pD  = g.pDraw != null ? (g.pDraw*100).toFixed(1)+'%' : null;
    var spd = g.spread != null ? (parseFloat(g.spread)>0?'-'+g.spread:'+'+Math.abs(parseFloat(g.spread))) : null;
    var barH = g.probH!=null ? (g.probH*100).toFixed(1) : 50;
    var barD = g.pDraw!=null ? (g.pDraw*100).toFixed(1) : 0;

    var eloH = g.homeElo ? g.homeElo.toFixed(0) : '—';
    var eloA = g.awayElo ? g.awayElo.toFixed(0) : '—';

    var spreadHtml = spd
      ? '<div class="lines-spread-row"><span class="lines-spread-label">Spread</span>'
        +'<span class="lines-spread-home">'+g.homeTeam+' '+spd+'</span></div>'
      : '';

    var drawHtml = pD
      ? '<span class="lines-draw">'+pD+' draw</span>' : '';

    return '<div class="lines-game-card">'
      +'<div class="lines-meta">'
      +'<span class="lines-badge">'+g.league+'</span>'
      +'<span class="lines-time">'+fmt(g)+'</span>'
      +(g.neutral?'<span class="lines-neutral">Neutral</span>':'')
      +'</div>'
      +'<div class="lines-matchup">'
        +'<div class="lines-team">'
          +'<div class="lines-tname">'+g.homeTeam+'</div>'
          +(g.homeElo?'<div class="lines-elo">'+eloH+' Elo</div>':'')
        +'</div>'
        +'<div class="lines-mid">'
          +'<div class="lines-prob-bar">'
            +'<div style="width:'+barH+'%;background:var(--accent)"></div>'
            +(barD>0.5?'<div style="width:'+barD+'%;background:var(--text-dim);opacity:0.4"></div>':'')
            +'<div style="flex:1;background:var(--blue-hi)"></div>'
          +'</div>'
          +'<div class="lines-probs">'
            +'<span style="color:var(--accent)">'+pH+'</span>'
            +drawHtml
            +'<span style="color:var(--blue-hi)">'+pA+'</span>'
          +'</div>'
          +spreadHtml
        +'</div>'
        +'<div class="lines-team lines-team-r">'
          +'<div class="lines-tname">'+g.awayTeam+'</div>'
          +(g.awayElo?'<div class="lines-elo">'+eloA+' Elo</div>':'')
        +'</div>'
      +'</div>'
      +'</div>';
  }

  function render(){
    var filtered = activeSport==='All' ? allGames : allGames.filter(function(g){return g.sport===activeSport;});
    var btnHtml = sports.map(function(s){
      return '<button onclick="window._lf(\''+s+'\')" class="lines-filter-btn'+(activeSport===s?' active':'')+'">'
        +s+' <span style="font-size:0.6rem;opacity:0.7">'
        +(s==='All'?allGames.length:allGames.filter(function(g){return g.sport===s;}).length)
        +'</span></button>';
    }).join('');

    var rows = filtered.map(renderGame).join('');

    root.innerHTML = '<div class="lines-header">'
      +'<div><div class="lines-title">Upcoming Games</div>'
      +'<div class="lines-sub">Elo win probability · '+filtered.length+' game'+(filtered.length!==1?'s':'')+'</div></div>'
      +'</div>'
      +'<div class="lines-filter-row" style="margin-bottom:0.85rem">'+btnHtml+'</div>'
      +(rows||'<div class="empty-state">No upcoming games for this sport</div>')
      +'<div class="lines-note">Win % and spread calculated from Elo ratings. Home advantage applied unless neutral site. Not financial advice.</div>';
  }

  window._lf = function(sport){
    activeSport = sport;
    render();
    if(typeof gtag!=='undefined') gtag('event','lines_filter',{sport:sport});
  };
  render();
};
