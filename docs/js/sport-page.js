/* ============================================================
   sport-page.js
   Reusable engine for every sport page.
   Each sport HTML page just calls:
     initSportPage(CONFIG)
   ============================================================ */
'use strict';

window.initSportPage = function(CFG) {
  /* CFG shape:
    {
      sport:      string   e.g. "NFL"
      dataPath:   string   e.g. "../NFL/data/NFL_Elo_"  (season + ".csv" appended)
      seasons:    number[] newest first
      hca:        number   home advantage Elo points
      confLabel:  string   "Division" | "Conference" | "League"
      tabs:       string[] subset of ["rankings","byconf","predictor","bracketology","resume"]
      extraCols:  array    optional extra column defs for rankings table
      kFactor:    number   (display only)
    }
  */

  // ── State ───────────────────────────────────────────────────
  let data         = [];      // coerced rows for current season
  let currentSeason = CFG.seasons[0];

  // ── Season picker ────────────────────────────────────────────
  const picker = document.getElementById('seasonPicker');
  if (picker) {
    CFG.seasons.forEach(yr => {
      const b = document.createElement('button');
      b.className = 'season-btn' + (yr === currentSeason ? ' active' : '');
      b.textContent = yr;
      b.onclick = () => loadSeason(yr);
      picker.appendChild(b);
    });
  }

  // ── Tab init ─────────────────────────────────────────────────
  const tabsEl = document.querySelector('.tabs');
  const panelMap = {};
  (CFG.tabs || ['rankings']).forEach(t => {
    panelMap[t] = document.getElementById('panel-' + t);
  });

  if (tabsEl) {
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        Object.values(panelMap).forEach(p => { if(p) p.hidden = true; });
        const pn = tab.dataset.tab;
        if (panelMap[pn]) panelMap[pn].hidden = false;
        if (pn === 'byconf')      renderByConf();
        if (pn === 'predictor')   renderPredictor();
        if (pn === 'bracketology')renderBracketology();
        if (pn === 'resume')      renderResume();
      });
    });
    // activate first tab
    const firstTab = tabsEl.querySelector('.tab');
    if (firstTab) firstTab.click();
  }

  // ── Load season ──────────────────────────────────────────────
  async function loadSeason(yr) {
    currentSeason = yr;
    document.querySelectorAll('.season-btn').forEach(b =>
      b.classList.toggle('active', parseInt(b.textContent) === yr));

    setLoading('panel-rankings');

    const raw = await fetchCSV(CFG.dataPath + yr + '.csv');
    if (!raw) {
      setEmpty('panel-rankings', 'No data available for ' + yr);
      updateSummary(null);
      return;
    }

    data = raw.map(coerceRow).sort((a,b) => a.rank - b.rank);
    updateSummary(data);
    populateSelects();
    renderRankings();

    // Re-render whichever tab is active (if not rankings)
    const activeTab = document.querySelector('.tab.active');
    if (activeTab) {
      const pn = activeTab.dataset.tab;
      if (pn === 'byconf')      renderByConf();
      if (pn === 'predictor')   renderPredictor();
      if (pn === 'bracketology')renderBracketology();
      if (pn === 'resume')      renderResume();
    }
  }

  // ── Summary cards ────────────────────────────────────────────
  function updateSummary(d) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    if (!d || !d.length) {
      ['s-top','s-top-elo','s-avg','s-teams','s-confs','s-updated'].forEach(id => set(id,'—'));
      return;
    }
    const top = d[0];
    set('s-top',      top.team);
    set('s-top-elo',  'Elo ' + top.elo.toFixed(1));
    set('s-teams',    d.length);
    set('s-avg',      (d.reduce((s,r)=>s+r.elo,0)/d.length).toFixed(1));
    const confs = new Set(d.map(r=>r.conference).filter(Boolean));
    set('s-confs', confs.size || '—');
    const upd = d.find(r=>r.updated_at)?.updated_at;
    set('s-updated', upd ? fmt.date(upd) : '—');
  }

  // ── Populate filter selects ──────────────────────────────────
  function populateSelects() {
    const confs = [...new Set(data.map(r=>r.conference).filter(Boolean))].sort();
    const cf = document.getElementById('confFilter');
    if (cf) cf.innerHTML = '<option value="">All ' + CFG.confLabel + 's</option>' +
      confs.map(c=>`<option>${c}</option>`).join('');

    const teams = [...data].sort((a,b)=>a.team.localeCompare(b.team));
    ['teamA','teamB'].forEach((id,i) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = teams.map((t,j)=>
        `<option value="${t.team}" ${j===i?'selected':''}>${t.team}</option>`).join('');
    });
  }

  // ── Filtered data ────────────────────────────────────────────
  function getFiltered() {
    const conf  = (document.getElementById('confFilter')?.value)  || '';
    const minG  = parseInt(document.getElementById('minGames')?.value) || 0;
    const q     = (document.getElementById('teamSearch')?.value || '').toLowerCase();
    return data.filter(r =>
      (!conf || r.conference === conf) &&
      r.games_played >= minG &&
      (!q || r.team.toLowerCase().includes(q))
    );
  }

  // ── Rankings tab ─────────────────────────────────────────────
  function renderRankings() {
    const filtered = getFiltered();
    const el = document.getElementById('panel-rankings');
    if (!el) return;
    if (!filtered.length) { el.innerHTML = '<div class="empty-state">No teams match your filters.</div>'; return; }

    const maxElo = Math.max(...filtered.map(r=>r.elo));
    const minElo = Math.min(...filtered.map(r=>r.elo));

    // Base columns
    const rows = filtered.map(r => {
      const bw   = r.best_win_elo > 0 ? r.best_win_elo.toFixed(1) : '—';
      const bwn  = fmt.maybe(r.best_win_team);
      const barW = eloBarWidth(r.elo, maxElo, minElo, 80);
      const extra = (CFG.extraCols || []).map(c => {
        const v = r[c.key] ?? null;
        return `<td class="num" data-val="${v ?? ''}">${v != null ? Number(v).toFixed(c.dec ?? 0) : '—'}</td>`;
      }).join('');

      return `<tr>
        <td class="rank"  data-val="${r.rank}">${r.rank}</td>
        <td class="team-name">${r.team}</td>
        <td class="conf"  data-val="${r.conference||''}">${r.conference||'—'}</td>
        <td class="elo"   data-val="${r.elo}">
          <div class="elo-bar-wrap">
            <span>${r.elo.toFixed(1)}</span>
            <div class="elo-bar" style="width:${barW}px"></div>
          </div>
        </td>
        <td class="record" data-val="${r.wins}">${r.record}</td>
        <td class="num"   data-val="${r.win_pct}">${fmt.pct(r.win_pct)}</td>
        <td class="num"   data-val="${r.sos}">${r.sos>0?r.sos.toFixed(1):'—'}</td>
        <td class="num"   data-val="${r.best_win_elo}">
          <span title="${bwn}">${bwn!=='—'?bwn.substring(0,16):'—'}</span>
          <span style="color:var(--text-dim);font-size:0.62rem;margin-left:0.25rem">${bw!=='—'?bw:''}</span>
        </td>
        ${extra}
      </tr>`;
    }).join('');

    const extraHeaders = (CFG.extraCols||[]).map(c=>
      `<th data-type="num">${c.label}</th>`).join('');

    el.innerHTML = `<div class="table-wrap"><table class="tbl" id="mainTable">
      <thead><tr>
        <th data-type="num">Rank</th>
        <th>Team</th>
        <th>${CFG.confLabel}</th>
        <th data-type="num">Elo</th>
        <th data-type="num">Record</th>
        <th data-type="num">Win%</th>
        <th data-type="num">SOS</th>
        <th data-type="num">Best Win</th>
        ${extraHeaders}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;

    makeSortable(document.getElementById('mainTable'));

    // Wire search to filter rows live (no re-render needed after initial)
    const searchEl = document.getElementById('teamSearch');
    const tbl = document.getElementById('mainTable');
    if (searchEl && tbl) makeSearchable(searchEl, tbl);
  }

  // ── By Conference tab ────────────────────────────────────────
  function renderByConf() {
    const el = document.getElementById('panel-byconf');
    if (!el) return;
    if (!data.length) { el.innerHTML = '<div class="empty-state">Load a season first.</div>'; return; }

    const confMap = {};
    data.forEach(r => {
      const c = r.conference || 'Other';
      if (!confMap[c]) confMap[c] = [];
      confMap[c].push(r);
    });

    const sorted = Object.entries(confMap)
      .sort(([,a],[,b]) => {
        const avgA = a.reduce((s,r)=>s+r.elo,0)/a.length;
        const avgB = b.reduce((s,r)=>s+r.elo,0)/b.length;
        return avgB - avgA;
      });

    el.innerHTML = sorted.map(([conf, teams]) => {
      const avg  = (teams.reduce((s,r)=>s+r.elo,0)/teams.length).toFixed(1);
      const wins = teams.reduce((s,r)=>s+r.wins,0);
      const loss = teams.reduce((s,r)=>s+r.losses,0);
      const rows = [...teams].sort((a,b)=>b.elo-a.elo).map((r,i) => `<tr>
        <td class="rank">${i+1}</td>
        <td class="team-name">${r.team}</td>
        <td class="elo" data-val="${r.elo}">${r.elo.toFixed(1)}</td>
        <td class="record">${r.record}</td>
        <td class="num">${fmt.pct(r.win_pct)}</td>
        <td class="num">${r.sos>0?r.sos.toFixed(1):'—'}</td>
        <td class="num" title="${r.best_win_team||''}">${r.best_win_team?r.best_win_team.substring(0,16):'—'}</td>
      </tr>`).join('');

      return `<div class="conf-block">
        <div class="conf-block-header">${conf} · avg Elo ${avg} · ${wins}–${loss} overall</div>
        <table class="tbl">
          <thead><tr>
            <th>#</th><th>Team</th><th data-type="num">Elo</th>
            <th>Record</th><th data-type="num">Win%</th>
            <th data-type="num">SOS</th><th>Best Win</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }).join('');
  }

  // ── Predictor tab ────────────────────────────────────────────
  function renderPredictor() {
    const el = document.getElementById('panel-predictor');
    if (!el || !data.length) return;

    const teamAEl = document.getElementById('teamA');
    const teamBEl = document.getElementById('teamB');
    const hcaEl   = document.getElementById('hcaCheck');
    const resEl   = document.getElementById('predResult');
    if (!teamAEl || !teamBEl || !resEl) return;

    function calc() {
      const ta = data.find(r => r.team === teamAEl.value);
      const tb = data.find(r => r.team === teamBEl.value);
      if (!ta || !tb || ta.team === tb.team) { resEl.innerHTML = ''; return; }

      const hAdj = hcaEl?.checked ? CFG.hca : 0;
      const pA   = eloWinProb(ta.elo, tb.elo, hAdj);
      const pB   = 1 - pA;
      const sprd = eloSpread(ta.elo, tb.elo, hAdj);
      const fav  = pA >= pB ? ta.team : tb.team;

      resEl.innerHTML = `
        <div class="pred-result">
          <div class="prob-nums">
            <span style="color:var(--accent)">${(pA*100).toFixed(1)}%</span>
            <span style="color:var(--text-dim);font-size:1rem;align-self:center">win probability</span>
            <span style="color:var(--blue-hi)">${(pB*100).toFixed(1)}%</span>
          </div>
          <div class="prob-bar" style="margin:0.6rem 0">
            <div style="width:${(pA*100).toFixed(1)}%;background:var(--accent)"></div>
            <div style="flex:1;background:var(--blue-hi)"></div>
          </div>
          <div class="prob-detail">
            <span>${ta.team} · Elo ${ta.elo.toFixed(1)}${hAdj?'  (home)':''}</span>
            <span>proj. spread: <strong>${sprd > 0 ? '+' : ''}${sprd}</strong> (${fav})</span>
            <span>${tb.team} · Elo ${tb.elo.toFixed(1)}</span>
          </div>
        </div>`;
    }

    [teamAEl, teamBEl, hcaEl].forEach(el => { if(el) el.addEventListener('change', calc); });
    calc();
  }

  // ── Bracketology tab (CBB / College Baseball) ────────────────
  function renderBracketology() {
    const el = document.getElementById('panel-bracketology');
    if (!el || !data.length) return;

    // Auto bids: best Elo team per conference
    const byConf = {};
    data.forEach(r => {
      const c = r.conference || 'Unknown';
      if (!byConf[c] || r.elo > byConf[c].elo) byConf[c] = r;
    });
    const autoBids   = Object.values(byConf);
    const autoTeams  = new Set(autoBids.map(r=>r.team));
    const totalBids  = CFG.sport === 'CBB' ? 68 : 64;
    const atLargeN   = totalBids - autoBids.length;

    const atLarge = data.filter(r => !autoTeams.has(r.team))
                        .sort((a,b) => b.elo - a.elo)
                        .slice(0, atLargeN);

    const field = [...autoBids, ...atLarge].sort((a,b) => b.elo - a.elo);

    // Seed distribution
    const seedLines = CFG.sport === 'CBB'
      ? [1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,6,6,6,6,7,7,7,7,
         8,8,8,8,9,9,9,9,10,10,10,10,11,11,11,11,11,11,
         12,12,12,12,13,13,13,13,14,14,14,14,15,15,15,15,16,16,16,16,16,16]
      : Array.from({length:64},(_,i)=>Math.floor(i/4)+1);

    field.forEach((r,i) => { r._seed = seedLines[i]; r._auto = autoTeams.has(r.team); });

    const bySeed = {};
    field.forEach(r => { if(!bySeed[r._seed])bySeed[r._seed]=[]; bySeed[r._seed].push(r); });

    const infoEl = document.getElementById('bracketInfo');
    if (infoEl) infoEl.textContent = `${autoBids.length} auto bids · ${atLarge.length} at-large · ${field.length} total`;

    el.innerHTML = `<div class="bracket-grid">
      ${Object.entries(bySeed).map(([seed, teams]) => `
        <div class="bracket-card">
          <div class="bracket-card-header">Seed ${seed}</div>
          ${teams.map(r => `
            <div class="bracket-line">
              <div class="seed ${parseInt(seed)<=3?'s'+seed:''}">${seed}</div>
              <div style="flex:1;min-width:0">
                <div class="bracket-line-team">${r.team}</div>
                <div class="bracket-line-conf">${r.conference||'—'} · ${r.elo.toFixed(1)}</div>
              </div>
              ${r._auto ? '<span class="card-tag tag-live" style="font-size:0.55rem;padding:0.15rem 0.45rem">AUTO</span>' : ''}
            </div>`).join('')}
        </div>`).join('')}
    </div>`;
  }

  // ── Resume tab (CFB) ─────────────────────────────────────────
  function renderResume() {
    const el = document.getElementById('panel-resume');
    if (!el || !data.length) return;

    const sorted = [...data].sort((a,b) => (b.resume_score||0) - (a.resume_score||0));
    const rows = sorted.slice(0,120).map((r,i) => `<tr>
      <td class="rank">${i+1}</td>
      <td class="team-name">${r.team}</td>
      <td class="conf">${r.conference||'—'}</td>
      <td class="elo" data-val="${r.elo}">${r.elo.toFixed(1)}</td>
      <td class="record">${r.record}</td>
      <td class="num" data-val="${r.resume_score||0}">${r.resume_score>0?Number(r.resume_score).toFixed(0):'—'}</td>
      <td class="num">${r.sos>0?r.sos.toFixed(1):'—'}</td>
      <td class="num" title="${r.best_win_team||''}">${r.best_win_team?r.best_win_team.substring(0,16):'—'}</td>
    </tr>`).join('');

    el.innerHTML = buildTable(rows, [
      {label:'Rank',type:'num'},{label:'Team'},{label:CFG.confLabel},
      {label:'Elo',type:'num'},{label:'Record',type:'num'},
      {label:'Resume Score',type:'num'},{label:'SOS',type:'num'},{label:'Best Win'}
    ]);
    makeSortable(document.getElementById('mainTable'));
  }

  // ── Export button ────────────────────────────────────────────
  document.getElementById('exportBtn')?.addEventListener('click', () => {
    const cols = ['rank','team','conference','elo','wins','losses',
                  'games_played','win_pct','record','sos',
                  'best_win_team','best_win_elo','updated_at'];
    downloadCSV(getFiltered(), CFG.sport + '_Elo_' + currentSeason + '.csv', cols);
  });

  // ── Filter change listeners ──────────────────────────────────
  ['confFilter','minGames'].forEach(id =>
    document.getElementById(id)?.addEventListener('change', renderRankings));

  // ── Helpers ─────────────────────────────────────────────────
  function setLoading(panelId) {
    const el = document.getElementById(panelId);
    if (el) el.innerHTML = '<div class="loading"><div class="spinner"></div>Loading…</div>';
  }
  function setEmpty(panelId, msg) {
    const el = document.getElementById(panelId);
    if (el) el.innerHTML = '<div class="empty-state">' + msg + '</div>';
  }

  // ── Init ─────────────────────────────────────────────────────
  loadSeason(currentSeason);
};
