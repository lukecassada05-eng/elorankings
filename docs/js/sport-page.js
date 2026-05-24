'use strict';

window.initSportPage = function(CFG) {
  let data = [], allSeasonData = {}, currentSeason = (CFG.seasons && CFG.seasons[0]) || new Date().getFullYear();

  // ── Season picker ──────────────────────────────────────────
  // Picker is built dynamically after probeSeasons() discovers available CSVs
  // (see findAvailableSeason / probeSeasons below)

  // ── Tab init ───────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('[id^="panel-"]').forEach(p => p.hidden = true);
      const panel = document.getElementById('panel-' + tab.dataset.tab);
      if (panel) panel.hidden = false;
      if (tab.dataset.tab === 'byconf')       renderByConf();
      if (tab.dataset.tab === 'predictor')    renderPredictor();
      if (tab.dataset.tab === 'bracketology') renderBracketology();
      if (tab.dataset.tab === 'resume')       renderResume();
      if (tab.dataset.tab === 'history')      renderHistory();
      if (tab.dataset.tab === 'tracker')      renderSeasonTracker();
      if (tab.dataset.tab === 'greatest')    renderGreatestTeams();
      if (tab.dataset.tab === 'pickem')      renderPickem();
      if (tab.dataset.tab === 'confhistory') renderConfHistory();
    });
  });


  // ── Lines & Odds ──────────────────────────────────────────
  // Separate section below tabs — visually distinct button
  (function setupLines() {
    // Insert Lines button below the tabs row
    var tabsEl = document.querySelector('.tabs');
    if (!tabsEl) return;

    // Create the Lines toggle button
    var btn = document.createElement('button');
    btn.id = 'linesToggleBtn';
    btn.innerHTML = '📈 Lines &amp; Odds';
    btn.title = 'Elo-based win probability, spread and moneyline odds for upcoming games';
    btn.style.cssText = [
      'display:block','width:100%','margin:0.85rem 0 0',
      'padding:0.6rem 1rem',
      'background:var(--bg2)','border:2px solid var(--border)',
      'border-radius:var(--radius-lg)','cursor:pointer',
      'font-family:var(--font-mono)','font-size:0.78rem','font-weight:600',
      'color:var(--text-muted)','text-align:left',
      'transition:border-color 0.15s,color 0.15s',
      'letter-spacing:0.02em'
    ].join(';');

    btn.addEventListener('mouseenter', function() {
      if (!linesOpen) {
        btn.style.borderColor = 'var(--accent)';
        btn.style.color = 'var(--accent)';
      }
    });
    btn.addEventListener('mouseleave', function() {
      if (!linesOpen) {
        btn.style.borderColor = 'var(--border)';
        btn.style.color = 'var(--text-muted)';
      }
    });

    tabsEl.parentNode.insertBefore(btn, tabsEl.nextSibling);

    // Create the Lines panel (hidden by default)
    var panel = document.createElement('div');
    panel.id = 'linesPanel';
    panel.hidden = true;
    panel.style.cssText = 'margin-top:0.75rem';
    btn.parentNode.insertBefore(panel, btn.nextSibling);

    var linesOpen   = false;
    var linesLoaded = false;

    btn.addEventListener('click', function() {
      linesOpen = !linesOpen;
      panel.hidden = !linesOpen;

      if (linesOpen) {
        btn.style.cssText = btn.style.cssText
          .replace('var(--bg2)', 'rgba(226,201,126,0.08)')
          .replace(/border:[^;]+;/, 'border:2px solid var(--accent);');
        btn.style.borderColor = 'var(--accent)';
        btn.style.color = 'var(--accent)';
        btn.innerHTML = '📈 Lines &amp; Odds &nbsp;<span style="font-size:0.68rem;opacity:0.7">▲ close</span>';
        if (!linesLoaded) { linesLoaded = true; loadLines(); }
      } else {
        btn.style.borderColor = 'var(--border)';
        btn.style.color = 'var(--text-muted)';
        btn.style.background = 'var(--bg2)';
        btn.innerHTML = '📈 Lines &amp; Odds';
      }

      if (typeof gtag !== 'undefined') {
        gtag('event', 'lines_toggle', { sport: CFG.sport, open: linesOpen });
      }
    });

    // Soccer league sub-filter state
    var activeSoccerLeague = 'All';
    var allLinesGames = [];

    function loadLines() {
      panel.innerHTML = '<div class="loading"><div class="spinner"></div>Loading upcoming games…</div>';

      // ESPN configs per sport
      // Calibrated sport configs — scale and HCA based on sports analytics research
      // NFL/CFB: FiveThirtyEight validated (scale 28=3.6pts/100Elo, HCA 55=~3pts)
      // NBA: strong home court (HCA 100≈3pts), tight scale (predictable high-scoring)
      // MLB/NHL: high variance sports need larger scale (small margins, many games)
      // CBB: strongest home court in sports (HCA 90), scale 12≈7pts/100Elo
      // Soccer: D=500 model, draw suppresses win%, scale 140≈0.7goals/100Elo
      var cfgMap = {
        NFL:   { path:'americanfootball/nfl',                  nf:'displayName',      hca:55,  scale:28,  unit:'pts'   },
        NBA:   { path:'basketball/nba',                         nf:'displayName',      hca:63,  scale:11,  unit:'pts'   },
        MLB:   { path:'baseball/mlb',                           nf:'displayName',      hca:25,  scale:180, unit:'runs'  },
        NHL:   { path:'icehockey/nhl',                          nf:'displayName',      hca:30,  scale:200, unit:'goals' },
        CFB:   { path:'football/college-football',              nf:'shortDisplayName', hca:55,  scale:28,  unit:'pts',  extra:'&groups=80', spreadCap:35 },
        CBB:   { path:'basketball/mens-college-basketball',     nf:'shortDisplayName', hca:90,  scale:12,  unit:'pts',  extra:'&groups=50' },
        CBASE: { path:'baseball/college-baseball',              nf:'shortDisplayName', hca:25,  scale:160, unit:'runs',  extraUrls:['&groups=11','&groups=100'] },
        Soccer:[
          { league:'EPL',          path:'soccer/eng.1',            nf:'displayName', hca:65, scale:140, unit:'goals', draw:true },
          { league:'La Liga',      path:'soccer/esp.1',            nf:'displayName', hca:65, scale:140, unit:'goals', draw:true },
          { league:'Bundesliga',   path:'soccer/ger.1',            nf:'displayName', hca:65, scale:140, unit:'goals', draw:true },
          { league:'Serie A',      path:'soccer/ita.1',            nf:'displayName', hca:65, scale:140, unit:'goals', draw:true },
          { league:'Ligue 1',      path:'soccer/fra.1',            nf:'displayName', hca:65, scale:140, unit:'goals', draw:true },
          { league:'MLS',          path:'soccer/usa.1',            nf:'displayName', hca:65, scale:140, unit:'goals', draw:true },
          { league:'UCL',          path:'soccer/uefa.champions',   nf:'displayName', hca:0,  scale:140, unit:'goals', draw:true },
          { league:'Eredivisie',   path:'soccer/ned.1',            nf:'displayName', hca:65, scale:140, unit:'goals', draw:true },
          { league:'Primeira Liga',path:'soccer/por.1',            nf:'displayName', hca:65, scale:140, unit:'goals', draw:true },
          { league:'Süper Lig',    path:'soccer/tur.1',            nf:'displayName', hca:65, scale:140, unit:'goals', draw:true },
          { league:'Pro League',   path:'soccer/bel.1',            nf:'displayName', hca:65, scale:140, unit:'goals', draw:true },
          { league:'Scottish Prem',path:'soccer/sco.1',            nf:'displayName', hca:65, scale:140, unit:'goals', draw:true },
        ]
      };

      var sportCfg = cfgMap[CFG.sport];
      if (!sportCfg) {
        panel.innerHTML = '<div class="empty-state" style="padding:1.5rem;text-align:center">Lines not available for this sport yet.</div>';
        return;
      }

      var NAME_FIX = {
        // College Baseball: ESPN shortDisplayName → canonical name used in CBASE CSV
        // (mirrors the ALIASES in update_college_baseball.R)
        'Fla. State':'Florida State','Florida St':'Florida State','FSU':'Florida State',
        'N.C. State':'NC State','N Carolina St':'NC State','Ohio St':'Ohio State',
        'Penn St':'Penn State','Michigan St':'Michigan State','Mich. St.':'Michigan State',
        'Oklahoma St':'Oklahoma State','Okla. State':'Oklahoma State',
        'Iowa St':'Iowa State','Iowa St.':'Iowa State',
        'Kansas St':'Kansas State','Kansas St.':'Kansas State','K-State':'Kansas State',
        'Miss St':'Mississippi State','Miss. St.':'Mississippi State',
        'Miss. State':'Mississippi State','Mississippi St':'Mississippi State',
        'S. Carolina':'South Carolina','S Carolina':'South Carolina',
        'Oregon St':'Oregon State','Ore. State':'Oregon State',
        'Arizona St':'Arizona State','Ariz. St.':'Arizona State',
        'Wash St':'Washington State','Washington St':'Washington State',
        'Fresno St':'Fresno State','Utah St':'Utah State',
        'San Jose St':'San Jose State','San José St':'San Jose State',
        'San Diego St':'San Diego State','Boise St':'Boise State',
        'Colorado St':'Colorado State',
        'Hawaii':"Hawai\'i",
        'USF':'South Florida','South Fla':'South Florida',
        'ECU':'East Carolina','E. Carolina':'East Carolina',
        'UConn':'UConn','Connecticut':'UConn',
        'App State':'Appalachian State','Appalachian St':'Appalachian State',
        'Ga. Southern':'Georgia Southern','GA Southern':'Georgia Southern',
        'Ga. State':'Georgia State','GA St':'Georgia State','Georgia St':'Georgia State',
        'Ark St':'Arkansas State','Arkansas St':'Arkansas State',
        'Texas St':'Texas State','Tex St':'Texas State',
        'Coastal Car':'Coastal Carolina','Coastal':'Coastal Carolina',
        'S. Alabama':'South Alabama','South Ala':'South Alabama',
        'ODU':'Old Dominion','Old Dom.':'Old Dominion',
        'So. Miss':'Southern Miss',
        'UL Monroe':'UL Monroe','La.-Monroe':'UL Monroe','ULM':'UL Monroe',
        'ULL':'Louisiana','Louisiana Lafayette':'Louisiana','UL Lafayette':'Louisiana',
        'WKU':'Western Kentucky','W. Kentucky':'Western Kentucky','Western KY':'Western Kentucky',
        'Western Ky':'Western Kentucky','Western Ky.':'Western Kentucky',
        'Middle Tenn':'Middle Tennessee','Middle Tenn.':'Middle Tennessee','MTSU':'Middle Tennessee',
        'Fla. Atlantic':'Florida Atlantic','FAU':'Florida Atlantic',
        'FIU Panthers':'FIU','Florida Intl':'FIU','Fla. Intl':'FIU',
        'La. Tech':'Louisiana Tech','La Tech':'Louisiana Tech',
        'New Mexico St':'New Mexico State','NMSU':'New Mexico State',
        'Jax State':'Jacksonville State','Jax St':'Jacksonville State',
        'Kennesaw St':'Kennesaw State',
        'Sam Hous.':'Sam Houston','Sam Houston St':'Sam Houston','SHSU':'Sam Houston',
        'C Michigan':'Central Michigan','Cent Michigan':'Central Michigan','CMU':'Central Michigan',
        'E. Michigan':'Eastern Michigan','E Michigan':'Eastern Michigan','EMU':'Eastern Michigan',
        'W. Michigan':'Western Michigan','W Michigan':'Western Michigan','WMU':'Western Michigan',
        'N. Illinois':'Northern Illinois','N Illinois':'Northern Illinois','NIU':'Northern Illinois',
        'Ball St':'Ball State','Ball St.':'Ball State',
        'Bowling Green St':'Bowling Green','BGSU':'Bowling Green',
        'UB':'Buffalo','Kent St':'Kent State','Kent St.':'Kent State',
        'Miami OH':'Miami (OH)','Miami (Ohio)':'Miami (OH)',
        'Santa Barbara':'UC Santa Barbara','UCSB':'UC Santa Barbara',
        'Long Beach St':'Long Beach State','LBSU':'Long Beach State',
        'CS Fullerton':'Cal State Fullerton','Fullerton':'Cal State Fullerton',
        'Sacramento St':'Sacramento State','Sac. State':'Sacramento State',
        'CS Northridge':'Cal State Northridge','CSUN':'Cal State Northridge',
        'Bakersfield':'Cal State Bakersfield','CS Bakersfield':'Cal State Bakersfield',
        'Missouri St':'Missouri State','Indiana St':'Indiana State',
        'Illinois St':'Illinois State','S. Illinois':'Southern Illinois',
        'N. Iowa':'Northern Iowa','UNI':'Northern Iowa',
        'Wright St':'Wright State','N. Kentucky':'Northern Kentucky','N Kentucky':'Northern Kentucky',
        'Purdue FW':'Purdue Fort Wayne','IU Indy':'IU Indianapolis','IUPUI':'IU Indianapolis',
        'Dallas Baptist':'Dallas Baptist','DBU':'Dallas Baptist',
        'GCU':'Grand Canyon','Grand Canyon':'Grand Canyon',
        'Tarleton St':'Tarleton State','SFA':'Stephen F. Austin','SF Austin':'Stephen F. Austin',
        'McNeese St':'McNeese','McNeese State':'McNeese',
        'Nicholls St':'Nicholls','Nicholls State':'Nicholls',
        'SE Louisiana':'SE Louisiana','Southeastern La.':'SE Louisiana',
        'N\'Western St':'Northwestern State','Northwestern St':'Northwestern State',
        'Hou Christian':'Houston Christian','Houston Baptist':'Houston Christian',
        'Abil Christian':'Abilene Christian','Abilene Chrstn':'Abilene Christian',
        'NC A&T':'North Carolina A&T','Delaware St':'Delaware State',
        'Norfolk St':'Norfolk State','Morgan St':'Morgan State',
        'Alabama St':'Alabama State','Bethune':'Bethune-Cookman',
        'Fla. A&M':'Florida A&M','SC State':'South Carolina State',
        'Miss Valley St':'Mississippi Valley State',
        'Jackson St':'Jackson State','AR-Pine Bluff':'Arkansas-Pine Bluff',
        'Alcorn St':'Alcorn State','Savannah St':'Savannah State',
        'S Dakota St':'South Dakota State','N Dakota St':'North Dakota State','NDSU':'North Dakota State',
        'So Indiana':'Southern Indiana','UT Rio Grande':'UT Rio Grande Valley','UTRGV':'UT Rio Grande Valley',
        'W Illinois':'Western Illinois','W. Illinois':'Western Illinois',
        'CA Baptist':'Cal Baptist','LMU':'Loyola Marymount',
        'SE Missouri St':'Southeast Missouri','SE Missouri':'Southeast Missouri','SEMO':'Southeast Missouri',
        'E. Illinois':'Eastern Illinois','E Illinois':'Eastern Illinois',
        'C Arkansas':'Central Arkansas','Cent. Arkansas':'Central Arkansas',
        'UMass Lowell':'UMass Lowell','UAlbany':'Albany',
        'UIC':'Illinois-Chicago','UT Arlington':'UT Arlington','UTA':'UT Arlington',
        'UNO':'New Orleans','SIUE':'SIUE','SIU Edwardsville':'SIUE',
        'Wichita St':'Wichita State','Wichita St.':'Wichita State',
        'St John\'s':'St. John\'s','St. Johns':'St. John\'s',
        'St Thomas (MN)':'St. Thomas','St. Thomas (MN)':'St. Thomas',
        'G Washington':'George Washington','GWU':'George Washington',
        'C Connecticut':'Central Connecticut State','Cent. Conn.':'Central Connecticut State',
        'FDU':'Fairleigh Dickinson','URI':'Rhode Island','UMass':'Massachusetts',
        'Mass.':'Massachusetts','VCU':'VCU',
        // MLB
        'Athletics':'Sacramento Athletics', 'Oakland Athletics':'Sacramento Athletics',
        // Soccer: ESPN displayName → football-data.co.uk CSV name
        'Manchester United':'Man United','Manchester City':'Man City',
        'Wolverhampton Wanderers':'Wolves','Brighton & Hove Albion':'Brighton',
        'Tottenham Hotspur':'Tottenham','West Ham United':'West Ham',
        'Newcastle United':'Newcastle','Nottingham Forest':"Nott'm Forest",
        'AFC Bournemouth':'Bournemouth','Leeds United':'Leeds',
        'Leicester City':'Leicester','Ipswich Town':'Ipswich',
        'Sheffield United':'Sheffield United','Blackburn Rovers':'Blackburn',
        'Norwich City':'Norwich','Cardiff City':'Cardiff',
        'Swansea City':'Swansea','Stoke City':'Stoke','Hull City':'Hull',
        'Queens Park Rangers':'QPR','Coventry City':'Coventry',
        // La Liga
        'FC Barcelona':'Barcelona','Athletic Club':'Ath Bilbao','Athletic Bilbao':'Ath Bilbao',
        'Real Betis':'Betis','Celta Vigo':'Celta','Rayo Vallecano':'Vallecano',
        // Bundesliga
        'Borussia Dortmund':'Dortmund','Bayer Leverkusen':'Leverkusen',
        'Eintracht Frankfurt':'Ein Frankfurt','Borussia Monchengladbach':"M'gladbach",
        'SC Freiburg':'Freiburg','VfB Stuttgart':'Stuttgart',
        'FC Augsburg':'Augsburg','Mainz 05':'Mainz','FC Heidenheim':'Heidenheim',
        'FC St. Pauli':'St Pauli',
        // Serie A
        'Internazionale':'Inter','AC Milan':'Milan','SSC Napoli':'Napoli',
        'AS Roma':'Roma','Hellas Verona':'Verona',
        // Ligue 1
        'Paris Saint-Germain':'Paris SG','Olympique de Marseille':'Marseille',
        'AS Monaco':'Monaco','Olympique Lyonnais':'Lyon','Stade Rennais':'Rennes',
        'Saint-Etienne':'St Etienne',
        // Eredivisie
        'Ajax':'Ajax','PSV Eindhoven':'PSV','Feyenoord':'Feyenoord',
        'AZ Alkmaar':'AZ','Vitesse':'Vitesse','FC Utrecht':'Utrecht',
        'SC Heerenveen':'Heerenveen','Sparta Rotterdam':'Sparta Rotterdam',
        // Primeira Liga
        'FC Porto':'Porto','SL Benfica':'Benfica','Sporting CP':'Sp Lisbon',
        'Sporting Lisbon':'Sp Lisbon','SC Braga':'Braga','Vitoria SC':'Vitoria',
        // Süper Lig
        'Galatasaray':'Galatasaray','Fenerbahce':'Fenerbahce',
        'Besiktas':'Besiktas','Trabzonspor':'Trabzonspor',
        // Pro League (Belgium)
        'Club Brugge':'Club Brugge','Anderlecht':'Anderlecht',
        'Gent':'Gent','Standard Liege':'Standard',
        // Scottish Premiership
        'Celtic':'Celtic','Rangers':'Rangers',
        'Celtic FC':'Celtic','Rangers FC':'Rangers',
        'Heart of Midlothian':'Hearts','Heart of Midlothian FC':'Hearts',
        'Aberdeen':'Aberdeen','Aberdeen FC':'Aberdeen',
        'Hibernian':'Hibernian','Hibernian FC':'Hibernian',
        'Motherwell FC':'Motherwell','St. Mirren FC':'St Mirren',
        'Livingston FC':'Livingston','Ross County FC':'Ross County',
        'Dundee FC':'Dundee','Dundee United FC':'Dundee Utd',
        // Eredivisie
        'Ajax Amsterdam':'Ajax','AZ Alkmaar':'AZ',
        'KAA Gent':'Gent','KV Mechelen':'Mechelen',
        'Sint-Truidense':'Sint-Truiden','Sint-Truiden VV':'Sint-Truiden',
        'Union St.-Gilloise':'Union SG','Royale Union Saint-Gilloise':'Union SG',
        'R. Antwerp':'Antwerp','Royal Antwerp FC':'Antwerp',
        'Cercle Brugge KSV':'Cercle Brugge',
        'Standard de Liege':'Standard','Standard Liège':'Standard',
        'OH Leuven':'Oud-Heverlee Leuven',
        'FC Westerlo':'Westerlo',
        'Beerschot VA':'Beerschot',
        'RSC Anderlecht':'Anderlecht',
        'Club Brugge KV':'Club Brugge',
        // Primeira Liga
        'FC Porto':'Porto','SL Benfica':'Benfica',
        'Sporting CP':'Sp Lisbon','Sporting Lisbon':'Sp Lisbon',
        'SC Braga':'Braga','Vitoria SC':'Vitoria',
        'FC Famalicao':'Famalicao','Estoril Praia':'Estoril',
        'Moreirense FC':'Moreirense','CD Santa Clara':'Santa Clara',
        'Rio Ave FC':'Rio Ave','GD Chaves':'Chaves',
        // Süper Lig
        'Galatasaray SK':'Galatasaray','Fenerbahce SK':'Fenerbahce',
        'Besiktas JK':'Besiktas','Trabzonspor AS':'Trabzonspor',
        'Basaksehir FK':'Basaksehir','Sivasspor':'Sivasspor',
        'Alanyaspor':'Alanyaspor','Kayserispor':'Kayserispor',
        // La Liga extras
        'Atletico de Madrid':'Atletico Madrid',
        'Athletic Club de Bilbao':'Ath Bilbao',
        'Girona FC':'Girona','Deportivo Alaves':'Alaves',
        'UD Las Palmas':'Las Palmas','RCD Mallorca':'Mallorca',
        'RCD Espanyol':'Espanyol','Cadiz CF':'Cadiz',
        'Elche CF':'Elche','Levante UD':'Levante',
        // MLS
        'Inter Miami CF':'Inter Miami','LA Galaxy':'LA Galaxy',
        'Los Angeles FC':'LAFC','Seattle Sounders FC':'Seattle Sounders',
        'Portland Timbers':'Portland Timbers','New England Revolution':'New England Rev',
        'Red Bull New York':'NY Red Bulls','Atlanta United FC':'Atlanta United',
        'Columbus Crew':'Columbus Crew','CF Montréal':'Montreal Impact',
        'Toronto FC':'Toronto FC','Philadelphia Union':'Philadelphia Union',
        'Orlando City SC':'Orlando City','FC Cincinnati':'Cincinnati',
        'Nashville SC':'Nashville SC','Charlotte FC':'Charlotte FC',
        'Chicago Fire FC':'Chicago Fire','New York City FC':'NYCFC',
        'Sporting Kansas City':'Sporting KC','Minnesota United FC':'Minnesota Utd',
        'Colorado Rapids':'Colorado Rapids','FC Dallas':'FC Dallas',
        'Houston Dynamo FC':'Houston Dynamo','San Jose Earthquakes':'San Jose Earthquakes',
        'Real Salt Lake':'Real Salt Lake','Vancouver Whitecaps':'Vancouver Whitecaps',
        'Austin FC':'Austin FC','Portland Timbers':'Portland Timbers',
        'San Diego FC':'San Diego FC'
      };

      var NOW    = new Date();
      var CUTOFF = new Date(NOW.getTime() + 16*24*60*60*1000); // 16 days covers 15 fetched days

      function inWindow(d) {
        if (!d) return false;
        var dt = new Date(d);
        // Since we fetch specific dates, just exclude anything beyond 16 days
        // The completed filter in parseEvents handles already-finished games
        return !isNaN(dt) && dt <= CUTOFF;
      }

      function eloProb(eA, eB, hca) { return 1/(1+Math.pow(10,(eB-(eA+hca))/400)); }
      function eloSpread(eA, eB, hca, scale, cap) {
        var s = (eA+hca-eB)/scale;
        if (cap) s = Math.max(-cap, Math.min(cap, s));
        return s.toFixed(1);
      }
      function drawP(eA, eB, hca) { return Math.max(0.03, 0.28*Math.max(0,1-Math.abs(eA+hca-eB)/500)); }
      function toAmerican(p) {
        if (p<=0||p>=1) return '—';
        return p>=0.5 ? String(Math.round(-(p/(1-p))*100)) : '+'+Math.round(((1-p)/p)*100);
      }

      function fetchESPN(path, extra, noPostseason, extraPaths) {
        // Use ESPN date range parameter — single request for 14 days
        var now = new Date();
        var end = new Date(now.getTime() + 14*24*60*60*1000);
        function fmt(d) {
          return d.getFullYear() +
            String(d.getMonth()+1).padStart(2,'0') +
            String(d.getDate()).padStart(2,'0');
        }
        var dateRange = fmt(now) + '-' + fmt(end);
        var base = 'https://site.api.espn.com/apis/site/v2/sports/'+path+'/scoreboard?limit=500&dates='+dateRange+(extra||'');
        var urls = [base];
        if (!noPostseason) urls.push(base + '&seasontype=3');
        // For sports with multiple group filters (e.g. CBASE: regular + tournament)
        if (extraPaths && extraPaths.length) {
          var now2 = now; var end2 = end;
          extraPaths.forEach(function(ep) {
            if (ep !== (extra||'')) {
              var b2 = 'https://site.api.espn.com/apis/site/v2/sports/'+path+'/scoreboard?limit=500&dates='+dateRange+ep;
              urls.push(b2);
              if (!noPostseason) urls.push(b2 + '&seasontype=3');
            }
          });
        }
        return Promise.all(urls.map(function(url) {
          return fetch(url, {mode:'cors'})
            .then(function(r){ return r.ok ? r.json() : {events:[]}; })
            .catch(function(){ return {events:[]}; });
        })).then(function(results) {
          var seen = {}, events = [];
          results.forEach(function(data) {
            (data.events||[]).forEach(function(ev) {
              if (!seen[ev.id]) { seen[ev.id] = 1; events.push(ev); }
            });
          });
          return {events: events};
        });
      }

      // Use the already-loaded Elo data (data array from current season)
      function getElo(teamName) {
        var row = data.find(function(r){ return r.team === teamName; });
        return row ? row.elo : 1500; // default 1500 = base Elo for new season
      }

      function parseEvents(events, lCfg) {
        var games = [], seen = {};
        (events||[]).forEach(function(ev) {
          if (!inWindow(ev.date)) return;
          var comp = (ev.competitions||[])[0];
          if (!comp) return;
          if (comp.status&&comp.status.type&&comp.status.type.completed) return;
          var competitors = comp.competitors||[];
          var home=null, away=null;
          competitors.forEach(function(c){if(c.homeAway==='home')home=c;else away=c;});
          if (!home||!away) return;
          var hn=(home.team[lCfg.nf]||home.team.displayName||'').trim();
          var an=(away.team[lCfg.nf]||away.team.displayName||'').trim();
          if (!hn||!an) return;
          if (hn.toLowerCase()==='tbd'||an.toLowerCase()==='tbd') return;
          if (hn.toLowerCase().includes('flex')||an.toLowerCase().includes('flex')) return;
          hn = NAME_FIX[hn]||hn; an = NAME_FIX[an]||an;
          var key = ev.id||(hn+'|'+an+'|'+ev.date);
          if (seen[key]) return; seen[key]=1;
          var neutral = !!(comp.neutralSite);
          var hca = neutral ? 0 : lCfg.hca;
          var eH = getElo(hn), eA = getElo(an);
          var pH = eloProb(eH, eA, hca);
          var pA = 1 - pH;
          var pD = lCfg.draw ? drawP(eH, eA, hca) : 0;
          if (pD) { pH=(1-pD)*pH; pA=(1-pD)*pA; }
          games.push({
            league: lCfg.league||CFG.sport,
            date: ev.date, id: key,
            homeTeam:hn, awayTeam:an,
            eH:eH, eA:eA, pH:pH, pA:pA, pD:pD,
            spd: parseFloat(eloSpread(eH,eA,hca,lCfg.scale)),
            unit: lCfg.unit, neutral:neutral,
            isDefault: (eH===1500||eA===1500)
          });
        });
        games.sort(function(a,b){return new Date(a.date)-new Date(b.date);});
        return games;
      }

      function renderGameCards(games) {
        if (!games.length) {
          return '<div class="empty-state" style="padding:1.5rem;text-align:center">'
            +'<div style="font-size:0.95rem;font-weight:600;margin-bottom:0.3rem">No upcoming games</div>'
            +'<div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim)">'+CFG.sport+' is off-season or no games in the next 2 weeks</div>'
            +'</div>';
        }

        var html = '<div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim);margin-bottom:0.75rem">'
          +games.length+' game'+(games.length!==1?'s':'')+' · next 14 days</div>';

        games.forEach(function(g) {
          var d = new Date(g.date);
          var dateStr = isNaN(d) ? '—' :
            d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})
            +' · '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});

          var pH  = (g.pH*100).toFixed(1)+'%';
          var pA  = (g.pA*100).toFixed(1)+'%';
          var pD  = g.pD>0 ? (g.pD*100).toFixed(1)+'%' : null;
          var mlH = toAmerican(g.pH), mlA = toAmerican(g.pA);
          var absS = Math.abs(g.spd).toFixed(1);
          var uL  = g.unit!=='pts' ? ' '+g.unit : '';
          var spdH = g.spd>0.05?'-'+absS+uL:g.spd<-0.05?'+'+absS+uL:'PK';
          var spdA = g.spd>0.05?'+'+absS+uL:g.spd<-0.05?'-'+absS+uL:'PK';
          var barH = (g.pH*100).toFixed(1);
          var barD = (g.pD*100).toFixed(1);

          html += '<div class="lines-game-card">'
            +'<div class="lines-meta">'
              +(g.league&&g.league!==CFG.sport?'<span class="lines-badge">'+g.league+'</span>':'')
              +'<span class="lines-time">'+dateStr+'</span>'
              +(g.neutral?'<span class="lines-neutral">Neutral</span>':'')
              +(g.isDefault?'<span style="font-family:var(--font-mono);font-size:0.52rem;color:var(--text-dim)">★ base Elo</span>':'')
            +'</div>'
            +'<div class="lines-matchup">'
              +'<div class="lines-team">'
                +'<div class="lines-tname">'+g.homeTeam+'</div>'
                +'<div class="lines-elo">'+g.eH.toFixed(0)+' Elo</div>'
              +'</div>'
              +'<div class="lines-mid">'
                +'<div class="lines-prob-bar">'
                  +'<div style="width:'+barH+'%;background:var(--accent)"></div>'
                  +(g.pD>0?'<div style="width:'+barD+'%;background:var(--text-dim);opacity:0.4"></div>':'')
                  +'<div style="flex:1;background:var(--blue-hi)"></div>'
                +'</div>'
                +'<div class="lines-probs">'
                  +'<span style="color:var(--accent)">'+pH+'</span>'
                  +(pD?'<span class="lines-draw">'+pD+' draw</span>':'<span style="color:var(--text-dim)">vs</span>')
                  +'<span style="color:var(--blue-hi)">'+pA+'</span>'
                +'</div>'
                +'<div class="lines-row2">'
                  +'<span class="lines-spd-val">'+spdH+'</span>'
                  +'<span class="lines-row2-label">Spread</span>'
                  +'<span class="lines-spd-val">'+spdA+'</span>'
                +'</div>'
                +'<div class="lines-row2">'
                  +'<span class="lines-ml '+(g.pH>=0.5?'lines-fav':'lines-dog')+'">'+mlH+'</span>'
                  +'<span class="lines-row2-label">Elo Odds</span>'
                  +'<span class="lines-ml '+(g.pA>=0.5?'lines-fav':'lines-dog')+'">'+mlA+'</span>'
                +'</div>'
              +'</div>'
              +'<div class="lines-team lines-team-r">'
                +'<div class="lines-tname">'+g.awayTeam+'</div>'
                +'<div class="lines-elo">'+g.eA.toFixed(0)+' Elo</div>'
              +'</div>'
            +'</div>'
            +'</div>';
        });

        html += '<div class="lines-note">Win %, spread &amp; odds from Elo · Home advantage applied unless neutral · ★ = team not in current CSV, using base Elo 1500 · Not financial advice</div>';
        return html;
      }

      function renderLeagueFilter(leagues) {
        var btns = ['All'].concat(leagues).map(function(l) {
          return '<button class="lines-sub-btn'+(l==='All'?' active':'')+'" data-league="'+l+'">'+l+'</button>';
        }).join('');
        return '<div id="leagueFilterBar" style="display:flex;gap:0.35rem;flex-wrap:wrap;margin-bottom:0.75rem">'+btns+'</div>';
      }

      function bindLeagueFilter() {
        document.querySelectorAll('#leagueFilterBar .lines-sub-btn').forEach(function(btn) {
          btn.addEventListener('click', function() {
            activeSoccerLeague = btn.getAttribute('data-league');
            document.querySelectorAll('#leagueFilterBar .lines-sub-btn').forEach(function(b){
              b.classList.toggle('active', b === btn);
            });
            var filtered = activeSoccerLeague==='All' ? allLinesGames
              : allLinesGames.filter(function(g){ return g.league===activeSoccerLeague; });
            var gameArea = document.getElementById('linesGames');
            if (gameArea) gameArea.innerHTML = renderGameCards(filtered);
          });
        });
      }

      // Fetch and render
      if (Array.isArray(sportCfg)) {
        // Soccer: fetch all leagues
        var leagues = sportCfg.map(function(l){return l.league;});
        Promise.all(sportCfg.map(function(lc){
          return fetchESPN(lc.path, '', true).then(function(data){ return parseEvents(data.events, lc); });
        })).then(function(results) {
          allLinesGames = [];
          results.forEach(function(games){allLinesGames = allLinesGames.concat(games);});
          allLinesGames.sort(function(a,b){return new Date(a.date)-new Date(b.date);});
          panel.innerHTML = renderLeagueFilter(leagues)+'<div id="linesGames">'+renderGameCards(allLinesGames)+'</div>';
          bindLeagueFilter();
        });
      } else {
        fetchESPN(sportCfg.path, sportCfg.extra, false, sportCfg.extraUrls).then(function(resp) {
          var games = parseEvents(resp.events, sportCfg);
          var isCollege = (CFG.sport === 'CFB' || CFG.sport === 'CBB' || CFG.sport === 'CBASE');
          if (isCollege && games.length) {
            // Build conference filter from game data
            var confs = ['All'];
            var confSet = {};
            games.forEach(function(g) {
              // Look up conference from current data
              var homeRow = data.find(function(r){ return r.team === g.homeTeam; });
              var awayRow = data.find(function(r){ return r.team === g.awayTeam; });
              if (homeRow && homeRow.conference && !confSet[homeRow.conference]) {
                confSet[homeRow.conference] = 1; confs.push(homeRow.conference);
              }
              if (awayRow && awayRow.conference && !confSet[awayRow.conference]) {
                confSet[awayRow.conference] = 1; confs.push(awayRow.conference);
              }
            });
            var allConfGames = games;
            var activeConf = 'All';
            function renderConfFilter() {
              return '<div id="confFilterBar" style="display:flex;gap:0.35rem;flex-wrap:wrap;margin-bottom:0.75rem">'
                + confs.map(function(c){
                    return '<button class="lines-sub-btn'+(c===activeConf?' active':'')+'" data-conf="'+c+'">'+c+'</button>';
                  }).join('')
                + '</div>';
            }
            function renderWithConfFilter() {
              var filtered = activeConf==='All' ? allConfGames
                : allConfGames.filter(function(g){
                    var hr = data.find(function(r){ return r.team===g.homeTeam; });
                    var ar = data.find(function(r){ return r.team===g.awayTeam; });
                    return (hr&&hr.conference===activeConf)||(ar&&ar.conference===activeConf);
                  });
              panel.innerHTML = renderConfFilter()+'<div id="linesGames">'+renderGameCards(filtered)+'</div>';
              document.querySelectorAll('#confFilterBar .lines-sub-btn').forEach(function(btn){
                btn.addEventListener('click', function(){
                  activeConf = btn.getAttribute('data-conf');
                  renderWithConfFilter();
                });
              });
            }
            renderWithConfFilter();
          } else {
            panel.innerHTML = '<div id="linesGames">'+renderGameCards(games)+'</div>';
          }
        });
      }
    }
  })();


  // ── Load season ────────────────────────────────────────────
  async function loadSeason(yr) {
    currentSeason = yr;
    document.querySelectorAll('.season-btn').forEach(b =>
      b.classList.toggle('active', parseInt(b.textContent) === yr));

    const el = document.getElementById('panel-rankings');
    if (el) el.innerHTML = '<div class="loading"><div class="spinner"></div>Loading ' + CFG.sport + ' ' + yr + '…</div>';

    // Use cache if already loaded
    if (!allSeasonData[yr]) {
      const raw = await fetchCSV(CFG.dataPath + yr + '.csv');
      if (!raw || raw.length === 0) {
        if (el) el.innerHTML = '<div class="empty-state">No data yet for ' + CFG.sport + ' ' + yr + '.<br><span style="font-size:0.75rem;color:var(--text-dim)">Run the GitHub Actions workflow to generate this season\'s data.</span></div>';
        updateSummary(null);
        return;
      }
      allSeasonData[yr] = raw.map(coerceRow).sort((a,b) => a.rank - b.rank);
    }
    data = allSeasonData[yr];

    // Also pre-load prev season for trend arrows (async, no wait)
    const prevYr = yr - 1;
    if (!allSeasonData[prevYr] && CFG.seasons && CFG.seasons.includes(prevYr)) {
      fetchCSV(CFG.dataPath + prevYr + '.csv').then(raw => {
        if (raw) {
          allSeasonData[prevYr] = raw.map(coerceRow);
          renderRankings(); // re-render with trends now available
        }
      });
    }

    updateSummary(data);
    populateSelects();
    renderRankings();

    const activeTab = document.querySelector('.tab.active');
    if (activeTab) {
      const pn = activeTab.dataset.tab;
      if (pn === 'byconf')       renderByConf();
      if (pn === 'predictor')    renderPredictor();
      if (pn === 'bracketology') renderBracketology();
      if (pn === 'resume')       renderResume();
      if (pn === 'history')      renderHistory();
      if (pn === 'tracker')      renderSeasonTracker();
      if (pn === 'greatest')    renderGreatestTeams();
      if (pn === 'pickem')      renderPickem();
      if (pn === 'confhistory') renderConfHistory();
    }
  }

  // ── Summary cards ──────────────────────────────────────────
  function updateSummary(d) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    if (!d || !d.length) {
      ['s-top','s-top-elo','s-avg','s-teams','s-confs','s-updated'].forEach(id => set(id, '—'));
      return;
    }
    set('s-top',     d[0].team);
    set('s-top-elo', 'Elo ' + d[0].elo.toFixed(1));
    set('s-teams',   d.length);
    set('s-avg',     (d.reduce((s,r)=>s+r.elo,0)/d.length).toFixed(1));
    set('s-confs',   new Set(d.map(r=>r.conference).filter(Boolean)).size || '—');
    const upd = d.find(r => r.updated_at)?.updated_at;
    const updEl = document.getElementById('s-updated');
    if (updEl) {
      updEl.textContent = upd ? fmt.date(upd) : '—';
      // Add updated badge to page header if not already there
      const header = document.querySelector('.page-header p');
      if (header && upd && !document.querySelector('.updated-badge')) {
        const badge = document.createElement('span');
        badge.className = 'updated-badge';
        badge.textContent = 'Updated ' + fmt.date(upd);
        header.parentNode.insertBefore(badge, header.nextSibling);
      }
    }
  }

  // ── Populate selects ───────────────────────────────────────
  function populateSelects() {
    const confs = [...new Set(data.map(r=>r.conference).filter(Boolean))].sort();
    const cf = document.getElementById('confFilter');
    if (cf) cf.innerHTML = '<option value="">All ' + CFG.confLabel + 's</option>' +
      confs.map(c => `<option>${c}</option>`).join('');
    const teams = [...data].sort((a,b) => a.team.localeCompare(b.team));
    ['teamA','teamB','histTeamA','histTeamB'].forEach((id,i) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = teams.map((t,j) =>
        `<option value="${t.team}" ${j===i?'selected':''}>${t.team}</option>`).join('');
    });
  }

  // ── Get elo trend vs previous season ──────────────────────
  function getTrend(team) {
    const prev = allSeasonData[currentSeason - 1];
    if (!prev) return null;
    const prevRow = prev.find(r => r.team === team);
    if (!prevRow) return null;
    const curr = data.find(r => r.team === team);
    if (!curr) return null;
    return curr.elo - prevRow.elo;
  }

  function trendHtml(team) {
    const t = getTrend(team);
    if (t === null) return '<span class="trend-new">NEW</span>';
    if (t > 5)  return `<span class="trend-up" title="${t.toFixed(1)} Elo vs last season">▲ ${t.toFixed(0)}</span>`;
    if (t < -5) return `<span class="trend-down" title="${t.toFixed(1)} Elo vs last season">▼ ${Math.abs(t).toFixed(0)}</span>`;
    return '<span class="trend-new">—</span>';
  }

  // ── Filter ─────────────────────────────────────────────────
  function getFiltered() {
    const conf = document.getElementById('confFilter')?.value || '';
    const minG = parseInt(document.getElementById('minGames')?.value) || 0;
    const q    = (document.getElementById('teamSearch')?.value || '').toLowerCase();
    return data.filter(r =>
      (!conf || r.conference === conf) &&
      r.games_played >= minG &&
      (!q || r.team.toLowerCase().includes(q))
    );
  }

  // ── Rankings table ─────────────────────────────────────────
  function renderRankings() {
    const filtered = getFiltered();
    const el = document.getElementById('panel-rankings');
    if (!el) return;
    if (!filtered.length) { el.innerHTML = '<div class="empty-state">No teams match your filters.</div>'; return; }

    const maxElo = Math.max(...filtered.map(r=>r.elo));
    const minElo = Math.min(...filtered.map(r=>r.elo));
    const searchQ = (document.getElementById('teamSearch')?.value || '').toLowerCase();

    const ctrlHtml = `<div class="controls">
      <div class="ctrl-group">
        <span class="ctrl-label">${CFG.confLabel}</span>
        <select id="confFilter"><option value="">All ${CFG.confLabel}s</option>
          ${[...new Set(data.map(r=>r.conference).filter(Boolean))].sort().map(c=>`<option>${c}</option>`).join('')}
        </select>
      </div>
      <div class="ctrl-group">
        <span class="ctrl-label">Min games</span>
        <select id="minGames">
          <option value="0">Any</option><option value="4" selected>4+</option>
          <option value="10">10+</option><option value="20">20+</option>
        </select>
      </div>
      <div class="search-wrap">
        <span class="search-icon">⌕</span>
        <input type="search" id="teamSearch" placeholder="Search team…" value="${searchQ}">
      </div>
      <button class="btn" id="exportBtn">↓ CSV</button>
    </div>`;

    const extraHeaders = (CFG.extraCols||[]).map(c=>`<th data-type="num">${c.label}</th>`).join('');
    const rows = filtered.map(r => {
      const bw   = r.best_win_elo > 0 ? r.best_win_elo.toFixed(1) : '—';
      const bwn  = fmt.maybe(r.best_win_team);
      const bar  = eloBarWidth(r.elo, maxElo, minElo, 80);
      const extra = (CFG.extraCols||[]).map(c => {
        const v = r[c.key];
        return `<td class="num" data-val="${v??''}">${v!=null?Number(v).toFixed(c.dec??0):'—'}</td>`;
      }).join('');
      const spreadVal = ((r.elo - 1500) / 35).toFixed(1);
      return `<tr class="team-row" data-team="${r.team}">
        <td class="rank" data-val="${r.rank}">${r.rank}</td>
        <td class="team-name">${r.team} ${trendHtml(r.team)}</td>
        <td class="conf" data-val="${r.conference||''}">${r.conference||'—'}</td>
        <td class="elo" data-val="${r.elo}">
          <div class="elo-bar-wrap"><span>${r.elo.toFixed(1)}</span>
          <div class="elo-bar" style="width:${bar}px"></div></div>
        </td>
        ${CFG.sport==='CFB'?`<td class="num" data-val="${r.pr||r.elo}" style="color:var(--accent);font-weight:500">${(r.pr||r.elo).toFixed(1)}</td>`:''}
        <td class="record" data-val="${r.wins}">${r.record}</td>
        <td class="num" data-val="${r.win_pct}">${fmt.pct(r.win_pct)}</td>
        <td class="num" data-val="${r.sos}">${r.sos>0?r.sos.toFixed(1):'—'}</td>
        <td class="num" data-val="${r.best_win_elo}">
          <span title="${bwn}">${bwn!=='—'?bwn.substring(0,14):'—'}</span>
          <span style="color:var(--text-dim);font-size:0.62rem;margin-left:0.2rem">${bw!=='—'?bw:''}</span>
        </td>
        ${extra}
      </tr>`;
    }).join('');

    el.innerHTML = ctrlHtml + `<div class="table-wrap"><table class="tbl" id="mainTable">
      <thead><tr>
        <th data-type="num">Rank</th><th>Team</th><th>${CFG.confLabel}</th>
        <th data-type="num">Elo</th>
        ${CFG.sport==='CFB'?'<th data-type="num" title="Playoff Rating = Elo + sqrt(Resume Score)">PR ⓘ</th>':''}
        <th data-type="num">Record</th>
        <th data-type="num">Win%</th><th data-type="num">SOS</th>
        <th data-type="num">Best Win</th>${extraHeaders}
      </tr></thead><tbody>${rows}</tbody>
    </table></div>`;

    makeSortable(document.getElementById('mainTable'));
    makeSearchable(document.getElementById('teamSearch'), document.getElementById('mainTable'));

    // Highlight searched team
    const srch = document.getElementById('teamSearch');
    if (srch) srch.addEventListener('input', () => {
      const q = srch.value.toLowerCase();
      document.querySelectorAll('#mainTable tbody tr').forEach(tr => {
        tr.style.background = (q && tr.dataset.team?.toLowerCase().includes(q)) ? 'rgba(226,201,126,0.08)' : '';
      });
    });

    // Row click → expand game list
    document.querySelectorAll('.team-row').forEach(tr => {
      tr.addEventListener('click', () => toggleExpand(tr, tr.dataset.team));
    });

    // Re-wire controls
    document.getElementById('confFilter')?.addEventListener('change', renderRankings);
    document.getElementById('minGames')?.addEventListener('change', renderRankings);
    document.getElementById('exportBtn')?.addEventListener('click', () => {
      const cols = ['rank','team','conference','elo','wins','losses','games_played','win_pct','record','sos','best_win_team','best_win_elo','updated_at'];
      downloadCSV(getFiltered(), CFG.sport+'_Elo_'+currentSeason+'.csv', cols);
    });
  }

  // ── Row expand: show games (derived from wins/losses summary) ──
  function toggleExpand(tr, team) {
    const existing = tr.nextElementSibling;
    if (existing && existing.classList.contains('expand-row')) {
      existing.remove(); return;
    }
    const row = data.find(r => r.team === team);
    if (!row) return;

    // Build a streak from win_pct and games_played
    const wins = row.wins, losses = row.losses, total = row.games_played;
    const winPct = row.win_pct;
    const spread = ((row.elo - 1500) / 35).toFixed(1);
    const trendDelta = getTrend(team);
    const trendStr = trendDelta !== null
      ? (trendDelta > 0 ? `▲ ${trendDelta.toFixed(1)} vs last season` : `▼ ${Math.abs(trendDelta).toFixed(1)} vs last season`)
      : 'First season in data';

    const expandTr = document.createElement('tr');
    expandTr.className = 'expand-row';
    expandTr.innerHTML = `<td colspan="20">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1rem;padding:0.25rem 0">
        <div>
          <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.1em">Record</div>
          <div style="font-size:1.1rem;font-weight:500">${row.record}</div>
          <div style="font-size:0.75rem;color:var(--text-dim);margin-top:0.2rem">${(winPct*100).toFixed(1)}% win rate</div>
        </div>
        <div>
          <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.1em">Elo vs last season</div>
          <div style="font-size:1rem;font-weight:500;color:${trendDelta>0?'var(--green-hi)':trendDelta<0?'var(--red-hi)':'var(--text-dim)'}">${trendStr}</div>
        </div>
        <div>
          <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.1em">SOS</div>
          <div style="font-size:1rem;font-weight:500">${row.sos>0?row.sos.toFixed(1):'—'}</div>
          <div style="font-size:0.75rem;color:var(--text-dim);margin-top:0.2rem">avg opponent Elo</div>
        </div>
        <div>
          <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.1em">Best win</div>
          <div style="font-size:0.9rem;font-weight:500">${fmt.maybe(row.best_win_team)}</div>
          <div style="font-size:0.75rem;color:var(--text-dim);margin-top:0.2rem">${row.best_win_elo>0?'Elo '+row.best_win_elo.toFixed(1):'—'}</div>
        </div>
        <div>
          <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.1em">vs avg team</div>
          <div style="font-size:1rem;font-weight:500">${spread > 0 ? '+' : ''}${spread}</div>
          <div style="font-size:0.75rem;color:var(--text-dim);margin-top:0.2rem">implied spread</div>
        </div>
      </div>
    </td>`;
    tr.parentNode.insertBefore(expandTr, tr.nextSibling);
  }

  // ── By Conference ──────────────────────────────────────────
  function renderByConf() {
    const el = document.getElementById('panel-byconf');
    if (!el || !data.length) return;
    const confMap = {};
    data.forEach(r => { const c=r.conference||'Other'; if(!confMap[c])confMap[c]=[]; confMap[c].push(r); });
    const sorted = Object.entries(confMap).sort(([,a],[,b])=>
      b.reduce((s,r)=>s+r.elo,0)/b.length - a.reduce((s,r)=>s+r.elo,0)/a.length);
    el.innerHTML = sorted.map(([conf, teams]) => {
      const avg  = (teams.reduce((s,r)=>s+r.elo,0)/teams.length).toFixed(1);
      const wins = teams.reduce((s,r)=>s+r.wins,0);
      const loss = teams.reduce((s,r)=>s+r.losses,0);
      const rows = [...teams].sort((a,b)=>b.elo-a.elo).map((r,i) => `<tr>
        <td class="rank">${i+1}</td><td class="team-name">${r.team}</td>
        <td class="elo" data-val="${r.elo}">${r.elo.toFixed(1)}</td>
        <td class="record">${r.record}</td>
        <td class="num">${fmt.pct(r.win_pct)}</td>
        <td class="num">${r.sos>0?r.sos.toFixed(1):'—'}</td>
        <td class="num" title="${r.best_win_team||''}">${r.best_win_team?r.best_win_team.substring(0,16):'—'}</td>
      </tr>`).join('');
      return `<div class="conf-block">
        <div class="conf-block-header">${conf} · avg Elo ${avg} · ${wins}–${loss}</div>
        <table class="tbl"><thead><tr><th>#</th><th>Team</th><th data-type="num">Elo</th>
          <th>Record</th><th data-type="num">Win%</th><th data-type="num">SOS</th><th>Best Win</th>
        </tr></thead><tbody>${rows}</tbody></table>
      </div>`;
    }).join('');
  }

  // ── Predictor ──────────────────────────────────────────────
  function renderPredictor() {
    var el    = document.getElementById('panel-predictor');
    if (!el || !data.length) return;
    var taEl   = document.getElementById('teamA');
    var tbEl   = document.getElementById('teamB');
    var hca    = document.getElementById('hcaCheck');
    var drawEl = document.getElementById('drawCheck');
    var res    = document.getElementById('predResult');
    if (!taEl || !tbEl || !res) return;

    var isSoccer = CFG.sport === 'Soccer';

    function calc() {
      var ta = null, tb = null;
      for (var i = 0; i < data.length; i++) {
        if (data[i].team === taEl.value) ta = data[i];
        if (data[i].team === tbEl.value) tb = data[i];
      }
      if (!ta || !tb || ta.team === tb.team) { res.innerHTML = ''; return; }

      var hAdj     = (hca && hca.checked) ? CFG.hca : 0;
      var rawProb  = eloWinProb(ta.elo, tb.elo, hAdj);
      var withDraws = isSoccer && drawEl && drawEl.checked;

      // Soccer draw model: ~28% base draw rate, falls off with Elo gap
      var eloDiff  = Math.abs(ta.elo + hAdj - tb.elo);
      var drawProb = withDraws ? Math.max(0.03, 0.28 * Math.max(0, 1 - eloDiff / 500)) : 0;
      var pA = (1 - drawProb) * rawProb;
      var pB = (1 - drawProb) * (1 - rawProb);
      var pD = drawProb;

      // Soccer uses expected goal diff (xGD), others use point spread
      var sprdVal  = isSoccer
        ? ((ta.elo + hAdj - tb.elo) / 150).toFixed(2)
        : eloSpread(ta.elo, tb.elo, hAdj);
      var sprdLbl  = isSoccer ? 'xGD' : 'spread';
      var sprdStr  = (parseFloat(sprdVal) > 0 ? '+' : '') + sprdVal;

      var barA = (pA * 100).toFixed(1);
      var barD = (pD * 100).toFixed(1);
      var barB = (pB * 100).toFixed(1);

      var drawSpan = withDraws
        ? '<span style="color:var(--text-dim);font-size:0.85rem;align-self:center">' + barD + '% draw</span>'
        : '';
      var drawBar = withDraws
        ? '<div style="width:' + barD + '%;background:var(--text-dim);opacity:0.5"></div>'
        : '';
      var winLabel = withDraws ? '' : '<span style="color:var(--text-dim);font-size:1rem;align-self:center">win probability</span>';

      res.innerHTML =
        '<div class="pred-result">'
        + '<div class="prob-nums">'
        + '<span style="color:var(--accent)">' + barA + '%</span>'
        + drawSpan
        + winLabel
        + '<span style="color:var(--blue-hi)">' + barB + '%</span>'
        + '</div>'
        + '<div class="prob-bar" style="margin:0.6rem 0">'
        + '<div style="width:' + barA + '%;background:var(--accent)"></div>'
        + drawBar
        + '<div style="flex:1;background:var(--blue-hi)"></div>'
        + '</div>'
        + '<div class="prob-detail">'
        + '<span>' + ta.team + ' · Elo ' + ta.elo.toFixed(1) + (hAdj ? ' (home)' : '') + '</span>'
        + '<span>' + sprdLbl + ': <strong>' + sprdStr + '</strong></span>'
        + '<span>' + tb.team + ' · Elo ' + tb.elo.toFixed(1) + '</span>'
        + '</div>'
        + '</div>';
    }

    [taEl, tbEl, hca, drawEl].forEach(function(e) { if (e) e.addEventListener('change', calc); });
    calc();
  }

  // ── Bracketology ───────────────────────────────────────────
  function renderBracketology() {
    const el = document.getElementById('panel-bracketology');
    if (!el || !data.length) return;
    const byConf = {};
    data.forEach(r => { const c=r.conference||'Unknown'; if(!byConf[c]||r.elo>byConf[c].elo) byConf[c]=r; });
    const autoBids  = Object.values(byConf);
    const autoTeams = new Set(autoBids.map(r=>r.team));
    const total     = CFG.sport==='CBB' ? 68 : 64;
    const atLarge   = data.filter(r=>!autoTeams.has(r.team)).sort((a,b)=>b.elo-a.elo).slice(0,total-autoBids.length);
    const field     = [...autoBids,...atLarge].sort((a,b)=>b.elo-a.elo);
    const seeds     = CFG.sport==='CBB'
      ? [1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,6,6,6,6,7,7,7,7,
         8,8,8,8,9,9,9,9,10,10,10,10,11,11,11,11,11,11,
         12,12,12,12,13,13,13,13,14,14,14,14,15,15,15,15,16,16,16,16,16,16]
      : Array.from({length:64},(_,i)=>Math.floor(i/4)+1);
    field.forEach((r,i)=>{r._seed=seeds[i];r._auto=autoTeams.has(r.team);});
    const infoEl = document.getElementById('bracketInfo');
    if (infoEl) infoEl.textContent = `${autoBids.length} auto bids · ${atLarge.length} at-large · ${field.length} total`;
    const bySeed = {};
    field.forEach(r=>{if(!bySeed[r._seed])bySeed[r._seed]=[];bySeed[r._seed].push(r);});
    el.innerHTML = `<div class="bracket-grid">${
      Object.entries(bySeed).map(([seed,teams])=>`
        <div class="bracket-card">
          <div class="bracket-card-header">Seed ${seed}</div>
          ${teams.map(r=>`<div class="bracket-line">
            <div class="seed ${parseInt(seed)<=3?'s'+seed:''}">${seed}</div>
            <div style="flex:1;min-width:0">
              <div class="bracket-line-team">${r.team}</div>
              <div class="bracket-line-conf">${r.conference||'—'} · ${r.elo.toFixed(1)}</div>
            </div>
            ${r._auto?'<span class="card-tag tag-live" style="font-size:0.55rem;padding:0.15rem 0.4rem">AUTO</span>':''}
          </div>`).join('')}
        </div>`).join('')}
    </div>`;
  }

  // ── Resume (CFB) ───────────────────────────────────────────
  function renderResume() {
    const el = document.getElementById('panel-resume');
    if (!el||!data.length) return;
    const sorted = [...data].sort((a,b)=>CFG.sport==='CFB'?(b.pr||b.elo||0)-(a.pr||a.elo||0):(b.resume_score||0)-(a.resume_score||0));
    const rows = sorted.slice(0,120).map((r,i)=>`<tr>
      <td class="rank">${i+1}</td><td class="team-name">${r.team}</td>
      <td class="conf">${r.conference||'—'}</td>
      <td class="elo" data-val="${r.elo}">${r.elo.toFixed(1)}</td>
      ${CFG.sport==='CFB'?`<td class="num" data-val="${r.pr||r.elo}" style="color:var(--accent);font-weight:500">${(r.pr||r.elo).toFixed(1)}</td>`:''}
      <td class="record">${r.record}</td>
      <td class="num" data-val="${r.resume_score||0}">${r.resume_score>0?Number(r.resume_score).toFixed(0):'—'}</td>
      <td class="num">${r.sos>0?r.sos.toFixed(1):'—'}</td>
      <td class="num">${r.best_win_team?r.best_win_team.substring(0,16):'—'}</td>
    </tr>`).join('');
    el.innerHTML = `<div class="table-wrap"><table class="tbl" id="mainTable">
      <thead><tr><th data-type="num">Rank</th><th>Team</th><th>Conf</th>
        <th data-type="num">Elo</th>
        ${CFG.sport==='CFB'?'<th data-type="num" title="Playoff Rating = Elo + sqrt(Resume Score)">PR ⓘ</th>':''}
        <th>Record</th>
        <th data-type="num">Resume Score</th><th data-type="num">SOS</th><th>Best Win</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
    makeSortable(document.getElementById('mainTable'));
  }

  // ── Elo History chart ──────────────────────────────────────
  function renderHistory() {
    const el = document.getElementById('panel-history');
    if (!el) return;

    el.innerHTML = `<div class="history-wrap">
      <div class="history-team-select">
        <div class="ctrl-group"><span class="ctrl-label">Team A</span><select id="histTeamA"></select></div>
        <div class="ctrl-group"><span class="ctrl-label">Team B (optional)</span><select id="histTeamB"><option value="">None</option></select></div>
        <button class="btn primary" id="histDraw">Draw chart</button>
      </div>
      <div class="history-canvas-wrap"><canvas id="histCanvas"></canvas></div>
    </div>
    <div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim);margin-top:0.5rem">
      Click "Draw chart" after selecting teams. Loads all available seasons.
    </div>`;

    // Populate team selects from current season
    const teams = [...data].sort((a,b)=>a.team.localeCompare(b.team));
    ['histTeamA','histTeamB'].forEach((id,i) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      if (i===1) sel.innerHTML = '<option value="">None</option>';
      sel.innerHTML += teams.map(t=>`<option value="${t.team}">${t.team}</option>`).join('');
    });

    document.getElementById('histDraw')?.addEventListener('click', async () => {
      const ta = document.getElementById('histTeamA')?.value;
      const tb = document.getElementById('histTeamB')?.value;
      if (!ta) return;

      const btn = document.getElementById('histDraw');
      btn.textContent = 'Loading…';
      btn.disabled = true;

      // Load all seasons
      const seasonYears = (CFG.seasons || []).slice().reverse(); // oldest first
      for (const yr of seasonYears) {
        if (!allSeasonData[yr]) {
          try {
            const raw = await fetchCSV(CFG.dataPath + yr + '.csv');
            if (raw && raw.length) allSeasonData[yr] = raw.map(coerceRow);
          } catch(e) { /* skip */ }
        }
      }

      // Build series
      const labelsA = [], labelsB = [];
      const pointsA = [], pointsB = [];
      for (const yr of seasonYears) {
        const d = allSeasonData[yr];
        if (!d) continue;
        const ra = d.find(r=>r.team===ta);
        if (ra) { labelsA.push(yr); pointsA.push(ra.elo); }
        if (tb) {
          const rb = d.find(r=>r.team===tb);
          if (rb) { labelsB.push(yr); pointsB.push(rb.elo); }
        }
      }

      // Draw with Chart.js
      if (!window.Chart) {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
        document.head.appendChild(s);
        await new Promise(r => s.onload = r);
      }

      const canvas = document.getElementById('histCanvas');
      if (window._histChart) window._histChart.destroy();

      const datasets = [{
        label: ta,
        data: labelsA.map((yr,i) => ({x:yr,y:pointsA[i]})),
        borderColor: '#e2c97e',
        backgroundColor: 'rgba(226,201,126,0.1)',
        borderWidth: 2, pointRadius: 4, tension: 0.3, fill: false
      }];
      if (tb && pointsB.length) datasets.push({
        label: tb,
        data: labelsB.map((yr,i) => ({x:yr,y:pointsB[i]})),
        borderColor: '#7eb5e8',
        backgroundColor: 'rgba(126,181,232,0.1)',
        borderWidth: 2, pointRadius: 4, tension: 0.3, fill: false
      });

      window._histChart = new Chart(canvas, {
        type: 'line',
        data: { datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          parsing: false,
          scales: {
            x: { type:'linear', title:{display:true,text:'Season',color:'#474441'},
                 ticks:{color:'#474441',stepSize:1}, grid:{color:'rgba(255,255,255,0.04)'} },
            y: { title:{display:true,text:'Elo Rating',color:'#474441'},
                 ticks:{color:'#474441'}, grid:{color:'rgba(255,255,255,0.06)'},
                 suggestedMin:1200, suggestedMax:2000 }
          },
          plugins: {
            legend: { labels:{color:'#8a8680',font:{family:'monospace',size:11}} },
            tooltip: { callbacks: { label: ctx => ctx.dataset.label+': '+ctx.parsed.y.toFixed(1) } }
          }
        }
      });

      btn.textContent = 'Draw chart';
      btn.disabled = false;
    });
  }


  // ── Season Tracker (live in-season Elo progression) ───────
  function renderSeasonTracker() {
    const el = document.getElementById('panel-tracker');
    if (!el) return;
    if (!data.length) {
      el.innerHTML = '<div class="empty-state">Load a season first.</div>';
      return;
    }

    // Rebuild HTML every time tab is activated
    const allTeamNames = [...data].sort((a,b)=>a.team.localeCompare(b.team)).map(r=>r.team);

    el.innerHTML = `
      <div class="history-wrap">
        <div style="margin-bottom:1rem">
          <div style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:0.1em;
                      text-transform:uppercase;color:var(--text-muted);margin-bottom:0.5rem">
            Search and select teams to track
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:flex-start">

            <div style="flex:1;min-width:200px;max-width:300px">
              <input type="text" id="trackerSearch"
                     placeholder="Type team name to filter…"
                     autocomplete="off"
                     style="width:100%;box-sizing:border-box;margin-bottom:0.35rem;
                            font-family:var(--font-mono);font-size:0.78rem;
                            background:var(--bg3);border:1px solid var(--border-md);
                            color:var(--text);border-radius:var(--radius);
                            padding:0.35rem 0.6rem">
              <select id="trackerTeams" multiple size="7"
                      style="width:100%;box-sizing:border-box;
                             font-family:var(--font-mono);font-size:0.75rem;
                             background:var(--bg3);border:1px solid var(--border-md);
                             color:var(--text);border-radius:var(--radius);padding:0.2rem">
              </select>
              <div style="font-size:0.67rem;color:var(--text-dim);font-family:var(--font-mono);
                          margin-top:0.2rem">
                Ctrl/Cmd + click to select multiple
              </div>
            </div>

            <div style="display:flex;flex-direction:column;gap:0.5rem;padding-top:0.1rem">
              <div id="trackerSelected"
                   style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);
                          max-width:220px;line-height:1.5;min-height:1.2rem"></div>
              <button id="trackerRun"
                      style="background:var(--accent);color:#1a1611;border:none;
                             border-radius:var(--radius);padding:0.45rem 1rem;
                             font-family:var(--font-mono);font-size:0.78rem;
                             font-weight:600;cursor:pointer;width:fit-content">
                ▶ Build tracker
              </button>
              <div style="font-size:0.69rem;color:var(--text-muted);line-height:1.55">
                Fetches live ESPN data<br>week by week (~30–60s)
              </div>
            </div>

          </div>
        </div>

        <div id="trackerStatus"
             style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);
                    margin-bottom:0.75rem;display:none">
          <div id="trackerMsg">Starting…</div>
          <div style="height:3px;background:var(--bg4);border-radius:2px;
                      margin-top:0.4rem;overflow:hidden">
            <div id="trackerBar"
                 style="height:3px;background:var(--accent);width:0;
                        transition:width 0.4s ease"></div>
          </div>
        </div>

        <div id="trackerFinalRatings"
             style="display:none;margin-bottom:0.75rem;
                    display:none;flex-wrap:wrap;gap:0.5rem"></div>

        <div class="history-canvas-wrap" id="trackerChartWrap" style="display:none">
          <canvas id="trackerCanvas"></canvas>
        </div>
        <div id="trackerEmpty"
             style="color:var(--text-muted);font-size:0.83rem;
                    text-align:center;padding:2rem;display:none"></div>
        <div id="trackerSourceNote"
             style="font-family:var(--font-mono);font-size:0.62rem;
                    color:var(--text-dim);margin-top:0.75rem;line-height:1.7">
        </div>
      </div>`;

    // Set source accuracy note
    const sourceNotes = {
      CFB:   'Source: ESPN API (same as R script) — final Elo should match CSV exactly.',
      NHL:   'Source: ESPN API (same as R script) — final Elo should match CSV exactly.',
      CBASE: 'Source: ESPN API (same as R script) — final Elo should match CSV exactly.',
      NBA:   'Source: ESPN API (R script uses hoopR/NBA Stats API) — small differences expected.',
      CBB:   'Source: ESPN API (R script uses hoopR) — small differences expected.',
      NFL:   'Source: ESPN API (R script uses nflreadr) — differences expected due to different data source.',
      MLB:   'Source: ESPN API (R script uses MLB Stats API) — differences expected due to different data source.',
      Soccer:'N/A'
    };
    const noteEl = document.getElementById('trackerSourceNote');
    if (noteEl) noteEl.textContent = sourceNotes[CFG.sport] || '';

    // ── Populate select (called fresh each filter change) ─────
    const fillSelect = (q) => {
      const sel = document.getElementById('trackerTeams');
      if (!sel) return;
      const lq = (q || '').toLowerCase().trim();
      const filtered = lq
        ? allTeamNames.filter(t => t.toLowerCase().includes(lq))
        : allTeamNames;
      const selected = new Set([...sel.selectedOptions].map(o => o.value));
      sel.innerHTML = filtered
        .map(t => `<option value="${t}"${selected.has(t)?' selected':''}>${t}</option>`)
        .join('');
    };
    fillSelect('');

    // ── Wire up search input ───────────────────────────────────
    const searchEl = document.getElementById('trackerSearch');
    searchEl && searchEl.addEventListener('input', () => fillSelect(searchEl.value));

    // ── Wire up select change → show selected names ────────────
    const selEl = document.getElementById('trackerTeams');
    const selDisp = document.getElementById('trackerSelected');
    selEl && selEl.addEventListener('change', () => {
      const names = [...selEl.selectedOptions].map(o => o.value);
      if (selDisp) selDisp.textContent = names.length ? names.join(' · ') : '';
    });

    // ── Run button ─────────────────────────────────────────────
    const runBtn  = document.getElementById('trackerRun');
    const status  = document.getElementById('trackerStatus');
    const msgEl   = document.getElementById('trackerMsg');
    const barEl   = document.getElementById('trackerBar');
    const wrap    = document.getElementById('trackerChartWrap');
    const emptyEl = document.getElementById('trackerEmpty');
    const finalsEl = document.getElementById('trackerFinalRatings');

    runBtn && runBtn.addEventListener('click', async () => {
      const teams = [...(document.getElementById('trackerTeams')?.selectedOptions || [])]
                     .map(o => o.value);
      if (!teams.length) return;

      runBtn.disabled = true;
      status.style.display = 'block';
      wrap.style.display = 'none';
      emptyEl.style.display = 'none';
      finalsEl.style.display = 'none';
      finalsEl.innerHTML = '';
      msgEl.textContent = 'Starting…';
      barEl.style.width = '0';

      try {
        const result = await window.SeasonTracker.buildTracker(
          CFG.sport,
          currentSeason,
          (done, total, _extra, msg) => {
            barEl.style.width = Math.round(done / total * 100) + '%';
            msgEl.textContent = msg || ('Step ' + done + '/' + total);
          }
        );

        status.style.display = 'none';

        if (!result) {
          emptyEl.style.display = 'block';
          emptyEl.textContent = 'No data available for this season.';
          runBtn.disabled = false;
          return;
        }
        if (result.noData) {
          emptyEl.style.display = 'block';
          emptyEl.textContent = result.reason || 'Live tracking not available for this sport.';
          runBtn.disabled = false;
          return;
        }

        const { history, weeks } = result;
        const hasData = teams.some(t => history[t] && history[t].length > 0);
        if (!hasData) {
          emptyEl.style.display = 'block';
          emptyEl.textContent = 'No games found. Is this sport in-season for ' + currentSeason + '?';
          runBtn.disabled = false;
          return;
        }

        // ── Final ratings cards ────────────────────────────────
        const COLORS = ['#e2c97e','#7eb5e8','#7dd4a8','#e07a65','#c07dcc','#f0a060','#60d0c0'];
        finalsEl.style.display = 'flex';
        teams.forEach((team, i) => {
          const pts = history[team] || [];
          const finalElo = pts.length ? pts[pts.length - 1].elo.toFixed(1) : '—';
          // Compare to CSV rating if available
          const csvRow  = data.find(r => r.team === team);
          const csvElo  = csvRow ? csvRow.elo.toFixed(1) : null;
          const diff    = (csvRow && pts.length)
            ? (pts[pts.length-1].elo - csvRow.elo).toFixed(1)
            : null;
          finalsEl.innerHTML += `
            <div style="background:var(--bg3);border:1px solid var(--border);
                        border-radius:var(--radius);padding:0.55rem 0.85rem;
                        border-left:3px solid ${COLORS[i % COLORS.length]}">
              <div style="font-family:var(--font-mono);font-size:0.6rem;
                          color:var(--text-dim);margin-bottom:0.2rem;
                          text-transform:uppercase;letter-spacing:0.1em">${team}</div>
              <div style="font-size:1.1rem;font-weight:600;color:var(--text)">
                ${finalElo}
              </div>
              ${csvElo ? `<div style="font-size:0.67rem;color:var(--text-dim);
                                      font-family:var(--font-mono);margin-top:0.15rem">
                CSV (R engine): ${csvElo}
                ${diff !== null
                  ? `<span style="color:${Math.abs(parseFloat(diff))<1?'var(--text-dim)':parseFloat(diff)>0?'var(--green-hi)':'var(--red-hi)'};margin-left:0.3rem">
                      (${parseFloat(diff)>0?'+':''}${diff})
                    </span>`
                  : ''}
              </div>` : ''}
            </div>`;
        });

        // ── Chart ──────────────────────────────────────────────
        if (!window.Chart) {
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
            s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
          });
        }

        wrap.style.display = 'block';
        if (window._trackerChart) { window._trackerChart.destroy(); window._trackerChart = null; }

        const labels = weeks.map(w => w.slice(4,6) + '/' + w.slice(6,8));

        const datasets = teams.map((team, i) => {
          const byWeek = {};
          (history[team] || []).forEach(p => { byWeek[p.week] = p.elo; });
          // For the final label, use the last non-null value
          const pts = weeks.map(w => byWeek[w] ?? null);
          return {
            label: team + ' (' + (pts.filter(Boolean).pop() || '—') + ')',
            data:  pts,
            borderColor:     COLORS[i % COLORS.length],
            backgroundColor: COLORS[i % COLORS.length] + '18',
            borderWidth: 2.5,
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.35,
            fill: false,
            spanGaps: true
          };
        });

        window._trackerChart = new Chart(document.getElementById('trackerCanvas'), {
          type: 'line',
          data: { labels, datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { intersect: false, mode: 'index' },
            scales: {
              x: {
                ticks: { color:'#c0bcb6', maxTicksLimit:14,
                         font:{ size:11, family:'monospace' } },
                grid:  { color:'rgba(255,255,255,0.04)' }
              },
              y: {
                title: { display:true, text:'Elo Rating',
                         color:'#c0bcb6', font:{ size:11 } },
                ticks: { color:'#c0bcb6', font:{ family:'monospace', size:11 } },
                grid:  { color:'rgba(255,255,255,0.06)' }
              }
            },
            plugins: {
              legend: {
                labels: { color:'#c0bcb6',
                          font:{ family:'monospace', size:11 },
                          boxWidth:16 }
              },
              tooltip: {
                callbacks: {
                  label: ctx => {
                    const raw = ctx.parsed.y;
                    return ctx.dataset.label.split(' (')[0] +
                           ': ' + (raw != null ? raw.toFixed(1) : '—');
                  }
                }
              }
            }
          }
        });

      } catch (e) {
        status.style.display = 'none';
        emptyEl.style.display = 'block';
        emptyEl.textContent = 'Error: ' + e.message;
        console.error('SeasonTracker error:', e);
      }
      runBtn.disabled = false;
    });
  }

    // ── Auto-find available season ─────────────────────────────
async function findAvailableSeason() {
    // Check localStorage for last-used season
    const saved = localStorage.getItem('elo_season_' + CFG.sport);
    if (saved && CFG.seasons.includes(parseInt(saved))) return parseInt(saved);
    // Return newest season immediately — loadSeason shows empty state if no CSV
    // checkForNewerSeasons runs in background after load
    setTimeout(() => checkForNewerSeasons(), 2000);
    return CFG.seasons[0];
  }

  // ── Conference / Division / League History ────────────────
  let _confHistRendered = false;
  async function renderConfHistory() {
    const el = document.getElementById('panel-confhistory');
    if (!el) return;
    if (_confHistRendered && el.innerHTML.includes('confHistCanvas')) return;
    el.innerHTML = '<div class="loading"><div class="spinner"></div>Loading all seasons…</div>';

    const years = (CFG.seasons || []).slice().reverse();
    for (const yr of years) {
      if (!allSeasonData[yr]) {
        try {
          const raw = await fetchCSV(CFG.dataPath + yr + '.csv');
          if (raw && raw.length) allSeasonData[yr] = raw.map(coerceRow);
        } catch(e) { /* skip failed seasons */ }
      }
    }

    const sport = CFG.sport;
    const getGroups = (row) => {
      const conf = (row.conference || '').trim();
      if (!conf || conf === 'NA' || conf === 'FCS' || conf === 'Other D1') return [];
      if (sport === 'NFL') {
        const parts = conf.split(' ');
        return parts.length >= 2 ? [conf, parts[0]] : [conf];
      }
      if (sport === 'NHL') {
        const m = {'Atlantic':'Eastern','Metropolitan':'Eastern','Central':'Western','Pacific':'Western'};
        return m[conf] ? [conf, m[conf] + ' Conference'] : [conf];
      }
      if (sport === 'MLB') {
        const parts = conf.split(' ');
        if (parts.length >= 2) {
          const lg = parts[0] === 'AL' ? 'American League' : 'National League';
          return [conf, lg];
        }
        return [conf];
      }
      return [conf];
    };

    const groupData = {};
    for (const yr of years) {
      const d = allSeasonData[yr];
      if (!d) continue;
      for (const row of d) {
        if (row.games_played < 4) continue;
        for (const g of getGroups(row)) {
          if (!groupData[g]) groupData[g] = {};
          if (!groupData[g][yr]) groupData[g][yr] = [];
          groupData[g][yr].push(row.elo);
        }
      }
    }

    if (!Object.keys(groupData).length) {
      el.innerHTML = '<div class="empty-state">No data available.</div>';
      return;
    }

    const avgData = {};
    for (const [g, ym] of Object.entries(groupData)) {
      avgData[g] = {};
      for (const [yr, elos] of Object.entries(ym)) {
        avgData[g][yr] = Math.round((elos.reduce((a,b)=>a+b,0)/elos.length)*10)/10;
      }
    }

    const lastYr = years[years.length-1];
    const sortedGroups = Object.keys(avgData).sort((a,b)=>(avgData[b][lastYr]||0)-(avgData[a][lastYr]||0));

    el.innerHTML = `
      <div class="history-wrap">
        <div style="margin-bottom:1rem;display:flex;gap:0.75rem;flex-wrap:wrap;align-items:flex-start">
          <div>
            <input type="text" id="confHistSearch" placeholder="Filter groups…"
              style="width:190px;font-family:var(--font-mono);font-size:0.75rem;
                     background:var(--bg3);border:1px solid var(--border-md);color:var(--text);
                     border-radius:var(--radius);padding:0.3rem 0.6rem;margin-bottom:0.3rem;display:block">
            <select id="confHistSelect" multiple size="7"
              style="width:220px;font-family:var(--font-mono);font-size:0.73rem;
                     background:var(--bg3);border:1px solid var(--border-md);color:var(--text);
                     border-radius:var(--radius);padding:0.2rem">
              ${sortedGroups.map((g,i)=>`<option value="${g}" ${i<5?'selected':''}>${g}</option>`).join('')}
            </select>
            <div style="font-size:0.65rem;color:var(--text-dim);font-family:var(--font-mono);margin-top:0.2rem">
              Ctrl/Cmd to select multiple
            </div>
          </div>
          <button id="confHistDraw"
            style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);
                   padding:0.45rem 1rem;font-family:var(--font-mono);font-size:0.78rem;
                   font-weight:600;cursor:pointer;align-self:center">
            ▶ Draw chart
          </button>
        </div>
        <div class="history-canvas-wrap"><canvas id="confHistCanvas"></canvas></div>
      </div>`;

    const selEl = document.getElementById('confHistSelect');
    document.getElementById('confHistSearch')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      const sel = new Set([...selEl.selectedOptions].map(o=>o.value));
      selEl.innerHTML = sortedGroups.filter(g=>!q||g.toLowerCase().includes(q))
        .map(g=>`<option value="${g}" ${sel.has(g)?'selected':''}>${g}</option>`).join('');
    });

    const COLORS = ['#e2c97e','#7eb5e8','#7dd4a8','#e07a65','#c07dcc','#f0a060','#60d0c0','#a0e070','#e070a0','#70a0e0'];
    const labels = years.map(String);

    const drawChart = async () => {
      const selected = [...(selEl?.selectedOptions||[])].map(o=>o.value);
      if (!selected.length) return;
      if (!window.Chart) {
        await new Promise((res,rej)=>{
          const s=document.createElement('script');
          s.src='https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
          s.onload=res; s.onerror=rej; document.head.appendChild(s);
        });
      }
      if (window._confHistChart) { window._confHistChart.destroy(); window._confHistChart=null; }
      window._confHistChart = new Chart(document.getElementById('confHistCanvas'), {
        type: 'line',
        data: {
          labels,
          datasets: selected.map((g,i)=>({
            label: g,
            data: labels.map(yr=>avgData[g][parseInt(yr)]??null),
            borderColor: COLORS[i%COLORS.length],
            backgroundColor: COLORS[i%COLORS.length]+'18',
            borderWidth:2.5, pointRadius:3, tension:0.35, fill:false, spanGaps:true
          }))
        },
        options: {
          responsive:true, maintainAspectRatio:false,
          interaction:{intersect:false,mode:'index'},
          scales: {
            x:{ticks:{color:'#c0bcb6',font:{size:11,family:'monospace'}},grid:{color:'rgba(255,255,255,0.04)'}},
            y:{title:{display:true,text:'Avg Elo',color:'#c0bcb6',font:{size:11}},
               ticks:{color:'#c0bcb6',font:{family:'monospace',size:11}},
               grid:{color:'rgba(255,255,255,0.06)'}}
          },
          plugins:{
            legend:{labels:{color:'#c0bcb6',font:{family:'monospace',size:11},boxWidth:16}},
            tooltip:{callbacks:{label:ctx=>ctx.dataset.label+': '+(ctx.parsed.y||0).toFixed(1)}}
          }
        }
      });
    };
    document.getElementById('confHistDraw')?.addEventListener('click', drawChart);
    drawChart();
  }

    // ── Greatest Teams of All Time ────────────────────────────
  // Scans every available season CSV, finds the top 50 by peak Elo,
  // then displays a ranked table with season, record, conference, SOS.
  let _greatestRendered = false;
  async function renderGreatestTeams() {
    const el = document.getElementById('panel-greatest');
    if (!el) return;
    if (_greatestRendered && el.innerHTML.includes('greatestTable')) return; // already rendered
    el.innerHTML = '<div class="loading"><div class="spinner"></div>Loading all seasons…</div>';

    // Load every season
    const years = (CFG.seasons || []).slice().reverse();

    // Load all seasons with error handling (Safari is strict about fetch failures)
    for (const yr of years) {
      if (!allSeasonData[yr]) {
        try {
          const raw = await fetchCSV(CFG.dataPath + yr + '.csv');
          if (raw && raw.length) allSeasonData[yr] = raw.map(coerceRow);
        } catch(e) {
          // Skip seasons that fail to load (404 for future seasons, network errors)
        }
      }
    }

    // Collect every team-season with enough games
    const candidates = [];
    for (const yr of years) {
      const d = allSeasonData[yr];
      if (!d || !d.length) continue;
      for (const row of d) {
        if (!row.elo || row.games_played < 4) continue;
        candidates.push({
          rank:        0,
          team:        row.team       || '—',
          season:      yr,
          conference:  row.conference || '—',
          elo:         row.elo,
          record:      row.record     || (row.wins + '-' + row.losses),
          win_pct:     row.win_pct    || 0,
          sos:         row.sos        || 0,
          best_win:    row.best_win_team || '—',
          best_win_elo:row.best_win_elo  || 0,
          games_played:row.games_played,
        });
      }
    }

    if (!candidates.length) {
      el.innerHTML = '<div class="empty-state">No data loaded yet.</div>';
      return;
    }

    // Sort by Elo descending, take top 50
    candidates.sort((a, b) => b.elo - a.elo);
    const top = candidates.slice(0, 50);
    top.forEach((r, i) => r.rank = i + 1);

    const maxElo = top[0].elo;
    const minElo = top[top.length - 1].elo;

    const rows = top.map(r => {
      const bar = Math.round(((r.elo - minElo) / (maxElo - minElo)) * 80);
      const bwElo = r.best_win_elo > 0 ? r.best_win_elo.toFixed(1) : '';
      return `<tr>
        <td class="rank">${r.rank}</td>
        <td class="team-name" style="font-weight:500">${r.team}</td>
        <td class="num" style="color:var(--text-muted);font-family:var(--font-mono);font-size:0.75rem">${r.season}</td>
        <td class="conf">${r.conference}</td>
        <td class="elo" data-val="${r.elo}">
          <div class="elo-bar-wrap">
            <span>${r.elo.toFixed(1)}</span>
            <div class="elo-bar" style="width:${bar}px"></div>
          </div>
        </td>
        <td class="record">${r.record}</td>
        <td class="num">${fmt.pct(r.win_pct)}</td>
        <td class="num">${r.sos > 0 ? r.sos.toFixed(1) : '—'}</td>
        <td class="num" style="font-size:0.75rem">
          <span title="${r.best_win}">${r.best_win !== '—' ? r.best_win.substring(0,16) : '—'}</span>
          ${bwElo ? `<span style="color:var(--text-dim);font-size:0.62rem;margin-left:0.2rem">${bwElo}</span>` : ''}
        </td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <div class="greatest-wrap">
        <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);
                    margin-bottom:1rem;line-height:1.6">
          Top 50 single-season Elo ratings across all ${years.length} seasons.
          Ranked by peak Elo — teams with fewer than 4 games excluded.
        </div>
        <div class="table-wrap">
          <table class="tbl" id="greatestTable">
            <thead><tr>
              <th data-type="num">Rank</th>
              <th>Team</th>
              <th data-type="num">Season</th>
              <th>${CFG.confLabel || 'Conference'}</th>
              <th data-type="num">Elo</th>
              <th>Record</th>
              <th data-type="num">Win%</th>
              <th data-type="num">SOS</th>
              <th data-type="num">Best Win</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;

    makeSortable(document.getElementById('greatestTable'));
    _greatestRendered = true;
  }

  
  // ──────────────────────────────────────────────────────────
  // CFB SEASON PICK'EM
  // ──────────────────────────────────────────────────────────

  var _pk = {
    yr:null, schedule:[], scores:{}, confGames:[], confChamps:{},
    wins:{}, losses:{}, confWins:{}, confLoss:{}, eloBase:{}, eloSim:{},
    playoffRating:{}
  };

  // ── 2025-26 EXACT conference rosters ─────────────────────
  // Sources: Deseret News July 2025, ESPN standings, CFP rules
  var PK_CONFS = {
    "SEC": [
      "Alabama","Arkansas","Auburn","Florida","Georgia","Kentucky","LSU",
      "Mississippi State","Missouri","Ole Miss","Oklahoma","South Carolina",
      "Tennessee","Texas","Texas A&M","Vanderbilt"
    ],
    "Big Ten": [
      "Illinois","Indiana","Iowa","Maryland","Michigan","Michigan State",
      "Minnesota","Nebraska","Northwestern","Ohio State","Oregon",
      "Penn State","Purdue","Rutgers","UCLA","USC","Washington","Wisconsin"
    ],
    "Big 12": [
      "Arizona","Arizona State","Baylor","BYU","Cincinnati","Colorado",
      "Houston","Iowa State","Kansas","Kansas St","Oklahoma State",
      "TCU","Texas Tech","UCF","Utah","West Virginia"
    ],
    "ACC": [
      "Boston College","California","Clemson","Duke","Florida State",
      "Georgia Tech","Louisville","Miami","NC State","North Carolina",
      "Pittsburgh","SMU","Stanford","Syracuse","Virginia","Virginia Tech",
      "Wake Forest"
    ],
    "Pac-12": [
      "Boise St","Colorado St","Fresno St","Oregon St",
      "San Diego St","Texas St","Utah St","Washington St"
    ],
    "Mountain West": [
      "Air Force","Hawai'i","Nevada","New Mexico","Northern Illinois",
      "North Dakota State","San Jose State","UNLV","UTEP","Wyoming"
    ],
    "AAC": [
      "Army","Charlotte","East Carolina","FAU","Memphis","Navy",
      "North Texas","Rice","South Florida","Temple","Tulane","UAB","UTSA"
    ],
    "Sun Belt": [
      "Appalachian State","Arkansas State","Coastal Carolina",
      "Georgia Southern","Georgia State","James Madison","Louisiana",
      "Louisiana Tech","Marshall","Old Dominion","South Alabama",
      "Southern Miss","Troy","UL Monroe"
    ],
    "MAC": [
      "Akron","Ball State","Bowling Green","Buffalo","Central Michigan",
      "Eastern Michigan","Kent State","Massachusetts","Miami (OH)",
      "Ohio","Toledo","W. Michigan"
    ],
    "C-USA": [
      "Delaware","FIU","Jacksonville State","Kennesaw State","Liberty",
      "Middle Tennessee","Missouri State","New Mexico State",
      "Sam Houston","Western Kentucky"
    ],
    "Independent": ["Notre Dame","Connecticut"]
  };

  // ── Divisions — Sun Belt still has East/West in 2026 ─────
  // MAC eliminated divisions (only 12 teams, no divisions in 2026)
  // Sun Belt: only FBS conf still using divisions
  var PK_DIVS = {
    "Sun Belt": {
      "East": ["Appalachian State","Coastal Carolina","Georgia Southern",
               "Georgia State","James Madison","Marshall","Old Dominion"],
      "West": ["Arkansas State","Louisiana","Louisiana Tech","South Alabama",
               "Southern Miss","Troy","UL Monroe"]
    }
  };

  // ── CFP auto-bid conferences (eligible for automatic bids) ──
  // Any conference with a championship game qualifies
  // Independent schools (Notre Dame) can only receive at-large bids
  var CFP_AUTO_CONF = ["SEC","Big Ten","Big 12","ACC","Pac-12",
                       "Mountain West","AAC","Sun Belt","MAC","C-USA"];

  // ── ESPN shortDisplayName → canonical PK_CONFS name ──────
  var PK_ALIAS = {
    // SEC
    "Mississippi St":"Mississippi State","Miss St":"Mississippi State",
    "Miss. St.":"Mississippi State",
    // Big Ten
    "Ohio St":"Ohio State","Penn St":"Penn State",
    "Michigan St":"Michigan State","Mich. St.":"Michigan State",
    // Big 12
    "Kansas St":"Kansas St","Iowa St":"Iowa State",
    "Oklahoma St":"Oklahoma State","Okla. St.":"Oklahoma State",
    "West Virginia":"West Virginia","WVU":"West Virginia",
    // ACC
    "Florida St":"Florida State","FSU":"Florida State","Fla. State":"Florida State",
    "NC State":"NC State","N.C. State":"NC State",
    "Georgia Tech":"Georgia Tech","Ga. Tech":"Georgia Tech",
    "Pitt":"Pittsburgh","UNC":"North Carolina","UVA":"Virginia",
    "Va. Tech":"Virginia Tech","BC":"Boston College",
    // Pac-12
    "Boise St":"Boise St","Fresno St":"Fresno St",
    "Utah St":"Utah St","San Diego St":"San Diego St","SDSU":"San Diego St",
    "Washington St":"Washington St","Wash. State":"Washington St","Wash St":"Washington St",
    "Oregon St":"Oregon St","Texas St":"Texas St","Tex. St.":"Texas St",
    "Colorado St":"Colorado St","Colo. St.":"Colorado St",
    // Mountain West
    "San José St":"San Jose State","San Jose St":"San Jose State","SJSU":"San Jose State",
    "Hawaii":"Hawai'i","New Mexico":"New Mexico",
    "N Illinois":"Northern Illinois","NIU":"Northern Illinois",
    // AAC
    "ECU":"East Carolina","USF":"South Florida","E. Carolina":"East Carolina",
    "So. Florida":"South Florida",
    "FAU":"FAU","UAB":"UAB","UTSA":"UTSA",
    // Sun Belt
    "App State":"Appalachian State","Appalachian St":"Appalachian State",
    "GA Southern":"Georgia Southern","Ga. Southern":"Georgia Southern",
    "Georgia St":"Georgia State","Ga. State":"Georgia State","Ga St":"Georgia State",
    "Coastal":"Coastal Carolina","Coastal Car":"Coastal Carolina",
    "Coastal Car.":"Coastal Carolina",
    "S. Alabama":"South Alabama","South Ala.":"South Alabama",
    "ODU":"Old Dominion","Old Dom.":"Old Dominion",
    "Southern Miss":"Southern Miss","So. Miss":"Southern Miss",
    "UL Monroe":"UL Monroe","ULM":"UL Monroe",
    "La.":"Louisiana","ULL":"Louisiana","Louisiana":"Louisiana",
    "Ark St":"Arkansas State","Arkansas St":"Arkansas State","Ark. State":"Arkansas State",
    "James Madison":"James Madison","JMU":"James Madison",
    "Marshall":"Marshall","Troy":"Troy",
    // MAC
    "C Michigan":"Central Michigan","CMU":"Central Michigan","Cent. Michigan":"Central Michigan",
    "E Michigan":"Eastern Michigan","EMU":"Eastern Michigan","Eastern Mich.":"Eastern Michigan",
    "W Michigan":"W. Michigan","WMU":"W. Michigan","Western Mich.":"W. Michigan",
    "N. Illinois":"Northern Illinois",
    "Ball St":"Ball State","Ball St.":"Ball State",
    "Bowling Green":"Bowling Green","BGSU":"Bowling Green",
    "Kent St":"Kent State","Kent St.":"Kent State",
    "Miami OH":"Miami (OH)","Miami (Ohio)":"Miami (OH)","Miami-Ohio":"Miami (OH)",
    "Ohio":"Ohio","Toledo":"Toledo","Akron":"Akron","Buffalo":"Buffalo",
    "UMass":"Massachusetts","Mass.":"Massachusetts",
    // C-USA
    "Western KY":"Western Kentucky","WKU":"Western Kentucky","W. Kentucky":"Western Kentucky",
    "MTSU":"Middle Tennessee","Middle Tenn":"Middle Tennessee","Middle Tenn.":"Middle Tennessee",
    "FIU":"FIU","La. Tech":"Louisiana Tech","La Tech":"Louisiana Tech",
    "New Mexico St":"New Mexico State","NMSU":"New Mexico State",
    "Kennesaw St":"Kennesaw State","Kenn. St.":"Kennesaw State",
    "Jax State":"Jacksonville State","Jax St":"Jacksonville State",
    "Jacksonville St":"Jacksonville State",
    "Sam Hous.":"Sam Houston","SHSU":"Sam Houston",
    "Liberty":"Liberty","Mo. State":"Missouri State","Missouri St":"Missouri State",
    // Independent
    "UConn":"Connecticut","Notre Dame":"Notre Dame",
    // New 2026 additions
    "N Dakota St":"North Dakota State","ND State":"North Dakota State","NDSU":"North Dakota State",
    "N. Dakota St":"North Dakota State",
    "La. Tech":"Louisiana Tech","La Tech":"Louisiana Tech","LaTech":"Louisiana Tech",
    "La Tech Bulldogs":"Louisiana Tech",
    "Mass.":"Massachusetts","UMass":"Massachusetts","Massachusetts":"Massachusetts",
    "Western KY":"Western Kentucky","WKU":"Western Kentucky","W. Kentucky":"Western Kentucky",
    "Missouri St":"Missouri State","Mo. State":"Missouri State",
    // Pac-12 aliases
    "Washington St":"Washington St","Wash. State":"Washington St","Wash St":"Washington St","WSU":"Washington St",
    "Oregon St":"Oregon St","Texas St":"Texas St","Tex. St.":"Texas St","Texas St.":"Texas St",
    "Utah St":"Utah St","Utah St.":"Utah St","USU":"Utah St",
    "Colorado St":"Colorado St","CSU":"Colorado St","Colo. St.":"Colorado St",
    "Fresno St":"Fresno St","Fresno St.":"Fresno St",
    "Boise St":"Boise St","Boise St.":"Boise St","BSU":"Boise St",
    "San Diego St":"San Diego St","SDSU":"San Diego St",
    // Mountain West aliases
    "San José St":"San Jose State","San Jose St":"San Jose State","SJSU":"San Jose State",
    "N Illinois":"Northern Illinois","No. Illinois":"Northern Illinois",
    "Hawaii":"Hawai'i",
    // Additional ESPN shortDisplayName variants
    "K-State":"Kansas St","Kan. St.":"Kansas St",
    "So. California":"USC","S. Cal":"USC",
    "Georgia St.":"Georgia State","Ga. St.":"Georgia State",
    "N. Texas":"North Texas","North Tex.":"North Texas",
    "S. Florida":"South Florida","So. Florida":"South Florida",
    "N. Dakota St.":"North Dakota State","N.D. State":"North Dakota State",
    "Jms. Madison":"James Madison",
    "New Mex. St.":"New Mexico State","NM State":"New Mexico State",
    "Kennesaw St.":"Kennesaw State",
    "Miami Ohio":"Miami (OH)","Miami-Ohio":"Miami (OH)",
    "Cent. Mich.":"Central Michigan","C. Michigan":"Central Michigan",
    "E. Mich.":"Eastern Michigan","E. Michigan":"Eastern Michigan",
    "W. Mich.":"W. Michigan","W. Michigan":"W. Michigan",
    "Ball St.":"Ball State","Ball State":"Ball State",
    "Kent St.":"Kent State",
    "Coastal Car.":"Coastal Carolina",
    "Old Dom.":"Old Dominion",
    "ULL":"Louisiana","La.":"Louisiana",
    "So. Miss.":"Southern Miss","S. Miss":"Southern Miss",
    "La. Tech":"Louisiana Tech","LaTech":"Louisiana Tech",
    "S. Alabama":"South Alabama","South Ala.":"South Alabama",
    "Ark. State":"Arkansas State","Ark. St.":"Arkansas State",
    "Jax State":"Jacksonville State","Jax St.":"Jacksonville State",
    "Sam Hous.":"Sam Houston","SHSU":"Sam Houston",
    "Wash. St.":"Washington St","Wash St.":"Washington St"
  };

  // Set of all FBS team names for fast lookup
  var _fbs_set = null;
  function pkIsFBS(name) {
    if (!_fbs_set) {
      _fbs_set = new Set();
      Object.values(PK_CONFS).forEach(function(arr){
        arr.forEach(function(t){ _fbs_set.add(t); });
      });
      Object.keys(PK_ALIAS).forEach(function(k){ _fbs_set.add(k); });
    }
    return _fbs_set.has(name) || _fbs_set.has(PK_ALIAS[name]);
  }

  function pkResolve(t){ return PK_ALIAS[t] || t; }

  function pkConfOf(team){
    var t = pkResolve(team);
    for(var conf in PK_CONFS){
      if(PK_CONFS[conf].indexOf(t) !== -1) return conf;
    }
    return null;
  }

  function pkBuild(){
    _pk.wins={}; _pk.losses={}; _pk.confWins={}; _pk.confLoss={};
    _pk.eloSim = JSON.parse(JSON.stringify(_pk.eloBase));
    var K=30;
    // Dedup key: team_a + team_b + week — prevents same matchup same week counting twice
    // Main use case: ESPN scoreboard AND static Pac-12 schedule both return the same game
    // Different week number = counted separately (e.g. home-and-home across two weeks)
    var counted={};
    for(var i=0;i<_pk.schedule.length;i++){
      var g=_pk.schedule[i];
      var s=_pk.scores[g.id];
      if(!s||s.homeScore===''||s.awayScore===''||s.homeScore==null||s.awayScore==null) continue;
      var hs=parseInt(s.homeScore), as_=parseInt(s.awayScore);
      if(isNaN(hs)||isNaN(as_)||hs===as_) continue;
      var winner=pkResolve(hs>as_?g.homeTeam:g.awayTeam);
      var loser=pkResolve(hs>as_?g.awayTeam:g.homeTeam);
      // Canonical pair key — no week number so ESPN week mismatches don't double-count
      // (Each pair of FBS teams only plays once per regular season)
      var teams=[winner,loser].sort();
      var dedupKey=teams[0]+'|'+teams[1];
      if(counted[dedupKey]) continue;
      counted[dedupKey]=1;
      _pk.wins[winner]=(_pk.wins[winner]||0)+1;
      _pk.losses[loser]=(_pk.losses[loser]||0)+1;
      var cW=pkConfOf(winner), cL=pkConfOf(loser);
      if(cW&&cW===cL&&cW!=='Independent'){
        _pk.confWins[winner]=(_pk.confWins[winner]||0)+1;
        _pk.confLoss[loser]=(_pk.confLoss[loser]||0)+1;
      }
      var margin=Math.abs(hs-as_);
      var rW=_pk.eloSim[winner]||1500, rL=_pk.eloSim[loser]||1500;
      var eW=1/(1+Math.pow(10,(rL-rW)/400));
      var delta=K*Math.log(margin+1)*(1-eW);
      _pk.eloSim[winner]=rW+delta;
      _pk.eloSim[loser]=rL-delta;
    }
    for(var j=0;j<_pk.confGames.length;j++){
      var cg=_pk.confGames[j];
      if(cg.homeScore==null||cg.awayScore==null||cg.homeScore===cg.awayScore) continue;
      var cw=cg.homeScore>cg.awayScore?cg.homeTeam:cg.awayTeam;
      var cl=cg.homeScore>cg.awayScore?cg.awayTeam:cg.homeTeam;
      // Count conf championship result in W/L records
      _pk.wins[cw]  = (_pk.wins[cw]  || 0) + 1;
      _pk.losses[cl] = (_pk.losses[cl] || 0) + 1;
      var m2=Math.abs(cg.homeScore-cg.awayScore);
      var rW2=_pk.eloSim[cw]||1500, rL2=_pk.eloSim[cl]||1500;
      var eW2=1/(1+Math.pow(10,(rL2-rW2)/400));
      _pk.eloSim[cw]=rW2+K*Math.log(m2+1)*(1-eW2);
      _pk.eloSim[cl]=rL2-K*Math.log(m2+1)*(1-eW2);
    }
    // Sanity check: log any team with >14 games (debugging)
    if(typeof console!=='undefined'){
      var allT=Object.keys(_pk.wins).concat(Object.keys(_pk.losses));
      allT.forEach(function(t){
        var tot=(_pk.wins[t]||0)+(_pk.losses[t]||0);
        if(tot>14) console.warn('pkBuild: '+t+' has '+tot+' games (check for duplicates)');
      });
    }
    // Build playoff rating for every team
    // Formula: PlayoffRating = Elo + sqrt(sum of beaten opponents' Elo)
    // This rewards beating strong teams (resume strength) on top of raw Elo
    _pk.playoffRating = {};
    // Collect wins per team (same week-aware dedup as above)
    var wins_by = {};
    var counted2 = {};
    for(var gi=0;gi<_pk.schedule.length;gi++){
      var g=_pk.schedule[gi];
      var s=_pk.scores[g.id];
      if(!s||s.homeScore==null||s.awayScore==null) continue;
      var hs=parseInt(s.homeScore),as_=parseInt(s.awayScore);
      if(isNaN(hs)||isNaN(as_)||hs===as_) continue;
      var winner=pkResolve(hs>as_?g.homeTeam:g.awayTeam);
      var loser=pkResolve(hs>as_?g.awayTeam:g.homeTeam);
      var t2=[winner,loser].sort();
      var dk2=t2[0]+'|'+t2[1];
      if(counted2[dk2]) continue;
      counted2[dk2]=1;
      if(!wins_by[winner]) wins_by[winner]=[];
      wins_by[winner].push(loser);
    }
    for(var ci=0;ci<_pk.confGames.length;ci++){
      var cg2=_pk.confGames[ci];
      if(cg2.homeScore==null||cg2.awayScore==null||cg2.homeScore===cg2.awayScore) continue;
      var cw2=cg2.homeScore>cg2.awayScore?cg2.homeTeam:cg2.awayTeam;
      var cl2=cg2.homeScore>cg2.awayScore?cg2.awayTeam:cg2.homeTeam;
      if(!wins_by[cw2]) wins_by[cw2]=[];
      wins_by[cw2].push(cl2);
    }
    // Calculate playoff rating for each team
    var allTeamNames = Object.keys(_pk.eloSim);
    for(var ti=0;ti<allTeamNames.length;ti++){
      var team=allTeamNames[ti];
      var teamElo=_pk.eloSim[team]||1500;
      var beaten=wins_by[team]||[];
      var resumeSum=0;
      for(var bi=0;bi<beaten.length;bi++){
        var oppElo=_pk.eloSim[beaten[bi]]||_pk.eloBase[beaten[bi]]||1500;
        resumeSum+=oppElo;
      }
      // sqrt of sum of beaten opponents' Elo = resume score
      var resumeScore = beaten.length>0 ? Math.sqrt(resumeSum) : 0;
      _pk.playoffRating[team] = teamElo + resumeScore;
    }
  }

  function pkSort(teams){
    return teams.slice().sort(function(a,b){
      var acp=(a.cw+a.cl)?a.cw/(a.cw+a.cl):0, bcp=(b.cw+b.cl)?b.cw/(b.cw+b.cl):0;
      if(Math.abs(bcp-acp)>0.001) return bcp-acp;
      var awp=(a.w+a.l)?a.w/(a.w+a.l):0, bwp=(b.w+b.l)?b.w/(b.w+b.l):0;
      if(Math.abs(bwp-awp)>0.001) return bwp-awp;
      return (b.elo||1500)-(a.elo||1500);
    });
  }

  function pkTeam(t){
    return {team:t, cw:_pk.confWins[t]||0, cl:_pk.confLoss[t]||0,
            w:_pk.wins[t]||0, l:_pk.losses[t]||0,
            elo:_pk.eloSim[t]||_pk.eloBase[t]||1500};
  }


  async function renderPickem(){
    var el=document.getElementById('panel-pickem');
    if(!el||CFG.sport!=='CFB') return;
    if(!allSeasonData[currentSeason]){
      try{var raw=await fetchCSV(CFG.dataPath+currentSeason+'.csv');if(raw)allSeasonData[currentSeason]=raw.map(coerceRow);}catch(e){}
    }
    _pk.eloBase={};
    (allSeasonData[currentSeason]||[]).forEach(function(r){if(r.team&&r.elo)_pk.eloBase[r.team]=parseFloat(r.elo);});
    _pk.eloSim=JSON.parse(JSON.stringify(_pk.eloBase));
    _pk.yr=currentSeason+1;
    _pk.schedule=[];_pk.scores={};_pk.confGames=[];_pk.confChamps={};
    pkDrawShell();
    pkFetchSched(_pk.yr);
  }

  function pkDrawShell(){
    var el=document.getElementById('panel-pickem');
    if(!el) return;
    var seasonOpts='',eloOpts='';
    (CFG.seasons||[]).slice(0,5).forEach(function(y){
      seasonOpts+='<option value="'+y+'">'+y+'</option>';
      eloOpts+='<option value="'+y+'">'+y+' Elo</option>';
    });
    el.innerHTML=
      '<div style="max-width:920px">'
      +'<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:0.9rem 1.1rem;margin-bottom:1rem">'
      +'<div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">'
      +'<div style="font-size:0.86rem;font-weight:600;color:var(--text)">🏈 '+_pk.yr+' CFB Season Pick\'em</div>'
      +'<div style="display:flex;align-items:center;gap:0.4rem;margin-left:auto">'
      +'<span style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim)">Season:</span>'
      +'<select onchange="pkLoadYear(parseInt(this.value))" style="font-family:var(--font-mono);font-size:0.7rem;background:var(--bg3);border:1px solid var(--border-md);color:var(--text);border-radius:var(--radius);padding:0.2rem 0.4rem">'+seasonOpts+'</select>'
      +'</div></div>'
      +'<div style="font-size:0.68rem;color:var(--text-muted);font-family:var(--font-mono);margin-top:0.4rem;line-height:1.55">'
      +'Every FBS game in week order · enter scores → conf standings decide championship matchups → CFP bracket + Top 25'
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);flex-wrap:wrap">'
      +'<span style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim)">⚡ Auto-predict using</span>'
      +'<select id="pk-elo-yr" style="font-family:var(--font-mono);font-size:0.7rem;background:var(--bg3);border:1px solid var(--border-md);color:var(--text);border-radius:var(--radius);padding:0.2rem 0.4rem">'+eloOpts+'</select>'
      +'<button onclick="pkAutoPredict()" style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);padding:0.28rem 0.85rem;font-family:var(--font-mono);font-size:0.7rem;font-weight:600;cursor:pointer">Fill all games →</button>'
      +'<span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim)">(home +45 Elo · realistic score pools · upsets close)</span>'
      +'</div></div>'
      +'<div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:1rem">'
      +'<button onclick="pkTab(\'reg\')" id="pk-tab-reg" style="font-family:var(--font-mono);font-size:0.68rem;padding:0.42rem 0.9rem;border:none;border-bottom:2px solid var(--accent);margin-bottom:-2px;background:transparent;cursor:pointer;color:var(--accent)">📅 Regular Season</button>'
      +'<button onclick="pkTab(\'conf\')" id="pk-tab-conf" style="font-family:var(--font-mono);font-size:0.68rem;padding:0.42rem 0.9rem;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;background:transparent;cursor:pointer;color:var(--text-muted)">🏆 Conf Championships</button>'
      +'<button onclick="pkTab(\'cfp\')" id="pk-tab-cfp" style="font-family:var(--font-mono);font-size:0.68rem;padding:0.42rem 0.9rem;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;background:transparent;cursor:pointer;color:var(--text-muted)">🎯 CFP Bracket</button>'
      +'</div>'
      +'<div id="pk-reg"></div>'
      +'<div id="pk-conf" hidden></div>'
      +'<div id="pk-cfp" hidden></div>'
      +'</div>';
  }

  window.pkTab=function(ph){
    ['reg','conf','cfp'].forEach(function(p){
      var panel=document.getElementById('pk-'+p);
      var btn=document.getElementById('pk-tab-'+p);
      if(!panel||!btn) return;
      if(p===ph){panel.removeAttribute('hidden');btn.style.borderBottomColor='var(--accent)';btn.style.color='var(--accent)';}
      else{panel.setAttribute('hidden','');btn.style.borderBottomColor='transparent';btn.style.color='var(--text-muted)';}
    });
    pkBuild();
    if(ph==='conf') pkDrawConf();
    if(ph==='cfp')  pkDrawCFP();
  };

  window.pkLoadYear=async function(yr){
    var baseYr=yr-1;
    if(!allSeasonData[baseYr]){try{var raw=await fetchCSV(CFG.dataPath+baseYr+'.csv');if(raw)allSeasonData[baseYr]=raw.map(coerceRow);}catch(e){}}
    _pk.eloBase={};
    (allSeasonData[baseYr]||allSeasonData[currentSeason]||[]).forEach(function(r){if(r.team&&r.elo)_pk.eloBase[r.team]=parseFloat(r.elo);});
    _pk.eloSim=JSON.parse(JSON.stringify(_pk.eloBase));
    _pk.yr=yr;_pk.schedule=[];_pk.scores={};_pk.confGames=[];_pk.confChamps={};
    pkDrawShell();pkFetchSched(yr);
  };


  function pkGetStaticPac12(yr) {
    if (yr !== 2026) return [];
    // 2026 Pac-12 schedule — verified sources + computed round-robin
    // Each of 8 teams plays exactly 7 conf games (C(8,2)=28 unique matchups)
    // Non-conf games from Wikipedia/pac-12.com/txst.com
    var games = [
      // ── Non-conference ──────────────────────────────────────
      // Washington State
      {wk:1, dt:"2026-09-05", h:"Washington",       a:"Washington St", n:false},
      {wk:2, dt:"2026-09-12", h:"Kansas St",     a:"Washington St", n:false},
      {wk:3, dt:"2026-09-19", h:"Washington St", a:"Duquesne",         n:false},
      {wk:4, dt:"2026-09-26", h:"Washington St", a:"Arizona",          n:false},
      // Oregon State
      {wk:1, dt:"2026-08-29", h:"Stanford",         a:"Hawai'i",          n:false},
      {wk:2, dt:"2026-09-12", h:"Oregon St",     a:"Memphis",          n:false},
      {wk:3, dt:"2026-09-19", h:"Oregon St",     a:"S. Dakota",     n:false},
      {wk:4, dt:"2026-09-26", h:"W. Michigan", a:"Oregon St",     n:false},
      // Boise State
      {wk:1, dt:"2026-09-05", h:"Oregon",           a:"Boise St",      n:false},
      {wk:2, dt:"2026-09-12", h:"Boise St",      a:"Northwestern St",  n:false},
      {wk:3, dt:"2026-09-19", h:"Boise St",      a:"BYU",              n:false},
      // Colorado State
      {wk:1, dt:"2026-09-05", h:"Colorado St",   a:"Wyoming",          n:false},
      {wk:2, dt:"2026-09-12", h:"Colorado St",   a:"Southern Utah",    n:false},
      // Fresno State
      {wk:1, dt:"2026-09-05", h:"Fresno St",     a:"Sacramento St",    n:false},
      {wk:2, dt:"2026-09-12", h:"Fresno St",     a:"UCLA",             n:false},
      // San Diego State
      {wk:1, dt:"2026-09-05", h:"San Diego St",  a:"Portland St",      n:false},
      {wk:2, dt:"2026-09-12", h:"San Diego St",  a:"UC Davis",         n:false},
      // Utah State
      {wk:2, dt:"2026-09-12", h:"Washington",       a:"Utah St",       n:false},
      {wk:4, dt:"2026-09-26", h:"Utah St",       a:"Idaho St",         n:false},
      // Texas State (from txst.com)
      {wk:1, dt:"2026-09-05", h:"Texas",            a:"Texas St",      n:false},
      {wk:2, dt:"2026-09-12", h:"Texas St",      a:"UTSA",             n:false},
      {wk:3, dt:"2026-09-19", h:"Texas St",      a:"North Texas",      n:false},
      {wk:4, dt:"2026-09-26", h:"Texas St",      a:"UIW",              n:false},
      // ── Pac-12 Conference (28 unique games, 7 each) ─────────────────────────
      {wk:5, dt:"2026-10-03", h:"Colorado St", a:"Utah St", n:false},
      {wk:5, dt:"2026-10-03", h:"Oregon St", a:"Boise St", n:false},
      {wk:5, dt:"2026-10-03", h:"San Diego St", a:"Texas St", n:false},
      {wk:5, dt:"2026-10-03", h:"Washington St", a:"Fresno St", n:false},
      {wk:6, dt:"2026-10-10", h:"Boise St", a:"Fresno St", n:false},
      {wk:6, dt:"2026-10-10", h:"Oregon St", a:"Colorado St", n:false},
      {wk:6, dt:"2026-10-10", h:"Utah St", a:"Washington St", n:false},
      {wk:7, dt:"2026-10-17", h:"Boise St", a:"San Diego St", n:false},
      {wk:7, dt:"2026-10-17", h:"Fresno St", a:"Utah St", n:false},
      {wk:7, dt:"2026-10-17", h:"Oregon St", a:"Washington St", n:false},
      {wk:7, dt:"2026-10-17", h:"Texas St", a:"Colorado St", n:false},
      {wk:8, dt:"2026-10-24", h:"Colorado St", a:"San Diego St", n:false},
      {wk:8, dt:"2026-10-24", h:"Oregon St", a:"Fresno St", n:false},
      {wk:8, dt:"2026-10-24", h:"Texas St", a:"Utah St", n:false},
      {wk:8, dt:"2026-10-24", h:"Washington St", a:"Boise St", n:false},
      {wk:9, dt:"2026-10-31", h:"Boise St", a:"Texas St", n:false},
      {wk:9, dt:"2026-10-31", h:"Colorado St", a:"Fresno St", n:false},
      {wk:9, dt:"2026-10-31", h:"Oregon St", a:"Utah St", n:false},
      {wk:9, dt:"2026-10-31", h:"San Diego St", a:"Washington St", n:false},
      {wk:10, dt:"2026-11-07", h:"Boise St", a:"Colorado St", n:false},
      {wk:10, dt:"2026-11-07", h:"Fresno St", a:"San Diego St", n:false},
      {wk:10, dt:"2026-11-07", h:"Oregon St", a:"Texas St", n:false},
      {wk:11, dt:"2026-11-14", h:"Boise St", a:"Utah St", n:false},
      {wk:11, dt:"2026-11-14", h:"Oregon St", a:"San Diego St", n:false},
      {wk:11, dt:"2026-11-14", h:"Texas St", a:"Fresno St", n:false},
      {wk:11, dt:"2026-11-14", h:"Washington St", a:"Colorado St", n:false},
      {wk:12, dt:"2026-11-21", h:"San Diego St", a:"Utah St", n:false},
      {wk:12, dt:"2026-11-21", h:"Texas St", a:"Washington St", n:false},
    ];
    var out=[], seen2={};
    games.forEach(function(g,i){
      var key='p12_'+g.h.replace(/[^a-z]/gi,'')+'_'+g.a.replace(/[^a-z]/gi,'')+'_w'+g.wk;
      if(seen2[key]) return; seen2[key]=1;
      out.push({id:key,week:g.wk,date:g.dt,homeTeam:g.h,awayTeam:g.a,
                neutral:g.n,completed:false,homeScore:null,awayScore:null});
    });
    return out;
  }


  // ESPN shortDisplayName normalization — maps ESPN's inconsistent names to our static schedule names
  // Applied at fetch time so all games use consistent names for dedup
  var _pk_norm = {
    "Utah State":"Utah St","Washington State":"Washington St",
    "Oregon State":"Oregon St","Boise State":"Boise St",
    "Colorado State":"Colorado St","Fresno State":"Fresno St",
    "San Diego State":"San Diego St","Texas State":"Texas St",
    "Kansas State":"Kansas St","Hawaii":"Hawai'i",
    "S. Dakota":"S. Dakota","W. Michigan":"W. Michigan",
    "Southern Utah":"S. Utah","North Dakota":"N. Dakota",
    "Sacramento State":"Sacramento St","Portland State":"Portland St",
    "Idaho State":"Idaho St","Northwestern State":"Northwestern St"
  };
  function pkNorm(t){ return (_pk_norm[t]||t); }

  async function pkFetchSched(yr){
    pkSetReg('<div class="loading"><div class="spinner"></div>Loading '+yr+' schedule from ESPN…</div>');
    var games=[],seen={};
    var weeks=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,15];
    var BATCH=4,fetched=0;
    for(var b=0;b<weeks.length;b+=BATCH){
      var batch=weeks.slice(b,b+BATCH);
      await Promise.all(batch.map(async function(wk){
        var url='https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates='+yr+'&seasontype=2&week='+wk+'&groups=80&limit=300';
        try{
          var res=await fetch(url,{mode:'cors'});if(!res.ok) return;
          var data=await res.json();if(!data.events) return;
          data.events.forEach(function(ev){
            try{
              var comp=ev.competitions&&ev.competitions[0];if(!comp) return;
              var competitors=comp.competitors||[];
              var home=null,away=null;
              competitors.forEach(function(c){if(c.homeAway==='home')home=c;else away=c;});
              if(!home||!away) return;
              var key=ev.id||(home.team.id+'_'+away.team.id+'_w'+wk);
              if(seen[key]) return;seen[key]=1;
              var hn=home.team.shortDisplayName,an=away.team.shortDisplayName;
              // Normalize ESPN names to match our static schedule names
              hn=_pk_norm[hn]||hn; an=_pk_norm[an]||an;
              if(wk===15&&hn!=='Army'&&hn!=='Navy'&&an!=='Army'&&an!=='Navy') return;
              var completed=!!(comp.status&&comp.status.type&&comp.status.type.completed);
              var dt=ev.date?ev.date.slice(0,10):null;
              if(dt&&dt.startsWith('1970')) dt=null;
              // Skip games from wrong season (ESPN sometimes returns prior season data)
              // Only accept regular season dates (Aug-Dec of target year)
              if(dt){
                if(!dt.startsWith(String(yr))) return;
                var mo=parseInt(dt.slice(5,7));
                if(mo<8||mo>12) return; // skip Jan-Jul dates (bowl/playoff games)
              }
              // Skip completed games with no date — likely prior season data
              if(completed&&!dt) return;
              var hs=completed?(parseInt(home.score)||null):null;
              var as_=completed?(parseInt(away.score)||null):null;
              // Skip FCS-only games: require at least one FBS team
              if(!pkIsFBS(hn)&&!pkIsFBS(an)) return;
              // Pair-based dedup: prevents same matchup appearing multiple times
              var pairKey=[pkNorm(hn),pkNorm(an)].sort().join('|');
              if(seen['pair:'+pairKey]) return; seen['pair:'+pairKey]=1;
              games.push({id:key,week:wk,date:dt,homeTeam:hn,awayTeam:an,
                neutral:!!(comp.neutralSite),completed:completed,homeScore:hs,awayScore:as_});
              fetched++;
            }catch(e){}
          });
        }catch(e){}
      }));
      pkSetReg('<div style="padding:1rem;font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted)">Loading '+yr+' schedule… '+fetched+' games found</div>');
    }
    games.sort(function(a,b){
      if(a.week!==b.week) return a.week-b.week;
      if(!a.date&&!b.date) return 0;if(!a.date) return 1;if(!b.date) return -1;
      return a.date<b.date?-1:a.date>b.date?1:0;
    });
    // Merge static Pac-12 schedule (ESPN scoreboard API doesn't have these yet)
    // Use symmetric key so ESPN game and static game for same matchup+week are treated as same
    // Build symmetric pair set from ESPN-fetched games
    var symSeen={};
    games.forEach(function(g){
      var k=[pkNorm(g.homeTeam),pkNorm(g.awayTeam)].sort().join('|');
      symSeen[k]=1;
    });
    var staticGames=pkGetStaticPac12(yr);
    staticGames.forEach(function(g){
      var k=[pkNorm(g.homeTeam),pkNorm(g.awayTeam)].sort().join('|');
      if(!symSeen[k]){symSeen[k]=1;seen[g.id]=1;games.push(g);fetched++;}
    });
    // Final dedup pass: remove any remaining duplicates by resolved team pair
    // Keeps first occurrence (ESPN real scores preferred over static placeholders)
    var finalSeen={};
    var dedupedGames=[];
    games.forEach(function(g){
      var ra=pkNorm(g.homeTeam), rb=pkNorm(g.awayTeam);
      var k=[ra,rb].sort().join('|');
      if(!finalSeen[k]){finalSeen[k]=1;dedupedGames.push(g);}
    });
    // Sort by week then date
    dedupedGames.sort(function(a,b){
      if(a.week!==b.week) return a.week-b.week;
      if(!a.date&&!b.date) return 0;if(!a.date) return 1;if(!b.date) return -1;
      return a.date<b.date?-1:a.date>b.date?1:0;
    });
    _pk.schedule=dedupedGames;
    if(!games.length){
      pkSetReg('<div style="padding:1.5rem;font-family:var(--font-mono);font-size:0.78rem;color:var(--text-muted);text-align:center;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg)">'
        +'<div style="font-size:0.88rem;color:var(--text);margin-bottom:0.5rem">📅 '+yr+' schedule not available yet</div>'
        +'ESPN hasn\'t published the '+yr+' CFB schedule yet (usually July–August).<br><br>'
        +'<button onclick="pkLoadYear('+(yr-1)+')" style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);padding:0.4rem 1.1rem;font-family:var(--font-mono);font-size:0.73rem;font-weight:600;cursor:pointer">Load '+(yr-1)+' season instead →</button>'
        +'</div>');
      return;
    }
    games.forEach(function(g){
      if(g.completed&&g.homeScore!=null&&g.awayScore!=null)
        _pk.scores[g.id]={homeScore:g.homeScore,awayScore:g.awayScore};
    });
    pkBuild();pkDrawReg();
  }

  function pkSetReg(html){var el=document.getElementById('pk-reg');if(el)el.innerHTML=html;}

  function pkDrawReg(){
    var el=document.getElementById('pk-reg');if(!el) return;
    var picked=0;
    Object.keys(_pk.scores).forEach(function(id){var s=_pk.scores[id];if(s.homeScore!==''&&s.homeScore!=null&&s.awayScore!==''&&s.awayScore!=null)picked++;});
    var total=_pk.schedule.length;
    var completed=_pk.schedule.filter(function(g){return g.completed;}).length;
    var html='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem">'
      +'<div id="pk-count" style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-dim)">'+total+' games'+(completed?' · '+completed+' final':'')+' · '+picked+' predicted</div>'
      +'<button onclick="pkTab(\'conf\')" style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);padding:0.35rem 1rem;font-family:var(--font-mono);font-size:0.72rem;font-weight:600;cursor:pointer">Next: Conf Championships →</button>'
      +'</div>';
    var byWeek={};
    _pk.schedule.forEach(function(g){var wk=g.week||0;if(!byWeek[wk])byWeek[wk]=[];byWeek[wk].push(g);});
    Object.keys(byWeek).sort(function(a,b){return parseInt(a)-parseInt(b);}).forEach(function(wk){
      var games=byWeek[wk];
      var label=parseInt(wk)===0?'Week 0 (Kickoff)':parseInt(wk)===15?'Week 15 (Army-Navy)':'Week '+wk;
      var datedGames=games.filter(function(g){return g.date;});
      var range='';
      if(datedGames.length){
        var dates=datedGames.map(function(g){return g.date;}).sort();
        var d0=new Date(dates[0]+'T12:00:00'),d1=new Date(dates[dates.length-1]+'T12:00:00');
        var fmt=function(d){return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});};
        range=' — '+(d0.toDateString()===d1.toDateString()?fmt(d0):fmt(d0)+'–'+fmt(d1));
      }
      html+='<div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin:0.85rem 0 0.35rem;padding-top:0.5rem;border-top:1px solid var(--border)">'+label+range+' <span style="opacity:0.6">('+games.length+')</span></div>';
      games.forEach(function(g){
        // Skip games where opponent is truly TBD (flex matchups not yet determined)
        if(!g.homeTeam||!g.awayTeam||g.homeTeam==='TBD'||g.awayTeam==='TBD') {
          html+='<div style="display:flex;align-items:center;gap:0.4rem;padding:0.25rem 0.55rem;margin-bottom:0.18rem;border-radius:var(--radius);background:var(--bg2);border:1px solid var(--border);opacity:0.5">'
            +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:36px;text-align:center">'+( g.date?new Date(g.date+'T12:00:00').toLocaleDateString('en-US',{month:'numeric',day:'numeric'}):'TBD')+'</div>'
            +'<div style="flex:1;font-size:0.76rem;color:var(--text-muted)">'+(g.homeTeam&&g.homeTeam!=='TBD'?g.homeTeam:'TBD')+' H</div>'
            +'<div style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-dim);padding:0 0.5rem">vs</div>'
            +'<div style="flex:1;text-align:right;font-size:0.76rem;color:var(--text-muted)">A '+(g.awayTeam&&g.awayTeam!=='TBD'?g.awayTeam:'TBD')+'</div>'
            +'<div style="font-size:0.55rem;color:var(--text-dim);font-family:var(--font-mono);min-width:50px;text-align:right">Flex/TBD</div>'
            +'</div>';
          return;
        }
        var s=_pk.scores[g.id]||{};
        var hs=s.homeScore!=null?s.homeScore:'';
        var as_=s.awayScore!=null?s.awayScore:'';
        var hsi=parseInt(hs),asi=parseInt(as_);
        var homeWin=(!isNaN(hsi)&&!isNaN(asi)&&hsi!==asi&&hsi>asi);
        var awayWin=(!isNaN(hsi)&&!isNaN(asi)&&hsi!==asi&&asi>hsi);
        var dateStr=g.date?new Date(g.date+'T12:00:00').toLocaleDateString('en-US',{month:'numeric',day:'numeric'}):'TBD';
        var hSide=g.neutral?'N':'H',aSide=g.neutral?'N':'A';
        html+='<div data-gid="'+g.id+'" style="display:flex;align-items:center;gap:0.4rem;padding:0.3rem 0.55rem;margin-bottom:0.18rem;border-radius:var(--radius);background:'+(g.completed?'var(--bg2)':'var(--bg3)')+';border:1px solid '+(g.completed?'var(--border)':'var(--border-md)')+'">'
          +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:36px;text-align:center">'+dateStr+'</div>'
          +'<div class="pk-hn" style="flex:1;font-size:0.77rem;font-weight:'+(homeWin?'600':'400')+';color:'+(homeWin?'var(--accent)':'var(--text)')+'">'+g.homeTeam+' <span style="font-size:0.55rem;color:var(--text-dim)">'+hSide+'</span></div>'
          +'<input type="number" min="0" max="99" value="'+hs+'" placeholder="–"'+(g.completed?' disabled':'')+' onchange="pkScore(\''+g.id+'\',\'home\',this.value)" style="width:40px;text-align:center;font-family:var(--font-mono);font-size:0.82rem;background:'+(g.completed?'transparent':'var(--bg2)')+';border:'+(g.completed?'none':'1px solid var(--border-md)')+';color:var(--text);border-radius:var(--radius);padding:0.22rem;-moz-appearance:textfield;-webkit-appearance:none">'
          +'<span style="color:var(--text-dim);font-size:0.78rem">–</span>'
          +'<input type="number" min="0" max="99" value="'+as_+'" placeholder="–"'+(g.completed?' disabled':'')+' onchange="pkScore(\''+g.id+'\',\'away\',this.value)" style="width:40px;text-align:center;font-family:var(--font-mono);font-size:0.82rem;background:'+(g.completed?'transparent':'var(--bg2)')+';border:'+(g.completed?'none':'1px solid var(--border-md)')+';color:var(--text);border-radius:var(--radius);padding:0.22rem;-moz-appearance:textfield;-webkit-appearance:none">'
          +'<div class="pk-an" style="flex:1;text-align:right;font-size:0.77rem;font-weight:'+(awayWin?'600':'400')+';color:'+(awayWin?'var(--accent)':'var(--text)')+'"><span style="font-size:0.55rem;color:var(--text-dim)">'+aSide+'</span> '+g.awayTeam+'</div>'
          +(g.completed?'<span style="font-size:0.55rem;color:var(--text-dim);min-width:32px;text-align:right">FINAL</span>':'')
          +'</div>';
      });
    });
    html+='<div style="margin-top:1rem;display:flex;justify-content:flex-end"><button onclick="pkTab(\'conf\')" style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);padding:0.4rem 1.1rem;font-family:var(--font-mono);font-size:0.73rem;font-weight:600;cursor:pointer">Next: Conf Championships →</button></div>';
    el.innerHTML=html;
  }

  window.pkScore=function(id,side,val){
    if(!_pk.scores[id])_pk.scores[id]={homeScore:'',awayScore:''};
    var n=(val===''||val==null)?'':parseInt(val);
    if(side==='home')_pk.scores[id].homeScore=n;else _pk.scores[id].awayScore=n;
    var row=document.querySelector('[data-gid="'+id+'"]');
    if(row){
      var s=_pk.scores[id];var hs=parseInt(s.homeScore),as_=parseInt(s.awayScore);
      var hn=row.querySelector('.pk-hn'),an=row.querySelector('.pk-an');
      if(hn&&an&&!isNaN(hs)&&!isNaN(as_)&&hs!==as_){
        hn.style.fontWeight=hs>as_?'600':'400';hn.style.color=hs>as_?'var(--accent)':'var(--text)';
        an.style.fontWeight=as_>hs?'600':'400';an.style.color=as_>hs?'var(--accent)':'var(--text)';
      }
    }
    var picked=Object.keys(_pk.scores).filter(function(i2){var s2=_pk.scores[i2];return s2.homeScore!==''&&s2.homeScore!=null&&s2.awayScore!==''&&s2.awayScore!=null;}).length;
    var el=document.getElementById('pk-count');
    if(el)el.textContent=_pk.schedule.length+' games · '+picked+' predicted';
  };

  window.pkAutoPredict=async function(){
    var selEl=document.getElementById('pk-elo-yr');
    var eloYr=parseInt(selEl&&selEl.value)||currentSeason;
    var btn=document.querySelector('[onclick="pkAutoPredict()"]');
    if(btn){btn.textContent='Loading…';btn.disabled=true;}
    if(!allSeasonData[eloYr]){try{var raw=await fetchCSV(CFG.dataPath+eloYr+'.csv');if(raw)allSeasonData[eloYr]=raw.map(coerceRow);}catch(e){}}
    var eloMap={};
    (allSeasonData[eloYr]||[]).forEach(function(r){if(r.team&&r.elo)eloMap[r.team]=parseFloat(r.elo);});
    if(!Object.keys(eloMap).length){if(btn){btn.textContent='Fill all games →';btn.disabled=false;}return;}
    function getElo(team){var t=pkResolve(team);return eloMap[t]||eloMap[team]||1500;}

    var POOLS=[
      [30,  [21,24,27,28,31,34,35],      [17,20,21,24,27,28,31]],
      [80,  [24,27,28,31,34,35,38,41],   [14,17,20,21,24,27,28]],
      [150, [28,31,34,35,38,41,42,45],   [10,13,14,17,20,21,24]],
      [250, [35,38,41,42,45,48,49,52],   [7,10,13,14,17,20,21]],
      [9999,[42,45,48,49,52,55,56,59],   [0,3,7,10,13,14,17]]
    ];
    function pick(pool){return pool[Math.floor(Math.random()*pool.length)];}
    var filled=0;
    _pk.schedule.forEach(function(g){
      if(g.completed) return;
      if(!g.homeTeam||!g.awayTeam||g.homeTeam==='TBD'||g.awayTeam==='TBD') return;
      var eH=getElo(g.homeTeam)+(g.neutral?0:45),eA=getElo(g.awayTeam);
      var absDiff=Math.abs(eH-eA);var favHome=(eH>=eA);
      var pool=POOLS[POOLS.length-1];
      for(var pi=0;pi<POOLS.length;pi++){if(absDiff<=POOLS[pi][0]){pool=POOLS[pi];break;}}
      var wS=pick(pool[1]),lS=pick(pool[2]);
      var att=0;while(wS<=lS&&att<8){wS=pick(pool[1]);lS=pick(pool[2]);att++;}
      if(wS<=lS)lS=Math.max(0,wS-7);
      var upsetChance=absDiff<50?0.30:absDiff<150?0.15:absDiff<300?0.06:0.02;
      var favWins=Math.random()>upsetChance;
      var hs,as_;
      if(!favWins){
        var uP=POOLS[0];var uW=pick(uP[1]),uL=pick(uP[2]);
        var ua=0;while(uW<=uL&&ua<8){uW=pick(uP[1]);uL=pick(uP[2]);ua++;}
        if(uW<=uL)uL=Math.max(0,uW-3);
        if(favHome){hs=uL;as_=uW;}else{hs=uW;as_=uL;}
      }else{
        if(favHome){hs=wS;as_=lS;}else{hs=lS;as_=wS;}
      }
      _pk.scores[g.id]={homeScore:hs,awayScore:as_};filled++;
    });
    pkBuild();pkDrawReg();
    if(btn){btn.textContent='Fill all games →';btn.disabled=false;}
  };


  // Teams ineligible for conf championship games (FCS transition etc.)
  var CONF_CHAMP_INELIGIBLE = {"North Dakota State": true};

  function pkConfLeaders(conf){
    var teams=(PK_CONFS[conf]||[]).map(pkTeam)
      .filter(function(t){ return !CONF_CHAMP_INELIGIBLE[t.team]; });
    var divDef=PK_DIVS[conf];
    if(divDef){
      return Object.keys(divDef).map(function(div){
        var divTeams = teams.filter(function(t){return divDef[div].indexOf(t.team)!==-1;});
        return pkSort(divTeams)[0];
      }).filter(Boolean);
    }else{return pkSort(teams).slice(0,2);}
  }

  function pkDrawConf(){
    var el=document.getElementById('pk-conf');if(!el) return;
    pkBuild();
    var html='<div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);margin-bottom:1rem;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:0.75rem 1rem;line-height:1.6">'
      +'Standings from your picks. <b style="color:var(--text)">Sun Belt &amp; MAC</b> use East/West division leaders. All other conferences use top-2 by conf W% (tiebreaker: overall W% → Elo). Enter the championship score to lock in the conf champion.'
      +'</div>'
      +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:1rem;margin-bottom:1.2rem">';

    window._pkCGMap={};
    Object.keys(PK_CONFS).forEach(function(conf){
      if(conf==='Independent') return;
      var teams=(PK_CONFS[conf]||[]).map(pkTeam);
      var divDef=PK_DIVS[conf];
      var leaders=pkConfLeaders(conf);
      var homeT=(leaders[0]&&leaders[0].team)||'';
      var awayT=(leaders[1]&&leaders[1].team)||'';
      var confKey=conf.replace(/[^a-zA-Z0-9]/g,'_');
      window._pkCGMap[confKey]={conf:conf,homeT:homeT,awayT:awayT};

      var existing=null;
      for(var i=0;i<_pk.confGames.length;i++){if(_pk.confGames[i].conf===conf){existing=_pk.confGames[i];break;}}
      if(existing){existing.homeTeam=homeT;existing.awayTeam=awayT;}
      var hs=(existing&&existing.homeScore!=null)?existing.homeScore:'';
      var as_=(existing&&existing.awayScore!=null)?existing.awayScore:'';
      var champ=(existing&&existing.champ)||'';

      html+='<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:0.85rem">';
      html+='<div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-dim);margin-bottom:0.5rem">'+conf+'<span style="color:var(--text-dim);font-weight:400;text-transform:none;letter-spacing:0">'+(divDef?' · East/West divisions':' · no divisions')+'</span></div>';

      if(divDef){
        html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.6rem">';
        Object.keys(divDef).forEach(function(div){
          var dt=divDef[div];
          var divObjs=pkSort(teams.filter(function(t){return dt.indexOf(t.team)!==-1;}));
          html+='<div><div style="font-size:0.58rem;color:var(--text-dim);font-family:var(--font-mono);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.2rem">'+div+'</div>';
          for(var i=0;i<Math.min(divObjs.length,6);i++){
            var t=divObjs[i];var c=i===0?'var(--text)':'var(--text-muted)';
            html+='<div style="display:flex;gap:0.25rem;padding:0.1rem 0;font-size:0.7rem;color:'+c+'">'
              +'<span style="flex:1;font-weight:'+(i===0?'600':'400')+'">'+t.team+'</span>'
              +'<span style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim)">'+t.cw+'-'+t.cl+'</span>'
              +'<span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);margin-left:0.2rem">('+t.w+'-'+t.l+')</span>'
              +'</div>';
          }
          html+='</div>';
        });
        html+='</div>';
      }else{
        var sorted=pkSort(teams);
        html+='<div style="margin-bottom:0.6rem">';
        for(var i=0;i<Math.min(sorted.length,8);i++){
          var t=sorted[i];var c=i<2?'var(--text)':'var(--text-muted)';
          html+='<div style="display:flex;gap:0.3rem;padding:0.1rem 0;font-size:0.72rem;color:'+c+'">'
            +'<span style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim);min-width:14px;text-align:right">'+(i+1)+'</span>'
            +'<span style="flex:1;font-weight:'+(i<2?'600':'400')+'">'+t.team+'</span>'
            +'<span style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim)">'+t.cw+'-'+t.cl+'</span>'
            +'<span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);margin-left:0.2rem">('+t.w+'-'+t.l+')</span>'
            +'</div>';
        }
        if(sorted.length>8)html+='<div style="font-size:0.6rem;color:var(--text-dim);font-family:var(--font-mono);margin-top:0.1rem">+'+(sorted.length-8)+' more</div>';
        html+='</div>';
      }

      var champLabel=champ?('Championship · <b style="color:var(--accent)">'+champ+' wins</b>'):(homeT&&awayT?'Championship · '+homeT+' vs '+awayT:'Championship · TBD');
      html+='<div style="border-top:1px solid var(--border);padding-top:0.55rem">'
        +'<div id="pkcl-'+confKey+'" style="font-family:var(--font-mono);font-size:0.58rem;color:var(--text-dim);margin-bottom:0.35rem">'+champLabel+'</div>'
        +'<div style="display:flex;align-items:center;gap:0.3rem;flex-wrap:wrap">'
        +'<span style="flex:1;font-size:0.74rem;font-weight:600;min-width:90px">'+(homeT||'TBD')+'</span>'
        +'<input type="number" min="0" max="99" value="'+hs+'" placeholder="—" data-conf-key="'+confKey+'" data-side="home" onchange="pkCG(this)" style="width:40px;text-align:center;font-family:var(--font-mono);font-size:0.8rem;background:var(--bg3);border:1px solid var(--border-md);color:var(--text);border-radius:var(--radius);padding:0.25rem">'
        +'<span style="color:var(--text-dim)">–</span>'
        +'<input type="number" min="0" max="99" value="'+as_+'" placeholder="—" data-conf-key="'+confKey+'" data-side="away" onchange="pkCG(this)" style="width:40px;text-align:center;font-family:var(--font-mono);font-size:0.8rem;background:var(--bg3);border:1px solid var(--border-md);color:var(--text);border-radius:var(--radius);padding:0.25rem">'
        +'<span style="flex:1;text-align:right;font-size:0.74rem;font-weight:600;min-width:90px">'+(awayT||'TBD')+'</span>'
        +'</div></div></div>';
    });
    html+='</div><div style="display:flex;justify-content:flex-end"><button onclick="pkTab(\'cfp\')" style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);padding:0.4rem 1.1rem;font-family:var(--font-mono);font-size:0.73rem;font-weight:600;cursor:pointer">Generate CFP Bracket + Top 25 →</button></div>';
    el.innerHTML=html;
  }

  window.pkCG=function(input){
    var confKey=input.getAttribute('data-conf-key');
    var side=input.getAttribute('data-side');
    var map=(window._pkCGMap&&window._pkCGMap[confKey])||{};
    var conf=map.conf||confKey,homeT=map.homeT||'',awayT=map.awayT||'';
    var e=null;
    for(var i=0;i<_pk.confGames.length;i++){if(_pk.confGames[i].conf===conf){e=_pk.confGames[i];break;}}
    if(!e){e={conf:conf,homeTeam:homeT,awayTeam:awayT,homeScore:null,awayScore:null,champ:''};_pk.confGames.push(e);}
    e.homeTeam=homeT;e.awayTeam=awayT;
    var n=parseInt(input.value);
    if(side==='home')e.homeScore=isNaN(n)?null:n;else e.awayScore=isNaN(n)?null:n;
    if(e.homeScore!=null&&e.awayScore!=null&&e.homeScore!==e.awayScore){
      e.champ=e.homeScore>e.awayScore?e.homeTeam:e.awayTeam;
      _pk.confChamps[conf]=e.champ;pkBuild();
    }else{e.champ='';delete _pk.confChamps[conf];}
    var lbl=document.getElementById('pkcl-'+confKey);
    if(lbl)lbl.innerHTML=e.champ?('Championship · <b style="color:var(--accent)">'+e.champ+' wins</b>'):'Championship · '+homeT+' vs '+awayT;
  };

  // ── CFP BRACKET — 2025-26 RULES ──────────────────────────
  // Rule: 5 highest-ranked conf champs get automatic bids
  //       7 at-large bids fill remaining spots
  //       Seeds 1-4 = four HIGHEST-RANKED teams overall (get bye) — NOT necessarily conf champs
  //       Seeds 5-12 play first round (5v12, 6v11, 7v10, 8v9 at higher seed's campus)
  //       If a conf champ ranked outside top 12 → bumped up to seed 12, 11, etc.
  //       Independent teams (Notre Dame) can only receive at-large bids
  function pkDrawCFP(){
    var el=document.getElementById('pk-cfp');if(!el) return;
    pkBuild();

    // Step 1: determine each conf's champion
    var confChampions={};
    // Teams ineligible for CFP due to FCS transition rules
    var CFP_INELIGIBLE = {"North Dakota State": true}; // 2026-27: ineligible until 2028

    CFP_AUTO_CONF.forEach(function(conf){
      var picked=_pk.confChamps[conf];
      if(picked){
        if(CFP_INELIGIBLE[picked]) return; // skip ineligible teams
        confChampions[conf]={team:picked,elo:_pk.eloSim[picked]||1500,conf:conf,
          w:_pk.wins[picked]||0,l:_pk.losses[picked]||0,
          cw:_pk.confWins[picked]||0,cl:_pk.confLoss[picked]||0};
      }else{
        var leaders=pkConfLeaders(conf);
        // Skip ineligible teams for conf championship auto-bid
        var leader=null;
        for(var li=0;li<leaders.length;li++){
          if(!CFP_INELIGIBLE[leaders[li].team]){leader=leaders[li];break;}
        }
        if(leader)confChampions[conf]={team:leader.team,elo:leader.elo,conf:conf,
          w:leader.w,l:leader.l,cw:leader.cw,cl:leader.cl};
      }
    });

    // Step 2: rank ALL FBS teams by PLAYOFF RATING (Elo + resume)
    var allTeamSet={};
    Object.values(PK_CONFS).forEach(function(arr){arr.forEach(function(t){allTeamSet[t]=1;});});
    Object.keys(_pk.eloBase).forEach(function(t){allTeamSet[t]=1;});
    var allRanked=Object.keys(allTeamSet).map(function(t){
      var elo=_pk.eloSim[t]||_pk.eloBase[t]||0;
      return {team:t,elo:elo,
              pr:_pk.playoffRating[t]||elo, // playoff rating
              conf:pkConfOf(t)||'—',w:_pk.wins[t]||0,l:_pk.losses[t]||0,
              cw:_pk.confWins[t]||0,cl:_pk.confLoss[t]||0};
    }).filter(function(t){return t.elo>0;})
    .sort(function(a,b){return b.pr-a.pr;}); // sort by playoff rating

    // Step 3: identify the 5 highest-ranked conf champions
    var champByTeam={};
    Object.values(confChampions).forEach(function(c){champByTeam[c.team]=c;});
    var top5Champs=[],seenConf={};
    for(var ri=0;ri<allRanked.length&&top5Champs.length<5;ri++){
      var t=allRanked[ri];
      if(champByTeam[t.team]&&!seenConf[champByTeam[t.team].conf]){
        top5Champs.push(Object.assign({},t,{conf:champByTeam[t.team].conf}));
        seenConf[champByTeam[t.team].conf]=1;
      }
    }

    // Step 4: build the 12-team field
    // Seeds 1-4: four highest-ranked teams OVERALL (bye) — can be anyone
    // Must include all 5 conf champs; remaining 7 spots = at-large
    var inField={};
    var seeds=[];

    // Pick seeds 1-4: top 4 from allRanked
    for(var i=0;i<allRanked.length&&seeds.length<4;i++){
      if(!inField[allRanked[i].team]){
        seeds.push(Object.assign({},allRanked[i],{seed:seeds.length+1,bye:true,autoB:!!champByTeam[allRanked[i].team]}));
        inField[allRanked[i].team]=1;
      }
    }

    // Collect remaining conf champs not already in field (auto-bids for seeds 5-12)
    var remainingChamps=top5Champs.filter(function(c){return !inField[c.team];});

    // Seeds 5-12: fill from allRanked, ensuring remaining conf champs are included
    var seeds5to12=[];
    var champNeeded=remainingChamps.slice();
    for(var i=0;i<allRanked.length&&seeds5to12.length<8;i++){
      var t=allRanked[i];
      if(inField[t.team]) continue;
      // Remove from champNeeded if this is a conf champ
      champNeeded=champNeeded.filter(function(c){return c.team!==t.team;});
      seeds5to12.push(Object.assign({},t,{autoB:!!champByTeam[t.team]}));
      inField[t.team]=1;
    }
    // If any required conf champs still missing, bump them in (replacing lowest seeds)
    champNeeded.forEach(function(c){
      if(!inField[c.team]){
        // Remove the lowest-ranked non-champ from seeds5to12 and add this champ
        for(var k=seeds5to12.length-1;k>=0;k--){
          if(!seeds5to12[k].autoB){
            seeds5to12.splice(k,1);
            seeds5to12.push(Object.assign({},c,{autoB:true}));
            inField[c.team]=1;
            break;
          }
        }
      }
    });
    // Re-sort seeds 5-12 by Elo
    seeds5to12.sort(function(a,b){return b.elo-a.elo;});
    seeds5to12.forEach(function(t,i){t.seed=i+5;t.bye=false;});
    var allSeeds=seeds.concat(seeds5to12);

    // Step 5: first round matchups (5v12, 6v11, 7v10, 8v9)
    var r1=[[allSeeds[4],allSeeds[11]],[allSeeds[5],allSeeds[10]],[allSeeds[6],allSeeds[9]],[allSeeds[7],allSeeds[8]]];

    // Top 25
    var top25=allRanked.slice(0,25);

    // Champion set for display
    var champSet={};
    Object.values(confChampions).forEach(function(c){champSet[c.team]=c.conf;});

    function rec(t){return t.w+'-'+t.l;}
    function cRec(t){return (t.cw||t.cl)?t.cw+'-'+t.cl:'';}

    // Build Top 25 HTML
    var t25='<div style="margin-bottom:1.4rem">'
      +'<div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin-bottom:0.2rem">Top 25 — Playoff Rankings &nbsp;★ = conf champion</div>'
      +'<div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--text-dim);margin-bottom:0.4rem">'
      +'<span style="color:var(--accent)">PR</span> = Playoff Rating (Elo + &#x221A;(sum of beaten opponents Elo)) &nbsp;&middot;&nbsp; Elo = power ranking'
      +'</div>'
      +'<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden">'
      +'<div style="display:flex;gap:0.35rem;padding:0.2rem 0.6rem;background:var(--bg3);border-bottom:1px solid var(--border)">'
      +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:22px;text-align:right">#</div>'
      +'<div style="flex:1;font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim)">Team</div>'
      +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:36px;text-align:right">W-L</div>'
      +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:32px;text-align:right">Conf</div>'
      +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:42px;text-align:right" title="Playoff Rating = Elo + √(sum of beaten opponents Elo)">PR</div>'
      +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:38px;text-align:right">Elo</div>'
      +'</div>';
    top25.forEach(function(t,i){
      var star=champSet[t.team]?('<span style="font-size:0.5rem;color:var(--accent);font-family:var(--font-mono);margin-left:0.2rem">★'+champSet[t.team]+'</span>'):'';
      var prVal=t.pr||t.elo;
      t25+='<div style="display:flex;align-items:center;gap:0.35rem;padding:0.22rem 0.6rem;border-bottom:1px solid var(--border)">'
        +'<div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim);min-width:22px;text-align:right">'+(i+1)+'</div>'
        +'<div style="flex:1;font-size:0.75rem;font-weight:'+(champSet[t.team]?'600':'400')+'">'+t.team+star+'</div>'
        +'<div style="font-family:var(--font-mono);font-size:0.63rem;color:var(--text-muted);min-width:36px;text-align:right">'+rec(t)+'</div>'
        +'<div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);min-width:32px;text-align:right">'+cRec(t)+'</div>'
        +'<div style="font-family:var(--font-mono);font-size:0.63rem;color:var(--accent);min-width:42px;text-align:right" title="Playoff Rating">'+prVal.toFixed(0)+'</div>'
        +'<div style="font-family:var(--font-mono);font-size:0.63rem;color:var(--text-dim);min-width:38px;text-align:right">'+t.elo.toFixed(0)+'</div>'
        +'</div>';
    });
    t25+='</div></div>';

    // Build CFP field HTML
    var fieldHtml='<div>'
      +'<div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin-bottom:0.4rem">CFP Field — 12 Teams</div>'
      +'<div style="font-size:0.6rem;color:var(--text-dim);font-family:var(--font-mono);margin-bottom:0.55rem;line-height:1.6">'
      +'Seeds 1–4: highest playoff-rated teams overall (bye) · Seeds 5–12: ranked order, 5 conf champs guaranteed<br>'
      +'★ = conf auto-bid · BYE = first-round bye · W-L · Conf W-L · PR = Playoff Rating'
      +'</div>';
    allSeeds.forEach(function(s){
      var bg=s.bye?'rgba(226,201,126,0.09)':'var(--bg3)';
      var bdr=s.bye?'var(--accent)':'var(--border)';
      var byeSpan=s.bye?'<span style="font-size:0.5rem;color:var(--accent);font-family:var(--font-mono);margin-left:0.2rem">BYE</span>':'';
      var starSpan=champSet[s.team]?('<span style="font-size:0.5rem;color:var(--text-dim);font-family:var(--font-mono);margin-left:0.15rem">'+champSet[s.team]+'★</span>'):'';
      fieldHtml+='<div style="display:flex;align-items:center;gap:0.35rem;padding:0.26rem 0.5rem;margin-bottom:0.18rem;border-radius:var(--radius);background:'+bg+';border:1px solid '+bdr+'">'
        +'<div style="font-family:var(--font-mono);font-size:0.64rem;color:var(--text-dim);min-width:16px;text-align:right">'+s.seed+'</div>'
        +'<div style="flex:1;font-size:0.75rem;font-weight:500">'+s.team+byeSpan+starSpan+'</div>'
        +'<div style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-muted);min-width:32px;text-align:right">'+rec(s)+'</div>'
        +'<div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--text-dim);min-width:26px;text-align:right">'+cRec(s)+'</div>'
        +'<div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim)">'+s.elo.toFixed(0)+'</div>'
        +'</div>';
    });
    fieldHtml+='</div>';

    // Build bracket HTML
    var bracketHtml='<div>'
      +'<div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin-bottom:0.42rem">First Round — on campus of higher seed</div>';
    r1.forEach(function(pair){
      var hi=pair[0],lo=pair[1];
      bracketHtml+='<div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.28rem;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:0.32rem 0.6rem">'
        +'<span style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim)">#'+hi.seed+'</span>'
        +'<span style="flex:1;font-size:0.75rem;font-weight:600">'+hi.team+'</span>'
        +'<span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-muted)">'+rec(hi)+'</span>'
        +'<span style="font-size:0.62rem;color:var(--text-dim);font-family:var(--font-mono);margin:0 0.2rem">vs</span>'
        +'<span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-muted)">'+rec(lo)+'</span>'
        +'<span style="flex:1;font-size:0.75rem;text-align:right">'+lo.team+'</span>'
        +'<span style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim)">#'+lo.seed+'</span>'
        +'<span style="font-size:0.55rem;color:var(--text-dim);font-family:var(--font-mono);margin-left:0.25rem">@ #'+hi.seed+'</span>'
        +'</div>';
    });
    bracketHtml+='<div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin:0.8rem 0 0.4rem">Quarterfinals (top seeds host)</div>'
      +'<div style="font-size:0.7rem;color:var(--text-muted);font-family:var(--font-mono);line-height:1.9;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:0.55rem 0.7rem">';
    allSeeds.slice(0,4).forEach(function(s){
      bracketHtml+='#'+s.seed+' '+s.team+' ('+rec(s)+') hosts lowest remaining seed<br>';
    });
    bracketHtml+='</div>'
      +'<div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin:0.8rem 0 0.4rem">Semifinals &amp; Championship</div>'
      +'<div style="font-size:0.7rem;color:var(--text-muted);font-family:var(--font-mono);line-height:1.9;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:0.55rem 0.7rem">'
      +'Semifinal 1 — Rose Bowl (Pasadena, CA)<br>'
      +'Semifinal 2 — Sugar Bowl (New Orleans, LA)<br>'
      +'National Championship — Hard Rock Stadium (Miami, FL)'
      +'</div></div>';

    el.innerHTML=t25
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem;margin-bottom:1rem">'+fieldHtml+bracketHtml+'</div>'
      +'<div style="display:flex;gap:0.6rem">'
      +'<button onclick="pkTab(\'conf\')" style="background:var(--bg3);color:var(--text-muted);border:1px solid var(--border);border-radius:var(--radius);padding:0.32rem 0.75rem;font-family:var(--font-mono);font-size:0.67rem;cursor:pointer">← Conf Championships</button>'
      +'<button onclick="pkTab(\'reg\')" style="background:var(--bg3);color:var(--text-muted);border:1px solid var(--border);border-radius:var(--radius);padding:0.32rem 0.75rem;font-family:var(--font-mono);font-size:0.67rem;cursor:pointer">← Regular Season</button>'
      +'</div>';
  }



    async function checkForNewerSeasons() {
    const newest = CFG.seasons[0];
    const added  = [];
    for (let yr = newest + 2; yr >= newest + 1; yr--) {
      try {
        const r = await fetch(CFG.dataPath + yr + '.csv?t=' + Date.now(), {method:'HEAD'});
        if (r.ok) added.push(yr);
      } catch(_) {}
    }
    if (!added.length) return;
    for (const yr of added.sort((a,b) => b - a)) {
      if (!CFG.seasons.includes(yr)) CFG.seasons.unshift(yr);
    }
    // Rebuild picker with new season buttons at the front
    const picker = document.getElementById('seasonPicker');
    if (picker) {
      picker.innerHTML = '';
      CFG.seasons.forEach(yr => {
        const b = document.createElement('button');
        b.className = 'season-btn';
        b.textContent = yr;
        b.onclick = () => loadSeason(yr);
        picker.appendChild(b);
      });
    }
  }

  // ── Init ──────────────────────────────────────────────────
  // Build initial picker from hardcoded seasons, then load best season
  const picker = document.getElementById('seasonPicker');
  if (picker) {
    CFG.seasons.forEach(yr => {
      const b = document.createElement('button');
      b.className = 'season-btn';
      b.textContent = yr;
      b.onclick = () => loadSeason(yr);
      picker.appendChild(b);
    });
  }

  findAvailableSeason().then(yr => {
    document.querySelectorAll('.season-btn').forEach(b =>
      b.classList.toggle('active', parseInt(b.textContent) === yr));
    loadSeason(yr);
    const firstTab = document.querySelector('.tab');
    if (firstTab) firstTab.click();
  });

  // Persist season choice
  document.getElementById('seasonPicker')?.addEventListener('click', e => {
    if (e.target.classList.contains('season-btn'))
      localStorage.setItem('elo_season_' + CFG.sport, e.target.textContent);
  });
};
