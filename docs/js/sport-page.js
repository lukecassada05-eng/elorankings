'use strict';

window.initSportPage = function(CFG) {
  // Auto-add the current (and next, if it's about to start) season to
  // whatever's hardcoded in the page, so a new season shows up in the
  // picker the moment the backend has data for it — no manual HTML edit
  // needed when a season rolls over.
  if (window.EloSeason) CFG.seasons = window.EloSeason.withCurrent(CFG.seasons, CFG.sport);

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
      if (tab.dataset.tab === 'tourney')       { if(CFG.sport==='CBASE') renderCBaseTourney(); else renderTourney(); }
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
        '1. FC Koln':'Koeln',
        '1. FSV Mainz 05':'Mainz',
        'AC Milan':'Milan',
        'AC Monza':'Monza',
        'ACF Fiorentina':'Fiorentina',
        'AFC Ajax':'Ajax',
        'AFC Bournemouth':'Bournemouth',
        'AJ Auxerre':'Auxerre',
        'AS Monaco':'Monaco',
        'AS Monaco FC':'Monaco',
        'AS Roma':'Roma',
        'AS Saint-Étienne':'St Etienne',
        'AVS Futebol':'AVS',
        'AZ Alkmaar':'AZ',
        'Aberdeen FC':'Aberdeen',
        'Ajax Amsterdam':'Ajax',
        'Alanyaspor':'Alanyaspor',
        'Almere City FC':'Almere City',
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
        "Borussia M\u00f6nchengladbach":"M'gladbach",
        "Nott'm Forest":"Nott'm Forest",
        'Borussia Monchengladbach':'M\'gladbach',
        'Borussia Mönchengladbach':'M\'gladbach',
        'Brighton & Hove Albion':'Brighton',
        'Burnley':'Burnley',
        'CA Osasuna':'Osasuna',
        'CD Leganes':'Leganes',
        'CD Santa Clara':'Santa Clara',
        'Cagliari Calcio':'Cagliari',
        'Casa Pia AC':'Casa Pia',
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
        'Dundee United FC':'Dundee Utd',
        'Eintracht Frankfurt':'Ein Frankfurt',
        'Empoli FC':'Empoli',
        'Espanyol':'Espanol',
        'Estoril Praia':'Estoril',
        'Eyupspor':'Eyupspor',
        'FC Augsburg':'Augsburg',
        'FC Barcelona':'Barcelona',
        'FC Bayern München':'Bayern Munich',
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
        'Fortuna Sittard':'Fortuna Sittard',
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
        'K Sint-Truidense VV':'Sint-Truiden',
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
        'NEC Nijmegen':'NEC',
        'Newcastle United':'Newcastle',
        'Norwich City':'Norwich',
        'Nottingham Forest':'Nott\'m Forest',
        'OGC Nice':'Nice',
        'OH Leuven':'OH Leuven',
        'Oakland Athletics':'Athletics',
        'Olympique Lyonnais':'Lyon',
        'Olympique de Marseille':'Marseille',
        'Oud-Heverlee Leuven':'OH Leuven',
        'PEC Zwolle':'Zwolle',
        'PSG':'Paris SG',
        'PSV Eindhoven':'PSV',
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
        'RKC Waalwijk':'RKC',
        'RSC Anderlecht':'Anderlecht',
        'Rangers FC':'Rangers',
        'Rayo Vallecano':'Vallecano',
        'Rayo Vallecano de Madrid':'Vallecano',
        'Real Betis':'Betis',
        'Real Betis Balompié':'Betis',
        'Real Madrid':'Real Madrid',
        'Real Madrid CF':'Real Madrid',
        'Real Sociedad de Fútbol':'Real Sociedad',
        'Real Valladolid':'Valladolid',
        'Real Valladolid CF':'Valladolid',
        'Real Zaragoza':'Zaragoza',
        'Rio Ave FC':'Rio Ave',
        'Rizespor':'Rizespor',
        'Ross County FC':'Ross County',
        'Royal Antwerp FC':'Antwerp',
        'Royale Union Saint-Gilloise':'Union SG',
        'SBV Excelsior':'Excelsior',
        'SBV Vitesse':'Vitesse',
        'SC Braga':'Braga',
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
        'Sint-Truiden VV':'Sint-Truiden',
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
        'Union Saint-Gilloise':'Union SG',
        'Valencia CF':'Valencia',
        'Venezia FC':'Venezia',
        'VfB Stuttgart':'Stuttgart',
        'VfL Bochum':'Bochum',
        'VfL Bochum 1848':'Bochum',
        'VfL Wolfsburg':'Wolfsburg',
        'Villarreal CF':'Villarreal',
        'Vitesse Arnhem':'Vitesse',
        'Vitoria Guimaraes':'Vitoria',
        'Vitoria SC':'Vitoria',
        'Watford':'Watford',
        'West Ham United':'West Ham',
        'Wolverhampton Wanderers':'Wolves',
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
  function getMovers(n) {
    const eligible = data.filter(r => r.games_played > 0);
    const sorted   = [...eligible].sort((a, b) => movement(b) - movement(a));
    return {
      risers:  sorted.slice(0, n),
      fallers: sorted.slice(-n).reverse().filter(r => !sorted.slice(0, n).includes(r)),
    };
  }

  function moversHtml() {
    const { risers, fallers } = getMovers(5);
    if (!risers.length) return '';
    const row = r => {
      const d = movement(r);
      const cls = d >= 0 ? 'trend-up' : 'trend-down';
      const arrow = d >= 0 ? '▲' : '▼';
      return `<div class="mover-row" title="${d.toFixed(1)} Elo ${movementLabel(r)}">
        <span class="mover-team">${teamDisplay(r.team)}</span>
        <span class="${cls}">${arrow} ${Math.abs(d).toFixed(0)}</span>
      </div>`;
    };
    return `<div class="movers-panel">
      <div class="movers-col">
        <div class="movers-title">📈 Biggest Risers <span class="movers-sub">this week</span></div>
        ${risers.map(row).join('') || '<div class="mover-row mover-empty">No movement yet</div>'}
      </div>
      <div class="movers-col">
        <div class="movers-title">📉 Biggest Fallers <span class="movers-sub">this week</span></div>
        ${fallers.length ? fallers.map(row).join('') : '<div class="mover-row mover-empty">No movement yet</div>'}
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
    function fetchConfChamps() {
      // For CBB: use the NCAA tournament bracket - gives us actual auto bid winners
      // For CBASE: use conference tournament scoreboard
      if (isCBB) {
        // Try NCAA bracket API first (most reliable - has actual auto bid recipients)
        var bracketUrl = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/tournament/bracket?season=' + season;
        return fetch(bracketUrl, {mode:'cors'})
          .then(function(r){ return r.ok ? r.json() : null; })
          .catch(function(){ return null; })
          .then(function(data) {
            var champs = {};
            if (!data) return champs;
            // Traverse bracket teams - each conf's auto bid team is marked
            // ESPN bracket: groups of teams with seed info
            var teams = data.teams || (data.bracket && data.bracket.teams) || [];
            // Flatten nested structure
            function extractTeams(obj) {
              if (!obj) return;
              if (obj.seed && obj.team) {
                var t = obj.team;
                var c = (t.conferenceId || t.conference || {}).name || '';
                var n = t.shortDisplayName || t.displayName || '';
                if (c && n) {
                  // Lower seed number within a conf = auto bid winner
                  if (!champs[c.toLowerCase()] || obj.seed < champs[c.toLowerCase()].seed) {
                    champs[c.toLowerCase()] = {name: n, seed: obj.seed};
                  }
                }
              }
              Object.values(obj).forEach(function(v) {
                if (v && typeof v === 'object') extractTeams(v);
              });
            }
            extractTeams(data);
            // Convert to simple name map
            var result = {};
            Object.keys(champs).forEach(function(k){ result[k] = champs[k].name; });
            return result;
          });
      } else {
        // CBASE: fetch conference tournament championship games
        var yr = season;
        var fromDate = yr + '0515'; var toDate = yr + '0528';
        var urls = [
          'https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard?limit=500&seasontype=3&groups=11',
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
              var note = (ev.notes||[]).map(function(n){return n.headline||'';}).join(' ');
              if (!/champion/i.test(note)) return;
              var comp = (ev.competitions||[])[0];
              if (!comp || !comp.status.type.completed) return;
              var winner=null, max=-1;
              (comp.competitors||[]).forEach(function(c){ var s=parseFloat(c.score); if(!isNaN(s)&&s>max){max=s;winner=c;} });
              if (!winner) return;
              var wn = winner.team.shortDisplayName || winner.team.displayName || '';
              if (ev.groups && ev.groups[0]) {
                var g = ev.groups[0]; 
                if (g.name) champs[g.name.toLowerCase()] = wn;
                if (g.shortName) champs[g.shortName.toLowerCase()] = wn;
              }
            } catch(e){}
          });
          return champs;
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
        ${CFG.sport==='CFB'?'<th data-type="num" title="Playoff Rating = Elo × win_pct^0.6 + √(quality resume)">PR ⓘ</th>':''}
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
      {wk:2, dt:"2026-09-12", h:"Oregon St",     a:"Texas Tech",         n:false},
      {wk:1, dt:"2026-08-29", h:"Oregon St",     a:"Hawai'i",          n:false},
      
      {wk:3, dt:"2026-09-19", h:"Oregon St",     a:"S. Dakota",     n:false},
      // Boise State
      {wk:1, dt:"2026-09-05", h:"Oregon",           a:"Boise St",      n:false},
      {wk:2, dt:"2026-09-12", h:"Boise St",      a:"Memphis",           n:false},
      {wk:4, dt:"2026-09-26", h:"W. Michigan",  a:"Boise St",          n:false},
      {wk:3, dt:"2026-09-19", h:"Colorado St",   a:"BYU",              n:false},
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


      // Texas State non-conf
      {wk:1, dt:"2026-09-05", h:"Texas",          a:"Texas St",          n:false},
      {wk:2, dt:"2026-09-12", h:"Texas St",        a:"UIW",               n:false},
      {wk:3, dt:"2026-09-19", h:"Texas St",        a:"North Texas",       n:false},
      {wk:4, dt:"2026-09-26", h:"Texas St",        a:"UTSA",              n:false},
      // Texas State conference games
      {wk:5,  dt:"2026-10-03", h:"San Diego St",   a:"Texas St",          n:false},
      {wk:6,  dt:"2026-10-10", h:"Texas St",        a:"Fresno St",         n:false},
      {wk:8,  dt:"2026-10-24", h:"Texas St",        a:"Utah St",           n:false},
      {wk:9,  dt:"2026-10-31", h:"Boise St",        a:"Texas St",          n:false},
      {wk:10, dt:"2026-11-07", h:"Oregon St",       a:"Texas St",          n:false},
      {wk:11, dt:"2026-11-14", h:"Texas St",        a:"Colorado St",       n:false},
      {wk:12, dt:"2026-11-21", h:"Washington St",   a:"Texas St",          n:false},
      
      // ── Pac-12 Conference (28 unique games, 7 each) ─────────────────────────
      {wk:5, dt:"2026-10-03", h:"Colorado St", a:"Utah St", n:false},
      {wk:5, dt:"2026-10-03", h:"Oregon St", a:"Boise St", n:false},
      {wk:5, dt:"2026-10-03", h:"Washington St", a:"Fresno St", n:false},
      {wk:6, dt:"2026-10-10", h:"Boise St", a:"Fresno St", n:false},
      {wk:6, dt:"2026-10-10", h:"Oregon St", a:"Colorado St", n:false},
      {wk:6, dt:"2026-10-10", h:"Utah St", a:"Washington St", n:false},
      {wk:7, dt:"2026-10-17", h:"Boise St", a:"San Diego St", n:false},
      {wk:7, dt:"2026-10-17", h:"Fresno St", a:"Utah St", n:false},
      {wk:7, dt:"2026-10-17", h:"Oregon St", a:"Washington St", n:false},
      {wk:8, dt:"2026-10-24", h:"Colorado St", a:"San Diego St", n:false},
      {wk:8, dt:"2026-10-24", h:"Oregon St", a:"Fresno St", n:false},
      {wk:8, dt:"2026-10-24", h:"Washington St", a:"Boise St", n:false},
      {wk:9, dt:"2026-10-31", h:"Colorado St", a:"Fresno St", n:false},
      {wk:9, dt:"2026-10-31", h:"Oregon St", a:"Utah St", n:false},
      {wk:9, dt:"2026-10-31", h:"San Diego St", a:"Washington St", n:false},
      {wk:10, dt:"2026-11-07", h:"Boise St", a:"Colorado St", n:false},
      {wk:10, dt:"2026-11-07", h:"Fresno St", a:"San Diego St", n:false},
      {wk:11, dt:"2026-11-14", h:"Boise St", a:"Utah St", n:false},
      {wk:11, dt:"2026-11-14", h:"Oregon St", a:"San Diego St", n:false},
      {wk:11, dt:"2026-11-14", h:"Washington St", a:"Colorado St", n:false},
      {wk:12, dt:"2026-11-21", h:"San Diego St", a:"Utah St", n:false},
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
