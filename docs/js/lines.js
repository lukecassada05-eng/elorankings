'use strict';
// ── Upcoming Games — next 7 days only ─────────────────────────
// Sports we rank: NFL, NBA, MLB, NHL, CFB, Soccer leagues
// Shows: win%, spread, Elo-implied moneyline odds

window.initLinesPage = function() {
  var root = document.getElementById('lines-root');
  if (!root) return;

  var isRoot = window.location.pathname.indexOf('/sports/') === -1;
  var csvBase = isRoot ? '' : '../';

  // All ranked sports — 7-day filter handles off-season automatically
  // Sport tabs on the page show "No games" when out of season
  var SPORTS = [
    {sport:'NFL',    path:'americanfootball/nfl',                  name:'displayName',      hca:45, scale:35,  unit:'pts',   csv:'NFL/data/NFL_Elo_'},
    {sport:'NBA',    path:'basketball/nba',                         name:'displayName',      hca:50, scale:10,  unit:'pts',   csv:'NBA/data/NBA_Elo_'},
    {sport:'MLB',    path:'baseball/mlb',                           name:'displayName',      hca:20, scale:150, unit:'runs',  csv:'MLB/data/MLB_Elo_'},
    {sport:'NHL',    path:'icehockey/nhl',                          name:'displayName',      hca:25, scale:150, unit:'goals', csv:'NHL/data/NHL_Elo_'},
    {sport:'CFB',    path:'football/college-football',              name:'shortDisplayName', hca:55, scale:35,  unit:'pts',   csv:'CFB/data/CFB_Elo_', extra:'&groups=80'},
    {sport:'CBB',    path:'basketball/mens-college-basketball',     name:'shortDisplayName', hca:60, scale:10,  unit:'pts',   csv:'CBB/data/CBB_Elo_', extra:'&groups=50'},
    {sport:'CBASE',  path:'baseball/college-baseball',              name:'shortDisplayName', hca:20, scale:150, unit:'runs',  csv:'CBASE/data/CBASE_Elo_'},
    {sport:'Soccer', path:'soccer/eng.1',    name:'displayName', hca:60, scale:150, unit:'goals', csv:'Soccer/data/Soccer_Elo_', draw:true, league:'EPL'},
    {sport:'Soccer', path:'soccer/esp.1',    name:'displayName', hca:60, scale:150, unit:'goals', csv:'Soccer/data/Soccer_Elo_', draw:true, league:'La Liga'},
    {sport:'Soccer', path:'soccer/usa.1',    name:'displayName', hca:60, scale:150, unit:'goals', csv:'Soccer/data/Soccer_Elo_', draw:true, league:'MLS'},
    {sport:'Soccer', path:'soccer/ger.1',    name:'displayName', hca:60, scale:150, unit:'goals', csv:'Soccer/data/Soccer_Elo_', draw:true, league:'Bundesliga'},
    {sport:'Soccer', path:'soccer/ita.1',    name:'displayName', hca:60, scale:150, unit:'goals', csv:'Soccer/data/Soccer_Elo_', draw:true, league:'Serie A'},
    {sport:'Soccer', path:'soccer/fra.1',    name:'displayName', hca:60, scale:150, unit:'goals', csv:'Soccer/data/Soccer_Elo_', draw:true, league:'Ligue 1'},
    {sport:'Soccer', path:'soccer/uefa.champions', name:'displayName', hca:60, scale:150, unit:'goals', csv:'Soccer/data/Soccer_Elo_', draw:true, league:'UCL'},
  ];

  // ESPN name → CSV name fixes
  var NAME_FIX = {
    'Athletics': 'Sacramento Athletics',
    'Oakland Athletics': 'Sacramento Athletics',
  };
  function fixName(n){ return NAME_FIX[n]||n; }

  // 7-day window
  var now    = new Date();
  var cutoff = new Date(now.getTime() + 7*24*60*60*1000);

  function inNextWeek(dateStr) {
    if (!dateStr) return false;
    var d = new Date(dateStr);
    return !isNaN(d) && d >= now && d <= cutoff;
  }

  // ── Elo math ─────────────────────────────────────────────────
  function eloProb(eA, eB, hca){ return 1/(1+Math.pow(10,(eB-(eA+hca))/400)); }

  function eloSpread(eA, eB, hca, scale){
    return ((eA+hca-eB)/scale).toFixed(1);
  }

  // Convert win probability to American moneyline odds
  function toAmerican(prob) {
    if (prob <= 0 || prob >= 1) return '—';
    if (prob >= 0.5) {
      // Favorite: negative odds
      var odds = Math.round(-(prob/(1-prob))*100);
      return odds.toString();
    } else {
      // Underdog: positive odds
      var odds = Math.round(((1-prob)/prob)*100);
      return '+'+odds;
    }
  }

  function calcDraw(eA, eB, hca){
    return Math.max(0.03, 0.28*Math.max(0, 1-Math.abs(eA+hca-eB)/500));
  }

  // ── Fetch ESPN scoreboard ─────────────────────────────────────
  function fetchESPN(cfg) {
    var url = 'https://site.api.espn.com/apis/site/v2/sports/'+cfg.path+'/scoreboard?limit=100'+(cfg.extra||'');
    return fetch(url,{mode:'cors'}).then(function(r){return r.ok?r.json():{events:[]};}).catch(function(){return {events:[]};});
  }

  // ── Load Elo CSV ──────────────────────────────────────────────
  var eloCache = {};

  // Return the primary season year for each sport based on current date
  function seasonYear(sport) {
    var now = new Date();
    var yr  = now.getFullYear();
    var mo  = now.getMonth() + 1; // 1-12
    switch (sport) {
      case 'NFL':
        // Sep-Jan = current season; Feb-Aug = last season
        return mo >= 9 ? yr : yr - 1;
      case 'NBA':
      case 'NHL':
        // Oct-Jun = season labeled by END year; Jul-Sep = offseason (use prior)
        return mo >= 10 ? yr + 1 : yr;
      case 'CFB':
        // Aug-Jan = current season year; Feb-Jul = prior
        return mo >= 8 ? yr : yr - 1;
      case 'CBASE':
        // Feb-Jun in-season; Jul-Jan offseason (use prior year)
        return mo >= 2 ? yr : yr - 1;
      case 'Soccer':
        // Aug-Jul season; Aug-Dec = current yr; Jan-Jul = prior yr
        return mo >= 8 ? yr : yr - 1;
      default: // MLB and others: calendar year
        return mo >= 3 ? yr : yr - 1;
    }
  }

  function getEloMap(cfg) {
    var yr  = seasonYear(cfg.sport);
    var key = cfg.csv + yr;
    if (eloCache[key]) return Promise.resolve(eloCache[key]);
    // Try primary season year first, then one year back as fallback
    var tries = [yr, yr - 1];
    function tryNext(i) {
      if (i>=tries.length) return Promise.resolve({});
      var path = csvBase+cfg.csv+tries[i]+'.csv';
      return fetch(path).then(function(r){
        if (!r.ok) return tryNext(i+1);
        return r.text().then(function(text){
          var rows = text.trim().split('\n');
          var hdrs = rows[0].split(',').map(function(h){return h.trim().replace(/^"|"$/g,'');});
          var ti=hdrs.indexOf('team'), ei=hdrs.indexOf('elo');
          if (ti<0||ei<0) return tryNext(i+1);
          var map={};
          for(var j=1;j<rows.length;j++){
            var c=rows[j].split(',').map(function(x){return x.trim().replace(/^"|"$/g,'');});
            if(c[ti]) map[c[ti]]=parseFloat(c[ei])||1500;
          }
          eloCache[key]=map; return map;
        });
      }).catch(function(){return tryNext(i+1);});
    }
    return tryNext(0);
  }

  // ── State ─────────────────────────────────────────────────────
  var allGames    = [];
  var activeSport = 'All';
  var activeLeague= 'All Leagues';
  var loaded      = false;

  // ── Render ────────────────────────────────────────────────────
  function renderGames() {
    var filtered = allGames.filter(function(g){
      if (activeSport!=='All' && g.sport!==activeSport) return false;
      if (activeSport==='Soccer' && activeLeague!=='All Leagues' && g.league!==activeLeague) return false;
      return true;
    });

    if (!filtered.length) {
      root.innerHTML = '<div class="empty-state" style="padding:2rem;text-align:center">'
        +'<div style="margin-bottom:0.4rem">No games in the next 7 days</div>'
        +'<div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim)">Check back closer to the season</div>'
        +'</div>';
      return;
    }

    var html = '<div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim);margin-bottom:0.75rem">'
      +filtered.length+' game'+(filtered.length!==1?'s':'')+' · next 7 days</div>';

    filtered.forEach(function(g){
      var hasProb = g.probH!=null && g.probA!=null;
      var spd     = g.spread!=null ? parseFloat(g.spread) : null;
      var absSpd  = spd!=null ? Math.abs(spd) : null;
      var showSpd = absSpd!=null && absSpd>=0.05 && g.unit!=='runs'; // hide tiny MLB run spreads
      var unitLbl = g.unit!=='pts' ? ' '+g.unit : '';

      // Win percentages
      var pH = hasProb ? (g.probH*100).toFixed(1)+'%' : '—';
      var pA = hasProb ? (g.probA*100).toFixed(1)+'%' : '—';
      var pD = g.pDraw!=null ? (g.pDraw*100).toFixed(1)+'%' : null;

      // American odds (moneyline)
      var mlH = hasProb ? toAmerican(g.probH) : '—';
      var mlA = hasProb ? toAmerican(g.probA) : '—';

      // Spread strings (home perspective)
      var spdH = showSpd ? (spd>0?'-':'+')+(spd>0?absSpd.toFixed(1):absSpd.toFixed(1))+unitLbl : null;
      var spdA = showSpd ? (spd>0?'+':'-')+(absSpd.toFixed(1))+unitLbl : null;

      // Bar widths
      var barH = hasProb?(g.probH*100).toFixed(1):50;
      var barD = g.pDraw!=null?(g.pDraw*100).toFixed(1):0;

      // Date
      var dateStr='TBD';
      if(g.commence){var d=new Date(g.commence);if(!isNaN(d))
        dateStr=d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})+' '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});}

      html += '<div class="lines-game-card">'
        // ── top meta ──
        +'<div class="lines-meta">'
          +'<span class="lines-badge">'+g.league+'</span>'
          +'<span class="lines-time">'+dateStr+'</span>'
          +(g.neutral?'<span class="lines-neutral">Neutral</span>':'')
        +'</div>'
        // ── three-column matchup ──
        +'<div class="lines-matchup">'
          // Home
          +'<div class="lines-team">'
            +'<div class="lines-tname">'+g.homeTeam+'</div>'
            +(g.homeElo?'<div class="lines-elo">'+g.homeElo.toFixed(0)+' Elo</div>':'')
          +'</div>'
          // Middle: bar + probs + spread + odds
          +'<div class="lines-mid">'
            +'<div class="lines-prob-bar">'
              +'<div style="width:'+barH+'%;background:var(--accent)"></div>'
              +(barD>0.5?'<div style="width:'+barD+'%;background:var(--text-dim);opacity:0.4"></div>':'')
              +'<div style="flex:1;background:var(--blue-hi)"></div>'
            +'</div>'
            // Win %
            +'<div class="lines-probs">'
              +'<span style="color:var(--accent)">'+pH+'</span>'
              +(pD?'<span class="lines-draw">'+pD+' draw</span>':'<span style="color:var(--text-dim)">vs</span>')
              +'<span style="color:var(--blue-hi)">'+pA+'</span>'
            +'</div>'
            // Spread
            +(showSpd
              ?'<div class="lines-row2">'
                +'<span class="lines-spd-val">'+spdH+'</span>'
                +'<span class="lines-row2-label">Spread</span>'
                +'<span class="lines-spd-val">'+spdA+'</span>'
              +'</div>'
              :'')
            // Moneyline odds
            +(hasProb
              ?'<div class="lines-row2">'
                +'<span class="lines-ml '+(g.probH>=0.5?'lines-fav':'lines-dog')+'">'+mlH+'</span>'
                +'<span class="lines-row2-label">Elo Odds</span>'
                +'<span class="lines-ml '+(g.probA>=0.5?'lines-fav':'lines-dog')+'">'+mlA+'</span>'
              +'</div>'
              :'')
          +'</div>'
          // Away
          +'<div class="lines-team lines-team-r">'
            +'<div class="lines-tname">'+g.awayTeam+'</div>'
            +(g.awayElo?'<div class="lines-elo">'+g.awayElo.toFixed(0)+' Elo</div>':'')
          +'</div>'
        +'</div>'
        +'</div>';
    });

    html += '<div class="lines-note">Win %, spread and odds calculated from Elo ratings. Home advantage included unless neutral site. Not financial advice.</div>';
    root.innerHTML = html;
  }

  window._lf = function(sport, league){
    activeSport  = sport||'All';
    if(league) activeLeague = league;
    if(loaded) renderGames();
  };

  // ── Fetch & process ───────────────────────────────────────────
  root.innerHTML = '<div class="loading"><div class="spinner"></div>Loading upcoming games…</div>';

  Promise.all(SPORTS.map(function(cfg){
    return Promise.all([fetchESPN(cfg), getEloMap(cfg)]).then(function(res){
      var events = res[0].events||[];
      var eloMap = res[1];
      events.forEach(function(ev){
        // ── 7-day filter ──
        if (!inNextWeek(ev.date)) return;

        var comp = (ev.competitions||[])[0];
        if (!comp) return;
        if (comp.status&&comp.status.type&&comp.status.type.completed) return;

        var competitors = comp.competitors||[];
        var home=null,away=null;
        competitors.forEach(function(c){if(c.homeAway==='home')home=c;else away=c;});
        if(!home||!away) return;

        var hn=(home.team[cfg.name]||home.team.displayName||'').trim();
        var an=(away.team[cfg.name]||away.team.displayName||'').trim();
        if(!hn||!an) return;
        var lhn=hn.toLowerCase(),lan=an.toLowerCase();
        if(lhn==='tbd'||lan==='tbd'||lhn.includes('tbd')||lan.includes('tbd')) return;
        if(lhn.includes('flex')||lan.includes('flex')) return;

        hn=fixName(hn); an=fixName(an);

        var eH=eloMap[hn]||0, eA=eloMap[an]||0;
        var neutral=!!(comp.neutralSite);
        var hca=neutral?0:cfg.hca;

        var probH=null,probA=null,pDraw=null,spread=null;
        if(eH>0&&eA>0){
          probH  = eloProb(eH,eA,hca);
          probA  = 1-probH;
          spread = eloSpread(eH,eA,hca,cfg.scale);
          if(cfg.draw){
            pDraw = calcDraw(eH,eA,hca);
            probH = (1-pDraw)*probH;
            probA = (1-pDraw)*probA;
          }
        }

        allGames.push({
          sport:cfg.sport, league:cfg.league||cfg.sport,
          gameId:ev.id, commence:ev.date||'',
          homeTeam:hn, awayTeam:an,
          homeElo:eH||null, awayElo:eA||null,
          probH:probH, probA:probA, pDraw:pDraw,
          spread:spread, unit:cfg.unit||'pts', neutral:neutral,
        });
      });
    });
  })).then(function(){
    var seen={};
    allGames=allGames.filter(function(g){if(seen[g.gameId])return false;seen[g.gameId]=1;return true;});
    allGames.sort(function(a,b){
      if(!a.commence&&!b.commence)return 0;
      if(!a.commence)return 1;if(!b.commence)return -1;
      return new Date(a.commence)-new Date(b.commence);
    });
    loaded=true;
    renderGames();
  });
};
