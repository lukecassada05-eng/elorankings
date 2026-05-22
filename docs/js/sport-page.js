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
        <th data-type="num">Elo</th><th data-type="num">Record</th>
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
    const el = document.getElementById('panel-predictor');
    if (!el || !data.length) return;
    const taEl = document.getElementById('teamA');
    const tbEl = document.getElementById('teamB');
    const hca  = document.getElementById('hcaCheck');
    const res  = document.getElementById('predResult');
    if (!taEl || !tbEl || !res) return;

    function calc() {
      const ta = data.find(r=>r.team===taEl.value);
      const tb = data.find(r=>r.team===tbEl.value);
      if (!ta||!tb||ta.team===tb.team){res.innerHTML='';return;}
      const hAdj = hca?.checked ? CFG.hca : 0;
      const pA   = eloWinProb(ta.elo, tb.elo, hAdj);
      const pB   = 1 - pA;
      const sprd = eloSpread(ta.elo, tb.elo, hAdj);
      res.innerHTML = `<div class="pred-result">
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
          <span>${ta.team} · Elo ${ta.elo.toFixed(1)}${hAdj?' (home)':''}</span>
          <span>spread: <strong>${sprd>0?'+':''}${sprd}</strong></span>
          <span>${tb.team} · Elo ${tb.elo.toFixed(1)}</span>
        </div>
      </div>`;
    }
    [taEl,tbEl,hca].forEach(el => { if(el) el.addEventListener('change', calc); });
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
    const sorted = [...data].sort((a,b)=>(b.resume_score||0)-(a.resume_score||0));
    const rows = sorted.slice(0,120).map((r,i)=>`<tr>
      <td class="rank">${i+1}</td><td class="team-name">${r.team}</td>
      <td class="conf">${r.conference||'—'}</td>
      <td class="elo" data-val="${r.elo}">${r.elo.toFixed(1)}</td>
      <td class="record">${r.record}</td>
      <td class="num" data-val="${r.resume_score||0}">${r.resume_score>0?Number(r.resume_score).toFixed(0):'—'}</td>
      <td class="num">${r.sos>0?r.sos.toFixed(1):'—'}</td>
      <td class="num">${r.best_win_team?r.best_win_team.substring(0,16):'—'}</td>
    </tr>`).join('');
    el.innerHTML = `<div class="table-wrap"><table class="tbl" id="mainTable">
      <thead><tr><th data-type="num">Rank</th><th>Team</th><th>Conf</th>
        <th data-type="num">Elo</th><th>Record</th>
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

      // ── CFB Season Pick'em + CFP Predictor ───────────────────
  // Off-season: user adds games manually (team vs team + score)
  // In-season:  completed games shown from CSV; user picks remaining
  // Result:     seeded 12-team CFP bracket (no winner predicted, 
  //             just the field + seeding based on your picks)

  let _pk = {
    yr: null,
    games: [],        // {id, teamA, teamB, scoreA, scoreB, completed, picked}
    confGames: [],    // manually entered conf champ games
    eloBase: {},      // from CSV
    eloSim: {},       // adjusted by picks
  };

  // 2025 CFP rules:
  //  - 12 teams total
  //  - 4 first-round byes: top 4 conference champions (by rank/Elo among champs)
  //  - Seeds 5-12: remaining conf champs + at-large (highest ranked)
  //  - First round: 5v12, 6v11, 7v10, 8v9
  //  - Quarterfinals at top seeds' home sites
  //  - Semifinals at Rose/Sugar Bowl (fixed sites)
  //  - Championship neutral site

  const CFP_AUTO_CONF = ["SEC","Big Ten","Big 12","ACC",
                          "Mountain West","AAC","Sun Belt","MAC","C-USA","ACC"];
  // Conferences that get automatic bids (any conf champ is eligible)

  async function renderPickem() {
    const el = document.getElementById('panel-pickem');
    if (!el || CFG.sport !== 'CFB') return;

    // Load current season Elo
    if (!allSeasonData[currentSeason]) {
      const raw = await fetchCSV(CFG.dataPath + currentSeason + '.csv');
      if (raw) allSeasonData[currentSeason] = raw.map(coerceRow);
    }
    _pk.eloBase = {};
    (allSeasonData[currentSeason] || []).forEach(r => { _pk.eloBase[r.team] = r.elo; });
    _pk.eloSim  = { ..._pk.eloBase };

    const nextYr = currentSeason + 1;
    _pk.yr = nextYr;

    // Determine mode: off-season (no CSV for next year) vs in-season (CSV exists)
    let nextData = allSeasonData[nextYr];
    if (!nextData) {
      try {
        const raw = await fetchCSV(CFG.dataPath + nextYr + '.csv');
        if (raw && raw.length > 10) { allSeasonData[nextYr] = raw.map(coerceRow); nextData = allSeasonData[nextYr]; }
      } catch(_e) {}
    }

    const inSeason = !!(nextData && nextData.length > 10);
    if (inSeason) {
      _pk.eloBase = {};
      nextData.forEach(r => { _pk.eloBase[r.team] = r.elo; });
      _pk.eloSim = { ..._pk.eloBase };
    }

    _pk.games = [];
    _pk.confGames = [];

    renderPickemShell(nextYr, inSeason);
  }

  function renderPickemShell(yr, inSeason) {
    const el = document.getElementById('panel-pickem');
    if (!el) return;

    el.innerHTML = `
<div class="pk-wrap" style="max-width:860px">
  <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);
              padding:1rem 1.25rem;margin-bottom:1.25rem">
    <div style="font-size:0.88rem;font-weight:600;color:var(--text);margin-bottom:0.35rem">
      🏈 ${yr} Season Pick'em → CFP Bracket
    </div>
    <div style="font-size:0.72rem;color:var(--text-muted);font-family:var(--font-mono);line-height:1.6">
      ${inSeason
        ? `In-season mode · Elo based on ${yr} games so far · Pick remaining games below`
        : `Off-season mode · Elo based on ${yr-1} season · Add games to simulate ${yr}`}
      <br>After entering games → add conference championship predictions → generate CFP field
    </div>
  </div>

  <!-- Phase tabs -->
  <div style="display:flex;gap:0;margin-bottom:1.25rem;border-bottom:1px solid var(--border)">
    ${['regular','confchamp','bracket'].map((ph,i) => `
      <button onclick="pkSetPhase('${ph}')" id="pk-tab-${ph}"
        style="font-family:var(--font-mono);font-size:0.7rem;padding:0.5rem 1rem;
               border:none;border-bottom:2px solid ${i===0?'var(--accent)':'transparent'};
               background:transparent;cursor:pointer;color:${i===0?'var(--accent)':'var(--text-muted)'}">
        ${['Regular Season','Conf Championships','CFP Bracket'][i]}
      </button>`).join('')}
  </div>

  <div id="pk-phase-regular">${buildRegularPhase(inSeason)}</div>
  <div id="pk-phase-confchamp" hidden>${buildConfChampPhase()}</div>
  <div id="pk-phase-bracket" hidden>${buildBracketPhase()}</div>
</div>`;
  }

  window.pkSetPhase = function(ph) {
    ['regular','confchamp','bracket'].forEach(p => {
      document.getElementById(`pk-phase-${p}`)?.toggleAttribute('hidden', p !== ph);
      const btn = document.getElementById(`pk-tab-${p}`);
      if (btn) {
        btn.style.borderBottomColor = p === ph ? 'var(--accent)' : 'transparent';
        btn.style.color = p === ph ? 'var(--accent)' : 'var(--text-muted)';
      }
    });
    if (ph === 'confchamp') refreshConfChamp();
    if (ph === 'bracket')   refreshBracket();
  };

  // ── REGULAR SEASON PHASE ──────────────────────────────────
  function buildRegularPhase(inSeason) {
    const teams = Object.keys(_pk.eloBase).sort();
    const teamOpts = teams.map(t => `<option value="${t}">${t}</option>`).join('');

    return `
    <div>
      ${inSeason && _pk.games.filter(g=>g.completed).length
        ? `<div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim);
                       margin-bottom:0.75rem">${_pk.games.filter(g=>g.completed).length} completed games loaded from CSV</div>`
        : ''}

      <!-- Add game form -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);
                  padding:1rem;margin-bottom:1rem">
        <div style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:0.1em;
                    text-transform:uppercase;color:var(--text-dim);margin-bottom:0.6rem">
          Add a game prediction
        </div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:flex-end">
          <div class="ctrl-group" style="flex:1;min-width:140px">
            <span class="ctrl-label">Team A (Home)</span>
            <select id="pk-teamA" style="width:100%">
              <option value="">— select —</option>${teamOpts}
            </select>
          </div>
          <div style="display:flex;gap:0.35rem;align-items:flex-end;padding-bottom:0.1rem">
            <input type="number" id="pk-scoreA" min="0" max="99" placeholder="Score"
              style="width:56px;font-family:var(--font-mono);font-size:0.82rem;
                     background:var(--bg3);border:1px solid var(--border-md);color:var(--text);
                     border-radius:var(--radius);padding:0.35rem 0.4rem;text-align:center">
            <span style="color:var(--text-dim);padding-bottom:0.3rem">–</span>
            <input type="number" id="pk-scoreB" min="0" max="99" placeholder="Score"
              style="width:56px;font-family:var(--font-mono);font-size:0.82rem;
                     background:var(--bg3);border:1px solid var(--border-md);color:var(--text);
                     border-radius:var(--radius);padding:0.35rem 0.4rem;text-align:center">
          </div>
          <div class="ctrl-group" style="flex:1;min-width:140px">
            <span class="ctrl-label">Team B (Away)</span>
            <select id="pk-teamB" style="width:100%">
              <option value="">— select —</option>${teamOpts}
            </select>
          </div>
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap">
            <button onclick="pkAddGame()"
              style="background:var(--accent);color:#1a1611;border:none;
                     border-radius:var(--radius);padding:0.38rem 0.9rem;
                     font-family:var(--font-mono);font-size:0.75rem;font-weight:600;cursor:pointer">
              + Add
            </button>
            <button onclick="pkAutoFill()"
              style="background:var(--bg3);color:var(--text);border:1px solid var(--border-md);
                     border-radius:var(--radius);padding:0.38rem 0.75rem;
                     font-family:var(--font-mono);font-size:0.72rem;cursor:pointer"
              title="Auto-fill winner based on Elo (you still set the score)">
              ⚡ Elo winner
            </button>
          </div>
        </div>
        <div id="pk-add-error" style="font-size:0.68rem;color:#e07a65;margin-top:0.3rem;font-family:var(--font-mono)"></div>
      </div>

      <!-- Picked games list -->
      <div id="pk-games-list">${renderGamesList()}</div>

      <div style="margin-top:1rem;display:flex;justify-content:flex-end">
        <button onclick="pkSetPhase('confchamp')"
          style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);
                 padding:0.45rem 1.2rem;font-family:var(--font-mono);font-size:0.76rem;
                 font-weight:600;cursor:pointer">
          Next: Conf Championships →
        </button>
      </div>
    </div>`;
  }

  function renderGamesList() {
    const userGames = _pk.games.filter(g => !g.completed);
    if (!userGames.length) {
      return `<div style="color:var(--text-dim);font-size:0.78rem;padding:1.5rem;text-align:center;
                          font-family:var(--font-mono)">
        No games added yet. Use the form above to add predictions.<br>
        <span style="font-size:0.65rem">Tip: Add at least the major matchups for each conference.</span>
      </div>`;
    }
    return `<div style="display:flex;flex-direction:column;gap:0.3rem">
      ${userGames.map((g,i) => {
        const eA = (_pk.eloSim[g.teamA] || 1500).toFixed(0);
        const eB = (_pk.eloSim[g.teamB] || 1500).toFixed(0);
        const winner = g.scoreA > g.scoreB ? g.teamA : g.scoreB > g.scoreA ? g.teamB : null;
        return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.6rem;
                            background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius)">
          <div style="flex:1;font-size:0.8rem;font-weight:${winner===g.teamA?'600':'400'};
                      color:${winner===g.teamA?'var(--accent)':'var(--text)'}">${g.teamA}
            <span style="font-size:0.6rem;color:var(--text-dim);font-family:var(--font-mono)">${eA}</span></div>
          <div style="font-family:var(--font-mono);font-size:0.88rem;color:var(--text-muted);min-width:50px;text-align:center">
            ${g.scoreA} – ${g.scoreB}</div>
          <div style="flex:1;text-align:right;font-size:0.8rem;font-weight:${winner===g.teamB?'600':'400'};
                      color:${winner===g.teamB?'var(--accent)':'var(--text)'}">${g.teamB}
            <span style="font-size:0.6rem;color:var(--text-dim);font-family:var(--font-mono)">${eB}</span></div>
          <button onclick="pkRemoveGame(${i})"
            style="background:none;border:none;color:var(--text-dim);cursor:pointer;
                   font-size:0.8rem;padding:0.1rem 0.3rem">✕</button>
        </div>`;
      }).join('')}
    </div>`;
  }

  window.pkAddGame = function() {
    const tA = document.getElementById('pk-teamA')?.value;
    const tB = document.getElementById('pk-teamB')?.value;
    const sA = parseInt(document.getElementById('pk-scoreA')?.value);
    const sB = parseInt(document.getElementById('pk-scoreB')?.value);
    const err = document.getElementById('pk-add-error');
    if (!tA || !tB) { err.textContent = 'Select both teams.'; return; }
    if (tA === tB)   { err.textContent = 'Teams must be different.'; return; }
    if (isNaN(sA) || isNaN(sB)) { err.textContent = 'Enter scores for both teams.'; return; }
    if (sA === sB)   { err.textContent = 'Scores cannot be tied.'; return; }
    if (err) err.textContent = '';

    _pk.games.push({ id: Date.now(), teamA: tA, teamB: tB,
                     scoreA: sA, scoreB: sB, completed: false });
    pkApplyPickToElo(tA, tB, sA, sB);

    document.getElementById('pk-scoreA').value = '';
    document.getElementById('pk-scoreB').value = '';
    document.getElementById('pk-games-list').innerHTML = renderGamesList();
  };

  window.pkAutoFill = function() {
    const tA = document.getElementById('pk-teamA')?.value;
    const tB = document.getElementById('pk-teamB')?.value;
    if (!tA || !tB || tA === tB) return;
    const eA = _pk.eloSim[tA] || 1500;
    const eB = _pk.eloSim[tB] || 1500;
    // Home advantage ~45 pts
    const pA = 1 / (1 + Math.pow(10, (eB - eA + 45) / 400));
    const spread = Math.round(Math.abs(eA - eB) / 22);
    const win = 24 + Math.round(spread * 0.9);
    const lose = Math.max(0, win - Math.max(spread * 2, 3));
    if (pA >= 0.5) {
      document.getElementById('pk-scoreA').value = Math.min(win, 65);
      document.getElementById('pk-scoreB').value = Math.min(lose, 55);
    } else {
      document.getElementById('pk-scoreA').value = Math.min(lose, 55);
      document.getElementById('pk-scoreB').value = Math.min(win, 65);
    }
  };

  window.pkRemoveGame = function(idx) {
    _pk.games.splice(idx, 1);
    // Recompute simElo from scratch
    _pk.eloSim = { ..._pk.eloBase };
    _pk.games.filter(g => !g.completed).forEach(g =>
      pkApplyPickToElo(g.teamA, g.teamB, g.scoreA, g.scoreB));
    document.getElementById('pk-games-list').innerHTML = renderGamesList();
  };

  function pkApplyPickToElo(tA, tB, sA, sB) {
    const rA = _pk.eloSim[tA] || 1500;
    const rB = _pk.eloSim[tB] || 1500;
    const winner = sA > sB ? tA : tB;
    const loser  = sA > sB ? tB : tA;
    const margin = Math.abs(sA - sB);
    const rW = _pk.eloSim[winner] || 1500;
    const rL = _pk.eloSim[loser]  || 1500;
    const eW = 1 / (1 + Math.pow(10, (rL - rW) / 400));
    const delta = 30 * Math.log(margin + 1) * (1 - eW);
    _pk.eloSim[winner] = rW + delta;
    _pk.eloSim[loser]  = rL - delta;
  }

  // ── CONF CHAMPIONSHIP PHASE ───────────────────────────────
  function buildConfChampPhase() {
    return `<div id="pk-confchamp-content">
      <div style="color:var(--text-dim);font-size:0.78rem;font-family:var(--font-mono);padding:1rem">
        Loading...
      </div>
    </div>`;
  }

  function refreshConfChamp() {
    const el = document.getElementById('pk-confchamp-content');
    if (!el) return;

    // Build standings: for each conf, rank teams by simulated Elo
    const csvData = allSeasonData[currentSeason] || data;
    const confMap = {};
    csvData.forEach(r => {
      const c = (r.conference || '').trim();
      if (!c || c === 'NA' || c === 'FCS' || c === 'Other D1') return;
      if (!confMap[c]) confMap[c] = [];
      const simElo = _pk.eloSim[r.team] || r.elo;
      confMap[c].push({ team: r.team, elo: simElo, baseElo: r.elo, record: r.record });
    });

    // Sort each conf by simElo
    Object.values(confMap).forEach(arr => arr.sort((a,b) => b.elo - a.elo));

    const majorConfs = ["SEC","Big Ten","Big 12","ACC",
                        "Mountain West","AAC","Sun Belt","MAC","C-USA"];

    // Show only major conferences with 4+ teams
    const displayConfs = Object.entries(confMap)
      .filter(([c, teams]) => teams.length >= 4)
      .sort(([,a],[,b]) => b[0].elo - a[0].elo);

    const teamOpts = (Object.keys(_pk.eloBase)).sort()
      .map(t => `<option value="${t}">${t}</option>`).join('');

    let html = `
      <div style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);
                  margin-bottom:1rem;line-height:1.6">
        Based on your picks, the projected conference leaders are shown below.
        Manually enter your predicted conference championship game results,
        or leave blank to use the projected leader as champion.
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;margin-bottom:1.5rem">`;

    displayConfs.forEach(([conf, teams]) => {
      const existing = _pk.confGames.find(g => g.conf === conf);
      const projected = teams[0]?.team || '?';
      const runner    = teams[1]?.team || '?';

      html += `
        <div style="background:var(--bg2);border:1px solid var(--border);
                    border-radius:var(--radius-lg);padding:0.85rem">
          <div style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:0.1em;
                      text-transform:uppercase;color:var(--text-dim);margin-bottom:0.5rem">${conf}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.6rem">
            Projected: <strong style="color:var(--text)">${projected}</strong>
            vs <span>${runner}</span>
          </div>
          <div style="display:flex;gap:0.3rem;align-items:center;flex-wrap:wrap">
            <select onchange="pkConfPick('${conf}','A',this.value)"
              style="flex:1;min-width:100px;font-size:0.72rem;font-family:var(--font-mono);
                     background:var(--bg3);border:1px solid var(--border-md);color:var(--text);
                     border-radius:var(--radius);padding:0.25rem">
              <option value="${projected}">${projected}</option>
              ${teams.filter(t=>t.team!==projected).map(t=>`<option value="${t.team}"${existing?.teamA===t.team?' selected':''}>${t.team}</option>`).join('')}
            </select>
            <input type="number" min="0" max="30" placeholder="—" value="${existing?.scoreA??''}"
              onchange="pkConfScore('${conf}','A',this.value)"
              style="width:42px;text-align:center;font-family:var(--font-mono);font-size:0.78rem;
                     background:var(--bg3);border:1px solid var(--border-md);color:var(--text);
                     border-radius:var(--radius);padding:0.25rem">
            <span style="color:var(--text-dim)">–</span>
            <input type="number" min="0" max="30" placeholder="—" value="${existing?.scoreB??''}"
              onchange="pkConfScore('${conf}','B',this.value)"
              style="width:42px;text-align:center;font-family:var(--font-mono);font-size:0.78rem;
                     background:var(--bg3);border:1px solid var(--border-md);color:var(--text);
                     border-radius:var(--radius);padding:0.25rem">
            <select onchange="pkConfPick('${conf}','B',this.value)"
              style="flex:1;min-width:100px;font-size:0.72rem;font-family:var(--font-mono);
                     background:var(--bg3);border:1px solid var(--border-md);color:var(--text);
                     border-radius:var(--radius);padding:0.25rem">
              <option value="${runner}">${runner}</option>
              ${teams.filter(t=>t.team!==runner).map(t=>`<option value="${t.team}"${existing?.teamB===t.team?' selected':''}>${t.team}</option>`).join('')}
            </select>
          </div>
          ${existing ? `<div style="font-size:0.65rem;color:var(--accent);font-family:var(--font-mono);margin-top:0.3rem">
            Champion: ${existing.scoreA > existing.scoreB ? existing.teamA : existing.teamB}</div>` : ''}
        </div>`;
    });

    html += `</div>
      <div style="display:flex;justify-content:flex-end">
        <button onclick="pkSetPhase('bracket')"
          style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);
                 padding:0.45rem 1.2rem;font-family:var(--font-mono);font-size:0.76rem;
                 font-weight:600;cursor:pointer">
          Generate CFP Bracket →
        </button>
      </div>`;

    el.innerHTML = html;
  }

  window.pkConfPick = function(conf, side, team) {
    let entry = _pk.confGames.find(g => g.conf === conf);
    if (!entry) { entry = { conf, teamA:'', teamB:'', scoreA:null, scoreB:null }; _pk.confGames.push(entry); }
    if (side === 'A') entry.teamA = team; else entry.teamB = team;
  };
  window.pkConfScore = function(conf, side, val) {
    let entry = _pk.confGames.find(g => g.conf === conf);
    if (!entry) { entry = { conf, teamA:'', teamB:'', scoreA:null, scoreB:null }; _pk.confGames.push(entry); }
    const n = parseInt(val);
    if (side === 'A') entry.scoreA = isNaN(n) ? null : n;
    else              entry.scoreB = isNaN(n) ? null : n;
    // Apply to simElo
    if (entry.scoreA != null && entry.scoreB != null && entry.scoreA !== entry.scoreB) {
      pkApplyPickToElo(entry.teamA || '', entry.teamB || '', entry.scoreA, entry.scoreB);
    }
  };

  // ── CFP BRACKET PHASE ────────────────────────────────────
  // 12-team CFP rules (current format):
  //  Seeds 1-4: top 4 conference champions → first-round BYE
  //  Seeds 5-8: next 4 conference champions or at-large
  //  Seeds 9-12: at-large picks
  //  First round (on-campus): 5v12, 6v11, 7v10, 8v9
  //  Quarterfinals: 1v lowest winner, 2v next, 3v next, 4v highest winner
  //  Semifinals: Fiesta/Peach or Rose/Sugar (rotating)
  //  Championship: neutral site

  function buildBracketPhase() {
    return `<div id="pk-bracket-content">
      <div style="color:var(--text-dim);font-size:0.78rem;font-family:var(--font-mono);padding:1rem">Loading...</div>
    </div>`;
  }

  function refreshBracket() {
    const el = document.getElementById('pk-bracket-content');
    if (!el) return;

    const csvData = allSeasonData[currentSeason] || data;
    const elo = _pk.eloSim;

    // Build conf champion map: winner of each conf championship game
    // If no game entered, use projected leader (highest simElo in conf)
    const confMap = {};
    csvData.forEach(r => {
      const c = (r.conference || '').trim();
      if (!c || c === 'NA' || c === 'FCS' || c === 'Other D1') return;
      const e = elo[r.team] || r.elo;
      if (!confMap[c] || e > confMap[c].elo) confMap[c] = { team: r.team, elo: e, conf: c, record: r.record };
    });

    // Override with user conf champ picks
    _pk.confGames.forEach(g => {
      if (!g.teamA || !g.teamB) return;
      if (g.scoreA == null || g.scoreB == null || g.scoreA === g.scoreB) return;
      const winner = g.scoreA > g.scoreB ? g.teamA : g.teamB;
      confMap[g.conf] = { team: winner, elo: elo[winner] || 1500, conf: g.conf, record: '' };
    });

    const confChamps = Object.values(confMap).sort((a,b) => b.elo - a.elo);
    const champTeamSet = new Set(confChamps.map(c => c.team));

    // All teams ranked by simElo
    const allRanked = csvData
      .map(r => ({ team: r.team, elo: elo[r.team] || r.elo, conf: r.conference, record: r.record }))
      .sort((a,b) => b.elo - a.elo);

    // Top 4 conf champs → seeds 1-4 (bye)
    const top4Champs = confChamps.slice(0, 4);
    const top4Set = new Set(top4Champs.map(c => c.team));

    // Remaining conf champs eligible for auto-bids
    const remainingChamps = confChamps.slice(4);

    // At-large pool: top teams not already a top-4 champ, best by Elo
    // 12 total = 4 bye seeds + 8 first-round seeds
    // Selection: remaining conf champs get auto-bids first, then at-large fill rest
    const atLargePool = allRanked.filter(r => !top4Set.has(r.team));
    const seeds5to12 = [];
    const usedTeams = new Set([...top4Champs.map(c=>c.team)]);

    // Add remaining conf champs (up to 4 more)
    for (const c of remainingChamps) {
      if (seeds5to12.length >= 8) break;
      if (!usedTeams.has(c.team)) {
        seeds5to12.push(c);
        usedTeams.add(c.team);
      }
    }
    // Fill remaining spots with at-large (highest Elo not yet in field)
    for (const r of atLargePool) {
      if (seeds5to12.length >= 8) break;
      if (!usedTeams.has(r.team)) {
        seeds5to12.push(r);
        usedTeams.add(r.team);
      }
    }

    const allSeeds = [
      ...top4Champs.map((t,i) => ({...t, seed:i+1, bye:true, isChamp: champTeamSet.has(t.team)})),
      ...seeds5to12.map((t,i) => ({...t, seed:i+5, bye:false, isChamp: champTeamSet.has(t.team)}))
    ];

    // First round matchups (higher seed hosts): 5v12, 6v11, 7v10, 8v9
    const r1Matchups = [
      [allSeeds[4], allSeeds[11]],
      [allSeeds[5], allSeeds[10]],
      [allSeeds[6], allSeeds[9]],
      [allSeeds[7], allSeeds[8]],
    ];

    const seedCard = (s, highlight) => `
      <div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0.6rem;
                  border-radius:var(--radius);
                  background:${highlight?'rgba(226,201,126,0.1)':'var(--bg3)'};
                  border:1px solid ${highlight?'var(--accent)':'var(--border)'}">
        <div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-dim);
                    min-width:16px;text-align:center">${s.seed}</div>
        <div style="flex:1;font-size:0.78rem;font-weight:500">${s.team}
          ${s.bye ? `<span style="font-size:0.55rem;color:var(--accent);margin-left:0.25rem;
                               font-family:var(--font-mono)">BYE</span>` : ''}
          ${s.isChamp && !s.bye ? `<span style="font-size:0.55rem;color:var(--text-dim);
                                              margin-left:0.2rem;font-family:var(--font-mono)">[conf]</span>` : ''}
        </div>
        <div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim)">${(s.elo||1500).toFixed(0)}</div>
        <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);
                    min-width:55px;text-align:right">${s.conf||''}</div>
      </div>`;

    const r1Card = ([hi, lo]) => `
      <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem;
                  background:var(--bg2);border:1px solid var(--border);
                  border-radius:var(--radius);padding:0.4rem 0.6rem">
        <div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim);min-width:16px">${hi.seed}</div>
        <div style="flex:1;font-size:0.78rem;font-weight:500">${hi.team}</div>
        <div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim)">vs</div>
        <div style="flex:1;font-size:0.78rem;text-align:right">${lo.team}</div>
        <div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim);min-width:16px;text-align:right">${lo.seed}</div>
      </div>`;

    el.innerHTML = `
      <div>
        <div style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-muted);
                    margin-bottom:1.25rem;background:var(--bg2);border:1px solid var(--border);
                    border-radius:var(--radius-lg);padding:0.85rem 1rem;line-height:1.7">
          <strong style="color:var(--text)">Your CFP Field — ${_pk.yr || currentSeason+1} Season</strong><br>
          Seeds 1–4: Top conference champions (first-round bye) ·
          Seeds 5–12: Remaining conf champs + at-large (highest Elo) ·
          First-round games hosted by higher seeds
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem">
          <!-- Full seed list -->
          <div>
            <div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;
                        text-transform:uppercase;color:var(--text-dim);margin-bottom:0.5rem">
              CFP Field (12 Teams)
            </div>
            <div style="display:flex;flex-direction:column;gap:0.25rem">
              ${allSeeds.map((s,i) => seedCard(s, i < 4)).join('')}
            </div>
          </div>

          <!-- Bracket structure -->
          <div>
            <div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;
                        text-transform:uppercase;color:var(--text-dim);margin-bottom:0.5rem">
              First Round (Seeds 5–12)
            </div>
            ${r1Matchups.map(r1Card).join('')}

            <div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;
                        text-transform:uppercase;color:var(--text-dim);margin:0.85rem 0 0.5rem">
              Quarterfinals (1 vs winner · 2 vs winner · 3 vs winner · 4 vs winner)
            </div>
            <div style="font-size:0.75rem;color:var(--text-muted);font-family:var(--font-mono);
                        line-height:1.8;background:var(--bg2);border:1px solid var(--border);
                        border-radius:var(--radius);padding:0.6rem">
              ${allSeeds.slice(0,4).map(s=>`Seed ${s.seed} ${s.team} hosts lowest remaining`).join('<br>')}
            </div>

            <div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;
                        text-transform:uppercase;color:var(--text-dim);margin:0.85rem 0 0.4rem">
              Semifinals · Championship
            </div>
            <div style="font-size:0.72rem;color:var(--text-muted);font-family:var(--font-mono);
                        line-height:1.8;background:var(--bg2);border:1px solid var(--border);
                        border-radius:var(--radius);padding:0.6rem">
              Semifinal 1: Rose Bowl / Semifinal 2: Sugar Bowl<br>
              National Championship: neutral site
            </div>
          </div>
        </div>

        <!-- Full seeding explanation -->
        <div style="font-size:0.68rem;color:var(--text-dim);font-family:var(--font-mono);
                    line-height:1.6;border-top:1px solid var(--border);padding-top:0.85rem">
          Conference champions: ${confChamps.slice(0,8).map(c=>`${c.team} (${c.conf})`).join(' · ')}<br>
          At-large teams receive remaining spots by Elo ranking after conference champions are placed.
        </div>

        <div style="margin-top:1rem;display:flex;gap:0.75rem">
          <button onclick="pkSetPhase('confchamp')"
            style="background:var(--bg3);color:var(--text-muted);border:1px solid var(--border);
                   border-radius:var(--radius);padding:0.4rem 0.85rem;
                   font-family:var(--font-mono);font-size:0.72rem;cursor:pointer">
            ← Back to Conf Championships
          </button>
          <button onclick="pkSetPhase('regular')"
            style="background:var(--bg3);color:var(--text-muted);border:1px solid var(--border);
                   border-radius:var(--radius);padding:0.4rem 0.85rem;
                   font-family:var(--font-mono);font-size:0.72rem;cursor:pointer">
            ← Back to Regular Season
          </button>
        </div>
      </div>`;
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
