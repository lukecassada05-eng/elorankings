'use strict';

window.initSportPage = function(CFG) {
  // Auto-add the current (and next, if it's about to start) season to
  // whatever's hardcoded in the page, so a new season shows up in the
  // picker the moment the backend has data for it — no manual HTML edit
  // needed when a season rolls over.
  if (window.EloSeason) CFG.seasons = window.EloSeason.withCurrent(CFG.seasons, CFG.sport);

  let data = [], allSeasonData = {}, currentSeason = (CFG.seasons && CFG.seasons[0]) || new Date().getFullYear();

  // User-adjustable Biggest Movers filters (conference/division, min games
  // played, and how many risers/fallers to show). '' for minGames means
  // "use the automatic buy-game-opponent guard" (see getMovers below) —
  // once the user picks an explicit value we respect it exactly, even 0.
  let moversFilter = { conf: '', minGames: '', count: 5 };

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
      if (tab.dataset.tab === 'tourney')       { if(CFG.sport==='CBASE') renderCBaseTourney(); else renderTourney(); }
      if (tab.dataset.tab === 'resume')       renderResume();
      if (tab.dataset.tab === 'history')      renderHistory();
      if (tab.dataset.tab === 'tracker')      renderSeasonTracker();
      if (tab.dataset.tab === 'greatest')    renderGreatestTeams();
      if (tab.dataset.tab === 'pickem')      { if(CFG.sport==='CBB') renderPickemCBB(); else renderPickem(); }
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
        NHL:   { path:'hockey/nhl',                             nf:'displayName',      hca:30,  scale:200, unit:'goals' },
        CFB:   { path:'football/college-football',              nf:'shortDisplayName', hca:55,  scale:28,  unit:'pts',  extra:'&groups=80', spreadCap:35 },
        CBB:   { path:'basketball/mens-college-basketball',     nf:'shortDisplayName', hca:90,  scale:12,  unit:'pts',  extra:'&groups=50' },
        CBASE: { path:'baseball/college-baseball',              nf:'shortDisplayName', hca:25,  scale:160, unit:'runs' },
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
        '1. FC Heidenheim 1846':'Heidenheim',
        '1. FC Koln':'FC Koln',
        '1. FC Union Berlin':'Union Berlin',
        '1. FSV Mainz 05':'Mainz',
        'AC Milan':'Milan',
        'AC Monza':'Monza',
        'ACF Fiorentina':'Fiorentina',
        'ADO Den Haag':'Den Haag',
        'AFC Ajax':'Ajax',
        'AFC Bournemouth':'Bournemouth',
        'AJ Auxerre':'Auxerre',
        'AS Monaco':'Monaco',
        'AS Monaco FC':'Monaco',
        'AS Roma':'Roma',
        'AS Saint-Étienne':'St Etienne',
        'AVS Futebol':'AVS',
        'AZ Alkmaar':'AZ Alkmaar',
        'Aberdeen FC':'Aberdeen',
        'Académico de Viseu':'Academico Viseu',
        'Ajax Amsterdam':'Ajax',
        'Alanyaspor':'Alanyaspor',
        'Alavés':'Alaves',
        'Almere City FC':'Almere City',
        'Amed SFK':'Amedspor',
        'Angers SCO':'Angers',
        'Antalyaspor':'Antalyaspor',
        'Arsenal FC':'Arsenal',
        'Atalanta BC':'Atalanta',
        'Athletic Bilbao':'Ath Bilbao',
        'Athletic Club':'Ath Bilbao',
        'Athletic Club de Bilbao':'Ath Bilbao',
        'Atletico Madrid':'Ath Madrid',
        'Atletico de Madrid':'Ath Madrid',
        'Atlético Madrid':'Ath Madrid',
        'Atlético de Madrid':'Ath Madrid',
        'Basaksehir FK':'Basaksehir',
        'Bayer 04 Leverkusen':'Leverkusen',
        'Bayer Leverkusen':'Leverkusen',
        'Bayern Munich':'Bayern Munich',
        'Beerschot VA':'Beerschot',
        'Besiktas JK':'Besiktas',
        'Blackburn Rovers':'Blackburn',
        'Boavista FC':'Boavista',
        'Bodrum FK':'Bodrum',
        'Bologna FC 1909':'Bologna',
        'Borussia Dortmund':'Dortmund',
        'Braga':'Sp Braga',
        "Borussia M\u00f6nchengladbach":"M'gladbach",
        "Nott'm Forest":"Nott'm Forest",
        'Borussia Monchengladbach':'M\'gladbach',
        'Borussia Mönchengladbach':'M\'gladbach',
        'Brighton & Hove Albion':'Brighton',
        'Burnley':'Burnley',
        'C.D. Nacional':'Nacional',
        'CA Osasuna':'Osasuna',
        'CD Leganes':'Leganes',
        'CD Santa Clara':'Santa Clara',
        'Cagliari Calcio':'Cagliari',
        'Casa Pia AC':'Casa Pia',
        'Caykur Rizespor':'Rizespor',
        'Celta Vigo':'Celta',
        'Celtic FC':'Celtic',
        'Cercle Brugge KSV':'Cercle Brugge',
        'Clermont Foot 63':'Clermont',
        'Club Atletico de Madrid':'Ath Madrid',
        'Club Brugge KV':'Club Brugge',
        'Como 1907':'Como',
        'Coventry City':'Coventry',
        'Cádiz CF':'Cadiz',
        'Deportivo Alaves':'Alaves',
        'Deportivo Alavés':'Alaves',
        'Dundee FC':'Dundee',
        'Dundee United FC':'Dundee United',
        'Eintracht Frankfurt':'Ein Frankfurt',
        'Empoli FC':'Empoli',
        'Erzurum BB':'Erzurumspor',
        'Espanyol':'Espanol',
        'Estoril Praia':'Estoril',
        'Eyupspor':'Eyupspor',
        'FC Augsburg':'Augsburg',
        'FC Barcelona':'Barcelona',
        'FC Bayern München':'Bayern Munich',
        'FC Cologne':'FC Koln',
        'FC Famalicao':'Famalicao',
        'FC Groningen':'Groningen',
        'FC Heidenheim':'Heidenheim',
        'FC Internazionale Milano':'Inter',
        'FC Lorient':'Lorient',
        'FC Metz':'Metz',
        'FC Nantes':'Nantes',
        'FC Porto':'Porto',
        'FC Schalke 04':'Schalke',
        'FC St. Pauli':'St Pauli',
        'FC St. Pauli 1910':'St Pauli',
        'FC Twente':'Twente',
        'FC Union Berlin':'Union Berlin',
        'FC Utrecht':'Utrecht',
        'FC Vizela':'Vizela',
        'FC Volendam':'Volendam',
        'FCV Dender EH':'Dender',
        'Fenerbahce SK':'Fenerbahce',
        'Feyenoord Rotterdam':'Feyenoord',
        'Fortuna Sittard':'For Sittard',
        'Frosinone Calcio':'Frosinone',
        'GFC Ajaccio':'Ajaccio',
        'Galatasaray SK':'Galatasaray',
        'Gaziantep FK':'Gaziantep',
        'Genoa CFC':'Genoa',
        'Getafe CF':'Getafe',
        'Gil Vicente FC':'Gil Vicente',
        'Girona FC':'Girona',
        'Go Ahead Eagles':'Go Ahead Eagles',
        'Granada CF':'Granada',
        'Hamburg SV':'Hamburg',
        'Hamburger SV':'Hamburg',
        'Hatayspor':'Hatayspor',
        'Havre AC':'Le Havre',
        'Heart of Midlothian':'Hearts',
        'Heart of Midlothian FC':'Hearts',
        'Hellas Verona':'Verona',
        'Hellas Verona FC':'Verona',
        'Hibernian FC':'Hibernian',
        'Holstein Kiel':'Holstein Kiel',
        'Hull City':'Hull',
        'Inter Milan':'Inter',
        'Internazionale':'Inter',
        'Inverness CT':'Inverness',
        'Ipswich Town':'Ipswich',
        'Istanbul Basaksehir':'Basaksehir',
        'Juventus FC':'Juventus',
        'K Sint-Truidense VV':'St Truiden',
        'KAA Gent':'Gent',
        'KRC Genk':'Genk',
        'KV Kortrijk':'Kortrijk',
        'KV Mechelen':'Mechelen',
        'KVC Westerlo':'Westerlo',
        'Kasimpasa SK':'Kasimpasa',
        'Kayserispor':'Kayserispor',
        'Kilmarnock FC':'Kilmarnock',
        'Konyaspor':'Konyaspor',
        'Le Havre AC':'Le Havre',
        'Leeds United':'Leeds',
        'Leganes':'Leganes',
        'Leicester City':'Leicester',
        'Livingston FC':'Livingston',
        'Luton Town':'Luton',
        'MKE Ankaragucu':'Ankaragucu',
        'Mainz 05':'Mainz',
        'Manchester City':'Man City',
        'Manchester United':'Man United',
        'Montpellier HSC':'Montpellier',
        'Moreirense FC':'Moreirense',
        'Motherwell FC':'Motherwell',
        'NEC Nijmegen':'Nijmegen',
        'Newcastle United':'Newcastle',
        'Norwich City':'Norwich',
        'Nottingham Forest':'Nott\'m Forest',
        'OGC Nice':'Nice',
        'OH Leuven':'Oud-Heverlee Leuven',
        'Oakland Athletics':'Athletics',
        'Olympique Lyonnais':'Lyon',
        'Olympique de Marseille':'Marseille',
        'Oud-Heverlee Leuven':'Oud-Heverlee Leuven',
        'PEC Zwolle':'Zwolle',
        'PSG':'Paris SG',
        'PSV Eindhoven':'PSV Eindhoven',
        'Paris Saint-Germain':'Paris SG',
        'Paris Saint-Germain FC':'Paris SG',
        'Parma Calcio 1913':'Parma',
        'Queens Park Rangers':'QPR',
        'R. Antwerp FC':'Antwerp',
        'RB Leipzig':'RB Leipzig',
        'RC Celta de Vigo':'Celta',
        'RC Lens':'Lens',
        'RC Strasbourg Alsace':'Strasbourg',
        'RCD Espanyol':'Espanol',
        'RCD Mallorca':'Mallorca',
        'RAAL La Louvière':'RAAL La Louviere',
        'RKC Waalwijk':'RKC',
        'RSC Anderlecht':'Anderlecht',
        'Racing Genk':'Genk',
        'Rangers FC':'Rangers',
        'Rayo Vallecano':'Vallecano',
        'Rayo Vallecano de Madrid':'Vallecano',
        'Real Betis':'Betis',
        'Real Betis Balompié':'Betis',
        'Real Madrid':'Real Madrid',
        'Real Madrid CF':'Real Madrid',
        'Real Oviedo':'Oviedo',
        'Real Sociedad de Fútbol':'Sociedad',
        'Real Sociedad':'Sociedad',
        'Real Valladolid':'Valladolid',
        'Real Valladolid CF':'Valladolid',
        'Real Zaragoza':'Zaragoza',
        'Rio Ave FC':'Rio Ave',
        'Rizespor':'Rizespor',
        'Ross County FC':'Ross County',
        'Royal Antwerp FC':'Antwerp',
        'Royal Charleroi SC':'Charleroi',
        'Royale Union Saint-Gilloise':'St. Gilloise',
        'SBV Excelsior':'Excelsior',
        'SBV Vitesse':'Vitesse',
        'SC Braga':'Sp Braga',
        'SC Cambuur':'Cambuur',
        'SC Freiburg':'Freiburg',
        'SC Heerenveen':'Heerenveen',
        'SL Benfica':'Benfica',
        'SS Lazio':'Lazio',
        'SSC Napoli':'Napoli',
        'SV Werder Bremen':'Werder Bremen',
        'Sacramento Athletics':'Athletics',
        'Salernitana 1919':'Salernitana',
        'Samsunspor':'Samsunspor',
        'Sevilla FC':'Sevilla',
        'Sheffield United':'Sheffield United',
        'Sint-Truiden VV':'St Truiden',
        'Sint-Truidense':'St Truiden',
        'Sivasspor':'Sivasspor',
        'Sparta Rotterdam':'Sparta Rotterdam',
        'Sporting CP':'Sp Lisbon',
        'Sporting Charleroi':'Charleroi',
        'Sporting Lisbon':'Sp Lisbon',
        'St Mirren':'St Mirren',
        'St. Johnstone FC':'St Johnstone',
        'St. Mirren FC':'St Mirren',
        'Stade Brestois 29':'Brest',
        'Stade Rennais':'Rennes',
        'Stade Rennais FC':'Rennes',
        'Stade de Reims':'Reims',
        'Standard Liege':'Standard',
        'Standard Liège':'Standard',
        'Standard de Liege':'Standard',
        'Stoke City':'Stoke',
        'Sunderland':'Sunderland',
        'Swansea City':'Swansea',
        'TSG 1899 Hoffenheim':'Hoffenheim',
        'TSG Hoffenheim':'Hoffenheim',
        'Torino FC':'Torino',
        'Tottenham Hotspur':'Tottenham',
        'Toulouse FC':'Toulouse',
        'Trabzonspor AS':'Trabzonspor',
        'Troyes AC':'Troyes',
        'UD Almería':'Almeria',
        'UD Las Palmas':'Las Palmas',
        'US Cremonese':'Cremonese',
        'US Lecce':'Lecce',
        'US Sassuolo':'Sassuolo',
        'Udinese Calcio':'Udinese',
        'Union Saint-Gilloise':'St. Gilloise',
        'Union St.-Gilloise':'St. Gilloise',
        'Valencia CF':'Valencia',
        'Venezia FC':'Venezia',
        'VfB Stuttgart':'Stuttgart',
        'VfL Bochum':'Bochum',
        'VfL Bochum 1848':'Bochum',
        'VfL Wolfsburg':'Wolfsburg',
        'Villarreal CF':'Villarreal',
        'Vitesse Arnhem':'Vitesse',
        'Vitoria Guimaraes':'Guimaraes',
        'Vitoria SC':'Guimaraes',
        'Vitória de Guimaraes':'Guimaraes',
        'Waasland-Beveren':'Beveren',
        'Watford':'Watford',
        'West Ham United':'West Ham',
        'Wolverhampton Wanderers':'Wolves',
        'Zulte-Waregem':'Waregem',
      };

      var NOW    = new Date();
      var CUTOFF = new Date(NOW.getTime() + 16*24*60*60*1000); // 16 days covers 15 fetched days

      function inWindow(d) {
        if (!d) return false;
        var dt = new Date(d);
        // Lower bound: yesterday (catches timezone differences)
        // Upper bound: 14 days out
        var yesterday = new Date(NOW.getTime() - 24*60*60*1000);
        return !isNaN(dt) && dt >= yesterday && dt <= CUTOFF;
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

      function fetchESPN(path, extra, noPostseason) {
        var now = new Date();
        var endD = new Date(now.getTime() + 14*24*60*60*1000);
        function fmt(d) {
          return d.getFullYear() +
            String(d.getMonth()+1).padStart(2,'0') +
            String(d.getDate()).padStart(2,'0');
        }
        var dateRange = fmt(now) + '-' + fmt(endD);
        var espnBase = 'https://site.api.espn.com/apis/site/v2/sports/'+path+'/scoreboard';
        var ex = extra || '';
        // Fetch 3 ways to maximize coverage:
        // 1. Date range (regular season + future scheduled games)
        // 2. Default scoreboard (returns current active phase - playoffs if active)
        // 3. Explicit seasontype=3 (postseason - playoffs, conf tournaments)
        var urls = [
          espnBase + '?limit=500&dates=' + dateRange + ex,
          espnBase + '?limit=500' + ex,
        ];
        if (!noPostseason) {
          urls.push(espnBase + '?limit=500&seasontype=3' + ex);
        }
        return Promise.all(urls.map(function(url) {
          return fetch(url, {mode:'cors'})
            .then(function(r){ return r.ok ? r.json() : {events:[]}; })
            .catch(function(){ return {events:[]}; });
        })).then(function(results) {
          var seen = {}, events = [];
          results.forEach(function(d) {
            (d.events||[]).forEach(function(ev) {
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
        fetchESPN(sportCfg.path, sportCfg.extra).then(function(resp) {
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

    updateSummary(data);
    populateSelects();
    renderRankings();

    const activeTab = document.querySelector('.tab.active');
    if (activeTab) {
      const pn = activeTab.dataset.tab;
      if (pn === 'byconf')       renderByConf();
      if (pn === 'predictor')    renderPredictor();
      if (pn === 'bracketology') renderBracketology();
      if (pn === 'tourney') { if(CFG.sport==='CBASE') renderCBaseTourney(); else renderTourney(); }
      if (pn === 'resume')       renderResume();
      if (pn === 'history')      renderHistory();
      if (pn === 'tracker')      renderSeasonTracker();
      if (pn === 'greatest')    renderGreatestTeams();
      if (pn === 'pickem')      { if(CFG.sport==='CBB') renderPickemCBB(); else renderPickem(); }
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

  // ── Elo movement vs. a rolling checkpoint ───────────────────
  // R/elo_engine.R's attach_movers() checkpoints each team's rating and
  // only rolls that checkpoint forward once a week (see elo_change /
  // baseline_date in the CSV) — never on every twice-daily update. So a
  // team's move stays visible here for the rest of that window instead
  // of resetting the moment the next scheduled update runs, and a no-op
  // update (no new games) leaves the number exactly where it was.
  // Falls back to the 1500 season-start baseline for any CSV written
  // before that column existed (self-heals on that CSV's next update).
  function movement(r) {
    if (!r || !r.games_played) return null;
    return r.elo_change != null ? r.elo_change : (r.elo - 1500);
  }

  function movementLabel(r) {
    return r.baseline_date ? ('since ' + fmt.date(r.baseline_date)) : 'since season start';
  }

  function getTrend(team) {
    const curr = data.find(r => r.team === team);
    return curr ? movement(curr) : null;
  }

  function trendHtml(team) {
    const curr = data.find(r => r.team === team);
    const t = curr ? movement(curr) : null;
    if (t === null) return '<span class="trend-new">—</span>';
    const label = movementLabel(curr);
    if (t > 5)  return `<span class="trend-up" title="${t.toFixed(1)} Elo ${label}">▲ ${t.toFixed(0)}</span>`;
    if (t < -5) return `<span class="trend-down" title="${t.toFixed(1)} Elo ${label}">▼ ${Math.abs(t).toFixed(0)}</span>`;
    return '<span class="trend-new">—</span>';
  }

  // ── Biggest movers (rolling checkpoint, ~weekly — never "since last season") ──
  // CBB/CFB/CBASE schedules include "buy game" opponents from lower divisions
  // (D2, NAIA, FCS, etc.) who show up in the data with only a handful of
  // tracked games against D1/FBS teams. With so few games, a single result
  // swings their Elo wildly, so they dominate a raw biggest-movers list even
  // though they're not real, fully-tracked members of the field. Guard against
  // this without hardcoding a division list (which we have no reliable source
  // for) by requiring a team to have played close to a full slate relative to
  // its peers this season — real teams cluster near the max games played;
  // buy-game-only opponents fall far short of it.
  function getMovers(n) {
    let eligible = data.filter(r => r.games_played > 0);
    if (moversFilter.conf) eligible = eligible.filter(r => r.conference === moversFilter.conf);
    if (!eligible.length) return { risers: [], fallers: [] };
    const maxGames = eligible.reduce((m, r) => Math.max(m, r.games_played), 0);
    // Default guard against buy-game/low-sample opponents; overridden the
    // moment the user picks an explicit "min games" value from the filter
    // (including "Any games", which intentionally disables the guard).
    const auto = Math.max(3, Math.ceil(maxGames * 0.4));
    const minGamesForMovers = moversFilter.minGames === '' ? auto : (parseInt(moversFilter.minGames) || 0);
    const real = eligible.filter(r => r.games_played >= minGamesForMovers);
    const sorted = [...real].sort((a, b) => movement(b) - movement(a));
    // BUG FIX: this used to be sorted.slice(0, n) / sorted.slice(-n) with no
    // regard for sign, so whenever fewer than n teams had actually moved up
    // (e.g. a slow week, or a small conference filter), the Risers panel got
    // padded out with teams that were actually FALLING — rendered with a red
    // ▼ right under the "Biggest Risers" header. And with "Show all" (n set
    // very high), slice(0, n) grabbed the entire sorted list as "risers",
    // which then made the old overlap filter strip every team back out of
    // Fallers, leaving that panel empty. Filtering by sign first fixes both:
    // a team can only ever land in the list that matches which way it moved,
    // and there's no overlap to filter since the two sets are now disjoint.
    return {
      risers:  sorted.filter(r => movement(r) > 0).slice(0, n),
      fallers: sorted.filter(r => movement(r) < 0).slice(-n).reverse(),
    };
  }

  function moversHtml() {
    if (!data.length) return '';
    const n = moversFilter.count || 5;
    const { risers, fallers } = getMovers(n);
    const confs = [...new Set(data.map(r => r.conference).filter(Boolean))].sort();
    const filtered = !!(moversFilter.conf || moversFilter.minGames !== '');
    const emptyMsg = filtered ? 'No teams match this filter' : 'No movement yet';
    const row = r => {
      const d = movement(r);
      const cls = d >= 0 ? 'trend-up' : 'trend-down';
      const arrow = d >= 0 ? '▲' : '▼';
      return `<div class="mover-row" title="${d.toFixed(1)} Elo ${movementLabel(r)}">
        <span class="mover-team">${teamDisplay(r.team)}</span>
        <span class="${cls}">${arrow} ${Math.abs(d).toFixed(0)}</span>
      </div>`;
    };
    const opt = (val, label, cur) => `<option value="${val}"${String(cur)===String(val)?' selected':''}>${label}</option>`;
    const ctrlHtml = `<div class="movers-ctrl">
      <span class="ctrl-label">Filter</span>
      <select id="moversConfFilter" class="movers-select" title="Filter movers by ${CFG.confLabel}">
        ${opt('', 'All ' + CFG.confLabel + 's', moversFilter.conf)}
        ${confs.map(c => opt(c, c, moversFilter.conf)).join('')}
      </select>
      <select id="moversMinGames" class="movers-select" title="Minimum games played to qualify">
        ${opt('', 'Auto (hide low-sample)', moversFilter.minGames)}
        ${opt('0', 'Any games', moversFilter.minGames)}
        ${opt('4', '4+ games', moversFilter.minGames)}
        ${opt('10', '10+ games', moversFilter.minGames)}
        ${opt('20', '20+ games', moversFilter.minGames)}
      </select>
      <select id="moversCount" class="movers-select" title="How many risers/fallers to show">
        ${opt('5', 'Top 5', n)}
        ${opt('10', 'Top 10', n)}
        ${opt('15', 'Top 15', n)}
        ${opt('9999', 'Show all', n)}
      </select>
    </div>`;
    return `<div class="movers-panel">
      ${ctrlHtml}
      <div class="movers-col">
        <div class="movers-title">📈 Biggest Risers <span class="movers-sub">this week</span></div>
        ${risers.length ? risers.map(row).join('') : `<div class="mover-row mover-empty">${emptyMsg}</div>`}
      </div>
      <div class="movers-col">
        <div class="movers-title">📉 Biggest Fallers <span class="movers-sub">this week</span></div>
        ${fallers.length ? fallers.map(row).join('') : `<div class="mover-row mover-empty">${emptyMsg}</div>`}
      </div>
    </div>`;
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


  // ── Team abbreviations for NBA / MLB / NHL ─────────────────
  const TEAM_ABBR = {
    // NBA
    'Atlanta Hawks':'ATL','Boston Celtics':'BOS','Brooklyn Nets':'BKN',
    'Charlotte Hornets':'CHA','Chicago Bulls':'CHI','Cleveland Cavaliers':'CLE',
    'Dallas Mavericks':'DAL','Denver Nuggets':'DEN','Detroit Pistons':'DET',
    'Golden State Warriors':'GSW','Houston Rockets':'HOU','Indiana Pacers':'IND',
    'Los Angeles Clippers':'LAC','Los Angeles Lakers':'LAL','Memphis Grizzlies':'MEM',
    'Miami Heat':'MIA','Milwaukee Bucks':'MIL','Minnesota Timberwolves':'MIN',
    'New Orleans Pelicans':'NOP','New York Knicks':'NYK','Oklahoma City Thunder':'OKC',
    'Orlando Magic':'ORL','Philadelphia 76ers':'PHI','Phoenix Suns':'PHX',
    'Portland Trail Blazers':'POR','Sacramento Kings':'SAC','San Antonio Spurs':'SAS',
    'Toronto Raptors':'TOR','Utah Jazz':'UTA','Washington Wizards':'WAS',
    // MLB
    'Arizona Diamondbacks':'ARI','Atlanta Braves':'ATL','Baltimore Orioles':'BAL',
    'Boston Red Sox':'BOS','Chicago Cubs':'CHC','Chicago White Sox':'CWS',
    'Cincinnati Reds':'CIN','Cleveland Guardians':'CLE','Colorado Rockies':'COL',
    'Detroit Tigers':'DET','Houston Astros':'HOU','Kansas City Royals':'KC',
    'Los Angeles Angels':'LAA','Los Angeles Dodgers':'LAD','Miami Marlins':'MIA',
    'Milwaukee Brewers':'MIL','Minnesota Twins':'MIN','New York Mets':'NYM',
    'New York Yankees':'NYY','Athletics':'OAK','Sacramento Athletics':'OAK',
    'Philadelphia Phillies':'PHI','Pittsburgh Pirates':'PIT','San Diego Padres':'SD',
    'San Francisco Giants':'SF','Seattle Mariners':'SEA','St. Louis Cardinals':'STL',
    'Tampa Bay Rays':'TB','Texas Rangers':'TEX','Toronto Blue Jays':'TOR',
    'Washington Nationals':'WSH',
    // NFL
    'Arizona Cardinals':'ARI','Atlanta Falcons':'ATL','Baltimore Ravens':'BAL',
    'Buffalo Bills':'BUF','Carolina Panthers':'CAR','Chicago Bears':'CHI',
    'Cincinnati Bengals':'CIN','Cleveland Browns':'CLE','Dallas Cowboys':'DAL',
    'Denver Broncos':'DEN','Detroit Lions':'DET','Green Bay Packers':'GB',
    'Houston Texans':'HOU','Indianapolis Colts':'IND','Jacksonville Jaguars':'JAX',
    'Kansas City Chiefs':'KC','Las Vegas Raiders':'LV','Los Angeles Chargers':'LAC',
    'Los Angeles Rams':'LAR','Miami Dolphins':'MIA','Minnesota Vikings':'MIN',
    'New England Patriots':'NE','New Orleans Saints':'NO','New York Giants':'NYG',
    'New York Jets':'NYJ','Philadelphia Eagles':'PHI','Pittsburgh Steelers':'PIT',
    'San Francisco 49ers':'SF','Seattle Seahawks':'SEA','Tampa Bay Buccaneers':'TB',
    'Tennessee Titans':'TEN','Washington Commanders':'WSH',
    // NHL
    'Anaheim Ducks':'ANA','Arizona Coyotes':'ARI','Utah Hockey Club':'UTA','Utah HC':'UTA',
    'Boston Bruins':'BOS','Buffalo Sabres':'BUF','Calgary Flames':'CGY',
    'Carolina Hurricanes':'CAR','Chicago Blackhawks':'CHI','Colorado Avalanche':'COL',
    'Columbus Blue Jackets':'CBJ','Dallas Stars':'DAL','Detroit Red Wings':'DET',
    'Edmonton Oilers':'EDM','Florida Panthers':'FLA','Los Angeles Kings':'LAK',
    'Minnesota Wild':'MIN','Montreal Canadiens':'MTL','Montréal Canadiens':'MTL',
    'Nashville Predators':'NSH','New Jersey Devils':'NJD','New York Islanders':'NYI',
    'New York Rangers':'NYR','Ottawa Senators':'OTT','Philadelphia Flyers':'PHI',
    'Pittsburgh Penguins':'PIT','San Jose Sharks':'SJS','Seattle Kraken':'SEA',
    'St. Louis Blues':'STL','Tampa Bay Lightning':'TBL','Toronto Maple Leafs':'TOR',
    'Vancouver Canucks':'VAN','Vegas Golden Knights':'VGK','Washington Capitals':'WSH',
    'Winnipeg Jets':'WPG',
  };
  function teamDisplay(name) {
    if (!['NBA','MLB','NHL','NFL'].includes(CFG.sport)) return name;
    return TEAM_ABBR[name] || name;
  }

  function renderRankings() {
    const filtered = getFiltered();
    const el = document.getElementById('panel-rankings');
    if (!el) return;
    if (!filtered.length) { el.innerHTML = '<div class="empty-state">No teams match your filters.</div>'; return; }

    const maxElo = Math.max(...filtered.map(r=>r.elo));
    const minElo = Math.min(...filtered.map(r=>r.elo));
    const avgElo = filtered.reduce((s,r)=>s+r.elo,0)/(filtered.length||1);
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

    const moversPanelHtml = moversHtml();

    const extraHeaders = (CFG.extraCols||[]).map(c=>`<th data-type="num">${c.label}</th>`).join('');
    const rows = filtered.map(r => {
      const bw   = r.best_win_elo > 0 ? r.best_win_elo.toFixed(1) : '—';
      const bwn  = (r.best_win_team && r.best_win_team !== 'NA') ? r.best_win_team : '';
      const bar  = eloBarWidth(r.elo, maxElo, minElo, 80);
      const extra = (CFG.extraCols||[]).map(c => {
        const v = r[c.key];
        return `<td class="num" data-val="${v??''}">${v!=null?Number(v).toFixed(c.dec??0):'—'}</td>`;
      }).join('');
      const spreadVal = ((r.elo - 1500) / 35).toFixed(1);
      const eloClr = r.elo >= avgElo ? 'var(--green-hi)' : r.elo < avgElo - 120 ? 'var(--red-hi)' : 'var(--accent)';
      return `<tr class="team-row" data-team="${r.team}">
        <td class="rank" data-val="${r.rank}">${r.rank}</td>
        <td class="team-name">${teamDisplay(r.team)} ${trendHtml(r.team)}</td>
        <td class="conf" data-val="${r.conference||''}">${r.conference||'—'}</td>
        <td class="elo" data-val="${r.elo}">
          <div class="elo-bar-wrap"><span style="color:${eloClr};font-weight:600">${r.elo.toFixed(1)}</span>
          <div class="elo-bar" style="width:${bar}px;background:${eloClr}"></div></div>
        </td>
        ${CFG.sport==='CFB'?`<td class="num" data-val="${r.pr||r.elo}" style="color:var(--accent);font-weight:500">${(r.pr||r.elo).toFixed(1)}</td>`:''}
        <td class="num" data-val="${r.wins||0}">${r.record||'—'}</td>
        <td class="num" data-val="${r.win_pct||0}">${r.win_pct!=null?(r.win_pct*100).toFixed(1)+'%':'—'}</td>
        <td class="num" data-val="${r.sos||0}">${r.sos!=null?Number(r.sos).toFixed(1):'—'}</td>
        <td class="num" data-val="${r.best_win_elo||0}">${bwn?('<span style="font-size:0.78rem">'+bwn+' <span style="color:var(--text-dim);font-family:var(--font-mono);font-size:0.68rem">('+bw+')</span></span>'):'—'}</td>
        ${extra}
      </tr>`;
    }).join('');

    el.innerHTML = moversPanelHtml + ctrlHtml + `<div class="table-wrap"><table class="tbl" id="mainTable">
      <thead><tr>
        <th data-type="num">Rank</th><th>Team</th><th>${CFG.confLabel}</th>
        <th data-type="num">Elo</th>
        ${CFG.sport==='CFB'?'<th data-type="num" title="Playoff Rating = Elo × win_pct^0.6 + √(quality resume)">PR ⓘ</th>':''}
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
    document.getElementById('moversConfFilter')?.addEventListener('change', e => {
      moversFilter.conf = e.target.value; renderRankings();
    });
    document.getElementById('moversMinGames')?.addEventListener('change', e => {
      moversFilter.minGames = e.target.value; renderRankings();
    });
    document.getElementById('moversCount')?.addEventListener('change', e => {
      moversFilter.count = parseInt(e.target.value) || 5; renderRankings();
    });
    document.getElementById('exportBtn')?.addEventListener('click', () => {
      const cols = ['rank','team','conference','elo','elo_change','baseline_date','wins','losses','games_played','win_pct','record','sos','best_win_team','best_win_elo','updated_at'];
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
    const trendLabel = movementLabel(row);
    const trendStr = trendDelta !== null
      ? (trendDelta > 0 ? `▲ ${trendDelta.toFixed(1)} ${trendLabel}` : `▼ ${Math.abs(trendDelta).toFixed(1)} ${trendLabel}`)
      : 'No games yet';

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
          <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);margin-bottom:0.3rem;text-transform:uppercase;letter-spacing:0.1em">Elo movement</div>
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

  // ── 2026 NCAA Baseball Tournament ─────────────────────────────────────────
  var CBASE_BRACKET_2026 = {
    year: 2026,
    regionals: [
      {id:0,  name:"Los Angeles",    nseed:1,  teams:["UCLA","Virginia Tech","Cal Poly","Saint Mary's"]},
      {id:1,  name:"Atlanta",        nseed:2,  teams:["Georgia Tech","Oklahoma","The Citadel","UIC"]},
      {id:2,  name:"Athens",         nseed:3,  teams:["Georgia","Boston College","Liberty","LIU"]},
      {id:3,  name:"Auburn",         nseed:4,  teams:["Auburn","UCF","NC State","Milwaukee"]},
      {id:4,  name:"Chapel Hill",    nseed:5,  teams:["North Carolina","Tennessee","East Carolina","VCU"]},
      {id:5,  name:"Austin",         nseed:6,  teams:["Texas","UC Santa Barbara","Tarleton St","Holy Cross"]},
      {id:6,  name:"Tuscaloosa",     nseed:7,  teams:["Alabama","Oklahoma State","USC Upstate","Alabama State"]},
      {id:7,  name:"Gainesville",    nseed:8,  teams:["Florida","Miami","Troy","Rider"]},
      {id:8,  name:"Hattiesburg",    nseed:9,  teams:["Southern Miss","Virginia","Jax State","Little Rock"]},
      {id:9,  name:"Tallahassee",    nseed:10, teams:["Florida State","Coastal Carolina","NIU","St. John's"]},
      {id:10, name:"Eugene",         nseed:11, teams:["Oregon","Oregon State","Washington State","Yale"]},
      {id:11, name:"College Station",nseed:12, teams:["Texas A&M","Southern California","Texas State","Lamar"]},
      {id:12, name:"Lincoln",        nseed:13, teams:["Nebraska","Ole Miss","Arizona State","S. Dakota St"]},
      {id:13, name:"Starkville",     nseed:14, teams:["Mississippi State","Cincinnati","Louisiana","Lipscomb"]},
      {id:14, name:"Lawrence",       nseed:15, teams:["Kansas","Arkansas","Missouri St","Northeastern"]},
      {id:15, name:"Morgantown",     nseed:16, teams:["West Virginia","Wake Forest","Kentucky","Binghamton"]}
    ],
    superPairs: [[0,15],[1,14],[2,13],[3,12],[4,11],[5,10],[6,9],[7,8]]
  };

  function renderCBaseTourney() {
    var el = document.getElementById('panel-tourney');
    if (!el || CFG.sport !== 'CBASE') return;
    if (!data || !data.length) { el.innerHTML = '<div class="empty-state">Load a season first.</div>'; return; }
    var bracketYear = currentSeason || new Date().getFullYear();
    if (bracketYear !== 2026) {
      var bp = CFG.dataPath.replace('CBASE_Elo_', '');
      el.innerHTML = '<div class="loading"><div class="spinner"></div>Loading…</div>';
      fetch(bp + 'tournament_' + bracketYear + '.json?t=' + Date.now())
        .then(function(r){ return r.ok ? r.json() : Promise.reject(); })
        .then(function(d){ _renderTourneyData(el, d); })
        .catch(function(){ el.innerHTML = '<div class="empty-state">No tournament data for ' + bracketYear + '.</div>'; });
      return;
    }
    el.innerHTML = '<div class="loading"><div class="spinner"></div>Running simulations…</div>';
    setTimeout(function(){ _runCBaseTourney(el, CBASE_BRACKET_2026); }, 30);
  }

  function _runCBaseTourney(el, bracket) {
    bracket = bracket || CBASE_BRACKET_2026;
    // Try to load live tournament JSON written by R script
    // Falls back to hardcoded bracket if not found
    var yr = bracket.year || new Date().getFullYear();
    var basePath = CFG.dataPath.replace(CFG.sport + '_Elo_', '');
    var jsonUrl = basePath + 'tournament_' + yr + '.json?t=' + Date.now();

    fetch(jsonUrl)
      .then(function(res) {
        if (!res.ok) throw new Error('no json');
        return res.json();
      })
      .then(function(tourneyData) {
        // Build eliminated set from completed games
        // In double-elim regionals: 2 losses = eliminated
        // In super regionals (best of 3): 2 losses = eliminated
        // In CWS double-elim: 2 losses = eliminated (except finals)
        var losses = {};
        var winners = {};
        (tourneyData.games || []).forEach(function(g) {
          losses[g.loser]   = (losses[g.loser]   || 0) + 1;
          winners[g.winner] = (winners[g.winner]  || 0) + 1;
        });
        // Eliminated = 2 losses in regionals, 2 losses in CWS, 1 loss in super regional
        // Simplification: 2+ losses = eliminated in our double-elim model
        var eliminated = {};
        Object.keys(losses).forEach(function(t) {
          if (losses[t] >= 2) eliminated[t] = true;
        });
        // Super regional losers: exactly 2 losses from best-of-3
        // They appear with 2 losses in our game log
        _runSimulation(el, bracket, eliminated, tourneyData.games || [], tourneyData.updated);
      })
      .catch(function() {
        // No JSON yet (before tournament starts, or JSON not written)
        _runSimulation(el, bracket, {}, [], null);
      });
  }

  function _runSimulation(el, bracket, eliminated, completedGames, updatedAt) {
    eliminated = eliminated || {};
    completedGames = completedGames || [];
    // Build Elo lookup from current CSV data
    var eloMap = {};
    var DEFAULT_ELO = 1450;
    if (data && data.length) {
      data.forEach(function(r) { eloMap[r.team] = r.elo; });
    }

    function getElo(name) {
      if (eloMap[name]) return eloMap[name];
      // Fuzzy match: find team in data whose name contains the bracket name or vice versa
      var nl = name.toLowerCase().replace(/[^a-z0-9]/g,'');
      var best = null, bestScore = 0;
      Object.keys(eloMap).forEach(function(k) {
        var kl = k.toLowerCase().replace(/[^a-z0-9]/g,'');
        if (kl === nl) { best = k; bestScore = 999; return; }
        if (kl.includes(nl) || nl.includes(kl)) {
          var score = Math.min(kl.length, nl.length);
          if (score > bestScore) { best = k; bestScore = score; }
        }
      });
      return best ? eloMap[best] : DEFAULT_ELO;
    }

    // Assign Elo to every team
    var teamElos = {};
    bracket.regionals.forEach(function(reg) {
      reg.teams.forEach(function(t) { teamElos[t] = getElo(t); });
    });

    // Win probability from Elo
    function wp(eA, eB) { return 1/(1+Math.pow(10,(eB-eA)/400)); }

    // Simulate one game
    function simG(a, b) { return Math.random() < wp(teamElos[a], teamElos[b]) ? a : b; }

    // Double-elimination regional (4 teams)
    // Standard bracket: W: 1v4, 2v3  L: losers play  Championship
    function simRegional(teams) {
      var t = teams.slice(); // [s1, s2, s3, s4]
      // Winners bracket round 1
      var w1 = simG(t[0],t[3]), l1 = (w1===t[0]?t[3]:t[0]);
      var w2 = simG(t[1],t[2]), l2 = (w2===t[1]?t[2]:t[1]);
      // Losers bracket round 1
      var lb1 = simG(l1,l2); // loser goes home
      // Winners bracket final
      var wbF = simG(w1,w2); var wbL = (wbF===w1?w2:w1);
      // Losers bracket semifinal: wbL vs lb1
      var lb2 = simG(wbL, lb1);
      // Championship game 1: wbF (0 L) vs lb2 (1 L)
      var cg1 = simG(wbF, lb2);
      if (cg1 !== wbF) {
        // Championship game 2 (only if lb2 wins game 1)
        cg1 = simG(wbF, lb2);
      }
      return cg1;
    }

    // Best of 3 super regional
    function simSR(a, b) {
      var wA=0, wB=0;
      while(wA<2&&wB<2){ var g=simG(a,b); if(g===a)wA++;else wB++; }
      return wA>=2?a:b;
    }

    // CWS: 8 teams, two 4-team double-elim brackets, championship best-of-3
    // CWS bracket 1: seeds 1,4,5,8 (national seeds)   bracket 2: seeds 2,3,6,7
    function simCWS(eight) {
      // eight[i] = winner of super regional i (i=0..7)
      // Bracket 1: 0,3,4,7  Bracket 2: 1,2,5,6
      var b1 = [eight[0],eight[3],eight[4],eight[7]];
      var b2 = [eight[1],eight[2],eight[5],eight[6]];
      var c1 = simRegional(b1); // use same DE4 logic
      var c2 = simRegional(b2);
      // Championship: best of 3
      return simSR(c1, c2);
    }

    // ── Monte Carlo: N simulations ─────────────────────────────────────────
    var N = 5000;
    var counts = {}; // team → [regionalWins, srWins, cwsWins, champWins]
    var allTeams = [];
    bracket.regionals.forEach(function(reg) {
      reg.teams.forEach(function(t) {
        counts[t] = [0,0,0,0];
        allTeams.push(t);
      });
    });

    for (var sim=0; sim<N; sim++) {
      // Simulate all 16 regionals
      var regWinners = bracket.regionals.map(function(reg) {
        // Skip eliminated teams from simulation pool
        var alive = reg.teams.filter(function(t){ return !eliminated[t]; });
        var pool = alive.length >= 2 ? alive : reg.teams;
        var w = pool.length === 1 ? pool[0] : simRegional(pool.length === 4 ? pool : reg.teams);
        counts[w][0]++;
        return w;
      });
      // Super regionals
      var srWinners = bracket.superPairs.map(function(pair) {
        var a = regWinners[pair[0]], b = regWinners[pair[1]];
        var w = simSR(a, b);
        counts[w][1]++;
        return w;
      });
      // CWS
      var cwsWin = simCWS(srWinners);
      counts[cwsWin][2]++;
      // Champion (CWS winner who wins the finals)
      // Note: simCWS already does the final, cwsWin IS the champion
      counts[cwsWin][3]++;
    }

    // ── Build output ───────────────────────────────────────────────────────
    var avg = 0, cnt=0;
    allTeams.forEach(function(t){ avg+=teamElos[t]; cnt++; });
    avg = avg/cnt;
    function clr(e){return e>=avg?'var(--green-hi)':e<avg-150?'var(--red-hi)':'var(--accent)';}
    function pct(n){ return (n/N*100).toFixed(1)+'%'; }
    function bar(n, maxN, color) {
      var w = Math.round(n/maxN*100);
      return '<div style="background:var(--bg4);border-radius:2px;height:4px;flex:1;margin-left:6px;overflow:hidden">'
        +'<div style="width:'+w+'%;height:100%;background:'+color+';border-radius:2px"></div></div>';
    }

    // Sort all teams by CWS appearance prob for the odds table
    var sorted = allTeams.slice().sort(function(a,b){return counts[b][3]-counts[a][3];});
    var maxChamp = counts[sorted[0]][3];

    var oddsHtml = '<table style="width:100%;border-collapse:collapse;font-size:0.78rem">'
      +'<thead><tr style="border-bottom:1px solid var(--border)">'
      +'<th style="text-align:left;padding:0.4rem 0.5rem;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim)">Team</th>'
      +'<th style="text-align:left;padding:0.4rem 0.5rem;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim)">Elo</th>'
      +'<th style="text-align:right;padding:0.4rem 0.5rem;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim)">Regional</th>'
      +'<th style="text-align:right;padding:0.4rem 0.5rem;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim)">Super R</th>'
      +'<th style="text-align:right;padding:0.4rem 0.5rem;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim)">CWS</th>'
      +'<th style="padding:0.4rem 0.5rem;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent)">Champion</th>'
      +'</tr></thead><tbody>';

    // Sort: active teams by champion probability, eliminated teams at bottom
    var activeSorted   = sorted.filter(function(t){ return !eliminated[t]; });
    var eliminatedList = sorted.filter(function(t){ return  eliminated[t]; });
    var displayOrder   = activeSorted.concat(eliminatedList);

    displayOrder.forEach(function(t, i) {
      var e = teamElos[t];
      var isOut = eliminated[t];
      var c = isOut ? 'var(--text-dim)' : clr(e);
      var rowStyle = isOut ? 'opacity:0.4;' : '';
      var champPct = counts[t][3]/N;
      var outTag = isOut ? ' <span style="font-size:0.6rem;color:var(--red-hi)">OUT</span>' : '';
      oddsHtml += '<tr style="border-bottom:1px solid rgba(255,255,255,0.04);'+rowStyle+'">'
        +'<td style="padding:0.35rem 0.5rem;font-weight:'+(i<8&&!isOut?'600':'400')+';color:'+c+'">'+t+outTag+'</td>'
        +'<td style="padding:0.35rem 0.5rem;color:var(--text-dim);font-family:var(--font-mono);font-size:0.72rem">'+e.toFixed(0)+'</td>'
        +'<td style="padding:0.35rem 0.5rem;text-align:right;color:var(--text-dim)">'+pct(counts[t][0])+'</td>'
        +'<td style="padding:0.35rem 0.5rem;text-align:right;color:var(--text-dim)">'+pct(counts[t][1])+'</td>'
        +'<td style="padding:0.35rem 0.5rem;text-align:right;color:var(--text-dim)">'+pct(counts[t][2])+'</td>'
        +'<td style="padding:0.35rem 0.5rem">'
        +'<div style="display:flex;align-items:center">'
        +'<span style="font-weight:600;color:'+c+';min-width:42px">'+pct(counts[t][3])+'</span>'
        +bar(counts[t][3], maxChamp, c)
        +'</div></td>'
        +'</tr>';
    });
    oddsHtml += '</tbody></table>';

    // Regional summary
    var regHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:0.6rem;margin-bottom:1.5rem">';
    bracket.regionals.forEach(function(reg) {
      regHtml += '<div class="card" style="padding:0.65rem">'
        +'<div style="font-size:0.58rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim);margin-bottom:0.4rem">'
        +'#'+reg.nseed+' '+reg.name+' Regional</div>';
      // Sort teams by regional win %
      var rTeams = reg.teams.slice().sort(function(a,b){return counts[b][0]-counts[a][0];});
      rTeams.forEach(function(t) {
        var winPct = counts[t][0]/N;
        var e = teamElos[t];
        regHtml += '<div style="display:flex;align-items:center;padding:0.15rem 0;gap:0.4rem">'
          +(eliminated[t]
          ? '<span style="color:var(--text-dim);font-size:0.72rem;flex:1;text-decoration:line-through;opacity:0.4">'+t+' ❌</span>'
          : '<span style="color:'+clr(e)+';font-size:0.72rem;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+t+'</span>')
          +'<span style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim);min-width:34px;text-align:right">'+(winPct*100).toFixed(0)+'%</span>'
          +'</div>';
      });
      regHtml += '</div>';
    });
    regHtml += '</div>';

    var topChamp = activeSorted[0] || sorted[0];
    var topElo   = teamElos[topChamp];

    var liveStatus = completedGames.length > 0
      ? '<span style="color:var(--green-hi);font-size:0.7rem;margin-left:0.75rem">● LIVE · '+completedGames.length+' games played</span>'
      : '<span style="color:var(--text-dim);font-size:0.7rem;margin-left:0.75rem">Pre-tournament simulation</span>';
    var updatedStr = updatedAt ? ' · Updated '+updatedAt : '';
    el.innerHTML = ''
      +'<div class="section-header"><span>⚾ '+bracket.year+' NCAA Baseball Tournament · Omaha Odds'+liveStatus+'</span>'
      +'<button id="cbase-resim" style="margin-left:auto;padding:0.2rem 0.7rem;border:1px solid var(--border);background:var(--bg3);border-radius:var(--radius);cursor:pointer;font-size:0.72rem;color:var(--text)">🎲 Re-simulate ('+N.toLocaleString()+'×)</button></div>'
      +'<div class="section-note" style="margin-bottom:1rem">Based on '+N.toLocaleString()+' Monte Carlo simulations using Elo ratings · '
      +'Regionals: double-elimination · Super Regionals: best-of-3 · CWS: Omaha (Jun 12–22)'
      +'</div>'

      +'<div class="card" style="padding:1rem;display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;border:1px solid var(--accent)">'
      +'<div style="flex:1">'
      +'<div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-dim)">Most likely champion</div>'
      +'<div style="font-size:1.3rem;font-weight:700;color:'+clr(topElo)+'">'+topChamp+'</div>'
      +'<div style="font-size:0.72rem;color:var(--text-dim);margin-top:0.1rem">'+pct(counts[topChamp][3])+' championship probability · Elo '+topElo.toFixed(0)+'</div>'
      +'</div>'
      +'<div style="font-size:2rem">🏆</div>'
      +'</div>'

      +'<div style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim);margin-bottom:0.75rem">Championship Odds — All 64 Teams</div>'
      +'<div class="card" style="padding:0.75rem;margin-bottom:1.5rem;overflow-x:auto">'+oddsHtml+'</div>'

      +'<div style="font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim);margin-bottom:0.5rem">Regional Win Probabilities</div>'
      +regHtml;

    document.getElementById('cbase-resim').onclick = function() { renderCBaseTourney(); };
  }



  // ── Generic Playoff/Tournament Simulator ────────────────────────────────────
  // Works for NBA, NHL, MLB, NFL, CBB
  // Reads tournament_YEAR.json written by R, simulates remaining series/games
  function renderTourney() {
    var el = document.getElementById('panel-tourney');
    if (!el) return;
    var isCBASE = CFG.sport === 'CBASE';
    // CBASE 2026 uses the special simulator; all other years use JSON-based renderer
    if (isCBASE && (currentSeason || new Date().getFullYear()) === 2026) { renderCBaseTourney(); return; }

    var SUPPORTED = ['NBA','NHL','MLB','NFL','CBB','CBASE'];
    if (SUPPORTED.indexOf(CFG.sport) === -1) {
      el.innerHTML = '<div class="empty-state">Tournament simulator not available for '+CFG.sport+'.</div>';
      return;
    }
    if (!data || !data.length) {
      el.innerHTML = '<div class="empty-state">Load a season first.</div>';
      return;
    }
    el.innerHTML = '<div class="loading"><div class="spinner"></div>Loading playoff data…</div>';

    var yr = currentSeason || new Date().getFullYear();
    // NFL: playoffs happen Jan/Feb of the NEXT calendar year after the season
    var jsonYr = yr; // JSON always named by season year
    var basePath = CFG.dataPath.replace(CFG.sport + '_Elo_', '');
    var jsonUrl  = basePath + 'tournament_' + jsonYr + '.json?t=' + Date.now();

    fetch(jsonUrl)
      .then(function(r){ return r.ok ? r.json() : Promise.reject('no file'); })
      .then(function(d){ _renderTourneyData(el, d); })
      .catch(function(){
        // JSON not found - show projected odds with clear note
        _renderTourneyData(el, {
          year: jsonYr, sport: CFG.sport,
          games: [], series: [], eliminated: [],
          completed: false, updated: null,
          _notLoaded: true
        });
      });
  }

  function _renderTourneyData(el, d) {
    // ── Elo lookup ─────────────────────────────────────────────
    var eloMap = {};
    if (data && data.length) data.forEach(function(r){ eloMap[r.team] = r.elo; });
    function getElo(name) {
      if (!name) return null;
      if (eloMap[name]) return eloMap[name];
      var nl = name.toLowerCase().replace(/[^a-z0-9]/g,'');
      var best = null, bestScore = 0;
      Object.keys(eloMap).forEach(function(k) {
        var kl = k.toLowerCase().replace(/[^a-z0-9]/g,'');
        if (kl === nl) { best = k; bestScore = 9999; return; }
        if (kl.length > 3 && nl.length > 3 && (kl.indexOf(nl) !== -1 || nl.indexOf(kl) !== -1)) {
          var sc = Math.min(kl.length, nl.length);
          if (sc > bestScore) { best = k; bestScore = sc; }
        }
      });
      return best ? eloMap[best] : null;
    }
    function elo(name) { return getElo(name) || 1500; }

    // ── Round classification ────────────────────────────────────
    // Strip "- GAME N", "- Game N", "- G1" etc. from round names
    function normaliseRound(rnd) {
      if (!rnd) return '';
      return rnd
        .replace(/\s*[-–]\s*GAME\s+\d+.*$/i, '')   // "ALDS - GAME 1" → "ALDS"
        .replace(/\s*[-–]\s*G\d+\s*$/i, '')         // "ALDS - G1" → "ALDS"
        .replace(/\s*\(GAME\s+\d+\)\s*$/i, '')       // "ALDS (Game 1)" → "ALDS"
        .replace(/\s*[-–]\s*MAKEUP.*$/i, '')          // "NLWC - GAME 2 - MAKEUP FROM 10/1" → "NLWC"
        .replace(/\s*[-–]\s*GAME\s+\d+.*$/i, '')     // second pass after makeup strip
        .trim();
    }

    function getRoundOrder(rnd, sport, date) {
      rnd = normaliseRound(rnd);
      var r = rnd.toLowerCase().trim();

      // ── NFL ────────────────────────────────────────────────────
      if (sport === 'NFL') {
        if (r.indexOf('wild card') !== -1 || r.indexOf('wildcard') !== -1) return 0;
        if (r.indexOf('divisional') !== -1) return 1;
        if (r.indexOf('super bowl') !== -1) return 3;
        if (r.indexOf('championship') !== -1 || (r.indexOf('conference') !== -1 && /\bfinals?\b/.test(r))) return 2;
        // Infer from date when round is empty
        if (date) {
          var mo = parseInt(date.slice(5,7)), dy = parseInt(date.slice(8,10));
          if (mo === 2 && dy <= 15) return 3;        // Feb = Super Bowl
          if (mo === 1 && dy >= 24) return 2;        // Jan 24+ = Conference
          if (mo === 1 && dy >= 18) return 1;        // Jan 18-23 = Divisional
          if (mo === 1 && dy >= 10) return 0;        // Jan 10-17 = Wild Card
        }
        return -1; // Skip unidentifiable NFL games
      }

      // ── NBA ────────────────────────────────────────────────────
      if (sport === 'NBA') {
        if (!r) {
          // No round name — infer from date (early ESPN years had no round labels)
          if (!date) return -1;
          var _yr=parseInt(date.slice(0,4)), _mo=parseInt(date.slice(5,7)), _dy=parseInt(date.slice(8,10));
          // NBA 2020 bubble: playoffs ran Jul-Oct in Orlando
          if (_yr === 2020 && _mo >= 7) {
            if (_mo === 10) return 4;  // Oct = NBA Finals
            if (_mo === 9)  return 3;  // Sep = Conf Finals
            if (_mo === 8)  return 2;  // Aug = Conf Semis
            return 1;                   // Jul = First Round
          }
          // Normal calendar
          if (_mo === 6 && _dy >= 1)  return 4;  // NBA Finals (June 1+)
          if (_mo === 5 && _dy >= 18) return 3;  // Conf Finals (May 18+)
          if (_mo === 5 && _dy >= 3)  return 2;  // Conf Semis (May 3+)
          if (_mo >= 4)               return 1;  // First Round (Apr+)
          return -1;
        }
        if (r.indexOf('play-in') !== -1 || r.indexOf('playin') !== -1) return 0;
        if (r.indexOf('first round') !== -1 || r.indexOf('1st round') !== -1) return 1;
        if (r.indexOf('second round') !== -1 || r.indexOf('2nd round') !== -1) return 2;
        if (r.indexOf('semifinal') !== -1) return 2;
        if (r.indexOf('conference final') !== -1) return 3;
        if (r.indexOf('east final') !== -1 || r.indexOf('west final') !== -1) return 3;
        if (r.indexOf('east finals') !== -1 || r.indexOf('west finals') !== -1) return 3;
        if (r.indexOf('nba final') !== -1) return 4;
        if (r === 'finals' || r === 'the finals') return 4;
        if (/\bfinals?\b/.test(r) && r.indexOf('conference') === -1) return 4;
        return 1;
      }

      // ── NHL ────────────────────────────────────────────────────
      if (sport === 'NHL') {
        if (!r) {
          // Infer from date for early ESPN years
          if (!date) return -1;
          var _nyr=parseInt(date.slice(0,4)), _nmo=parseInt(date.slice(5,7)), _ndy=parseInt(date.slice(8,10));
          // NHL 2020 bubble: played Aug-Sep in Toronto/Edmonton
          if (_nyr === 2020 && _nmo >= 8) {
            if (_nmo === 9 && _ndy >= 22) return 4;  // Stanley Cup Final
            if (_nmo === 9 || (_nmo === 8 && _ndy >= 26)) return 3;  // Conf Finals
            if (_nmo === 8 && _ndy >= 12) return 2;  // Conf Semis
            return 1;  // First Round / Qualifying
          }
          // NHL 2021 shortened season: playoffs started May 13 (later than normal)
          if (_nyr === 2021) {
            if (_nmo === 7) return 4;
            if (_nmo === 6 && _ndy >= 15) return 4;
            if (_nmo === 6) return 3;
            if (_nmo === 5 && _ndy >= 28) return 2;
            if (_nmo >= 5) return 1;
            return -1;
          }
          // Normal calendar
          if (_nmo === 6 && _ndy >= 10) return 4;  // SCF (Jun 10+)
          if (_nmo === 6 || (_nmo === 5 && _ndy >= 18)) return 3;  // Conf Finals
          if (_nmo === 5 && _ndy >= 3)  return 2;  // Conf Semis
          if (_nmo >= 4)                return 1;  // First Round
          return -1;
        }
        if (r.indexOf('play-in') !== -1 || r.indexOf('qualifying') !== -1) return 0;
        if (r.indexOf('quarterfinal') !== -1 || r.indexOf('1st round') !== -1 || r.indexOf('first round') !== -1) return 1;
        if (r.indexOf('2nd round') !== -1 || r.indexOf('second round') !== -1) return 2;
        if (r.indexOf('semifinal') !== -1 && r.indexOf('stanley') === -1) return 2;
        if (r.indexOf('conference final') !== -1) return 3;
        if ((r.indexOf('east') !== -1 || r.indexOf('west') !== -1) && /\bfinals?\b/.test(r)) return 3;
        if (r.indexOf('stanley cup') !== -1) return 4;
        if (r === 'finals' || r === 'championship') return 4;
        return 1;
      }

      // ── MLB ────────────────────────────────────────────────────
      if (sport === 'MLB') {
        if (r === 'alwc' || r === 'nlwc' || r.indexOf('wild card') !== -1 || r.indexOf('wildcard') !== -1) return 0;
        if (r === 'alds' || r === 'nlds' || r.indexOf('division') !== -1) return 1;
        if (r === 'alcs' || r === 'nlcs' || r.indexOf('league championship') !== -1 || r.indexOf('championship series') !== -1) return 2;
        if (r.indexOf('world series') !== -1) return 3;
        // Numeric round IDs (old ESPN game IDs) - skip
        if (/^\d+$/.test(r)) return -1;
        // Infer from date when round is empty
        if (!r && date) {
          var yr2=parseInt(date.slice(0,4)), mo2 = parseInt(date.slice(5,7)), dy2 = parseInt(date.slice(8,10));
          // MLB 2020: shortened season, all dates shifted ~3 weeks earlier
          if (yr2 === 2020) {
            if (mo2 === 10 && dy2 >= 21) return 3;  // WS
            if (mo2 === 10 && dy2 >= 12) return 2;  // ALCS/NLCS
            if (mo2 >= 10 || (mo2 === 9 && dy2 >= 29)) return 1;  // DS
          } else {
            if (mo2 === 11 || (mo2 === 10 && dy2 >= 25)) return 3;  // WS
            if (mo2 === 10 && dy2 >= 13) return 2;                   // CS
            if (mo2 === 10 && dy2 >= 1) return 1;                    // DS
          }
        }
        if (!r) return -1; // skip empty MLB rounds without dates
        return 1;
      }

      // ── CBB ────────────────────────────────────────────────────
      if (sport === 'CBB') {
        if (!r) return -1;
        if (r.indexOf('first four') !== -1) return 0;
        if (r.indexOf('round of 64') !== -1 || r.indexOf('first round') !== -1 || r.indexOf('1st round') !== -1) return 1;
        if (r.indexOf('round of 32') !== -1 || r.indexOf('second round') !== -1) return 2;
        if (r.indexOf('sweet') !== -1) return 3;
        if (r.indexOf('elite') !== -1) return 4;
        if (r.indexOf('final four') !== -1) return 5;
        if (r.indexOf('championship') !== -1) return 6;
        return 1;
      }

      // ── CBASE ──────────────────────────────────────────────────
      if (sport === 'CBASE') {
        if (r.indexOf('super regional') !== -1) return 1;
        if (r.indexOf('world series') !== -1 || r.indexOf('cws') !== -1) return 2;
        if (r.indexOf('ncaa') !== -1 || r.indexOf('regional') !== -1) return 0;
        return -1;
      }

      return 0;
    }

    
    function getRoundLabel(order, sport) {
      var labels = {
        NBA:   {0:'Play-In',1:'First Round',2:'Conf. Semifinals',3:'Conf. Finals',4:'NBA Finals'},
        NHL:   {0:'Play-In/Qualifying',1:'First Round',2:'Second Round',3:'Conf. Finals',4:'Stanley Cup Final'},
        MLB:   {0:'Wild Card',1:'Division Series',2:'Championship Series',3:'World Series'},
        NFL:   {0:'Wild Card',1:'Divisional Round',2:'Conf. Championship',3:'Super Bowl'},
        CBB:   {0:'First Four',1:'Round of 64',2:'Round of 32',3:'Sweet 16',4:'Elite Eight',5:'Final Four',6:'Championship'},
        CBASE: {0:'Regionals',1:'Super Regionals',2:'College World Series'},
      };
      var map = labels[sport] || {};
      return map[order] || ('Round '+(order+1));
    }

    // ── Filter, normalise & merge series ──────────────────────────
    var rawSeries = (d.series || []).filter(function(s) {
      var rnd = normaliseRound(s.round || '');
      // NHL: filter empty rounds (late-season regular season games)
      if (CFG.sport === 'NHL' && !rnd) return false;
      // NBA: empty-round entries are either reg season noise OR early-year playoff data
      // Keep only if: has a named round, OR is clearly a playoff series (3+ total wins)
      if (CFG.sport === 'NBA' && !rnd) {
        return s.done || ((s.w1||0) + (s.w2||0)) >= 3;
      }
      if (CFG.sport === 'CBASE') return getRoundOrder(rnd, 'CBASE') >= 0;
      return true;
    });

    // Merge per-game series entries into one series per team-pair per round order
    // e.g. "ALDS - GAME 1" + "ALDS - GAME 2" between same teams → one series
    var mergedMap = {};  // key: "order||sortedTeams"
    rawSeries.forEach(function(s) {
      var o = getRoundOrder(s.round, CFG.sport, s.date);
      if (o < 0) return;
      // Filter Pro Bowl (team names are "Afc" / "Nfc" / "NFC" / "AFC")
      var t1l = (s.t1||'').toLowerCase(), t2l = (s.t2||'').toLowerCase();
      if ((t1l === 'afc' || t1l === 'nfc' || t2l === 'afc' || t2l === 'nfc')) return;
      // Filter MLB regular season: empty round games before Oct 8 are regular season
      // (DS doesn't start until ~Oct 5-8 historically)
      if (CFG.sport === 'MLB' && !(normaliseRound(s.round||''))) {
        if (!s.date) return;
        var _sdate = s.date, _syr = parseInt(_sdate.slice(0,4));
        var _smo = parseInt(_sdate.slice(5,7)), _sdy = parseInt(_sdate.slice(8,10));
        // MLB 2020: COVID shortened season, playoffs started Sep 29
        if (_syr === 2020) {
          if (_smo < 9) return;
          if (_smo === 9 && _sdy < 29) return;  // before Sep 29 = regular season
        } else {
          // Normal years: playoffs never start before Oct 8
          if (_smo < 10) return;
          if (_smo === 10 && _sdy < 8) return;
        }
      }
      var teamKey = [s.t1, s.t2].sort().join('||');
      var key = o + '||' + teamKey;
        // Clean up extra whitespace in team names (old ESPN data has "Arizona              Diamondbacks")
      var ct1 = (s.t1||'').replace(/\s+/g,' ').trim();
      var ct2 = (s.t2||'').replace(/\s+/g,' ').trim();
      if (!mergedMap[key]) {
        mergedMap[key] = { t1:ct1, t2:ct2, w1:0, w2:0, done:false, loser:'', round:normaliseRound(s.round||''), date:s.date, order:o };
      }
      var m = mergedMap[key];
      var totalWins = (s.w1||0) + (s.w2||0);

      if (totalWins > 1 && !m._hasPreMerged) {
        // This entry already has accumulated wins (e.g. "4-3 World Series" from R)
        // Map wins to correct team positions in merged entry
        var _st1 = (s.t1||'').replace(/\s+/g,' ').trim();
        var t1wins = (_st1 === m.t1) ? (s.w1||0) : (s.w2||0);
        var t2wins = (_st1 === m.t1) ? (s.w2||0) : (s.w1||0);
        // Only use if these are bigger than what we've counted (avoid double-add)
        if (t1wins + t2wins > m.w1 + m.w2) {
          m.w1 = t1wins; m.w2 = t2wins; m._hasPreMerged = true;
        }
      } else if (totalWins === 1) {
        // Single game result - add one win to the correct team
        if (s.w1 > s.w2) {
          // s.t1 won - compare cleaned names
          var st1 = (s.t1||'').replace(/\s+/g,' ').trim();
          if (st1 === m.t1) m.w1++; else m.w2++;
        } else {
          // s.t2 won
          var st2 = (s.t2||'').replace(/\s+/g,' ').trim();
          if (st2 === m.t1) m.w1++; else m.w2++;
        }
      }
      if (!m.date || s.date < m.date) m.date = s.date;
      if (s.loser) m.loser = s.loser.replace(/\s+/g,' ').trim();
      if (s.done) m.done = true;
    });

    // Convert merged map to list, sorted by date
    var seriesList = Object.keys(mergedMap).map(function(k){ return mergedMap[k]; })
      .sort(function(a,b){ return (a.date||'').localeCompare(b.date||''); });

    // Determine done/loser from win counts; cap wins at series WTA
    seriesList.forEach(function(s) {
      var wta = getSeriesWTA(s.order);
      // Cap wins at WTA (R sometimes over-accumulates when team pair plays in multiple rounds)
      if (s.w1 > wta) s.w1 = wta;
      if (s.w2 > wta) s.w2 = wta;
      if (!s.done && (s.w1 >= wta || s.w2 >= wta)) {
        s.done = true;
        s.loser = s.w1 >= wta ? s.t2 : s.t1;
      }
    });

    // Group by round order for bracket columns
    var roundGroups = {};
    seriesList.forEach(function(s) {
      var o = s.order;
      if (!roundGroups[o]) roundGroups[o] = [];
      roundGroups[o].push(s);
    });
    var rounds = Object.keys(roundGroups).sort(function(a,b){return a-b;}).map(function(o){
      return { order: +o, label: getRoundLabel(+o, CFG.sport), series: roundGroups[o] };
    });

    // ── Rebuild eliminated from filtered series ─────────────────
    var eliminated = {};
    seriesList.forEach(function(s) {
      var wta = getSeriesWTA(s.order !== undefined ? s.order : 1);
      if ((s.done || s.w1 >= wta || s.w2 >= wta) && s.loser) {
        eliminated[s.loser] = true;
      }
    });
    // Supplement with JSON eliminated list (reliable for completed seasons)
    (d.eliminated||[]).forEach(function(t){ eliminated[(t||'').replace(/\s+/g,' ').trim()] = true; });

    var WIN_TO_ADV = (CFG.sport==='NFL'||CFG.sport==='CBB'||CFG.sport==='CBASE') ? 1
                   : (CFG.sport==='MLB') ? 3 : 4;
    function getSeriesWTA(roundOrder) {
      if (CFG.sport === 'MLB') {
        if (roundOrder === 0) return 2; // Wild Card: best-of-3
        if (roundOrder === 1) return 3; // Division Series: best-of-5
        return 4;                        // CS + WS: best-of-7
      }
      return WIN_TO_ADV;
    }
    var isCompleted = d.completed === true;
    var hasGames    = (d.games||[]).length > 0;

    // ── Early return: data not loaded ───────────────────────────
    if (d._notLoaded) {
      var _icon={NBA:'🏀',NHL:'🏒',MLB:'⚾',NFL:'🏈',CBB:'🏀',CBASE:'⚾'}[CFG.sport]||'🏆';
      var _title={NBA:'NBA Playoffs',NHL:'Stanley Cup Playoffs',MLB:'MLB Playoffs',
        NFL:'NFL Playoffs',CBB:'NCAA Tournament',CBASE:'NCAA Baseball Tournament'}[CFG.sport]||'Playoffs';
      var _isPast = d.year < new Date().getFullYear();
      el.innerHTML = '<div class="section-header"><span>'+_icon+' '+d.year+' '+_title+'</span></div>'
        +(_isPast
          ? '<div style="padding:0.5rem 0.75rem;background:var(--bg3);border-radius:var(--radius);border:1px solid var(--border);font-size:0.75rem;color:var(--text-dim);margin-bottom:1rem">'
            +'⚠️ Playoff data not yet loaded for '+d.year+'. Run the <strong>Backfill Playoff Data</strong> workflow in GitHub Actions to generate it, then refresh.</div>'
          : '<div style="padding:0.4rem 0;font-size:0.75rem;color:var(--accent);margin-bottom:0.75rem">'
            +'📅 Playoffs not yet started — showing projected odds.</div>');
      // Show projected odds
      el.innerHTML += ''; // projected odds shown below via _renderTourneyData re-call
      return;
    }

    // ── Monte Carlo ─────────────────────────────────────────────
    function wp(a,b){ return 1/(1+Math.pow(10,(elo(b)-elo(a))/400)); }
    function simGame(a,b){ return Math.random()<wp(a,b)?a:b; }
    function simSeries(t1,t2,w1,w2,wta){
      var s1=w1,s2=w2;
      while(s1<wta&&s2<wta){ if(Math.random()<wp(t1,t2))s1++;else s2++; }
      return s1>=wta?t1:t2;
    }

    var allTeams=[], seenT={};
    seriesList.forEach(function(s){
      [s.t1,s.t2].forEach(function(t){if(!seenT[t]){seenT[t]=1;allTeams.push(t);}});
    });
    if (!allTeams.length && data.length) {
      var n=CFG.sport==='NFL'?14:CFG.sport==='MLB'?12:CFG.sport==='CBB'?64:16;
      data.slice().sort(function(a,b){return b.elo-a.elo;}).slice(0,n).forEach(function(r){allTeams.push(r.team);});
    }

    var champCount={};
    allTeams.forEach(function(t){champCount[t]=0;});
    var N = isCompleted ? 0 : 1500;

    if (N > 0) {
      for (var sim=0; sim<N; sim++) {
        var alive = allTeams.filter(function(t){return !eliminated[t];});
        if (seriesList.length) {
          var rw=[];
          seriesList.forEach(function(s){
            if(eliminated[s.t1]){rw.push(s.t2);return;}
            if(eliminated[s.t2]){rw.push(s.t1);return;}
            if(s.done||s.w1>=WIN_TO_ADV||s.w2>=WIN_TO_ADV){rw.push(s.w1>s.w2?s.t1:s.t2);}
            else{rw.push(simSeries(s.t1,s.t2,s.w1||0,s.w2||0,WIN_TO_ADV));}
          });
          alive=rw;
        }
        while(alive.length>1){
          var nx=[];
          for(var i=0;i<alive.length;i+=2){
            if(i+1>=alive.length){nx.push(alive[i]);continue;}
            nx.push(simSeries(alive[i],alive[i+1],0,0,WIN_TO_ADV));
          }
          alive=nx;
        }
        if(alive.length===1&&champCount[alive[0]]!==undefined) champCount[alive[0]]++;
      }
    }

    // ── Colors ──────────────────────────────────────────────────
    var knownElos=Object.values?Object.values(eloMap):Object.keys(eloMap).map(function(k){return eloMap[k];});
    var avgElo=knownElos.length?knownElos.reduce(function(s,v){return s+v;},0)/knownElos.length:1500;
    function clr(name){
      if(eliminated[name]) return 'var(--text-dim)';
      var e=getElo(name); if(!e) return 'var(--text)';
      return e>=avgElo?'var(--green-hi)':e<avgElo-150?'var(--red-hi)':'var(--accent)';
    }
    function pct(n){ return N>0?(n/N*100).toFixed(0)+'%':'';}

    // ── Find champion ───────────────────────────────────────────
    function findChamp(){
      // Find winner of highest-order completed series
      var best=-1, champ=null;
      seriesList.forEach(function(s){
        var o=getRoundOrder(s.round,CFG.sport);
        var done=s.done||s.w1>=WIN_TO_ADV||s.w2>=WIN_TO_ADV;
        if(done&&o>=best){best=o;champ=s.w1>s.w2?s.t1:s.t2;}
      });
      return champ;
    }

    // ── Game score lookup ───────────────────────────────────────
    var gameLookup={};
    (d.games||[]).forEach(function(g){
      var key=[g.winner,g.loser].sort().join('||');
      if(!gameLookup[key])gameLookup[key]=[];
      gameLookup[key].push(g);
    });
    function pairGames(t1,t2){return gameLookup[[t1,t2].sort().join('||')]||[];}

    // ── escXml ──────────────────────────────────────────────────
    function escXml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

    // ── Render ──────────────────────────────────────────────────
    var icon={NBA:'🏀',NHL:'🏒',MLB:'⚾',NFL:'🏈',CBB:'🏀',CBASE:'⚾'}[CFG.sport]||'🏆';
    var sportTitle={NBA:'NBA Playoffs',NHL:'Stanley Cup Playoffs',MLB:'MLB Playoffs',
      NFL:'NFL Playoffs',CBB:'NCAA Tournament',CBASE:'NCAA Baseball Tournament'}[CFG.sport]||(CFG.sport+' Playoffs');
    var liveTag = isCompleted
      ? ' <span style="color:var(--green-hi);font-size:0.65rem">✓ Final</span>'
      : hasGames
        ? ' <span style="color:var(--green-hi);font-size:0.65rem">● Live</span>'
        : ' <span style="color:var(--text-dim);font-size:0.65rem">Projected</span>';

    var html='<div class="section-header"><span>'+icon+' '+d.year+' '+sportTitle+liveTag+'</span>'
      +(N>0?'<button id="gen-resim" style="margin-left:auto;padding:0.2rem 0.6rem;border:1px solid var(--border);background:var(--bg3);border-radius:var(--radius);cursor:pointer;font-size:0.7rem;color:var(--text)">🎲 Re-simulate</button>':'')
      +'</div>';
    if(d.updated)html+='<div style="font-size:0.6rem;color:var(--text-dim);margin-bottom:0.6rem">Updated '+d.updated+'</div>';
    if(!hasGames&&!isCompleted)html+='<div style="font-size:0.75rem;color:var(--accent);margin-bottom:0.75rem">📅 Playoffs not yet started — projected odds.</div>';

    // ── SVG bracket ─────────────────────────────────────────────
    if(rounds.length){
      var COL_W=180,CELL_H=26,PAD_V=7,CONN=28;
      var maxSeries=rounds.reduce(function(m,r){return Math.max(m,r.series.length);},1);
      var SVG_H=Math.max(200,maxSeries*(CELL_H*2+PAD_V*2+10)+32);
      var SVG_W=rounds.length*(COL_W+CONN)+CONN+4;
      var parts=[],prevCenters=[],glData={};

      rounds.forEach(function(rnd,ri){
        var colX=ri*(COL_W+CONN)+CONN,n=rnd.series.length,step=SVG_H/n,curC=[];
        // Round label
        parts.push('<text x="'+(colX+COL_W/2)+'" y="13" text-anchor="middle" font-size="9" font-weight="600" fill="#888" font-family="inherit" letter-spacing="0.07em">'+escXml(rnd.label)+'</text>');
        rnd.series.forEach(function(s,si){
          var boxH=CELL_H*2+PAD_V*2,topY=20+si*step+(step-boxH)/2,midY=topY+boxH/2;
          curC.push(midY);
          var seriesWTA=getSeriesWTA(rnd.order);
          var isSingle=seriesWTA===1;
          var sdone=s.done||s.w1>=seriesWTA||s.w2>=seriesWTA;
          var sw=sdone?(s.w1>s.w2?s.t1:s.t2):'';
          var gs=pairGames(s.t1,s.t2);

          // Box
          parts.push('<rect x="'+colX+'" y="'+topY+'" width="'+COL_W+'" height="'+boxH+'" rx="3" fill="var(--bg3)" stroke="'+(sdone?'#333':'rgba(226,201,126,0.3)')+'" stroke-width="1"/>');
          parts.push('<line x1="'+colX+'" y1="'+(topY+PAD_V+CELL_H)+'" x2="'+(colX+COL_W)+'" y2="'+(topY+PAD_V+CELL_H)+'" stroke="#333" stroke-width="0.75"/>');

          // Teams
          [{n:s.t1,w:s.w1},{n:s.t2,w:s.w2}].forEach(function(t,ti){
            var rowY=topY+PAD_V+ti*CELL_H,midTY=rowY+CELL_H*0.67;
            var isW=sdone&&t.n===sw,isL=sdone&&t.n!==sw;
            var fill=isW?'var(--accent)':(isL?'#555':'var(--text)'),fw=isW?'600':'400';
            // Score: actual game score for single-elim, series wins for series
            var sc;
            if(isSingle&&gs.length>0){
              var g0=gs[0];
              sc=g0.winner===t.n?(g0.winner_score||0):(g0.loser_score||0);
            } else { sc=Math.min(t.w||0,seriesWTA); }

            if(isW)parts.push('<rect x="'+colX+'" y="'+rowY+'" width="'+COL_W+'" height="'+CELL_H+'" fill="rgba(255,255,255,0.04)"/>');
            parts.push('<foreignObject x="'+(colX+6)+'" y="'+rowY+'" width="'+(COL_W-30)+'" height="'+CELL_H+'"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:11px;line-height:'+CELL_H+'px;color:'+fill+';font-weight:'+fw+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'+(isL?'text-decoration:line-through;opacity:0.5;':'')+'font-family:inherit;">'+escXml(t.n)+(isW?' \u2713':'')+(N>0&&!isCompleted&&champCount[t.n]!==undefined?' <span style="font-size:9px;color:#888">'+pct(champCount[t.n])+'</span>':'')+'</div></foreignObject>');
            parts.push('<text x="'+(colX+COL_W-5)+'" y="'+midTY+'" text-anchor="end" font-size="12" font-family="var(--font-mono,monospace)" font-weight="'+fw+'" fill="'+(isW?'var(--accent)':'#666')+'">'+sc+'</text>');
          });

          // Connectors: only draw if rounds are paired (each has 2x series of next)
          if(ri>0){
            var prevN=prevCenters.length, curN=rounds[ri].series.length;
            if(prevN===curN*2){
              // Clean bracket: pair [0,1]→0, [2,3]→1 etc
              var pA=prevCenters[si*2],pB=prevCenters[si*2+1];
              if(pA!==undefined&&pB!==undefined){
                var jx=colX-CONN/2;
                parts.push('<polyline points="'+(colX-CONN)+','+pA+' '+jx+','+pA+' '+jx+','+pB+' '+(colX-CONN)+','+pB+'" fill="none" stroke="#444" stroke-width="1.5"/>');
                parts.push('<line x1="'+jx+'" y1="'+midY+'" x2="'+colX+'" y2="'+midY+'" stroke="#444" stroke-width="1.5"/>');
              }
            } else {
              // Non-paired (e.g. MLB WC→DS): just draw a horizontal line to box
              parts.push('<line x1="'+(colX-CONN)+'" y1="'+midY+'" x2="'+colX+'" y2="'+midY+'" stroke="#555" stroke-width="1.5" stroke-dasharray="4,3"/>');
            }
          } else if(ri===0){
            parts.push('<line x1="0" y1="'+midY+'" x2="'+colX+'" y2="'+midY+'" stroke="#444" stroke-width="1.5"/>');
          }

          // Clickable for game log
          if(gs.length>0){
            var ck=escXml([s.t1,s.t2].sort().join('||'));
            parts.push('<rect class="svgbtn" data-key="'+ck+'" x="'+colX+'" y="'+topY+'" width="'+COL_W+'" height="'+boxH+'" rx="3" fill="transparent" cursor="pointer" opacity="0"/>');
            parts.push('<circle cx="'+(colX+COL_W-8)+'" cy="'+(topY+5)+'" r="2.5" fill="#666" pointer-events="none"/>');
            glData[ck]={t1:s.t1,t2:s.t2,w1:s.w1,w2:s.w2,games:gs};
          }
        });
        prevCenters=curC;
      });

      window._tourney_gl=glData;
      html+='<div style="overflow-x:auto;margin-bottom:1rem">'
        +'<svg id="brk-svg" xmlns="http://www.w3.org/2000/svg" width="'+SVG_W+'" height="'+SVG_H+'" style="display:block;font-family:inherit">'
        +parts.join('')+'</svg></div>';

      // Game log panel
      html+='<div id="game-log-panel" style="display:none;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:0.75rem;margin-bottom:1rem">'
        +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">'
        +'<span id="glp-title" style="font-weight:600;font-size:0.8rem;color:var(--text)"></span>'
        +'<button id="glp-close" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:1.1rem;line-height:1">x</button>'
        +'</div><div id="glp-body"></div></div>';

      html+='<div style="font-size:0.6rem;color:var(--text-dim);margin-bottom:0.75rem">Click any matchup box to see game details</div>';
    }

    // ── Champion + Odds ──────────────────────────────────────────
    var champ = isCompleted ? findChamp()
      : allTeams.filter(function(t){return !eliminated[t];}).sort(function(a,b){return (champCount[b]||0)-(champCount[a]||0);})[0]||null;

    if(champ){
      html+='<div class="card" style="padding:0.85rem;display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem;border:1px solid var(--accent)">'
        +'<div style="flex:1"><div style="font-size:0.55rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-dim)">'+(isCompleted?'🏆 Champion':'Projected Champion')+'</div>'
        +'<div style="font-size:1.15rem;font-weight:700;color:'+clr(champ)+'">'+champ+'</div>'
        +(getElo(champ)?'<div style="font-size:0.68rem;color:var(--text-dim)">Elo '+getElo(champ).toFixed(0)+(N>0?' · '+pct(champCount[champ]||0)+' odds':'')+'</div>':'')
        +'</div><div style="font-size:1.8rem">🏆</div></div>';
    }

    // ── Odds table inline ───────────────────────────────────────
    if(N>0&&allTeams.length){
      var sorted2=allTeams.slice().sort(function(a,b){return (champCount[b]||0)-(champCount[a]||0);});
      html+='<div style="font-weight:600;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim);margin-bottom:0.4rem">Championship Odds</div>';
      html+='<div class="card" style="padding:0.5rem;overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.75rem">'
        +'<thead><tr style="border-bottom:1px solid var(--border)">'
        +'<th style="text-align:left;padding:0.3rem 0.4rem;font-size:0.55rem;text-transform:uppercase;color:var(--text-dim)">Team</th>'
        +'<th style="text-align:right;padding:0.3rem 0.4rem;font-size:0.55rem;text-transform:uppercase;color:var(--text-dim)">Elo</th>'
        +'<th style="padding:0.3rem 0.4rem;font-size:0.55rem;text-transform:uppercase;color:var(--accent)">Win %</th>'
        +'</tr></thead><tbody>';
      sorted2.forEach(function(t){
        var isOut=!!eliminated[t],e=getElo(t)||1500;
        var bw=Math.round((champCount[t]||0)/N*100);
        var c=isOut?'var(--text-dim)':e>=avgElo?'var(--green-hi)':e<avgElo-150?'var(--red-hi)':'var(--accent)';
        html+='<tr style="border-bottom:1px solid rgba(255,255,255,0.04);'+(isOut?'opacity:0.35;':'')+'">'
          +'<td style="padding:0.25rem 0.4rem;color:'+c+';font-weight:600">'+t+(isOut?' <span style="font-size:0.55rem;color:var(--red-hi)">OUT</span>':'')+'</td>'
          +'<td style="padding:0.25rem 0.4rem;font-family:var(--font-mono);font-size:0.68rem;color:var(--text-dim);text-align:right">'+e.toFixed(0)+'</td>'
          +'<td style="padding:0.25rem 0.4rem"><div style="display:flex;align-items:center">'
            +'<span style="color:'+c+';font-weight:600;min-width:38px">'+bw+'%</span>'
            +'<div style="background:var(--bg4);border-radius:2px;height:3px;flex:1;margin-left:4px;overflow:hidden">'
              +'<div style="width:'+bw+'%;height:100%;background:'+c+'"></div></div>'
          +'</div></td></tr>';
      });
      html+='</tbody></table></div>';
    }
    el.innerHTML = html;

    // Wire click handlers
    setTimeout(function(){
      var cls=document.getElementById('glp-close');
      var glp=document.getElementById('game-log-panel');
      if(cls&&glp)cls.onclick=function(){glp.style.display='none';};
      document.querySelectorAll('.svgbtn').forEach(function(btn){
        btn.addEventListener('click',function(){
          var d2=(window._tourney_gl||{})[this.getAttribute('data-key')];
          if(!d2||!glp)return;
          var label=d2.w1+'-'+d2.w2;
          document.getElementById('glp-title').textContent=d2.t1+' vs '+d2.t2+(d2.w1||d2.w2?' · Series '+label:'');
          document.getElementById('glp-body').innerHTML=d2.games.map(function(g,i){
            var ws=g.winner_score||0,ls=g.loser_score||0;
            var dt=g.date?'<span style="color:#888;font-size:.65rem;margin-left:.3rem">'+g.date.slice(5)+'</span>':'';
            return '<div style="display:flex;gap:.5rem;padding:.25rem 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:.78rem">'
              +'<span style="color:#888;min-width:2rem;flex-shrink:0">G'+(i+1)+'</span>'
              +'<span style="flex:1;font-weight:600;color:var(--accent)">'+g.winner+'</span>'
              +'<span style="font-family:monospace;color:var(--text)">'+ws+'–'+ls+'</span>'
              +dt+'</div>';
          }).join('');
          glp.style.display='block';
        });
      });
      var rsim=document.getElementById('gen-resim');
      if(rsim)rsim.onclick=function(){_renderTourneyData(el,d);};
    },80);
  }



  function _renderProjectedOdds(el, yr) {
    _renderTourneyData(el, {
      year:yr, sport:CFG.sport, completed:false,
      games:[], series:[], eliminated:[], updated:null
    });
  }
  function renderBracketology() {
    const el = document.getElementById('panel-bracketology');
    if (!el || !data.length) return;
    el.innerHTML = '<div class="loading"><div class="spinner"></div>Building bracket…</div>';

    // ── Config ────────────────────────────────────────────────────────────────
    const EXCLUDE = new Set(['NA','N/A','Unknown','Other D1','Independent','Ind','']);
    const isCBB   = CFG.sport === 'CBB';
    const isCBASE = CFG.sport === 'CBASE';
    const season  = currentSeason || CFG.seasons[0];
    const is76    = isCBB && season >= 2027;
    const total   = is76 ? 76 : (isCBB ? 68 : 64);

    // ── Fetch conference tournament champions from ESPN ────────────────────────
    // CBB: conf tournaments run late Feb–mid March (seasontype=3)
    // CBASE: conf tournaments run mid-May (seasontype=3)
    async function fetchConfChamps() {
      // For CBB: sweep the conference-tournament window day by day
      // For CBASE: use conference tournament scoreboard
      if (isCBB) {
        // The endpoint this used to call — .../tournament/bracket?season=YYYY
        // — 404s (confirmed by direct testing; it's not a real endpoint, or
        // at least not one that accepts a bare `season` param), so this
        // silently found zero champs every time and fell all the way
        // through to the Elo-based "projected" fallback below — which is
        // why auto bids always showed the highest-Elo team even for
        // seasons whose real conference tournaments had already finished.
        //
        // Fix: walk the actual conference-tournament window (~Feb 25 – Mar
        // 18) one day at a time — ESPN's basketball scoreboard endpoint
        // doesn't support dates=RANGE queries (confirmed separately; single
        // 8-digit dates work) — and look for completed games whose notes
        // headline reads as a true FINAL ("Big Ten Tournament - Final",
        // "Atlantic 10 Championship - Final", etc. — word-boundary match on
        // "final", explicitly excluding "Semifinal"/"Quarterfinal"). Both
        // teams' conferences come from THIS season's own CSV rows (`data`,
        // already loaded), not from parsing the conference name out of the
        // headline text — so it never depends on ESPN's naming matching
        // ours. If both teams share a conference, the winner is that
        // conference's confirmed auto bid.
        var teamToConf = {};
        data.forEach(function(r){ if (r.team && r.conference) teamToConf[r.team] = r.conference; });

        function dateSweepList(y, m0, d0, endM0, endD0) {
          var out = [];
          var d = new Date(Date.UTC(y, m0, d0));
          var end = new Date(Date.UTC(y, endM0, endD0));
          while (d <= end) {
            out.push(''+d.getUTCFullYear()+String(d.getUTCMonth()+1).padStart(2,'0')+String(d.getUTCDate()).padStart(2,'0'));
            d.setUTCDate(d.getUTCDate()+1);
          }
          return out;
        }
        // Month args are 0-indexed: 1=Feb, 2=Mar. Comfortably spans every
        // conference's championship Sunday without reaching into NCAA
        // Tournament dates (Round of 64 starts ~Mar 19-20) or the National
        // Championship (early April), so a headline match here can't
        // accidentally pick up the wrong game.
        var dates = dateSweepList(season, 1, 25, 2, 18);

        var champs = {};
        var BATCH = 6;
        for (var b = 0; b < dates.length; b += BATCH) {
          var batch = dates.slice(b, b+BATCH);
          await Promise.all(batch.map(function(d) {
            var url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates='+d+'&groups=50&limit=500';
            return fetch(url, {mode:'cors'})
              .then(function(r){ return r.ok ? r.json() : null; })
              .catch(function(){ return null; })
              .then(function(sd) {
                if (!sd || !sd.events) return;
                sd.events.forEach(function(ev) {
                  try {
                    var comp = ev.competitions && ev.competitions[0]; if (!comp) return;
                    if (!comp.status || !comp.status.type || !comp.status.type.completed) return;
                    var notes = (comp.notes||ev.notes||[]).map(function(n){return n.headline||'';}).join(' ');
                    if (!/\bfinal\b/i.test(notes) || /semifinal|quarterfinal/i.test(notes)) return;
                    var competitors = comp.competitors||[];
                    if (competitors.length !== 2) return;
                    var winner=null, max=-1;
                    competitors.forEach(function(c){ var s=parseFloat(c.score); if(!isNaN(s)&&s>max){max=s;winner=c;} });
                    if (!winner) return;
                    var loser = competitors.find(function(c){ return c!==winner; });
                    var wn = winner.team.shortDisplayName || winner.team.displayName || '';
                    var ln = loser && (loser.team.shortDisplayName || loser.team.displayName) || '';
                    var wConf = teamToConf[wn], lConf = teamToConf[ln];
                    if (wConf && wConf === lConf) champs[wConf] = wn;
                  } catch(e){}
                });
              });
          }));
        }
        // Shape matches what the caller below already expects: a
        // lowercased-key -> team-name map, matched via confLow/confAlpha.
        var result = {};
        Object.keys(champs).forEach(function(k){ result[k.toLowerCase()] = champs[k]; });
        return result;
      } else {
        // CBASE: same fix as CBB, applied by direct analogy —
        //
        // The old version here had two bugs that together guaranteed it
        // never found a real champion: (1) its first URL never included a
        // `dates=` param at all, so instead of querying the *selected*
        // season's conference-tournament window it queried ESPN's default
        // "today" slate — meaningless for any season other than whatever
        // happens to be in progress right now, and completely empty the
        // rest of the year (this is CBASE's off-season as of this fix).
        // (2) it flagged a game as "the champion" whenever any note
        // headline merely CONTAINED the word "champion" — a false positive
        // on every earlier round too, since ESPN labels those "<Conf>
        // Championship - Quarterfinal" / "- Semifinal", which also contain
        // "champion". Whichever round got processed first silently won.
        //
        // Fix, mirroring the CBB approach one-for-one: sweep the real
        // conference-tournament window for the *selected* season with a
        // proper dates= range, require a true final-round headline (ends
        // in "- Final", not "- Semifinal"/"- Quarterfinal"/etc — same
        // suffix rule already proven live for CBB, and used by the R
        // backend's own fetch_conf_champs() for exactly this reason), and
        // resolve both teams' conferences from THIS season's own CSV
        // (`data`), not from parsing ESPN's own conference-name text —
        // so it never depends on ESPN's naming matching ours. Only counts
        // as an auto bid if both teams share a conference by our own data.
        //
        // Window is May 10 – Jun 3: regular-season conference tournaments
        // mostly run mid-to-late May, but some (SEC, ACC) can run into the
        // very start of June, so this is intentionally a bit wider than
        // the R backend's May 15–28 window to avoid clipping a late final.
        //
        // NOTE: unlike CBB's endpoint (confirmed to 404 on dates=RANGE,
        // requiring a day-by-day sweep), college baseball's scoreboard
        // does accept dates=RANGE — this codebase's own R backend
        // (update_college_baseball.R's fetch_cbase_season()) already
        // fetches full season data this way successfully. This branch
        // could not be re-verified against live ESPN data at fix time
        // (the diagnostic tool available was returning an unrelated
        // cached/default response for this endpoint no matter what params
        // were sent), so if auto bids still look wrong for a past CBASE
        // season after this ships, that's the first thing to re-check.
        var teamToConf = {};
        data.forEach(function(r){ if (r.team && r.conference) teamToConf[r.team] = r.conference; });

        function isFinalRound(headline) {
          var h = (headline||'').trim();
          if (!h) return false;
          if (/-\s*(semi|quarter|elite|first|second|1st|2nd|3rd)\s*final/i.test(h)) return false;
          return /-\s*final\s*$/i.test(h);
        }

        var yr = season;
        var fromDate = yr + '0510'; var toDate = yr + '0603';
        var urls = [
          'https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard?limit=500&dates='+fromDate+'-'+toDate+'&seasontype=3&groups=11',
          'https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard?limit=500&dates='+fromDate+'-'+toDate+'&groups=11'
        ];
        return Promise.all(urls.map(function(u) {
          return fetch(u,{mode:'cors'}).then(function(r){return r.ok?r.json():{events:[]};}).catch(function(){return{events:[]};});
        })).then(function(results) {
          var seen={}, events=[];
          results.forEach(function(d){ (d.events||[]).forEach(function(ev){ if(!seen[ev.id]){seen[ev.id]=1;events.push(ev);} }); });
          var champs = {};
          events.forEach(function(ev) {
            try {
              var comp = (ev.competitions||[])[0];
              if (!comp || !comp.status || !comp.status.type || !comp.status.type.completed) return;
              var notesArr = comp.notes || ev.notes || [];
              var finalHeadline = null;
              for (var i=0;i<notesArr.length;i++) {
                var h = notesArr[i].headline || '';
                if (isFinalRound(h)) { finalHeadline = h; break; }
              }
              if (!finalHeadline) return;
              var competitors = comp.competitors||[];
              if (competitors.length !== 2) return;
              var winner=null, max=-1;
              competitors.forEach(function(c){ var s=parseFloat(c.score); if(!isNaN(s)&&s>max){max=s;winner=c;} });
              if (!winner) return;
              var loser = competitors.find(function(c){ return c!==winner; });
              var wn = winner.team.shortDisplayName || winner.team.displayName || '';
              var ln = loser && (loser.team.shortDisplayName || loser.team.displayName) || '';
              var wConf = teamToConf[wn], lConf = teamToConf[ln];
              if (wConf && wConf === lConf) champs[wConf] = wn;
            } catch(e){}
          });
          var result = {};
          Object.keys(champs).forEach(function(k){ result[k.toLowerCase()] = champs[k]; });
          return result;
        });
      }
    }

    // ── Build bracket after fetching champs ───────────────────────────────────
    fetchConfChamps().then(function(champsByConf) {
      // Build conf groups
      var confTeams = {};
      data.forEach(function(r) {
        var c = r.conference || '';
        if (!confTeams[c]) confTeams[c] = [];
        confTeams[c].push(r);
      });

      // Assign auto bids
      var byConf = {};
      Object.entries(confTeams).forEach(function(entry) {
        var conf = entry[0]; var teams = entry[1];
        if (EXCLUDE.has(conf) || !conf) return;
        if (teams.length < 2) return;

        // 1. Check ESPN-fetched champs
        // champsByConf keys are full conf name + abbreviation, all lowercase
        // CSV conference field: hoopR uses full names like "Atlantic Coast Conference"
        var champTeam = null;
        var confLow   = conf.toLowerCase().replace(/\s+conference$/i,'').trim();
        var confAlpha = conf.toLowerCase().replace(/[^a-z0-9]/g,'');
        if (Object.keys(champsByConf).length > 0) {
          var espnWinner = null;
          // Direct match on full or short name
          Object.keys(champsByConf).forEach(function(k) {
            if (espnWinner) return;
            var kAlpha = k.replace(/[^a-z0-9]/g,'');
            if (k === confLow || kAlpha === confAlpha ||
                confLow.includes(k) || k.includes(confLow) ||
                confAlpha.includes(kAlpha) || kAlpha.includes(confAlpha)) {
              espnWinner = champsByConf[k];
            }
          });
          if (espnWinner) {
            var matched = teams.find(function(t) {
              return t.team.toLowerCase() === espnWinner.toLowerCase() ||
                     t.team.toLowerCase().includes(espnWinner.toLowerCase()) ||
                     espnWinner.toLowerCase().includes(t.team.toLowerCase());
            });
            if (matched) champTeam = {team: matched, confirmed: true};
          }
        }

        // 2. Check CSV conf_champ column
        if (!champTeam) {
          var csvChamp = teams.find(function(r) {
            return String(r.conf_champ||'').trim().toUpperCase() === 'TRUE';
          });
          if (csvChamp) champTeam = {team: csvChamp, confirmed: true};
        }

        // 3. Fallback: highest Elo
        if (!champTeam) {
          var best = teams.slice().sort(function(a,b){return b.elo-a.elo;})[0];
          champTeam = {team: best, confirmed: false};
        }

        byConf[conf] = Object.assign({}, champTeam.team, {_confirmed: champTeam.confirmed});
      });

      var autoBids  = Object.values(byConf);
      var autoTeams = new Set(autoBids.map(function(r){return r.team;}));

      var atLarge = data
        .filter(function(r){ return !autoTeams.has(r.team) && !EXCLUDE.has(r.conference||''); })
        .sort(function(a,b){ return b.elo - a.elo; })
        .slice(0, total - autoBids.length);

      var field = autoBids.concat(atLarge).sort(function(a,b){ return b.elo - a.elo; });

      // Seeds
      var seeds;
      if (isCBB && is76) {
        seeds = Array.from({length:76}, function(_,i){ return Math.floor(i/4)+1; });
      } else if (isCBB) {
        seeds = [1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,6,6,6,6,7,7,7,7,
                 8,8,8,8,9,9,9,9,10,10,10,10,11,11,11,11,11,11,
                 12,12,12,12,13,13,13,13,14,14,14,14,15,15,15,15,16,16,16,16,16,16];
      } else {
        seeds = Array.from({length:64}, function(_,i){ return Math.floor(i/4)+1; });
      }

      field.forEach(function(r,i){
        r._seed = seeds[i] || (Math.floor(i/4)+1);
        r._auto = autoTeams.has(r.team);
      });

      var confirmed = autoBids.filter(function(r){return r._confirmed;}).length;
      var projected = autoBids.filter(function(r){return !r._confirmed;}).length;
      var champCount = Object.keys(champsByConf).length;

      var infoEl = document.getElementById('bracketInfo');
      if (infoEl) {
        var s = autoBids.length + ' auto bids';
        if (champCount > 0) s += ' (' + confirmed + ' confirmed · ' + projected + ' projected)';
        else s += ' (projected — champ data loading)';
        s += ' · ' + atLarge.length + ' at-large · ' + field.length + ' total';
        if (is76) s += ' · 76-team format (2026-27+)';
        infoEl.textContent = s;
      }

      var bySeed = {};
      field.forEach(function(r){ if(!bySeed[r._seed]) bySeed[r._seed]=[]; bySeed[r._seed].push(r); });

      el.innerHTML = '<div class="bracket-grid">' +
        Object.entries(bySeed).map(function(e) {
          var seed = e[0]; var teams = e[1];
          return '<div class="bracket-card">' +
            '<div class="bracket-card-header">Seed ' + seed + '</div>' +
            teams.map(function(r) {
              var tag = r._auto && r._confirmed
                ? '<span class="card-tag tag-live" style="font-size:0.5rem;padding:0.1rem 0.35rem">CHAMP</span>'
                : r._auto
                ? '<span class="card-tag" style="font-size:0.5rem;padding:0.1rem 0.35rem;background:var(--bg3)">AUTO\u2605</span>'
                : '';
              return '<div class="bracket-line">' +
                '<div class="seed ' + (parseInt(seed)<=3?'s'+seed:'') + '">' + seed + '</div>' +
                '<div style="flex:1;min-width:0">' +
                  '<div class="bracket-line-team">' + r.team + '</div>' +
                  '<div class="bracket-line-conf">' + (r.conference||'\u2014') + ' \u00b7 ' + r.elo.toFixed(1) + '</div>' +
                '</div>' + tag + '</div>';
            }).join('') + '</div>';
        }).join('') + '</div>' +
        '<div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);margin-top:0.75rem;padding:0.5rem;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius)">' +
        'CHAMP\u00a0=\u00a0confirmed conf tournament winner\u2002\u00b7\u2002AUTO\u2605\u00a0=\u00a0projected (highest Elo)\u2002\u00b7\u2002At-large by Elo' +
        '</div>';
    });
  }

  // ── Resume (CFB) ───────────────────────────────────────────
  // CFB's Resume tab tries the Playoff Chance feature first (only ever
  // published for the active/in-progress season — see
  // R/update_cfb_playoff.R). A missing/failed fetch — historical season,
  // season too early for the sim to have run yet, non-CFB sport — falls
  // straight through to the classic resume-score table below, so this
  // never needs an explicit "is this the active season" flag to maintain.
  async function renderResume() {
    const el = document.getElementById('panel-resume');
    if (!el || !data.length) return;

    if (CFG.sport === 'CFB') {
      el.innerHTML = '<div class="loading"><div class="spinner"></div>Loading playoff picture…</div>';
      try {
        const url = CFG.dataPath.replace('CFB_Elo_', 'CFB_Playoff_') + currentSeason + '.json';
        const resp = await fetch(url, { cache: 'no-store' });
        if (resp.ok) {
          const pj = await resp.json();
          if (pj && pj.teams && pj.teams.length) { renderPlayoffChance(el, pj); return; }
        }
      } catch (e) { /* fall through to the classic table below */ }
    }
    renderResumeClassic(el);
  }

  function renderResumeClassic(el) {
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
        ${CFG.sport==='CFB'?'<th data-type="num" title="Playoff Rating = Elo × win_pct^0.6 + √(quality resume)">PR ⓘ</th>':''}
        <th>Record</th>
        <th data-type="num">Resume Score</th><th data-type="num">SOS</th><th>Best Win</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
    makeSortable(document.getElementById('mainTable'));
  }

  // ────────────────────────────────────────────────────────────
  // CFB PLAYOFF CHANCE (active season only)
  // Renders R/update_cfb_playoff.R's server-side Monte Carlo output —
  // this file does no simulation of its own, only string-builds HTML
  // from numbers the backend already computed (see that script's header
  // comment for the full methodology). Every helper below is prefixed
  // pc* / .pc- so nothing here can collide with an existing same-named
  // local (several other tabs declare their own small `pct()` helpers
  // scoped to themselves) or an existing site-wide CSS class.
  // ────────────────────────────────────────────────────────────
  function pcEsc(s) { return String(s == null ? '' : s); }
  function pcPct(x) { return (x == null || isNaN(x)) ? '—' : Math.round(x * 100) + '%'; }

  function pcChanceCell(p) {
    const v = (p == null) ? 0 : p;
    const cls = v >= 0.5 ? 'in' : (v >= 0.03 ? 'bubble' : 'out');
    const barPct = Math.max(2, Math.round(v * 100));
    return `<div class="pc-chance-cell">
      <div class="pc-chance-pct pc-pct-${cls}">${pcPct(v)}</div>
      <div class="pc-chance-bar-wrap"><div class="pc-chance-bar pc-bar-${cls}" style="width:${barPct}%"></div></div>
    </div>`;
  }

  function pcMethodCard(pj) {
    const g5 = pj.auto_bid_conferences.filter(c => pj.power4_conferences.indexOf(c) === -1).join(' / ');
    return `<div class="pc-method-card"><h3>How this works</h3><div class="pc-method-grid">
      <div><div class="pc-method-item-lbl">Field</div><div class="pc-method-item-val"><b>12 teams</b> — top 4 seeds get a first-round bye, straight-seeded by Playoff Rating</div></div>
      <div><div class="pc-method-item-lbl">Automatic bids (5)</div><div class="pc-method-item-val"><b>${pj.power4_conferences.join(' · ')}</b> champions, plus the highest-ranked champion among ${g5}</div></div>
      <div><div class="pc-method-item-lbl">Remaining games</div><div class="pc-method-item-val">Win probability from each team's <b>current Elo</b> (+${pj.hca} HCA) — Elo itself is frozen; only Playoff Rating/records update per simulation</div></div>
      <div><div class="pc-method-item-lbl">Where it runs</div><div class="pc-method-item-val">Simulated <b>server-side</b> during the scheduled update, not in your browser — this page just loads the finished numbers</div></div>
    </div></div>`;
  }

  function pcAutobidRow(pj) {
    const byTeam = {};
    (pj.teams || []).forEach(t => byTeam[t.team] = t);
    const chips = (pj.auto_bid_tracker || []).map(a => {
      const t = a.team ? byTeam[a.team] : null;
      const chance = t ? pcPct(t.win_ccg_pct) + ' to win conf.' : 'No projected leader yet';
      return `<div class="pc-autobid-chip">
        <div class="pc-autobid-conf">${pcEsc(a.conference)}${a.power4 ? '' : ' (highest G5)'}</div>
        <div class="pc-autobid-team">${pcEsc(a.team || '—')}</div>
        <div class="pc-autobid-chance">${chance}</div>
      </div>`;
    }).join('');
    return `<div class="pc-sec-row"><div class="pc-sec-title" style="font-size:1.05rem">Automatic-bid tracker</div></div>
      <div class="pc-autobid-row">${chips}</div>`;
  }

  function pcFieldCard(pj) {
    const field = pj.field_today || [];
    const rows = field.map(f => `<div class="pc-bracket-line${f.auto_bid ? '' : ' at-large'}">
      <div class="pc-seed${f.bye ? ' bye' : ''}">${f.bye ? 'BYE' : f.seed}</div>
      <div class="pc-bracket-line-team"><div class="pc-bracket-line-name">${pcEsc(f.team)}</div>
      <div class="pc-bracket-line-conf">${pcEsc(f.conference)}${f.auto_bid ? ' · auto-bid' : ' · at-large'}</div></div>
      <div class="pc-bracket-line-chance">#${f.seed}</div>
    </div>`).join('');
    const r1 = [[4,11],[5,10],[6,9],[7,8]].filter(p => field[p[1]]);
    const r1html = r1.map(p => {
      const hi = field[p[0]], lo = field[p[1]];
      return `<div class="pc-bracket-line"><div class="pc-seed">${hi.seed}</div>
        <div class="pc-bracket-line-team"><div class="pc-bracket-line-name">${pcEsc(hi.team)} <span style="color:var(--text-dim);font-weight:400">vs</span> ${pcEsc(lo.team)}</div>
        <div class="pc-bracket-line-conf">at #${hi.seed} ${pcEsc(hi.team)}</div></div>
        <div class="pc-bracket-line-chance">#${lo.seed}</div></div>`;
    }).join('');
    return `<div class="pc-sec-row"><div class="pc-sec-title" style="font-size:1.05rem">Projected field — if the season ended today</div></div>
      <div class="pc-bracket-grid">
        <div class="pc-bracket-card"><div class="pc-bracket-card-header">12-team field</div>${rows}</div>
        <div class="pc-bracket-card"><div class="pc-bracket-card-header">First round (seeds 1-4 host)</div>${r1html || '<div style="color:var(--text-dim);font-size:0.8rem">Not enough of the field is settled yet.</div>'}</div>
      </div>`;
  }

  function pcCcgAccordion(pj) {
    const confs = Object.keys(pj.conferences || {}).sort((a, b) => {
      const pa = pj.conferences[a].power4, pb = pj.conferences[b].power4;
      if (pa !== pb) return pa ? -1 : 1;
      return a.localeCompare(b);
    });
    const rows = confs.map((conf, i) => {
      const c = pj.conferences[conf];
      const lm = c.likely_matchup;
      const matchupHtml = lm ? lm.matchup.replace(' vs ', ' <span class="vs">vs</span> ') : 'Not enough of the race is decided yet';
      const pctHtml = lm ? pcPct(lm.pct) : '';
      const standingsHtml = (c.standings || []).slice(0, 8).map(s => {
        const isLeader = c.projected_ccg && (s.team === c.projected_ccg.team1 || s.team === c.projected_ccg.team2);
        return `<div class="pc-ccg-standings-row${isLeader ? ' lead' : ''}${s.eligible ? '' : ' ineligible'}">
          <span>${pcEsc(s.team)}</span><span>${pcEsc(s.conference_record)}</span></div>`;
      }).join('');
      return `<details class="pc-ccg-row"${i === 0 ? ' open' : ''}>
        <summary class="pc-ccg-summary">
          <div class="pc-ccg-conf">${pcEsc(conf)}${c.has_divisions ? ' (divisions)' : ''}</div>
          <div class="pc-ccg-matchup">${matchupHtml}</div>
          <div class="pc-ccg-conf-pct">${pctHtml}</div>
          <svg class="pc-ccg-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        </summary>
        <div class="pc-ccg-detail"><div class="pc-ccg-detail-grid">
          <div><div class="pc-ccg-decided-lbl">Current standings (top 8)</div><div class="pc-ccg-standings">${standingsHtml}</div></div>
          <div><div class="pc-ccg-decided-lbl">How the tiebreaker works<span class="pc-approx-tag">approx beyond common opp.</span></div>
          <div class="pc-ccg-decided-val">${pcEsc(c.tiebreak_note)}</div></div>
        </div></div>
      </details>`;
    }).join('');
    return `<div class="pc-sec-row"><div class="pc-sec-title" style="font-size:1.05rem">Conference championship races</div></div>
      <div class="pc-ccg-list">${rows}</div>`;
  }

  function pcTeamTable(pj) {
    const teams = (pj.teams || []).slice().sort((a, b) => (b.playoff_pct || 0) - (a.playoff_pct || 0));
    const rowsHtml = teams.map((t, i) => `<tr class="pc-selectable" data-pc-team="${pcEsc(t.team).replace(/"/g,'&quot;')}">
      <td class="rank">${i + 1}</td>
      <td class="team-name"><div class="pc-team-expand-lbl"><svg class="pc-team-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M6 9l6 6 6-6"/></svg>${pcEsc(t.team)}${t.cfp_ineligible ? ' <span class="pc-approx-tag">ineligible</span>' : ''}</div></td>
      <td class="conf">${pcEsc(t.conference)}</td>
      <td class="record">${pcEsc(t.record)}</td>
      <td class="num" data-val="${t.elo}">${t.elo.toFixed(1)}</td>
      <td class="num" data-val="${t.pr}" style="color:var(--accent)">${t.pr.toFixed(1)}</td>
      <td class="num" data-val="${t.reach_ccg_pct||0}">${pcPct(t.reach_ccg_pct)}</td>
      <td class="num" data-val="${t.playoff_pct||0}">${pcChanceCell(t.playoff_pct)}</td>
    </tr>`).join('');
    return `<div class="pc-sec-row"><div class="pc-sec-title" style="font-size:1.05rem">Every team</div>
      <div class="pc-sec-cap">Click a row for what needs to happen</div></div>
      <div class="table-wrap"><table class="tbl" id="pcTable"><thead><tr>
        <th data-type="num">Rank</th><th>Team</th><th>Conf</th><th>Record</th>
        <th data-type="num">Elo</th><th data-type="num">PR</th>
        <th data-type="num">Reach CCG</th><th data-type="num">Playoff Chance</th>
      </tr></thead><tbody>${rowsHtml}</tbody></table></div>
      <div class="pc-foot-cap">${pj.n_trials.toLocaleString()} simulations · updated ${new Date(pj.updated_at).toLocaleString()}</div>`;
  }

  function pcScenarioText(t) {
    if (t.cfp_ineligible) {
      return '<div class="pc-scenario-text">Not CFP-eligible this season (NCAA-mandated FBS transition window).</div>';
    }
    const buckets = t.scenario.buckets || [];
    const nRem = t.scenario.games_remaining;
    const winOutPct = t.scenario.win_out_pct;
    let needed = null;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].playoff_pct != null && buckets[i].playoff_pct >= 0.5) { needed = buckets[i].wins; break; }
    }
    const lines = [];
    if ((t.playoff_pct || 0) >= 0.97) {
      lines.push(`Very likely in — makes the field in <b>${pcPct(t.playoff_pct)}</b> of simulations already.`);
    } else if (nRem === 0) {
      lines.push(`No remaining regular-season games tracked — sits at <b>${pcPct(t.playoff_pct)}</b> to make the field from here.`);
    } else if (needed != null) {
      lines.push(`Needs to go at least <b>${needed}-${nRem-needed}</b> the rest of the way to be a better-than-even bet (currently <b>${pcPct(t.playoff_pct)}</b> overall).`);
      if (winOutPct != null) lines.push(`Win out (${nRem}-0) and it jumps to <b>${pcPct(winOutPct)}</b>.`);
    } else {
      lines.push(`Even winning out (${nRem}-0 the rest of the way) only gets ${pcEsc(t.team)} to <b>${pcPct(winOutPct)}</b> — it needs help from other results too.`);
    }
    return `<div class="pc-scenario-text">${lines.join(' ')}</div>`;
  }

  function pcScenarioGames(t) {
    const games = (t.remaining_games || []).map(g => `<div class="pc-scenario-game"><span class="pc-scenario-game-opp">${g.home ? 'vs ' : '@ '}${pcEsc(g.opponent)}${g.neutral ? ' (neutral)' : ''}</span>
      <span class="pc-scenario-game-prob">${pcPct(g.win_prob)} to win</span></div>`).join('');
    return `<div class="pc-scenario-games">${games || '<div style="color:var(--text-dim);font-size:0.78rem">No remaining games tracked.</div>'}</div>`;
  }

  function pcCcgBranch(t) {
    if (!t.scenario.ccg_relevant || !t.scenario.ccg_buckets || !t.scenario.ccg_buckets.length) return '';
    const row = t.scenario.ccg_buckets[t.scenario.ccg_buckets.length - 1];
    const branch = (lbl, obj, hi) => `<div class="pc-branch"><div class="pc-branch-lbl">${lbl}</div>
      <div class="pc-branch-pct${hi ? ' hi' : ''}">${pcPct(obj ? obj.playoff_pct : null)}</div></div>`;
    return `<div class="pc-scenario-full">
      <div class="pc-scenario-ccg-note">If <b>${pcEsc(t.team)}</b> wins out the rest of the regular season, here is how reaching (and winning) the conference title game splits its playoff odds:</div>
      <div class="pc-scenario-branches">
        ${branch('Doesn\'t reach CCG', row.no_reach, false)}
        ${branch('Reaches, loses', row.reach_lose, false)}
        ${branch('Reaches, wins', row.reach_win, true)}
      </div></div>`;
  }

  function pcScenarioRowHtml(t) {
    return `<div class="pc-scenario-wrap">
      <div><div class="pc-scenario-lbl">What needs to happen</div>${pcScenarioText(t)}</div>
      <div><div class="pc-scenario-lbl">Remaining games</div>${pcScenarioGames(t)}</div>
    </div>${pcCcgBranch(t)}`;
  }

  function renderPlayoffChance(el, pj) {
    el.innerHTML = pcMethodCard(pj) + pcAutobidRow(pj) + pcFieldCard(pj) + pcCcgAccordion(pj) + pcTeamTable(pj);
    makeSortable(document.getElementById('pcTable'));

    const byTeam = {};
    (pj.teams || []).forEach(t => byTeam[t.team] = t);

    document.querySelectorAll('#pcTable tbody tr.pc-selectable').forEach(row => {
      row.addEventListener('click', () => {
        const already = row.nextElementSibling && row.nextElementSibling.classList.contains('pc-scenario-row');
        // Collapse any other open row first — one scenario open at a time.
        document.querySelectorAll('#pcTable tr.pc-scenario-row').forEach(r => r.remove());
        document.querySelectorAll('#pcTable tr.pc-selected').forEach(r => r.classList.remove('pc-selected'));
        if (already) return; // click on the row that was already open just closes it

        const t = byTeam[row.dataset.pcTeam];
        if (!t) return;
        row.classList.add('pc-selected');
        const tr = document.createElement('tr');
        tr.className = 'pc-scenario-row';
        const td = document.createElement('td');
        td.colSpan = row.children.length;
        td.innerHTML = pcScenarioRowHtml(t);
        tr.appendChild(td);
        row.parentNode.insertBefore(tr, row.nextSibling);
      });
    });
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
    playoffRating:{},
    // Live-derived conference data (see pkFetchConferences below) — populated
    // fresh every time a season loads, so realignment never needs a code
    // change. confs: {confName: [team,...]}. divs: {confName: {divName:[...]}}
    // for conferences ESPN reports as having divisions; absent otherwise.
    // confIds: {confName: espnGroupId} used to backfill any conference ESPN's
    // FBS-umbrella scoreboard query omits (same trick as the old Pac-12 fix,
    // just generalized to detect ANY missing conference automatically).
    confs:{}, divs:{}, confIds:{}
  };

  // ── FALLBACK conference rosters — 2025-26 snapshot ───────
  // Sources: Deseret News July 2025, ESPN standings, CFP rules
  // NOT used as the primary source anymore (see pkFetchConferences, which
  // derives conference membership live from ESPN every time a season loads).
  // This snapshot only kicks in if that live fetch fails outright — e.g. the
  // network is blocked or ESPN changes their response shape — so Pick'em
  // degrades gracefully instead of showing an empty page. It WILL go stale
  // after a realignment; that's expected for a last-resort fallback, not a
  // bug to keep fixing every year the way the old primary copy was.
  var PK_CONFS_FALLBACK = {
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

  // ── Divisions fallback — Sun Belt had East/West as of 2025-26 ───
  // Live derivation (pkFetchConferences) detects divisions generically from
  // ESPN's own nested group structure, so this doesn't need to be kept in
  // sync by hand either — it's only consulted if the live fetch fails.
  var PK_DIVS_FALLBACK = {
    "Sun Belt": {
      "East": ["Appalachian State","Coastal Carolina","Georgia Southern",
               "Georgia State","James Madison","Marshall","Old Dominion"],
      "West": ["Arkansas State","Louisiana","Louisiana Tech","South Alabama",
               "Southern Miss","Troy","UL Monroe"]
    }
  };

  // ── CFP auto-bid conferences fallback ────────────────────
  // Live derivation treats any discovered conference with >= 8 teams as
  // auto-bid-eligible (every real FBS conference; a small "Independents"
  // grouping like Notre Dame/UConn naturally falls below that and is
  // correctly at-large-only, with no name matching required).
  var CFP_AUTO_CONF_FALLBACK = ["SEC","Big Ten","Big 12","ACC","Pac-12",
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
    "Jax State":"Jacksonville State",
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

  // Live conference data if pkFetchConferences succeeded this load, else the
  // frozen 2025-26 snapshot. Every consumer below goes through these two
  // helpers instead of touching _pk.confs / PK_CONFS_FALLBACK directly.
  function pkActiveConfs(){ return Object.keys(_pk.confs).length ? _pk.confs : PK_CONFS_FALLBACK; }
  function pkActiveDivs(){ return Object.keys(_pk.confs).length ? _pk.divs : PK_DIVS_FALLBACK; }

  // Set of all FBS team names for fast lookup. Rebuilt lazily — invalidated
  // (_fbs_set = null) every time pkFetchConferences runs so it always
  // reflects whichever conference data is currently active.
  var _fbs_set = null;
  function pkIsFBS(name) {
    if (!_fbs_set) {
      _fbs_set = new Set();
      Object.values(pkActiveConfs()).forEach(function(arr){
        arr.forEach(function(t){ _fbs_set.add(t); });
      });
      Object.keys(PK_ALIAS).forEach(function(k){ _fbs_set.add(k); });
    }
    return _fbs_set.has(name) || _fbs_set.has(PK_ALIAS[name]);
  }

  function pkResolve(t){ return PK_ALIAS[t] || t; }

  function pkConfOf(team){
    var t = pkResolve(team);
    var confs = pkActiveConfs();
    for(var conf in confs){
      if(confs[conf].indexOf(t) !== -1) return conf;
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
        resumeSum+=Math.max(0, oppElo-1350); // quality threshold
      }
      // sqrt of quality-adjusted resume (only wins vs 1350+ Elo count)
      var resumeScore = resumeSum>0 ? Math.sqrt(resumeSum) : 0;
      // PR = Elo × win_pct^0.6 + resume (win% penalizes bad records)
      var gp = (_pk.wins[team]||0) + (_pk.losses[team]||0);
      var wp = gp > 0 ? (_pk.wins[team]||0) / gp : 0.5;
      var wpFactor = Math.pow(Math.max(0.01, wp), 0.6);
      _pk.playoffRating[team] = teamElo * wpFactor + resumeScore;
    }
  }

  function pkSort(teams){
    return teams.slice().sort(function(a,b){
      var acp=(a.cw+a.cl)?a.cw/(a.cw+a.cl):0, bcp=(b.cw+b.cl)?b.cw/(b.cw+b.cl):0;
      if(Math.abs(bcp-acp)>0.001) return bcp-acp;
      var awp=(a.w+a.l)?a.w/(a.w+a.l):0, bwp=(b.w+b.l)?b.w/(b.w+b.l):0;
      if(Math.abs(bwp-awp)>0.001) return bwp-awp;
      return (b.pr||b.elo||1500)-(a.pr||a.elo||1500); // PR tiebreaker
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
    // BUG FIX: this used to hardcode _pk.yr = currentSeason + 1, i.e. always
    // one year past whatever CFB season is "current" — back when the season
    // picker itself was stuck a year behind (see the withCurrent() fix in
    // utils.js), that quietly cancelled out. Now that currentSeason correctly
    // tracks the live/about-to-start season, the +1 pushed Pick'em a full year
    // into the future by default — landing on a season ESPN hasn't scheduled
    // yet (confirmed: ESPN publishes a CFB schedule only ~1 season ahead) and
    // showing the "schedule not available" empty state on first load, every
    // year. Delegate to pkLoadYear(currentSeason) so the default view is
    // always the actual current season, using last season's final Elo as the
    // preseason baseline — identical to what picking the top entry in the
    // season dropdown does, so there's exactly one code path to keep correct.
    await window.pkLoadYear(currentSeason);
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

  // ── Live conference derivation (CFB) ──────────────────────────
  // Fetches every FBS conference's current roster — and divisions, if ESPN
  // reports any — from ESPN in a single call, so realignment is picked up
  // automatically the next time Pick'em loads a season instead of needing a
  // hand-edited roster. Division detection is generic (ESPN nests a second
  // "children" level under a conference that has them) rather than hardcoded
  // to "Sun Belt has East/West" the way the old static table was.
  // This is CFB's own, independent implementation — CBB derives its
  // conferences the same way but through its own separate function
  // (pkbFetchConferences), never shared code between sports.
  async function pkFetchConferences(yr){
    var confs={}, divs={}, confIds={};
    try{
      var url='https://site.api.espn.com/apis/v2/sports/football/college-football/standings?season='+yr+'&group=80';
      var res=await fetch(url,{mode:'cors'});
      if(!res.ok) throw new Error('standings fetch failed: '+res.status);
      var data=await res.json();
      var top=(data&&data.children)||[];
      top.forEach(function(node){
        var confFull=node&&node.name;
        // Prefer ESPN's shortName ("SEC", "Big Ten", "Pac-12") as the
        // canonical conference key — that's the same short-form convention
        // the R backend already writes into each team's CSV "conference"
        // column, so live-derived names line up with the rest of the site
        // instead of showing ESPN's longer official names ("Southeastern
        // Conference") only in Pick'em.
        var confName=(node&&node.shortName)||confFull;
        if(!confName) return;
        if(node.children&&node.children.length){
          var divMap={}, allTeams=[];
          node.children.forEach(function(div){
            var rawDivName=(div&&div.name)||'';
            // ESPN names a division like "Sun Belt - East" — strip whichever
            // of the conference's short/full name prefixes the string so
            // what's left is just "East".
            var divName=rawDivName.replace(confName,'').replace(confFull,'').replace(/^[\s\-–—]+/,'') || rawDivName || 'Division';
            var dteams=((div.standings&&div.standings.entries)||[]).map(function(e){
              return e&&e.team&&(e.team.shortDisplayName||e.team.displayName);
            }).filter(Boolean);
            if(dteams.length){ divMap[divName]=dteams; allTeams=allTeams.concat(dteams); }
          });
          if(allTeams.length){ confs[confName]=allTeams; divs[confName]=divMap; }
        }else{
          var teams=((node.standings&&node.standings.entries)||[]).map(function(e){
            return e&&e.team&&(e.team.shortDisplayName||e.team.displayName);
          }).filter(Boolean);
          if(teams.length) confs[confName]=teams;
        }
        if(node&&node.id) confIds[confName]=String(node.id);
      });
    }catch(e){
      if(typeof console!=='undefined') console.warn('pkFetchConferences: live fetch failed, using fallback roster —', e.message);
    }
    // Sanity check: a real FBS response has ~10-11 conferences. Suspiciously
    // few (network hiccup, ESPN reshaping their response) means don't run
    // Pick'em on a broken partial roster — fall back to the frozen snapshot,
    // same as an outright fetch failure.
    if(Object.keys(confs).length<5){
      if(typeof console!=='undefined' && Object.keys(confs).length) console.warn('pkFetchConferences: only found '+Object.keys(confs).length+' conferences, falling back');
      return {confs:{}, divs:{}, confIds:{}};
    }
    return {confs:confs, divs:divs, confIds:confIds};
  }

  window.pkLoadYear=async function(yr){
    var baseYr=yr-1;
    if(!allSeasonData[baseYr]){try{var raw=await fetchCSV(CFG.dataPath+baseYr+'.csv');if(raw)allSeasonData[baseYr]=raw.map(coerceRow);}catch(e){}}
    _pk.eloBase={};
    (allSeasonData[baseYr]||allSeasonData[currentSeason]||[]).forEach(function(r){if(r.team&&r.elo)_pk.eloBase[r.team]=parseFloat(r.elo);});
    _pk.eloSim=JSON.parse(JSON.stringify(_pk.eloBase));
    _pk.yr=yr;_pk.schedule=[];_pk.scores={};_pk.confGames=[];_pk.confChamps={};
    pkDrawShell();
    pkSetReg('<div class="loading"><div class="spinner"></div>Loading '+yr+' conference alignment from ESPN…</div>');
    var confData=await pkFetchConferences(yr);
    _pk.confs=confData.confs; _pk.divs=confData.divs; _pk.confIds=confData.confIds;
    _fbs_set=null; // invalidate cached FBS-team set so it rebuilds from the new roster
    pkFetchSched(yr);
  };

  // ESPN shortDisplayName normalization — maps ESPN's inconsistent names to the
  // canonical short names PK_CONFS/PK_ALIAS use. Applied at fetch time so all
  // games (from either the groups=80 or groups=9 fetch) use consistent names.
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
    var games=[],seen={},fetched=0;
    var weeks=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,15];

    // Shared event-processing logic, reused for both the primary FBS-umbrella
    // fetch and any per-conference supplemental fetch below.
    function processEvents(data, wk){
      if(!data||!data.events) return;
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
          // Normalize ESPN's inconsistent shortDisplayName variants to the
          // canonical names the live-derived conference rosters use
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
    }

    async function fetchGroupWeek(gr, wk){
      var url='https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates='+yr+'&seasontype=2&week='+wk+'&groups='+gr+'&limit=300';
      try{
        var res=await fetch(url,{mode:'cors'});if(!res.ok) return;
        var data=await res.json();
        processEvents(data, wk);
      }catch(e){}
    }

    var BATCH=4;
    // Phase 1: groups=80 is ESPN's umbrella FBS group. It covers nearly every
    // conference, but historically has NOT covered every recently-realigned
    // one (e.g. the rebuilt Pac-12 only shows up under its own conference-
    // level group id, not the umbrella). Rather than hardcode which
    // conference needs that treatment, phase 2 below detects it generically.
    for(var b=0;b<weeks.length;b+=BATCH){
      var batch=weeks.slice(b,b+BATCH);
      await Promise.all(batch.map(function(wk){ return fetchGroupWeek('80', wk); }));
      pkSetReg('<div style="padding:1rem;font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted)">Loading '+yr+' schedule… '+fetched+' games found</div>');
    }

    // Phase 2: any live-derived conference with zero teams appearing in what
    // groups=80 returned gets fetched again via its own ESPN group id —
    // generalizes the old Pac-12-specific fix to any conference ESPN's
    // umbrella group happens to omit, this year or any future one.
    var coveredTeams={};
    games.forEach(function(g){ coveredTeams[pkNorm(g.homeTeam)]=1; coveredTeams[pkNorm(g.awayTeam)]=1; });
    var missingConfGroupIds=[];
    Object.keys(_pk.confs).forEach(function(confName){
      var teams=_pk.confs[confName]||[];
      var anyCovered=teams.some(function(t){ return coveredTeams[pkNorm(t)]; });
      if(!anyCovered && teams.length && _pk.confIds[confName]) missingConfGroupIds.push(_pk.confIds[confName]);
    });
    if(missingConfGroupIds.length){
      var supplementTasks=[];
      weeks.forEach(function(wk){ missingConfGroupIds.forEach(function(gid){ supplementTasks.push({wk:wk,gid:gid}); }); });
      for(var sb=0;sb<supplementTasks.length;sb+=BATCH){
        var sbatch=supplementTasks.slice(sb,sb+BATCH);
        await Promise.all(sbatch.map(function(t){ return fetchGroupWeek(t.gid, t.wk); }));
        pkSetReg('<div style="padding:1rem;font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted)">Loading '+yr+' schedule… '+fetched+' games found</div>');
      }
    }

    games.sort(function(a,b){
      if(a.week!==b.week) return a.week-b.week;
      if(!a.date&&!b.date) return 0;if(!a.date) return 1;if(!b.date) return -1;
      return a.date<b.date?-1:a.date>b.date?1:0;
    });
    // Final dedup pass: the per-week fetch already dedupes by ESPN event id and
    // by team pair within a single (week, group) request, but a game could in
    // theory be double-counted across the phase 1 (groups=80) and phase 2
    // (per-conference supplement) fetches for the same week — collapse by
    // resolved team pair, keeping first occurrence.
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


  // Teams ineligible for conf championship / CFP consideration due to the
  // NCAA's mandatory 2-year FBS transition window (e.g. North Dakota State,
  // moving up for the 2026 season, is ineligible through 2027). Gated by
  // _pk.yr rather than a flat true/false so this expires automatically once
  // the transition window passes, instead of silently banning a team forever.
  function pkFcsTransitionIneligible(team){
    return team === "North Dakota State" && _pk.yr < 2028;
  }

  function pkConfLeaders(conf){
    var teams=(pkActiveConfs()[conf]||[]).map(pkTeam)
      .filter(function(t){ return !pkFcsTransitionIneligible(t.team); });
    var divDef=pkActiveDivs()[conf];
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
    var divConfNames=Object.keys(pkActiveDivs());
    var divNote=divConfNames.length
      ? 'Conferences with divisions this season (<b style="color:var(--text)">'+divConfNames.join(', ')+'</b>) use division leaders'
      : 'No FBS conference has divisions this season';
    var html='<div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);margin-bottom:1rem;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:0.75rem 1rem;line-height:1.6">'
      +'Standings from your picks. '+divNote+'; all other conferences use top-2 by conf W% (tiebreaker: overall W% → Elo). Enter the championship score to lock in the conf champion.'
      +'</div>'
      +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:1rem;margin-bottom:1.2rem">';

    window._pkCGMap={};
    var activeConfs=pkActiveConfs();
    Object.keys(activeConfs).forEach(function(conf){
      // Skip groupings too small to be a real auto-bid conference (independent
      // schools bucket, etc.) — same >=8 team threshold used for CFP
      // eligibility below, so there's one consistent, name-free rule instead
      // of matching on a literal "Independent" label that may not match what
      // ESPN actually calls that grouping.
      if((activeConfs[conf]||[]).length < 8) return;
      var teams=(activeConfs[conf]||[]).map(pkTeam);
      var divDef=pkActiveDivs()[conf];
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

  // ── CFP BRACKET — 2026 RULES ──────────────────────────────
  // Rule: 5 automatic bids — the SEC, Big Ten, Big 12 and ACC champions,
  //       EACH guaranteed regardless of ranking, plus the single
  //       highest-ranked champion among the other auto-bid ("Group of
  //       Five/Six") conferences (AAC, C-USA, MAC, Mountain West, Sun Belt,
  //       Pac-12). NOT simply "the 5 highest-ranked conf champs" — a lower
  //       Group-of-Five-style champ than the top one is at-large-only, same
  //       as a non-champion. Matches POWER4/GROUP_AUTO in
  //       R/update_cfb_playoff.R so both features agree.
  //       7 at-large bids fill remaining spots
  //       Seeds 1-4 = four HIGHEST-RANKED teams overall (get bye) — NOT necessarily conf champs
  //       Seeds 5-12 play first round (5v12, 6v11, 7v10, 8v9 at higher seed's campus)
  //       If an auto-bid team is ranked outside top 12 → bumped up to seed 12, 11, etc.
  //       Independent teams (Notre Dame) can only receive at-large bids
  function pkDrawCFP(){
    var el=document.getElementById('pk-cfp');if(!el) return;
    pkBuild();

    // Step 1: determine each conf's champion
    var confChampions={};

    // Auto-bid conferences = every live-discovered conference with >= 8 teams
    // (every real FBS conference; independents fall below and are correctly
    // at-large-only) — falls back to the fixed 2025-26 list only if live
    // conference discovery failed entirely this load.
    var activeConfsForCFP=pkActiveConfs();
    var cfpAutoConf=Object.keys(_pk.confs).length
      ? Object.keys(activeConfsForCFP).filter(function(c){ return (activeConfsForCFP[c]||[]).length>=8; })
      : CFP_AUTO_CONF_FALLBACK;

    cfpAutoConf.forEach(function(conf){
      var picked=_pk.confChamps[conf];
      if(picked){
        if(pkFcsTransitionIneligible(picked)) return; // skip ineligible teams
        confChampions[conf]={team:picked,elo:_pk.eloSim[picked]||1500,conf:conf,
          w:_pk.wins[picked]||0,l:_pk.losses[picked]||0,
          cw:_pk.confWins[picked]||0,cl:_pk.confLoss[picked]||0};
      }else{
        var leaders=pkConfLeaders(conf);
        // Skip ineligible teams for conf championship auto-bid
        var leader=null;
        for(var li=0;li<leaders.length;li++){
          if(!pkFcsTransitionIneligible(leaders[li].team)){leader=leaders[li];break;}
        }
        if(leader)confChampions[conf]={team:leader.team,elo:leader.elo,conf:conf,
          w:leader.w,l:leader.l,cw:leader.cw,cl:leader.cl};
      }
    });

    // Step 2: rank ALL FBS teams by PLAYOFF RATING (Elo + resume)
    var allTeamSet={};
    Object.values(pkActiveConfs()).forEach(function(arr){arr.forEach(function(t){allTeamSet[t]=1;});});
    Object.keys(_pk.eloBase).forEach(function(t){allTeamSet[t]=1;});
    var allRanked=Object.keys(allTeamSet).map(function(t){
      var elo=_pk.eloSim[t]||_pk.eloBase[t]||0;
      return {team:t,elo:elo,
              pr:_pk.playoffRating[t]||elo, // playoff rating
              conf:pkConfOf(t)||'—',w:_pk.wins[t]||0,l:_pk.losses[t]||0,
              cw:_pk.confWins[t]||0,cl:_pk.confLoss[t]||0};
    }).filter(function(t){return t.elo>0;})
    .sort(function(a,b){return b.pr-a.pr;}); // sort by playoff rating

    // Step 3: identify the 5 real auto-bid teams under the actual 2026 CFP
    // rule — NOT simply "top 5 highest-ranked conf champs regardless of
    // conference" (that was the old, incorrect logic here). The real rule:
    //   - The SEC, Big Ten, Big 12 and ACC champions are EACH guaranteed an
    //     auto bid no matter how they're ranked (4 bids).
    //   - The single highest-ranked champion among the remaining Group-of-
    //     Five-style auto-bid conferences (AAC, C-USA, MAC, Mountain West,
    //     Sun Belt, Pac-12) gets the 5th auto bid — every other one of those
    //     conferences' champions, if they make the field at all, does so as
    //     an at-large team, not an auto bid.
    // Mirrors POWER4 / GROUP_AUTO in R/update_cfb_playoff.R so both features
    // agree on what "auto bid" means.
    var champByTeam={};
    Object.values(confChampions).forEach(function(c){champByTeam[c.team]=c;});
    var PK_POWER4=["SEC","Big Ten","Big 12","ACC"];
    var allRankedByTeam={};
    allRanked.forEach(function(t){allRankedByTeam[t.team]=t;});
    var top5Champs=[];
    PK_POWER4.forEach(function(conf){
      var c=confChampions[conf];
      if(c && allRankedByTeam[c.team]) top5Champs.push(Object.assign({},allRankedByTeam[c.team],{conf:conf}));
    });
    var groupAutoConfs=Object.keys(confChampions).filter(function(c){return PK_POWER4.indexOf(c)===-1;});
    for(var ri=0;ri<allRanked.length;ri++){
      var t=allRanked[ri];
      var match=groupAutoConfs.filter(function(gc){return confChampions[gc].team===t.team;})[0];
      if(match){top5Champs.push(Object.assign({},t,{conf:match}));break;}
    }
    var autoBidTeams={};
    top5Champs.forEach(function(c){autoBidTeams[c.team]=1;});

    // Step 4: build the 12-team field
    // Seeds 1-4: four highest-ranked teams OVERALL (bye) — can be anyone
    // Must include all 5 auto-bid teams; remaining 7 spots = at-large
    var inField={};
    var seeds=[];

    // Pick seeds 1-4: top 4 from allRanked
    for(var i=0;i<allRanked.length&&seeds.length<4;i++){
      if(!inField[allRanked[i].team]){
        seeds.push(Object.assign({},allRanked[i],{seed:seeds.length+1,bye:true,autoB:!!autoBidTeams[allRanked[i].team]}));
        inField[allRanked[i].team]=1;
      }
    }

    // Collect remaining auto-bid teams not already in field (for seeds 5-12)
    var remainingChamps=top5Champs.filter(function(c){return !inField[c.team];});

    // Seeds 5-12: fill from allRanked, ensuring remaining auto-bid teams are included
    var seeds5to12=[];
    var champNeeded=remainingChamps.slice();
    for(var i=0;i<allRanked.length&&seeds5to12.length<8;i++){
      var t=allRanked[i];
      if(inField[t.team]) continue;
      // Remove from champNeeded if this is an auto-bid team
      champNeeded=champNeeded.filter(function(c){return c.team!==t.team;});
      seeds5to12.push(Object.assign({},t,{autoB:!!autoBidTeams[t.team]}));
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
      +'<span style="color:var(--accent)">PR</span> = Playoff Rating &nbsp;&middot;&nbsp; performance &times; record &times; resume &nbsp;&middot;&nbsp; Elo = power ranking'
      +'</div>'
      +'<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden">'
      +'<div style="display:flex;gap:0.35rem;padding:0.2rem 0.6rem;background:var(--bg3);border-bottom:1px solid var(--border)">'
      +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:22px;text-align:right">#</div>'
      +'<div style="flex:1;font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim)">Team</div>'
      +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:36px;text-align:right">W-L</div>'
      +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:32px;text-align:right">Conf</div>'
      +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:42px;text-align:right" title="Playoff Rating = Elo × win_pct^0.6 + √(quality resume)">PR</div>'
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
      +'★ = conf auto-bid · BYE = first-round bye · W-L · Conf W-L · PR = Playoff Rating (performance × record × resume)'
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


  // ──────────────────────────────────────────────────────────
  // CBB SEASON PICK'EM
  // ──────────────────────────────────────────────────────────
  // Independent implementation from CFB's pk* functions above — per the
  // standing rule that conference realignment/derivation is never shared
  // across sports (a school's conference, and each sport's own naming
  // convention, can differ). Everything here is prefixed pkb / _pkb.
  //
  // Conference membership comes straight from this season's own CSV
  // ("conference" column — hoopR writes full names like "Big Ten
  // Conference"), so it can never go stale the way a hand-typed roster
  // would. The full season schedule (conference AND non-conference games)
  // is fetched by sweeping ESPN's scoreboard one calendar day at a time —
  // see pkbFetchSched for why (ESPN's basketball scoreboard endpoint
  // doesn't support dates=RANGE queries the way football's does).

  var _pkb = {
    yr:null, confs:{}, confIds:{}, schedule:[], scores:{}, confGames:[],
    wins:{}, losses:{}, confWins:{}, confLoss:{}, eloBase:{}, eloSim:{},
    playoffRating:{}, confBrackets:{}, confChamps:{},
    ncaaFirstFour:null, ncaaBracket:null
  };

  // Same exclusion list renderBracketology() already uses for the CSV
  // "conference" field — non-conference labels, not real conferences.
  var PKB_EXCLUDE = new Set(['NA','N/A','Unknown','Other D1','Independent','Ind','']);

  function pkbTeamRow(t){
    var elo=_pkb.eloSim[t]||_pkb.eloBase[t]||1500;
    return {team:t, cw:_pkb.confWins[t]||0, cl:_pkb.confLoss[t]||0,
            w:_pkb.wins[t]||0, l:_pkb.losses[t]||0,
            elo:elo, pr:_pkb.playoffRating[t]||elo};
  }

  function pkbSort(teams){
    return teams.slice().sort(function(a,b){
      var acp=(a.cw+a.cl)?a.cw/(a.cw+a.cl):0, bcp=(b.cw+b.cl)?b.cw/(b.cw+b.cl):0;
      if(Math.abs(bcp-acp)>0.001) return bcp-acp;
      var awp=(a.w+a.l)?a.w/(a.w+a.l):0, bwp=(b.w+b.l)?b.w/(b.w+b.l):0;
      if(Math.abs(bwp-awp)>0.001) return bwp-awp;
      return (b.pr||b.elo||1500)-(a.pr||a.elo||1500);
    });
  }

  function pkbConfOfTeam(team){
    for(var conf in _pkb.confs){ if(_pkb.confs[conf].indexOf(team)!==-1) return conf; }
    return null;
  }

  // ── Live conference derivation (CBB) ──────────────────────────
  // Conference membership itself comes from the CSV (always in sync with
  // whatever the R backend already computed). The single ESPN call here
  // only resolves each CSV conference name to an ESPN group id, so its own
  // conference schedule can be fetched — fuzzy-matched the same way
  // renderBracketology() already matches CSV conference names to ESPN
  // conference-tournament-champ data (confLow/confAlpha normalization).
  // Conference membership comes straight from the season's own CSV — no
  // ESPN call needed here at all. (An earlier version of this function also
  // fetched ESPN's standings once to resolve each conference to an ESPN
  // group id, for a per-conference scoreboard fetch — that per-conference
  // fetch has since been replaced by a single whole-slate sweep in
  // pkbFetchSched, so the id lookup was dead weight and has been removed.)
  async function pkbFetchConferences(yr){
    if(!allSeasonData[yr]){
      try{ var raw=await fetchCSV(CFG.dataPath+yr+'.csv'); if(raw) allSeasonData[yr]=raw.map(coerceRow); }catch(e){}
    }
    var rows=allSeasonData[yr]||[];
    var confs={};
    rows.forEach(function(r){
      var c=r.conference||'';
      if(!c||PKB_EXCLUDE.has(c)) return;
      if(!confs[c]) confs[c]=[];
      if(r.team) confs[c].push(r.team);
    });
    return {confs:confs};
  }

  window.pkbLoadYear=async function(yr){
    var baseYr=yr-1;
    if(!allSeasonData[baseYr]){try{var raw=await fetchCSV(CFG.dataPath+baseYr+'.csv');if(raw)allSeasonData[baseYr]=raw.map(coerceRow);}catch(e){}}
    _pkb.eloBase={};
    (allSeasonData[baseYr]||allSeasonData[currentSeason]||[]).forEach(function(r){ if(r.team&&r.elo) _pkb.eloBase[r.team]=parseFloat(r.elo); });
    _pkb.eloSim=JSON.parse(JSON.stringify(_pkb.eloBase));
    _pkb.yr=yr; _pkb.schedule=[]; _pkb.scores={}; _pkb.confGames=[]; _pkb.confChamps={};
    _pkb.confBrackets={}; _pkb.ncaaFirstFour=null; _pkb.ncaaBracket=null;
    window._pkbActiveConfTourney=null;
    pkbDrawShell();
    pkbSetReg('<div class="loading"><div class="spinner"></div>Loading '+yr+' conference alignment…</div>');
    var confData=await pkbFetchConferences(yr);
    _pkb.confs=confData.confs; _pkb.confIds={};
    pkbFetchSched(yr);
  };

  // Walks the season one calendar day at a time and fetches that day's
  // WHOLE D1 scoreboard in a single call — no per-conference filtering, so
  // both conference AND non-conference games come back from the exact same
  // sweep. This replaced an earlier per-conference, date-range-chunked
  // design after live testing showed ESPN's men's-college-basketball
  // scoreboard endpoint 404s on dates=START-END range queries (confirmed
  // repeatedly — football's equivalent endpoint accepts ranges fine, this
  // one doesn't), which meant the old fetch was silently returning zero
  // games every time. Single 8-digit dates work reliably, so this fetches
  // more times but each one actually succeeds.
  function pkbSeasonDates(y0, yr){
    var dates=[];
    var d=new Date(Date.UTC(y0,10,1));           // Nov 1 of y0
    var end=new Date(Date.UTC(yr,2,16));          // Mar 16 of yr — stops
    // short of conference-tournament week so the regular-season schedule
    // never mixes with conference-tournament games (those are simulated
    // separately from the user's bracket picks, not fetched from ESPN).
    while(d<=end){
      var y=d.getUTCFullYear(), m=String(d.getUTCMonth()+1).padStart(2,'0'), dd=String(d.getUTCDate()).padStart(2,'0');
      dates.push(''+y+m+dd);
      d.setUTCDate(d.getUTCDate()+1);
    }
    return dates;
  }

  async function pkbFetchSched(yr){
    pkbSetReg('<div class="loading"><div class="spinner"></div>Loading '+yr+' schedule from ESPN…</div>');
    var games=[], seen={}, fetched=0;
    var y0=yr-1;
    var dates=pkbSeasonDates(y0, yr);

    // team -> its own CSV conference, for classifying each game as
    // conference or non-conference play (and for skipping games against
    // any team we have no Elo/roster data for at all).
    var rosterOf={};
    Object.keys(_pkb.confs).forEach(function(c){ (_pkb.confs[c]||[]).forEach(function(t){ rosterOf[t]=c; }); });

    function processEvents(data){
      if(!data||!data.events) return;
      data.events.forEach(function(ev){
        try{
          var comp=ev.competitions&&ev.competitions[0]; if(!comp) return;
          var competitors=comp.competitors||[];
          var home=null,away=null;
          competitors.forEach(function(c){ if(c.homeAway==='home') home=c; else away=c; });
          if(!home||!away) return;
          var hn=home.team.shortDisplayName||home.team.displayName;
          var an=away.team.shortDisplayName||away.team.displayName;
          var hConf=rosterOf[hn], aConf=rosterOf[an];
          // Keep the game only if BOTH teams are ones we actually track
          // (have Elo/roster data for) — an exhibition against a non-D1
          // opponent, or a team missing from this season's CSV, can't be
          // meaningfully scored here anyway.
          if(!hConf||!aConf) return;
          var dt=ev.date?ev.date.slice(0,10):null;
          var key=ev.id||(hn+'_'+an+'_'+(dt||''));
          if(seen[key]) return; seen[key]=1;
          var pairKey='pair:'+[hn,an].sort().join('|')+'|'+(dt||'');
          if(seen[pairKey]) return; seen[pairKey]=1;
          var completed=!!(comp.status&&comp.status.type&&comp.status.type.completed);
          var hs=completed?(parseInt(home.score)||null):null;
          var as_=completed?(parseInt(away.score)||null):null;
          var conf=(hConf===aConf)?hConf:'Non-Conference';
          games.push({id:key,conf:conf,date:dt,homeTeam:hn,awayTeam:an,
            neutral:!!(comp.neutralSite),completed:completed,homeScore:hs,awayScore:as_});
          fetched++;
        }catch(e){}
      });
    }

    async function fetchDate(d){
      var url='https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates='+d+'&groups=50&limit=500';
      try{
        var res=await fetch(url,{mode:'cors'}); if(!res.ok) return;
        var data=await res.json();
        processEvents(data);
      }catch(e){}
    }

    var BATCH=6;
    for(var b=0;b<dates.length;b+=BATCH){
      var batch=dates.slice(b,b+BATCH);
      await Promise.all(batch.map(fetchDate));
      pkbSetReg('<div style="padding:1rem;font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted)">Loading '+yr+' schedule… '+fetched+' games found ('+Math.min(b+BATCH,dates.length)+'/'+dates.length+' days)</div>');
    }

    games.sort(function(a,b){
      if(!a.date&&!b.date) return 0; if(!a.date) return 1; if(!b.date) return -1;
      return a.date<b.date?-1:a.date>b.date?1:0;
    });
    _pkb.schedule=games;

    if(!games.length){
      pkbSetReg('<div style="padding:1.5rem;font-family:var(--font-mono);font-size:0.78rem;color:var(--text-muted);text-align:center;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg)">'
        +'<div style="font-size:0.88rem;color:var(--text);margin-bottom:0.5rem">📅 '+yr+' schedule not available yet</div>'
        +'ESPN hasn\'t published the '+yr+' CBB schedule yet.<br><br>'
        +'<button onclick="pkbLoadYear('+(yr-1)+')" style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);padding:0.4rem 1.1rem;font-family:var(--font-mono);font-size:0.73rem;font-weight:600;cursor:pointer">Load '+(yr-1)+' season instead →</button>'
        +'</div>');
      return;
    }
    games.forEach(function(g){
      if(g.completed&&g.homeScore!=null&&g.awayScore!=null) _pkb.scores[g.id]={homeScore:g.homeScore,awayScore:g.awayScore};
    });
    pkbBuild(); pkbDrawReg();
  }

  // Flattens every decided conference-tournament matchup (across all
  // conference brackets) into _pkb.confGames, which pkbBuild() consumes
  // alongside the regular-season schedule — mirrors CFB's confGames step.
  function pkbRebuildConfGamesFromBrackets(){
    var out=[];
    Object.keys(_pkb.confBrackets).forEach(function(conf){
      var b=_pkb.confBrackets[conf];
      (b&&b.rounds||[]).forEach(function(round){
        round.forEach(function(m){
          if(m.a&&m.b&&m.winner) out.push({conf:conf, teamA:m.a.team, teamB:m.b.team, winner:m.winner.team});
        });
      });
    });
    _pkb.confGames=out;
  }

  function pkbBuild(){
    _pkb.wins={}; _pkb.losses={}; _pkb.confWins={}; _pkb.confLoss={};
    _pkb.eloSim=JSON.parse(JSON.stringify(_pkb.eloBase));
    var K=25;
    var counted={};
    for(var i=0;i<_pkb.schedule.length;i++){
      var g=_pkb.schedule[i];
      var s=_pkb.scores[g.id];
      if(!s||s.homeScore===''||s.homeScore==null||s.awayScore===''||s.awayScore==null) continue;
      var hs=parseInt(s.homeScore), as_=parseInt(s.awayScore);
      if(isNaN(hs)||isNaN(as_)||hs===as_) continue;
      var winner=hs>as_?g.homeTeam:g.awayTeam;
      var loser=hs>as_?g.awayTeam:g.homeTeam;
      var teams=[winner,loser].sort();
      // Dedup by team pair + DATE (not just pair) — conference opponents
      // commonly play twice in a season (home and away), and dropping the
      // rematch as a "duplicate" silently undercounted every conference
      // that does full round-robin-style home-and-home scheduling.
      var dedupKey=teams[0]+'|'+teams[1]+'|'+g.conf+'|'+(g.date||g.id);
      if(counted[dedupKey]) continue; counted[dedupKey]=1;
      _pkb.wins[winner]=(_pkb.wins[winner]||0)+1;
      _pkb.losses[loser]=(_pkb.losses[loser]||0)+1;
      // Only real conference games count toward conference W/L (used to
      // seed conference tournaments) — a Non-Conference game still counts
      // toward the overall record and Elo above, just not this.
      if(g.conf!=='Non-Conference'){
        _pkb.confWins[winner]=(_pkb.confWins[winner]||0)+1;
        _pkb.confLoss[loser]=(_pkb.confLoss[loser]||0)+1;
      }
      var margin=Math.abs(hs-as_);
      var rW=_pkb.eloSim[winner]||1500, rL=_pkb.eloSim[loser]||1500;
      var eW=1/(1+Math.pow(10,(rL-rW)/400));
      var delta=K*Math.log(margin+1)*(1-eW);
      _pkb.eloSim[winner]=rW+delta;
      _pkb.eloSim[loser]=rL-delta;
    }
    // Conference-tournament results (picked, not scored — small flat nudge)
    (_pkb.confGames||[]).forEach(function(cg){
      if(!cg.winner) return;
      var loser=(cg.teamA===cg.winner)?cg.teamB:cg.teamA;
      _pkb.wins[cg.winner]=(_pkb.wins[cg.winner]||0)+1;
      _pkb.losses[loser]=(_pkb.losses[loser]||0)+1;
      var rW=_pkb.eloSim[cg.winner]||1500, rL=_pkb.eloSim[loser]||1500;
      var eW=1/(1+Math.pow(10,(rL-rW)/400));
      var delta=15*(1-eW);
      _pkb.eloSim[cg.winner]=rW+delta;
      _pkb.eloSim[loser]=rL-delta;
    });

    // Playoff Rating: Elo × win%^0.6 + √(quality-win resume) — identical
    // formula to CFB's. Now draws on the full schedule (conference AND
    // non-conference games, plus conference-tournament picks), so the
    // resume component actually sees true out-of-conference quality wins
    // instead of being limited to conference play only.
    var beatenBy={}, counted2={};
    for(var gi=0;gi<_pkb.schedule.length;gi++){
      var g2=_pkb.schedule[gi];
      var s2=_pkb.scores[g2.id];
      if(!s2||s2.homeScore==null||s2.awayScore==null) continue;
      var hs2=parseInt(s2.homeScore),as2=parseInt(s2.awayScore);
      if(isNaN(hs2)||isNaN(as2)||hs2===as2) continue;
      var winner2=hs2>as2?g2.homeTeam:g2.awayTeam;
      var loser2=hs2>as2?g2.awayTeam:g2.homeTeam;
      var tk=[winner2,loser2].sort().join('|')+'|'+g2.conf+'|'+(g2.date||g2.id);
      if(counted2[tk]) continue; counted2[tk]=1;
      if(!beatenBy[winner2]) beatenBy[winner2]=[];
      beatenBy[winner2].push(loser2);
    }
    (_pkb.confGames||[]).forEach(function(cg){
      if(!cg.winner) return;
      var loser=(cg.teamA===cg.winner)?cg.teamB:cg.teamA;
      if(!beatenBy[cg.winner]) beatenBy[cg.winner]=[];
      beatenBy[cg.winner].push(loser);
    });

    _pkb.playoffRating={};
    Object.keys(_pkb.eloSim).forEach(function(team){
      var teamElo=_pkb.eloSim[team]||1500;
      var beaten=beatenBy[team]||[];
      var resumeSum=0;
      beaten.forEach(function(opp){
        var oppElo=_pkb.eloSim[opp]||_pkb.eloBase[opp]||1500;
        resumeSum+=Math.max(0, oppElo-1350);
      });
      var resumeScore=resumeSum>0?Math.sqrt(resumeSum):0;
      var gp=(_pkb.wins[team]||0)+(_pkb.losses[team]||0);
      var wp=gp>0?(_pkb.wins[team]||0)/gp:0.5;
      var wpFactor=Math.pow(Math.max(0.01,wp),0.6);
      _pkb.playoffRating[team]=teamElo*wpFactor+resumeScore;
    });
  }

  // ── Generic single-elimination bracket engine (CBB-only; not shared
  // with CFB's own CFP bracket code above) ──────────────────────
  function pkbNextPow2(n){ var p=1; while(p<n) p*=2; return p; }

  // Standard tournament seeding recursion — for n=8 produces
  // [1,8,4,5,2,7,3,6], i.e. round-1 pairs (1v8, 4v5, 2v7, 3v6), so seed 1
  // and seed 2 can only meet in the final. Verified by hand for n=8.
  function pkbSeedOrder(n){
    if(n<=1) return [1];
    var prev=pkbSeedOrder(n/2);
    var out=[];
    prev.forEach(function(s){ out.push(s); out.push(n+1-s); });
    return out;
  }

  function pkbNewBracket(seededTeams){
    var n=seededTeams.length;
    var order=pkbSeedOrder(n);
    var round1=[];
    for(var i=0;i<order.length;i+=2){
      var a=seededTeams[order[i]-1]||null, b=seededTeams[order[i+1]-1]||null;
      round1.push({a:a, b:b, winner:null});
    }
    return {rounds:[round1]};
  }

  // Auto-resolves any bye (single-team) matchup and builds each following
  // round from a fully-decided prior round. Called after every pick;
  // callers truncate rounds to the edited round first so re-picking an
  // earlier matchup correctly discards everything built on top of it.
  function pkbAdvanceByes(rounds){
    var i=0;
    while(true){
      var round=rounds[i];
      if(!round) break;
      round.forEach(function(m){
        if(!m.winner){
          if(m.a&&!m.b) m.winner=m.a;
          else if(m.b&&!m.a) m.winner=m.b;
        }
      });
      if(round.length===1) break;
      if(!round.every(function(m){return m.winner;})) break;
      if(rounds[i+1]){ i++; continue; }
      var nextRound=[];
      for(var j=0;j<round.length;j+=2){
        nextRound.push({a:round[j].winner, b:round[j+1]?round[j+1].winner:null, winner:null});
      }
      rounds.push(nextRound);
      i++;
    }
    return rounds;
  }

  function pkbRenderBracket(bracket, advanceFnName){
    var html='<div style="display:flex;gap:0.8rem;overflow-x:auto;padding-bottom:0.5rem">';
    bracket.rounds.forEach(function(round){
      var label=round.length===1?'Final':round.length===2?'Semifinals':round.length===4?'Elite 8':
                round.length===8?'Sweet 16':round.length===16?'Round of 32':'Round of '+(round.length*2);
      html+='<div style="min-width:200px">'
        +'<div style="font-family:var(--font-mono);font-size:0.58rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-dim);margin-bottom:0.4rem">'+label+'</div>';
      round.forEach(function(m,mi){
        var ri=bracket.rounds.indexOf(round);
        html+='<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:0.35rem;margin-bottom:0.9rem">';
        [m.a,m.b].forEach(function(t){
          if(!t){ html+='<div style="padding:0.25rem 0.4rem;font-size:0.68rem;color:var(--text-dim)">—</div>'; return; }
          var isWinner=m.winner&&m.winner.team===t.team;
          var clickable=!!(m.a&&m.b);
          var base='display:block;width:100%;text-align:left;padding:0.25rem 0.4rem;border-radius:var(--radius);border:none;background:'
            +(isWinner?'rgba(226,201,126,0.14)':'transparent')+';color:'+(isWinner?'var(--accent)':'var(--text)')
            +';font-size:0.68rem;font-weight:'+(isWinner?'600':'400')+(clickable?';cursor:pointer':';cursor:default');
          var label2='<span style="color:var(--text-dim);font-family:var(--font-mono);font-size:0.55rem;margin-right:0.25rem">'+(t.seed||'')+'</span>'+t.team;
          if(clickable){
            html+='<button onclick="'+advanceFnName+'('+ri+','+mi+',\''+String(t.team).replace(/'/g,"\\'")+'\')" style="'+base+'">'+label2+'</button>';
          }else{
            html+='<div style="'+base+'">'+label2+'</div>';
          }
        });
        html+='</div>';
      });
      html+='</div>';
    });
    html+='</div>';
    return html;
  }

  // ── Entry point ────────────────────────────────────────────
  async function renderPickemCBB(){
    var el=document.getElementById('panel-pickem');
    if(!el||CFG.sport!=='CBB') return;
    await window.pkbLoadYear(currentSeason);
  }

  function pkbDrawShell(){
    var el=document.getElementById('panel-pickem'); if(!el) return;
    var seasonOpts='', eloOpts='';
    (CFG.seasons||[]).slice(0,5).forEach(function(y){
      seasonOpts+='<option value="'+y+'">'+y+'</option>';
      eloOpts+='<option value="'+y+'">'+y+' Elo</option>';
    });
    el.innerHTML=
      '<div style="max-width:920px">'
      +'<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:0.9rem 1.1rem;margin-bottom:1rem">'
      +'<div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">'
      +'<div style="font-size:0.86rem;font-weight:600;color:var(--text)">🏀 '+_pkb.yr+' CBB Season Pick\'em</div>'
      +'<div style="display:flex;align-items:center;gap:0.4rem;margin-left:auto">'
      +'<span style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim)">Season:</span>'
      +'<select onchange="pkbLoadYear(parseInt(this.value))" style="font-family:var(--font-mono);font-size:0.7rem;background:var(--bg3);border:1px solid var(--border-md);color:var(--text);border-radius:var(--radius);padding:0.2rem 0.4rem">'+seasonOpts+'</select>'
      +'</div></div>'
      +'<div style="font-size:0.68rem;color:var(--text-muted);font-family:var(--font-mono);margin-top:0.4rem;line-height:1.55">'
      +'Full schedule, conference + non-conference · enter scores → conf tournament brackets decide auto bids → Elo/resume fills the NCAA field'
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);flex-wrap:wrap">'
      +'<span style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim)">⚡ Auto-predict using</span>'
      +'<select id="pkb-elo-yr" style="font-family:var(--font-mono);font-size:0.7rem;background:var(--bg3);border:1px solid var(--border-md);color:var(--text);border-radius:var(--radius);padding:0.2rem 0.4rem">'+eloOpts+'</select>'
      +'<button onclick="pkbAutoPredict()" style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);padding:0.28rem 0.85rem;font-family:var(--font-mono);font-size:0.7rem;font-weight:600;cursor:pointer">Fill all games →</button>'
      +'<span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim)">(home +60 Elo · scores simulated around the Elo gap)</span>'
      +'</div></div>'
      +'<div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:1rem;flex-wrap:wrap">'
      +'<button onclick="pkbTab(\'reg\')" id="pkb-tab-reg" style="font-family:var(--font-mono);font-size:0.68rem;padding:0.42rem 0.9rem;border:none;border-bottom:2px solid var(--accent);margin-bottom:-2px;background:transparent;cursor:pointer;color:var(--accent)">📅 Regular Season</button>'
      +'<button onclick="pkbTab(\'conf\')" id="pkb-tab-conf" style="font-family:var(--font-mono);font-size:0.68rem;padding:0.42rem 0.9rem;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;background:transparent;cursor:pointer;color:var(--text-muted)">🏆 Conf Tournaments</button>'
      +'<button onclick="pkbTab(\'ncaa\')" id="pkb-tab-ncaa" style="font-family:var(--font-mono);font-size:0.68rem;padding:0.42rem 0.9rem;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;background:transparent;cursor:pointer;color:var(--text-muted)">🎯 NCAA Bracket</button>'
      +'</div>'
      +'<div id="pkb-reg"></div>'
      +'<div id="pkb-conf" hidden></div>'
      +'<div id="pkb-ncaa" hidden></div>'
      +'</div>';
  }

  window.pkbTab=function(ph){
    ['reg','conf','ncaa'].forEach(function(p){
      var panel=document.getElementById('pkb-'+p);
      var btn=document.getElementById('pkb-tab-'+p);
      if(!panel||!btn) return;
      if(p===ph){panel.removeAttribute('hidden');btn.style.borderBottomColor='var(--accent)';btn.style.color='var(--accent)';}
      else{panel.setAttribute('hidden','');btn.style.borderBottomColor='transparent';btn.style.color='var(--text-muted)';}
    });
    pkbBuild();
    if(ph==='conf') pkbDrawConfTourney();
    if(ph==='ncaa') pkbDrawNCAA();
  };

  function pkbSetReg(html){ var el=document.getElementById('pkb-reg'); if(el) el.innerHTML=html; }

  function pkbDrawReg(){
    var el=document.getElementById('pkb-reg'); if(!el) return;
    var picked=0;
    Object.keys(_pkb.scores).forEach(function(id){ var s=_pkb.scores[id]; if(s.homeScore!==''&&s.homeScore!=null&&s.awayScore!==''&&s.awayScore!=null) picked++; });
    var total=_pkb.schedule.length;
    var completed=_pkb.schedule.filter(function(g){return g.completed;}).length;
    var html='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem">'
      +'<div id="pkb-count" style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-dim)">'+total+' games'+(completed?' · '+completed+' final':'')+' · '+picked+' predicted</div>'
      +'<button onclick="pkbTab(\'conf\')" style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);padding:0.35rem 1rem;font-family:var(--font-mono);font-size:0.72rem;font-weight:600;cursor:pointer">Next: Conf Tournaments →</button>'
      +'</div>';
    var byConf={};
    _pkb.schedule.forEach(function(g){ if(!byConf[g.conf]) byConf[g.conf]=[]; byConf[g.conf].push(g); });
    Object.keys(byConf).sort().forEach(function(conf){
      var games=byConf[conf];
      html+='<details style="margin-bottom:0.5rem"><summary style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-dim);cursor:pointer;padding:0.4rem 0;border-top:1px solid var(--border)">'+conf+' <span style="opacity:0.6">('+games.length+' games)</span></summary>';
      games.forEach(function(g){
        var s=_pkb.scores[g.id]||{};
        var hs=s.homeScore!=null?s.homeScore:'';
        var as_=s.awayScore!=null?s.awayScore:'';
        var hsi=parseInt(hs),asi=parseInt(as_);
        var homeWin=(!isNaN(hsi)&&!isNaN(asi)&&hsi!==asi&&hsi>asi);
        var awayWin=(!isNaN(hsi)&&!isNaN(asi)&&hsi!==asi&&asi>hsi);
        var dateStr=g.date?new Date(g.date+'T12:00:00').toLocaleDateString('en-US',{month:'numeric',day:'numeric'}):'TBD';
        var hSide=g.neutral?'N':'H',aSide=g.neutral?'N':'A';
        html+='<div data-gid="'+g.id+'" style="display:flex;align-items:center;gap:0.4rem;padding:0.3rem 0.55rem;margin-bottom:0.18rem;border-radius:var(--radius);background:'+(g.completed?'var(--bg2)':'var(--bg3)')+';border:1px solid '+(g.completed?'var(--border)':'var(--border-md)')+'">'
          +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:36px;text-align:center">'+dateStr+'</div>'
          +'<div class="pkb-hn" style="flex:1;font-size:0.77rem;font-weight:'+(homeWin?'600':'400')+';color:'+(homeWin?'var(--accent)':'var(--text)')+'">'+g.homeTeam+' <span style="font-size:0.55rem;color:var(--text-dim)">'+hSide+'</span></div>'
          +'<input type="number" min="0" max="150" value="'+hs+'" placeholder="–"'+(g.completed?' disabled':'')+' onchange="pkbScore(\''+g.id+'\',\'home\',this.value)" style="width:40px;text-align:center;font-family:var(--font-mono);font-size:0.82rem;background:'+(g.completed?'transparent':'var(--bg2)')+';border:'+(g.completed?'none':'1px solid var(--border-md)')+';color:var(--text);border-radius:var(--radius);padding:0.22rem;-moz-appearance:textfield;-webkit-appearance:none">'
          +'<span style="color:var(--text-dim);font-size:0.78rem">–</span>'
          +'<input type="number" min="0" max="150" value="'+as_+'" placeholder="–"'+(g.completed?' disabled':'')+' onchange="pkbScore(\''+g.id+'\',\'away\',this.value)" style="width:40px;text-align:center;font-family:var(--font-mono);font-size:0.82rem;background:'+(g.completed?'transparent':'var(--bg2)')+';border:'+(g.completed?'none':'1px solid var(--border-md)')+';color:var(--text);border-radius:var(--radius);padding:0.22rem;-moz-appearance:textfield;-webkit-appearance:none">'
          +'<div class="pkb-an" style="flex:1;text-align:right;font-size:0.77rem;font-weight:'+(awayWin?'600':'400')+';color:'+(awayWin?'var(--accent)':'var(--text)')+'"><span style="font-size:0.55rem;color:var(--text-dim)">'+aSide+'</span> '+g.awayTeam+'</div>'
          +(g.completed?'<span style="font-size:0.55rem;color:var(--text-dim);min-width:32px;text-align:right">FINAL</span>':'')
          +'</div>';
      });
      html+='</details>';
    });
    html+='<div style="margin-top:1rem;display:flex;justify-content:flex-end"><button onclick="pkbTab(\'conf\')" style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);padding:0.4rem 1.1rem;font-family:var(--font-mono);font-size:0.73rem;font-weight:600;cursor:pointer">Next: Conf Tournaments →</button></div>';
    el.innerHTML=html;
  }

  window.pkbScore=function(id,side,val){
    if(!_pkb.scores[id]) _pkb.scores[id]={homeScore:'',awayScore:''};
    var n=(val===''||val==null)?'':parseInt(val);
    if(side==='home') _pkb.scores[id].homeScore=n; else _pkb.scores[id].awayScore=n;
    var row=document.querySelector('[data-gid="'+id+'"]');
    if(row){
      var s=_pkb.scores[id]; var hs=parseInt(s.homeScore), as_=parseInt(s.awayScore);
      var hn=row.querySelector('.pkb-hn'), an=row.querySelector('.pkb-an');
      if(hn&&an&&!isNaN(hs)&&!isNaN(as_)&&hs!==as_){
        hn.style.fontWeight=hs>as_?'600':'400'; hn.style.color=hs>as_?'var(--accent)':'var(--text)';
        an.style.fontWeight=as_>hs?'600':'400'; an.style.color=as_>hs?'var(--accent)':'var(--text)';
      }
    }
    var picked=Object.keys(_pkb.scores).filter(function(i2){var s2=_pkb.scores[i2];return s2.homeScore!==''&&s2.homeScore!=null&&s2.awayScore!==''&&s2.awayScore!=null;}).length;
    var el=document.getElementById('pkb-count');
    if(el) el.textContent=_pkb.schedule.length+' games · '+picked+' predicted';
  };

  window.pkbAutoPredict=async function(){
    var selEl=document.getElementById('pkb-elo-yr');
    var eloYr=parseInt(selEl&&selEl.value)||currentSeason;
    var btn=document.querySelector('[onclick="pkbAutoPredict()"]');
    if(btn){btn.textContent='Loading…';btn.disabled=true;}
    if(!allSeasonData[eloYr]){try{var raw=await fetchCSV(CFG.dataPath+eloYr+'.csv');if(raw)allSeasonData[eloYr]=raw.map(coerceRow);}catch(e){}}
    var eloMap={};
    (allSeasonData[eloYr]||[]).forEach(function(r){ if(r.team&&r.elo) eloMap[r.team]=parseFloat(r.elo); });
    function getElo(team){ return eloMap[team]||1500; }
    _pkb.schedule.forEach(function(g){
      if(g.completed) return;
      if(!g.homeTeam||!g.awayTeam) return;
      var eH=getElo(g.homeTeam)+(g.neutral?0:60), eA=getElo(g.awayTeam);
      var diff=eH-eA;
      var favHome=diff>=0;
      var upsetChance=Math.abs(diff)<50?0.30:Math.abs(diff)<150?0.16:Math.abs(diff)<300?0.07:0.03;
      var favWins=Math.random()>upsetChance;
      var margin=favWins?Math.max(1,Math.round(Math.abs(diff)/12+(Math.random()*8-4))):Math.max(1,Math.round(Math.random()*6+1));
      var loserScore=68+Math.round(Math.random()*14-7);
      var winnerScore=loserScore+margin;
      var hs,as_;
      if(favHome===favWins){ hs=winnerScore; as_=loserScore; } else { hs=loserScore; as_=winnerScore; }
      _pkb.scores[g.id]={homeScore:hs,awayScore:as_};
    });
    pkbBuild(); pkbDrawReg();
    if(btn){btn.textContent='Fill all games →';btn.disabled=false;}
  };

  // ── Conference tournaments ────────────────────────────────
  function pkbConfStandings(conf){
    return pkbSort((_pkb.confs[conf]||[]).map(pkbTeamRow));
  }

  function pkbBuildConfBracket(conf){
    var standings=pkbConfStandings(conf);
    var n=standings.length;
    if(n<2) return null;
    standings.forEach(function(t,i){ t.seed=i+1; });
    var size=pkbNextPow2(n);
    var seeded=[];
    for(var i=0;i<size;i++){ seeded.push(standings[i]||null); }
    var bracket=pkbNewBracket(seeded);
    pkbAdvanceByes(bracket.rounds);
    bracket._seedKey=standings.map(function(t){return t.team;}).join('|');
    return bracket;
  }

  function pkbDrawConfTourney(){
    var el=document.getElementById('pkb-conf'); if(!el) return;
    pkbBuild();
    var confNames=Object.keys(_pkb.confs).filter(function(c){ return (_pkb.confs[c]||[]).length>=2; }).sort();
    if(!window._pkbActiveConfTourney||confNames.indexOf(window._pkbActiveConfTourney)===-1){
      window._pkbActiveConfTourney=confNames[0]||null;
    }
    var opts=confNames.map(function(c){
      return '<option value="'+c.replace(/"/g,'&quot;')+'"'+(c===window._pkbActiveConfTourney?' selected':'')+'>'+c+(_pkb.confChamps[c]?' ✓':'')+'</option>';
    }).join('');
    var html='<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.9rem;flex-wrap:wrap">'
      +'<span style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim)">Conference:</span>'
      +'<select onchange="pkbSelectConfTourney(this.value)" style="font-family:var(--font-mono);font-size:0.72rem;background:var(--bg3);border:1px solid var(--border-md);color:var(--text);border-radius:var(--radius);padding:0.25rem 0.5rem">'+opts+'</select>'
      +'<span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);margin-left:auto">'+Object.keys(_pkb.confChamps).length+' / '+confNames.length+' champions decided</span>'
      +'</div>';

    var conf=window._pkbActiveConfTourney;
    if(!conf){
      el.innerHTML=html+'<div style="padding:1rem;color:var(--text-dim);font-family:var(--font-mono);font-size:0.72rem">No conferences with schedule data loaded.</div>';
      return;
    }

    var standings=pkbConfStandings(conf);
    var seedKey=standings.map(function(t){return t.team;}).join('|');
    var bracket=_pkb.confBrackets[conf];
    if(!bracket||bracket._seedKey!==seedKey){
      bracket=pkbBuildConfBracket(conf);
      if(bracket) _pkb.confBrackets[conf]=bracket;
    }

    html+='<div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);margin-bottom:0.6rem">Seeded by conference record from your regular-season picks (tiebreak: overall win% → Playoff Rating). Click a team to advance them.</div>';

    if(!bracket){
      html+='<div style="padding:1rem;color:var(--text-dim);font-family:var(--font-mono);font-size:0.72rem">Not enough teams/games to build a bracket for '+conf+' yet.</div>';
    }else{
      html+=pkbRenderBracket(bracket, 'pkbConfAdvance');
      var champ=_pkb.confChamps[conf];
      if(champ) html+='<div style="margin-top:0.6rem;font-family:var(--font-mono);font-size:0.72rem;color:var(--accent)">🏆 '+champ+' wins the '+conf+' tournament — auto bid locked in.</div>';
    }

    html+='<div style="margin-top:1.2rem;display:flex;gap:0.6rem">'
      +'<button onclick="pkbTab(\'reg\')" style="background:var(--bg3);color:var(--text-muted);border:1px solid var(--border);border-radius:var(--radius);padding:0.32rem 0.75rem;font-family:var(--font-mono);font-size:0.67rem;cursor:pointer">← Regular Season</button>'
      +'<button onclick="pkbTab(\'ncaa\')" style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);padding:0.35rem 1rem;font-family:var(--font-mono);font-size:0.72rem;font-weight:600;cursor:pointer">Next: NCAA Bracket →</button>'
      +'</div>';

    el.innerHTML=html;
  }

  window.pkbSelectConfTourney=function(conf){
    window._pkbActiveConfTourney=conf;
    pkbDrawConfTourney();
  };

  window.pkbConfAdvance=function(ri,mi,team){
    var conf=window._pkbActiveConfTourney;
    var bracket=_pkb.confBrackets[conf];
    if(!bracket) return;
    bracket.rounds=bracket.rounds.slice(0,ri+1);
    var m=bracket.rounds[ri][mi];
    var t=(m.a&&m.a.team===team)?m.a:(m.b&&m.b.team===team?m.b:null);
    if(!t) return;
    m.winner=t;
    pkbAdvanceByes(bracket.rounds);
    var lastRound=bracket.rounds[bracket.rounds.length-1];
    if(lastRound.length===1&&lastRound[0].winner) _pkb.confChamps[conf]=lastRound[0].winner.team;
    else delete _pkb.confChamps[conf];
    pkbRebuildConfGamesFromBrackets();
    pkbBuild();
    pkbDrawConfTourney();
  };

  // ── NCAA Tournament ────────────────────────────────────────
  // Auto bid = that conference's tournament winner from the user's picks,
  // or (until decided) the regular-season standings leader as a
  // "projected" placeholder — same confirmed/projected concept
  // renderBracketology() already uses for its own auto-bid display.
  function pkbAutoBidTeam(conf){
    if(_pkb.confChamps[conf]) return _pkb.confChamps[conf];
    var standings=pkbConfStandings(conf);
    return standings[0]?standings[0].team:null;
  }

  function pkbPairFF(teams){
    var sorted=teams.slice().sort(function(a,b){ return a.pr-b.pr; }); // worst first
    var games=[];
    for(var i=0;i<sorted.length;i+=2){ games.push({a:sorted[i], b:sorted[i+1]}); }
    return games;
  }

  // Builds the full at-large/auto-bid field. No real geographic regions are
  // modeled (there's no reliable way to generate them) — disclosed to the
  // user as a known limitation; seeding and bracket order are by Playoff
  // Rating rank only.
  function pkbBuildNCAAField(){
    var season=_pkb.yr;
    var is76=season>=2027; // same 76-team-format cutoff renderBracketology() uses
    var total=is76?76:68;

    var confList=Object.keys(_pkb.confs).filter(function(c){ return (_pkb.confs[c]||[]).length>=2; });
    var autoBids=[], autoTeamSet={};
    confList.forEach(function(conf){
      var team=pkbAutoBidTeam(conf);
      if(!team||autoTeamSet[team]) return;
      autoTeamSet[team]=1;
      var row=pkbTeamRow(team);
      autoBids.push({team:team, conf:conf, confirmed:!!_pkb.confChamps[conf], pr:row.pr, elo:row.elo});
    });
    autoBids.sort(function(a,b){ return b.pr-a.pr; });

    var allTeams=[];
    Object.keys(_pkb.confs).forEach(function(conf){ (_pkb.confs[conf]||[]).forEach(function(t){ allTeams.push({team:t,conf:conf}); }); });
    var atLarge=allTeams.filter(function(t){ return !autoTeamSet[t.team]; }).map(function(t){
      var row=pkbTeamRow(t.team);
      return {team:t.team, conf:t.conf, pr:row.pr, elo:row.elo};
    }).sort(function(a,b){ return b.pr-a.pr; }).slice(0, Math.max(0,total-autoBids.length));

    var field=autoBids.concat(atLarge).sort(function(a,b){ return b.pr-a.pr; });

    var gamesNeeded=total-64; // First Four game count — 4 for 68-team, generalizes for a future 76-team format
    var autoGames=Math.ceil(gamesNeeded/2), atLargeGames=gamesNeeded-autoGames;
    var ffAutoTeams=autoBids.slice().sort(function(a,b){return b.pr-a.pr;}).slice(-(autoGames*2));
    var ffAtLargeTeams=atLarge.slice(-(atLargeGames*2));

    return {field:field, autoBids:autoBids, atLarge:atLarge, ffAutoTeams:ffAutoTeams, ffAtLargeTeams:ffAtLargeTeams, total:total, is76:is76};
  }

  function pkbDrawNCAA(){
    var el=document.getElementById('pkb-ncaa'); if(!el) return;
    pkbBuild();
    var fieldData=pkbBuildNCAAField();

    var ffGames=pkbPairFF(fieldData.ffAutoTeams).map(function(g){ return Object.assign({},g,{kind:'Auto-bid'}); })
      .concat(pkbPairFF(fieldData.ffAtLargeTeams).map(function(g){ return Object.assign({},g,{kind:'At-large'}); }));
    var key=fieldData.field.map(function(t){return t.team;}).join('|');

    if(!_pkb.ncaaFirstFour||_pkb.ncaaFirstFour._key!==key){
      _pkb.ncaaFirstFour={games:ffGames, results:{}, _key:key};
    }
    var ff=_pkb.ncaaFirstFour;
    var allDecided=ff.games.length>0 && ff.games.every(function(g,i){ return ff.results[i]; });

    var html='<div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);margin-bottom:1rem;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:0.75rem 1rem;line-height:1.6">'
      +'Auto bids = each conference\'s tournament winner from your picks (or the projected regular-season leader if not decided yet). At-large bids and seeding by Playoff Rating (Elo × win% + resume) — the same formula CFB\'s CFP Bracket uses. No geographic regions are simulated; bracket order follows Playoff Rating rank only.'
      +'</div>';

    html+='<div style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-dim);margin-bottom:0.5rem">First Four ('+fieldData.autoBids.length+' auto bids · '+fieldData.atLarge.length+' at-large · '+fieldData.total+' total)</div>';
    html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:0.6rem;margin-bottom:1.2rem">';
    ff.games.forEach(function(g,i){
      var picked=ff.results[i];
      html+='<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:0.6rem">'
        +'<div style="font-size:0.58rem;color:var(--text-dim);font-family:var(--font-mono);margin-bottom:0.35rem">'+g.kind+' · First Four</div>'
        +[g.a,g.b].map(function(t){
          var isPick=picked===t.team;
          return '<button onclick="pkbFirstFourAdvance('+i+',\''+String(t.team).replace(/'/g,"\\'")+'\')" style="display:block;width:100%;text-align:left;margin-bottom:0.25rem;padding:0.3rem 0.5rem;border-radius:var(--radius);border:1px solid '+(isPick?'var(--accent)':'var(--border-md)')+';background:'+(isPick?'rgba(226,201,126,0.12)':'var(--bg3)')+';color:'+(isPick?'var(--accent)':'var(--text)')+';font-size:0.74rem;font-weight:'+(isPick?'600':'400')+';cursor:pointer">'+t.team+' <span style="font-size:0.55rem;color:var(--text-dim);float:right">'+(t.conf||'')+'</span></button>';
        }).join('')
        +'</div>';
    });
    html+='</div>';

    if(!allDecided){
      html+='<div style="text-align:center;padding:1rem;font-family:var(--font-mono);font-size:0.72rem;color:var(--text-dim)">Pick all First Four winners to unlock the full bracket ↑</div>';
      el.innerHTML=html;
      return;
    }

    var autoTeamsFinal=fieldData.autoBids.filter(function(t){ return fieldData.ffAutoTeams.indexOf(t)===-1; });
    var atLargeTeamsFinal=fieldData.atLarge.filter(function(t){ return fieldData.ffAtLargeTeams.indexOf(t)===-1; });
    ff.games.forEach(function(g,i){
      var winnerName=ff.results[i];
      var winnerObj=(g.a.team===winnerName)?g.a:g.b;
      if(g.kind==='Auto-bid') autoTeamsFinal.push(winnerObj); else atLargeTeamsFinal.push(winnerObj);
    });

    var final64=autoTeamsFinal.concat(atLargeTeamsFinal).sort(function(a,b){ return b.pr-a.pr; });
    var seedArr64=[1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,6,6,6,6,7,7,7,7,
                   8,8,8,8,9,9,9,9,10,10,10,10,11,11,11,11,12,12,12,12,
                   13,13,13,13,14,14,14,14,15,15,15,15,16,16,16,16];
    final64.forEach(function(t,i){ t.seed=seedArr64[i]||16; });

    var bKey=final64.map(function(t){return t.team;}).join('|');
    if(!_pkb.ncaaBracket||_pkb.ncaaBracket._key!==bKey){
      // Rank order doubles as bracket seed order here (no regions modeled),
      // so pass final64 straight into the generic engine — it already
      // guarantees seed 1 and 2 can't meet before the final.
      var bracket=pkbNewBracket(final64.slice(0,64));
      pkbAdvanceByes(bracket.rounds);
      bracket._key=bKey;
      _pkb.ncaaBracket=bracket;
    }

    html+='<div style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-dim);margin:1rem 0 0.5rem">NCAA Tournament — Round of 64</div>';
    html+=pkbRenderBracket(_pkb.ncaaBracket, 'pkbNcaaAdvance');

    el.innerHTML=html;
  }

  window.pkbFirstFourAdvance=function(gi,team){
    if(!_pkb.ncaaFirstFour) return;
    _pkb.ncaaFirstFour.results[gi]=team;
    pkbDrawNCAA();
  };

  window.pkbNcaaAdvance=function(ri,mi,team){
    var bracket=_pkb.ncaaBracket; if(!bracket) return;
    bracket.rounds=bracket.rounds.slice(0,ri+1);
    var m=bracket.rounds[ri][mi];
    var t=(m.a&&m.a.team===team)?m.a:(m.b&&m.b.team===team?m.b:null);
    if(!t) return;
    m.winner=t;
    pkbAdvanceByes(bracket.rounds);
    pkbDrawNCAA();
  };



    async function checkForNewerSeasons() {
    const newest = CFG.seasons[0];
    const added  = [];
    // Only probe ONE season ahead of whatever's already newest (which, after
    // EloSeason.withCurrent(), is already this sport's correctly-computed
    // current season). Probing two years ahead had no valid case where it
    // should ever add anything — a season that far out can't have real data
    // yet — and stacked with the withCurrent() bug fixed elsewhere, it was
    // part of why a season tab could appear a year or more before it should.
    for (let yr = newest + 1; yr >= newest + 1; yr--) {
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
