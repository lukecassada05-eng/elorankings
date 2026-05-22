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

      // ── CFB Season Pick'em ─────────────────────────────────────
  // Step 1: Load full season schedule from ESPN (all FBS games)
  //         Show every game in date order — user fills in scores
  // Step 2: Conference standings built from user scores →
  //         show conf championship matchups → user fills scores
  // Step 3: Top 25 by simulated Elo + 12-team CFP bracket

  let _pk = {
    yr:        null,
    schedule:  [],    // all games from ESPN {id,date,homeTeam,awayTeam,homeScore,awayScore,completed}
    scores:    {},    // gameId → {homeScore, awayScore}
    wins:      {},    // team → total wins
    losses:    {},    // team → total losses
    confWins:  {},    // team → conf wins
    confLoss:  {},    // team → conf losses
    confChamps:{},    // conf → champion team name
    confGames: [],    // conf championship game inputs
    eloBase:   {},    // from last season CSV
    eloSim:    {},    // updated as user enters scores
    loaded:    false,
  };

  // Conference structure — who plays in each conf
  const PK_CONFS = {
    "SEC":["Alabama","Arkansas","Auburn","Florida","Georgia","Kentucky","LSU","Mississippi State",
           "Missouri","Ole Miss","South Carolina","Tennessee","Texas","Texas A&M","Vanderbilt","Oklahoma"],
    "Big Ten":["Illinois","Indiana","Iowa","Maryland","Michigan","Michigan State","Minnesota",
               "Nebraska","Northwestern","Ohio State","Penn State","Purdue","Rutgers","Wisconsin",
               "UCLA","USC","Oregon","Washington"],
    "Big 12":["Baylor","BYU","Cincinnati","Colorado","Houston","Iowa State","Kansas","Kansas State",
              "Oklahoma State","TCU","Texas Tech","UCF","Utah","West Virginia","Arizona","Arizona State"],
    "ACC":["Boston College","California","Clemson","Duke","Florida State","Georgia Tech","Louisville",
           "Miami","NC State","North Carolina","Notre Dame","Pittsburgh","SMU","Stanford",
           "Syracuse","Virginia","Virginia Tech","Wake Forest"],
    "Mountain West":["Air Force","Boise State","Colorado State","Fresno State","Hawai'i","Nevada",
                     "New Mexico","San Diego State","San Jose State","UNLV","Utah State","Wyoming"],
    "AAC":["Army","Charlotte","East Carolina","FAU","Memphis","Navy","North Texas","Rice",
           "South Florida","Temple","Tulane","UTSA"],
    "Sun Belt":["Appalachian State","Arkansas State","Coastal Carolina","Georgia Southern",
                "Georgia State","James Madison","Louisiana","Marshall","Old Dominion",
                "South Alabama","Southern Miss","Texas State","Troy","UL Monroe"],
    "MAC":["Akron","Ball State","Bowling Green","Buffalo","Central Michigan","Eastern Michigan",
           "Kent State","Massachusetts","Miami (OH)","Northern Illinois","Ohio","Toledo","Western Michigan"],
    "C-USA":["FIU","Florida Atlantic","Jacksonville State","Kennesaw State","Liberty","Louisiana Tech",
             "Middle Tennessee","New Mexico State","Sam Houston","UAB","UTEP","Western Kentucky"],
    "Independent":["Notre Dame","Army","Navy","Connecticut","UMass"],
  };

  function pkConfOf(team) {
    for (const [conf, teams] of Object.entries(PK_CONFS)) {
      if (teams.includes(team)) return conf;
    }
    return null;
  }

  // Rebuild all standings from current scores
  function pkBuildStandings() {
    _pk.wins={}; _pk.losses={}; _pk.confWins={}; _pk.confLoss={};
    _pk.eloSim = {..._pk.eloBase};

    for (const g of _pk.schedule) {
      const s = _pk.scores[g.id];
      if (!s || s.homeScore==='' || s.awayScore==='' ||
          s.homeScore==null || s.awayScore==null) continue;
      const hs = parseInt(s.homeScore), as_ = parseInt(s.awayScore);
      if (isNaN(hs)||isNaN(as_)||hs===as_) continue;

      const winner = hs > as_ ? g.homeTeam : g.awayTeam;
      const loser  = hs > as_ ? g.awayTeam : g.homeTeam;
      _pk.wins[winner]  = (_pk.wins[winner]  || 0) + 1;
      _pk.losses[loser] = (_pk.losses[loser] || 0) + 1;

      const cW = pkConfOf(winner), cL = pkConfOf(loser);
      if (cW && cW === cL && cW !== 'Independent') {
        _pk.confWins[winner] = (_pk.confWins[winner] || 0) + 1;
        _pk.confLoss[loser]  = (_pk.confLoss[loser]  || 0) + 1;
      }

      // Update Elo
      const margin = Math.abs(hs - as_);
      const rW = _pk.eloSim[winner]||1500, rL = _pk.eloSim[loser]||1500;
      const eW = 1/(1+Math.pow(10,(rL-rW)/400));
      const delta = 30*Math.log(margin+1)*(1-eW);
      _pk.eloSim[winner] = rW + delta;
      _pk.eloSim[loser]  = rL - delta;
    }

    // Apply conf championship scores
    for (const cg of _pk.confGames) {
      if (cg.homeScore==null||cg.awayScore==null||cg.homeScore===cg.awayScore) continue;
      const winner = cg.homeScore>cg.awayScore ? cg.homeTeam : cg.awayTeam;
      const loser  = cg.homeScore>cg.awayScore ? cg.awayTeam : cg.homeTeam;
      const margin = Math.abs(cg.homeScore - cg.awayScore);
      const rW = _pk.eloSim[winner]||1500, rL = _pk.eloSim[loser]||1500;
      const eW = 1/(1+Math.pow(10,(rL-rW)/400));
      const delta = 30*Math.log(margin+1)*(1-eW);
      _pk.eloSim[winner] = rW+delta;
      _pk.eloSim[loser]  = rL-delta;
      _pk.confChamps[cg.conf] = winner;
    }
  }

  // ── ENTRY POINT ───────────────────────────────────────────
  async function renderPickem() {
    const el = document.getElementById('panel-pickem');
    if (!el || CFG.sport !== 'CFB') return;

    // Determine which season to pick'em
    // Off-season (May-Aug): show selector defaulting to NEXT season
    // but also allow picking current/past seasons
    const now = new Date();
    const month = now.getMonth() + 1; // 1-12
    // CFB season: Sep-Jan. Off-season: Feb-Aug
    const inSeason = month >= 9 || month <= 1;
    // Default: next upcoming season
    const nextYr = currentSeason + 1;
    const pickYr = inSeason ? currentSeason : nextYr;

    // Load base Elo from the season BEFORE the pick year
    const baseYr = pickYr - 1;
    if (!allSeasonData[baseYr]) {
      try {
        const raw = await fetchCSV(CFG.dataPath + baseYr + '.csv');
        if (raw) allSeasonData[baseYr] = raw.map(coerceRow);
      } catch(_e) {}
    }
    // Also try current season as base if available
    if (!allSeasonData[currentSeason]) {
      try {
        const raw = await fetchCSV(CFG.dataPath + currentSeason + '.csv');
        if (raw) allSeasonData[currentSeason] = raw.map(coerceRow);
      } catch(_e) {}
    }
    _pk.eloBase = {};
    // Use the most recent available season as Elo base
    const baseData = allSeasonData[currentSeason] || allSeasonData[baseYr] || [];
    baseData.forEach(r => { _pk.eloBase[r.team]=r.elo; });
    _pk.eloSim = {..._pk.eloBase};

    _pk.yr = pickYr;
    _pk.schedule=[]; _pk.scores={}; _pk.confGames=[];
    _pk.confChamps={}; _pk.loaded=false;

    pkShowShell();
    pkFetchSchedule(pickYr);
  }

  window.pkAutoPredict = async function() {
    // Load Elo from the selected season
    const selEl = document.getElementById('pk-elo-yr');
    const eloYr = parseInt(selEl?.value) || currentSeason;

    // Show loading state on button
    const btn = document.querySelector('[onclick="pkAutoPredict()"]');
    if (btn) { btn.textContent = 'Loading…'; btn.disabled = true; }

    if (!allSeasonData[eloYr]) {
      try {
        const raw = await fetchCSV(CFG.dataPath + eloYr + '.csv');
        if (raw) allSeasonData[eloYr] = raw.map(coerceRow);
      } catch(_e) {}
    }

    // Build Elo lookup from selected season
    const eloMap = {};
    (allSeasonData[eloYr] || []).forEach(r => {
      if (r.team && r.elo) eloMap[r.team] = parseFloat(r.elo);
    });

    if (!Object.keys(eloMap).length) {
      if (btn) { btn.textContent = 'Fill all games →'; btn.disabled = false; }
      alert('No Elo data found for ' + eloYr + '. Try a different season.');
      return;
    }

    // Helper: get Elo for a team (fuzzy match if exact not found)
    function getElo(team) {
      if (eloMap[team]) return eloMap[team];
      // Try partial match for ESPN shortDisplayName variants
      const lower = team.toLowerCase();
      for (const [k, v] of Object.entries(eloMap)) {
        if (k.toLowerCase().includes(lower) || lower.includes(k.toLowerCase().substring(0,6))) {
          return v;
        }
      }
      return 1500; // default
    }

    // Predict every unplayed game
    let filled = 0;
    for (const g of _pk.schedule) {
      if (g.completed) continue; // skip completed games

      const eloHome = getElo(g.homeTeam) + (g.neutral ? 0 : 45); // home advantage
      const eloAway = getElo(g.awayTeam);
      const diff    = eloHome - eloAway;

      // Win probability for home team
      const pHome = 1 / (1 + Math.pow(10, -diff / 400));

      // Generate realistic scores based on Elo gap
      // Average CFB score ~27 pts, spread scales with Elo diff
      const absDiff   = Math.abs(diff);
      const margin    = Math.round(Math.log(absDiff + 1) * 3.5); // 0 diff → 0, 200 diff → ~18
      const baseScore = 27;
      const winScore  = Math.min(baseScore + Math.round(margin * 0.7), 56);
      const loseScore = Math.max(winScore - margin, Math.floor(winScore * 0.45));

      let homeScore, awayScore;
      if (pHome >= 0.5) {
        homeScore = winScore;
        awayScore = loseScore;
      } else {
        homeScore = loseScore;
        awayScore = winScore;
      }

      // Add small randomness so not every game is the same score
      const jitter = () => Math.floor(Math.random() * 7) - 3;
      homeScore = Math.max(0, homeScore + jitter());
      awayScore = Math.max(0, awayScore + jitter());

      // Ensure no ties
      if (homeScore === awayScore) {
        pHome >= 0.5 ? homeScore++ : awayScore++;
      }

      _pk.scores[g.id] = { homeScore, awayScore };
      filled++;
    }

    pkBuildStandings();
    pkRenderReg();

    if (btn) { btn.textContent = 'Fill all games →'; btn.disabled = false; }
    // Show count in a toast if available
    if (window.toast) toast(`Auto-filled ${filled} games using ${eloYr} Elo ratings`);
  };

    function pkShowShell() {
    const el = document.getElementById('panel-pickem');
    if (!el) return;
    el.innerHTML = `
<div style="max-width:920px">
  <!-- Header -->
  <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);
              padding:0.9rem 1.1rem;margin-bottom:1rem">
    <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">
      <div class="pk-title" style="font-size:0.86rem;font-weight:600;color:var(--text)">
        🏈 ${_pk.yr} CFB Season Pick'em
      </div>
      <div style="display:flex;align-items:center;gap:0.4rem;margin-left:auto">
        <span style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim)">Season:</span>
        <select onchange="pkLoadYear(parseInt(this.value))"
          style="font-family:var(--font-mono);font-size:0.7rem;background:var(--bg3);
                 border:1px solid var(--border-md);color:var(--text);border-radius:var(--radius);
                 padding:0.2rem 0.4rem">
          ${(CFG.seasons||[]).slice(0,5).map(y=>
            `<option value="${y}" ${y===_pk.yr?'selected':''}>${y}</option>`
          ).join('')}
        </select>
      </div>
    </div>
    <div style="font-size:0.68rem;color:var(--text-muted);font-family:var(--font-mono);
                margin-top:0.2rem;line-height:1.55">
      Every FBS game shown in order · enter scores → conf standings auto-calculate →
      pick conf championship games → CFP bracket + Top 25 generated
    </div>
    <!-- Auto-predict row -->
    <div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;
                padding-top:0.6rem;border-top:1px solid var(--border);flex-wrap:wrap">
      <span style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim)">
        ⚡ Auto-predict all games using
      </span>
      <select id="pk-elo-yr"
        style="font-family:var(--font-mono);font-size:0.7rem;background:var(--bg3);
               border:1px solid var(--border-md);color:var(--text);border-radius:var(--radius);
               padding:0.2rem 0.4rem">
        ${(CFG.seasons||[]).slice(0,5).map(y=>
          `<option value="${y}">${y} Elo</option>`
        ).join('')}
      </select>
      <button onclick="pkAutoPredict()"
        style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);
               padding:0.28rem 0.85rem;font-family:var(--font-mono);font-size:0.7rem;
               font-weight:600;cursor:pointer">
        Fill all games →
      </button>
      <span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim)">
        (home-field advantage applied · scores based on Elo gap)
      </span>
    </div>
  </div>

  <!-- Phase tabs -->
  <div style="display:flex;gap:0;border-bottom:2px solid var(--border);margin-bottom:1rem" id="pk-tabs">
    ${[['reg','📅 Regular Season'],['conf','🏆 Conf Championships'],['cfp','🎯 CFP Bracket']].map(([ph,lb],i)=>`
      <button onclick="pkGo('${ph}')" id="pk-tab-${ph}"
        style="font-family:var(--font-mono);font-size:0.68rem;padding:0.42rem 0.85rem;border:none;
               border-bottom:2px solid ${i===0?'var(--accent)':'transparent'};margin-bottom:-2px;
               background:transparent;cursor:pointer;white-space:nowrap;
               color:${i===0?'var(--accent)':'var(--text-muted)'}">
        ${lb}
      </button>`).join('')}
  </div>

  <div id="pk-panel-reg"></div>
  <div id="pk-panel-conf" hidden></div>
  <div id="pk-panel-cfp"  hidden></div>
</div>`;
    pkRenderReg(); // show placeholder while loading
  }

  window.pkGo = function(ph) {
    ['reg','conf','cfp'].forEach(p => {
      document.getElementById(`pk-panel-${p}`)?.toggleAttribute('hidden', p!==ph);
      const b = document.getElementById(`pk-tab-${p}`);
      if (!b) return;
      b.style.borderBottomColor = p===ph?'var(--accent)':'transparent';
      b.style.color = p===ph?'var(--accent)':'var(--text-muted)';
    });
    pkBuildStandings();
    if (ph==='conf') pkRenderConf();
    if (ph==='cfp')  pkRenderCFP();
  };

  // ── SCHEDULE FETCH ─────────────────────────────────────────
  async function pkFetchSchedule(yr) {
    pkRenderReg('<div class="loading"><div class="spinner"></div>Loading '
      +yr+' schedule from ESPN…</div>');

    const games = [];
    const seen  = new Set();

    // ESPN scoreboard accepts week= + dates=YYYY for future seasons
    // This captures ALL games including those with TBD dates/times
    // Regular season: weeks 1-15, plus week 0 (late Aug)
    // Weeks 0-13 = regular season
    // Week 14 = conf championships (excluded — determined by standings)
    // Week 15 = Army-Navy game only (special rivalry, not a bowl)
    const weeks = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,15];
    // Army-Navy specific: week 15 filter applied after fetch

    // Fetch all weeks in parallel batches of 4
    const BATCH = 4;
    let fetched = 0;

    for (let i = 0; i < weeks.length; i += BATCH) {
      const batch = weeks.slice(i, i + BATCH);
      await Promise.all(batch.map(async wk => {
        // Try both with groups=80 (FBS only) and seasontype=2 (regular season)
        const urls = [
          `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${yr}&seasontype=2&week=${wk}&groups=80&limit=300`,
          `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${yr}&seasontype=2&week=${wk}&limit=300`,
        ];
        for (const url of urls) {
          try {
            const res = await fetch(url, {mode:'cors'});
            if (!res.ok) continue;
            const data = await res.json();
            for (const ev of (data.events || [])) {
              try {
                const comp = ev.competitions?.[0];
                const competitors = comp?.competitors || [];
                const home = competitors.find(c => c.homeAway === 'home');
                const away = competitors.find(c => c.homeAway === 'away');
                if (!home || !away) continue;

                const key = ev.id || (home.team.id + '_' + away.team.id + '_wk' + wk);
                if (seen.has(key)) continue;
                seen.add(key);

                const neutral = comp.neutralSite || false;
                const completed = comp.status?.type?.completed || false;

                // Date: use ev.date if available, otherwise mark as TBD
                let gameDate = null;
                let dateTBD  = false;
                if (ev.date) {
                  gameDate = ev.date.slice(0, 10);
                  // ESPN uses 1970-01-01 as placeholder for TBD dates
                  if (gameDate === '1970-01-01' || gameDate.startsWith('1970')) {
                    gameDate = null;
                    dateTBD  = true;
                  }
                } else {
                  dateTBD = true;
                }

                games.push({
                  id:        key,
                  week:      wk,
                  date:      gameDate,
                  dateTBD,
                  homeTeam:  home.team.shortDisplayName,
                  awayTeam:  away.team.shortDisplayName,
                  neutral,
                  completed,
                  homeScore: completed ? (parseInt(home.score) || null) : null,
                  awayScore: completed ? (parseInt(away.score) || null) : null,
                });
                fetched++;
              } catch(_e2) {}
            }
            break; // got data from this URL, skip fallback
          } catch(_e) {}
        }
      }));

      pkRenderReg(`<div style="padding:1rem;font-family:var(--font-mono);font-size:0.72rem;
        color:var(--text-muted)">Loading ${yr} schedule… ${fetched} games found</div>`);
    }

    // Week 15: keep only Army-Navy game, filter everything else
    const armyNavy = new Set(['Army','Navy','Army Black Knights','Navy Midshipmen',
                               'Army West Point']);
    const filteredGames = games.filter(g =>
      g.week !== 15 ||
      armyNavy.has(g.homeTeam) || armyNavy.has(g.awayTeam)
    );

    // Sort: by week first, then by date within week (TBD at end of week)
    filteredGames.sort((a, b) => {
      if (a.week !== b.week) return a.week - b.week;
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });

    _pk.schedule = filteredGames;
    _pk.loaded   = true;

    if (games.length === 0) {
      // Week-based fetch also returned nothing — ESPN truly has no data yet
      const altYr = yr - 1;
      pkRenderReg(`<div style="padding:1.5rem;font-family:var(--font-mono);font-size:0.78rem;
        color:var(--text-muted);text-align:center;background:var(--bg2);border:1px solid var(--border);
        border-radius:var(--radius-lg)">
        <div style="font-size:0.88rem;color:var(--text);margin-bottom:0.5rem">
          📅 ${yr} schedule not available yet
        </div>
        ESPN hasn't published the ${yr} CFB schedule yet (typically released July–August).
        <br><br>
        <button onclick="pkLoadYear(${altYr})"
          style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);
                 padding:0.4rem 1.1rem;font-family:var(--font-mono);font-size:0.73rem;
                 font-weight:600;cursor:pointer">
          Load ${altYr} season instead →
        </button>
      </div>`);
      return;
    }

    // Pre-fill completed games
    for (const g of games) {
      if (g.completed && g.homeScore != null && g.awayScore != null) {
        _pk.scores[g.id] = {homeScore: g.homeScore, awayScore: g.awayScore};
      }
    }
    pkBuildStandings();
    pkRenderReg();
  }

  window.pkLoadYear = async function(yr) {
    // Load base Elo from the season before
    const baseYr = yr - 1;
    if (!allSeasonData[baseYr]) {
      try {
        const raw = await fetchCSV(CFG.dataPath + baseYr + '.csv');
        if (raw) allSeasonData[baseYr] = raw.map(coerceRow);
      } catch(_e) {}
    }
    _pk.eloBase = {};
    (allSeasonData[baseYr]||allSeasonData[currentSeason]||[]).forEach(r=>{_pk.eloBase[r.team]=r.elo;});
    _pk.eloSim = {..._pk.eloBase};
    _pk.yr = yr;
    _pk.schedule=[]; _pk.scores={}; _pk.confGames=[];
    _pk.confChamps={}; _pk.loaded=false;

    // Update shell title
    const titleEl = document.querySelector('.pk-wrap .pk-title');
    if (titleEl) titleEl.textContent = yr + ' CFB Season Pick\'em';

    pkFetchSchedule(yr);
  };

  // ── PHASE 1: REGULAR SEASON ───────────────────────────────
  function pkRenderReg(placeholder) {
    const el = document.getElementById('pk-panel-reg');
    if (!el) return;
    if (placeholder) { el.innerHTML = placeholder; return; }

    if (!_pk.loaded) {
      el.innerHTML = '<div class="loading"><div class="spinner"></div>Loading schedule…</div>';
      return;
    }

    const pickedCount   = Object.keys(_pk.scores).filter(id=>{
      const s=_pk.scores[id];
      return s.homeScore!==''&&s.homeScore!=null&&s.awayScore!==''&&s.awayScore!=null;
    }).length;
    const totalGames    = _pk.schedule.length;
    const completedGames= _pk.schedule.filter(g=>g.completed).length;

    // Group by week number
    const byWeek = {};
    for (const g of _pk.schedule) {
      const wk = g.week ?? 0;
      if (!byWeek[wk]) byWeek[wk] = [];
      byWeek[wk].push(g);
    }

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;
                  margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem">
        <div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-dim)">
          ${totalGames} games · ${completedGames} completed · ${pickedCount} picked
        </div>
        <button onclick="pkGo('conf')"
          style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);
                 padding:0.35rem 1rem;font-family:var(--font-mono);font-size:0.72rem;
                 font-weight:600;cursor:pointer">
          Next: Conf Championships →
        </button>
      </div>`;

    for (const [wk, games] of Object.entries(byWeek)) {
      const wkNum = parseInt(wk);
      const wkLabel = wkNum === 0 ? 'Week 0' : `Week ${wkNum}`;
      // Show date range if games have dates
      const datedGames = games.filter(g => g.date);
      let dateRange = '';
      if (datedGames.length) {
        const dates = datedGames.map(g => g.date).sort();
        const first = new Date(dates[0]+'T12:00:00');
        const last  = new Date(dates[dates.length-1]+'T12:00:00');
        const fmt   = d => d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
        dateRange = first.toDateString()===last.toDateString()
          ? ` — ${fmt(first)}`
          : ` — ${fmt(first)}–${fmt(last)}`;
      }
      html += `
        <div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;
                    text-transform:uppercase;color:var(--text-dim);margin:0.85rem 0 0.35rem;
                    padding-top:0.5rem;border-top:1px solid var(--border)">
          ${wkLabel}${dateRange} <span style="color:var(--text-dim);opacity:0.6">(${games.length} games)</span>
        </div>`;

      for (const g of games) {
        const s = _pk.scores[g.id] || {};
        const hs = s.homeScore ?? (g.completed?g.homeScore:'');
        const as_ = s.awayScore ?? (g.completed?g.awayScore:'');
        const hasScore = hs!==''&&hs!=null&&as_!==''&&as_!=null;
        const winner = hasScore ? (parseInt(hs)>parseInt(as_)?g.homeTeam:g.awayTeam) : null;

        html += `
          <div style="display:flex;align-items:center;gap:0.4rem;padding:0.3rem 0.55rem;
                      margin-bottom:0.18rem;border-radius:var(--radius);
                      background:${g.completed?'var(--bg2)':'var(--bg3)'};
                      border:1px solid ${g.completed?'var(--border)':'var(--border-md)'}">
            <!-- Date / TBD -->
            <div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);
                        min-width:36px;text-align:center">
              ${g.date
                ? new Date(g.date+'T12:00:00').toLocaleDateString('en-US',{month:'numeric',day:'numeric'})
                : 'TBD'}
            </div>
            <!-- Home team -->
            <div style="flex:1;font-size:0.77rem;font-weight:${winner===g.homeTeam?600:400};
                        color:${winner===g.homeTeam?'var(--accent)':'var(--text)'}">
              ${g.homeTeam}
              <span style="font-size:0.55rem;color:var(--text-dim);font-family:var(--font-mono)">${g.neutral?'N':'H'}</span>
            </div>
            <!-- Score inputs -->
            <input type="number" min="0" max="99"
              value="${hs}" placeholder="–"
              ${g.completed?'disabled style="opacity:0.55;"':''}
              onchange="pkScore('${g.id}','home',this.value)"
              style="width:40px;text-align:center;font-family:var(--font-mono);font-size:0.82rem;
                     background:${g.completed?'transparent':'var(--bg2)'};
                     border:${g.completed?'none':'1px solid var(--border-md)'};
                     color:${winner===g.homeTeam?'var(--accent)':'var(--text)'};
                     border-radius:var(--radius);padding:0.22rem;
                     -moz-appearance:textfield">
            <span style="color:var(--text-dim);font-size:0.78rem">–</span>
            <input type="number" min="0" max="99"
              value="${as_}" placeholder="–"
              ${g.completed?'disabled style="opacity:0.55;"':''}
              onchange="pkScore('${g.id}','away',this.value)"
              style="width:40px;text-align:center;font-family:var(--font-mono);font-size:0.82rem;
                     background:${g.completed?'transparent':'var(--bg2)'};
                     border:${g.completed?'none':'1px solid var(--border-md)'};
                     color:${winner===g.awayTeam?'var(--accent)':'var(--text)'};
                     border-radius:var(--radius);padding:0.22rem;
                     -moz-appearance:textfield">
            <!-- Away team -->
            <div style="flex:1;text-align:right;font-size:0.77rem;font-weight:${winner===g.awayTeam?600:400};
                        color:${winner===g.awayTeam?'var(--accent)':'var(--text)'}">
              <span style="font-size:0.55rem;color:var(--text-dim);font-family:var(--font-mono)">${g.neutral?'N':'A'}</span>
              ${g.awayTeam}
            </div>
            ${g.completed?`<span style="font-size:0.55rem;color:var(--text-dim);font-family:var(--font-mono);
                                        min-width:32px;text-align:right">FINAL</span>`:''}
          </div>`;
      }
    }

    html += `
      <div style="margin-top:1rem;display:flex;justify-content:flex-end">
        <button onclick="pkGo('conf')"
          style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);
                 padding:0.4rem 1.1rem;font-family:var(--font-mono);font-size:0.73rem;
                 font-weight:600;cursor:pointer">
          Next: Conf Championships →
        </button>
      </div>`;

    el.innerHTML = html;
  }

  window.pkScore = function(id, side, val) {
    if (!_pk.scores[id]) _pk.scores[id] = {homeScore:'',awayScore:''};
    const n = val===''?'':parseInt(val);
    if (side==='home') _pk.scores[id].homeScore = n;
    else               _pk.scores[id].awayScore  = n;
    pkBuildStandings();
    // Just update the winner highlight without full re-render (performance)
    const row = document.querySelector(`[data-gid="${id}"]`);
    // Full re-render is simpler and acceptable here
  };

  // ── PHASE 2: CONF CHAMPIONSHIPS ───────────────────────────
  // ── Conference standings & tiebreakers ───────────────────
  // 2025-26 division status:
  //   HAS divisions: Sun Belt (East/West), MAC (East/West)
  //   NO  divisions: SEC, Big Ten, ACC, Big 12, MW, AAC, C-USA (all abolished)

  const CONF_DIV_MAP = {
    "Sun Belt": {
      "East": ["Georgia Southern","Georgia State","South Alabama","Coastal Carolina",
               "James Madison","Old Dominion"],
      "West": ["Louisiana","Troy","Arkansas State","UL Monroe","Southern Miss",
               "Texas State","Marshall","Appalachian State"]
    },
    "MAC": {
      "East": ["Ohio","Miami (OH)","Bowling Green","Kent State","Buffalo","Akron","Massachusetts"],
      "West": ["Central Michigan","Western Michigan","Northern Illinois","Ball State",
               "Eastern Michigan","Toledo"]
    }
  };
  // All other conferences: top-2 by conf record (no divisions)

  function pkGetH2H(teamA, teamB) {
    for (const g of _pk.games) {
      const s = _pk.scores[g.id];
      if (!s) continue;
      const hs = parseInt(s.homeScore), as_ = parseInt(s.awayScore);
      if (isNaN(hs)||isNaN(as_)||hs===as_) continue;
      if (g.homeTeam===teamA && g.awayTeam===teamB) return hs>as_?teamA:teamB;
      if (g.homeTeam===teamB && g.awayTeam===teamA) return hs>as_?teamB:teamA;
    }
    return null;
  }

  function pkSortTeams(teams) {
    return [...teams].sort((a,b) => {
      // 1. Conf win%
      const aCP = (a.cw+a.cl)>0 ? a.cw/(a.cw+a.cl) : 0;
      const bCP = (b.cw+b.cl)>0 ? b.cw/(b.cw+b.cl) : 0;
      if (Math.abs(bCP-aCP) > 0.0001) return bCP-aCP;
      // 2. Head-to-head
      const h2h = pkGetH2H(a.team, b.team);
      if (h2h===b.team) return  1;
      if (h2h===a.team) return -1;
      // 3. Overall win%
      const aWP = (a.w+a.l)>0 ? a.w/(a.w+a.l) : 0;
      const bWP = (b.w+b.l)>0 ? b.w/(b.w+b.l) : 0;
      if (Math.abs(bWP-aWP) > 0.0001) return bWP-aWP;
      // 4. Simulated Elo
      return (b.elo||1500)-(a.elo||1500);
    });
  }

  function pkTeamObj(t) {
    return {
      team: t,
      cw:  _pk.confWins[t]||0,
      cl:  _pk.confLoss[t]||0,
      w:   _pk.wins[t]||0,
      l:   _pk.losses[t]||0,
      elo: _pk.eloSim[t]||_pk.eloBase[t]||1500,
    };
  }

  function pkGetChampMatchup(conf) {
    const teams = (PK_CONFS[conf]||[]).map(pkTeamObj);
    const divDef = CONF_DIV_MAP[conf];
    if (divDef) {
      // Division conference — each division leader meets
      const divLeaders = Object.entries(divDef).map(([div, divTeams]) => {
        const filtered = teams.filter(t => divTeams.includes(t.team));
        return pkSortTeams(filtered)[0];
      }).filter(Boolean);
      return { hasDivisions: true, homeTeam: divLeaders[0], awayTeam: divLeaders[1] };
    } else {
      // No divisions — top 2 by conf record
      const sorted = pkSortTeams(teams);
      return { hasDivisions: false, homeTeam: sorted[0], awayTeam: sorted[1] };
    }
  }

  // ── PHASE 2: CONFERENCE CHAMPIONSHIPS ────────────────────
  function pkRenderConf() {
    const el = document.getElementById('pk-panel-conf');
    if (!el) return;
    pkBuildStandings();

    let html = `
      <div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);
                  margin-bottom:1rem;background:var(--bg2);border:1px solid var(--border);
                  border-radius:var(--radius-lg);padding:0.75rem 1rem;line-height:1.6">
        Standings built from your regular season picks.
        <strong style="color:var(--text)">Sun Belt & MAC</strong> use division leaders.
        All other conferences: top-2 by conf W% (tiebreaker: H2H → overall W% → Elo).
        Enter the championship game score to finalize each conference champion.
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));
                  gap:1rem;margin-bottom:1.2rem">`;

    for (const conf of Object.keys(PK_CONFS)) {
      if (conf === 'Independent') continue;
      const allTeamObjs = (PK_CONFS[conf]||[]).map(pkTeamObj);
      const matchup  = pkGetChampMatchup(conf);
      const homeT    = matchup.homeTeam?.team || '';
      const awayT    = matchup.awayTeam?.team || '';
      const existing = _pk.confGames.find(g => g.conf === conf);
      if (existing) { existing.homeTeam = homeT; existing.awayTeam = awayT; }
      const hs    = existing?.homeScore ?? '';
      const as_   = existing?.awayScore ?? '';
      const champ = existing?.champ || '';
      const divDef = CONF_DIV_MAP[conf];

      html += `<div style="background:var(--bg2);border:1px solid var(--border);
                            border-radius:var(--radius-lg);padding:0.85rem">
        <div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.1em;
                    text-transform:uppercase;color:var(--text-dim);margin-bottom:0.5rem">
          ${conf}
          <span style="color:var(--text-dim);font-weight:400;text-transform:none;letter-spacing:0">
            ${divDef ? '· East/West divisions' : '· no divisions'}
          </span>
        </div>`;

      if (divDef) {
        // Show each division separately
        html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.6rem">`;
        for (const [div, divTeams] of Object.entries(divDef)) {
          const divObjs = pkSortTeams(allTeamObjs.filter(t => divTeams.includes(t.team)));
          html += `<div>
            <div style="font-size:0.58rem;color:var(--text-dim);font-family:var(--font-mono);
                        text-transform:uppercase;letter-spacing:0.08em;margin-bottom:0.2rem">${div}</div>
            ${divObjs.slice(0,5).map((t,i) => `
              <div style="display:flex;gap:0.25rem;padding:0.1rem 0;font-size:0.7rem;
                          color:${i===0?'var(--text)':'var(--text-muted)'}">
                <span style="flex:1;font-weight:${i===0?600:400}">${t.team}</span>
                <span style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim)">
                  ${t.cw}–${t.cl}
                </span>
                <span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);
                             margin-left:0.2rem">(${t.w}–${t.l})</span>
              </div>`).join('')}
          </div>`;
        }
        html += `</div>`;
      } else {
        // No divisions — show full conf standings
        const sorted = pkSortTeams(allTeamObjs);
        html += `<div style="margin-bottom:0.6rem">
          ${sorted.slice(0,8).map((t,i) => `
            <div style="display:flex;gap:0.3rem;padding:0.1rem 0;font-size:0.72rem;
                        color:${i<2?'var(--text)':'var(--text-muted)'}">
              <span style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim);
                           min-width:14px;text-align:right">${i+1}</span>
              <span style="flex:1;font-weight:${i<2?600:400}">${t.team}</span>
              <span style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim)">
                ${t.cw}–${t.cl}
              </span>
              <span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);
                           margin-left:0.2rem">(${t.w}–${t.l})</span>
            </div>`).join('')}
          ${sorted.length>8?`<div style="font-size:0.6rem;color:var(--text-dim);
            font-family:var(--font-mono);margin-top:0.1rem">+${sorted.length-8} more</div>`:''}
        </div>`;
      }

      html += `
        <div style="border-top:1px solid var(--border);padding-top:0.55rem">
          <div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--text-dim);
                      margin-bottom:0.35rem">
            Championship game
            ${champ
              ? `· <strong style="color:var(--accent)">${champ}</strong> wins`
              : homeT&&awayT ? `· ${homeT} vs ${awayT}` : '· TBD'}
          </div>
          <div style="display:flex;align-items:center;gap:0.3rem;flex-wrap:wrap">
            <span style="flex:1;font-size:0.74rem;font-weight:600;min-width:90px">${homeT||'TBD'}</span>
            <input type="number" min="0" max="99" value="${hs}" placeholder="—"
              onchange="pkCG('${conf}','home',this.value,'${homeT}','${awayT}')"
              style="width:40px;text-align:center;font-family:var(--font-mono);font-size:0.8rem;
                     background:var(--bg3);border:1px solid var(--border-md);color:var(--text);
                     border-radius:var(--radius);padding:0.25rem">
            <span style="color:var(--text-dim)">–</span>
            <input type="number" min="0" max="99" value="${as_}" placeholder="—"
              onchange="pkCG('${conf}','away',this.value,'${homeT}','${awayT}')"
              style="width:40px;text-align:center;font-family:var(--font-mono);font-size:0.8rem;
                     background:var(--bg3);border:1px solid var(--border-md);color:var(--text);
                     border-radius:var(--radius);padding:0.25rem">
            <span style="flex:1;text-align:right;font-size:0.74rem;font-weight:600;min-width:90px">${awayT||'TBD'}</span>
          </div>
        </div>
      </div>`;
    }

    html += `</div>
      <div style="display:flex;justify-content:flex-end">
        <button onclick="pkGo('cfp')"
          style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);
                 padding:0.4rem 1.1rem;font-family:var(--font-mono);font-size:0.73rem;
                 font-weight:600;cursor:pointer">
          Generate CFP Bracket + Top 25 →
        </button>
      </div>`;
    el.innerHTML = html;
  }

  window.pkCG = function(conf, side, val, homeT, awayT) {
    let e = _pk.confGames.find(g => g.conf === conf);
    if (!e) {
      e = {conf, homeTeam:homeT, awayTeam:awayT, homeScore:null, awayScore:null, champ:''};
      _pk.confGames.push(e);
    }
    e.homeTeam = homeT; e.awayTeam = awayT;
    const n = parseInt(val);
    if (side==='home') e.homeScore = isNaN(n)?null:n;
    else               e.awayScore = isNaN(n)?null:n;
    if (e.homeScore!=null && e.awayScore!=null && e.homeScore !== e.awayScore) {
      e.champ = e.homeScore>e.awayScore ? e.homeTeam : e.awayTeam;
      _pk.confChamps[conf] = e.champ;
      // Update Elo for conf champ game
      pkBuildStandings();
    }
    pkRenderConf();
  };

  // ── PHASE 3: CFP BRACKET + RANKINGS ──────────────────────
  // Records shown throughout: overall W–L and conf W–L
  // 12-team CFP: top-4 conf champs by ranking get BYE
  // Seeds 5-8: next conf champs; Seeds 9-12: at-large by Elo

  function pkRenderCFP() {
    const el = document.getElementById('pk-panel-cfp');
    if (!el) return;
    pkBuildStandings();

    const csvData = allSeasonData[currentSeason] || data || [];

    // Determine conf champions (user pick or standings leader)
    const champions = {};
    for (const conf of Object.keys(PK_CONFS)) {
      if (conf === 'Independent') continue;
      const picked = _pk.confChamps[conf];
      if (picked) {
        champions[conf] = {
          team: picked,
          elo:  _pk.eloSim[picked] || _pk.eloBase[picked] || 1500,
          conf,
          w:    _pk.wins[picked]    || 0,
          l:    _pk.losses[picked]  || 0,
          cw:   _pk.confWins[picked]|| 0,
          cl:   _pk.confLoss[picked]|| 0,
        };
      } else {
        const matchup = pkGetChampMatchup(conf);
        const leader  = matchup.homeTeam;
        if (leader) champions[conf] = {
          team: leader.team,
          elo:  leader.elo,
          conf,
          w:    leader.w,
          l:    leader.l,
          cw:   leader.cw,
          cl:   leader.cl,
        };
      }
    }

    const champList = Object.values(champions).sort((a,b) => b.elo - a.elo);
    const champSet  = new Set(champList.map(c => c.team));

    // All FBS teams ranked by simulated Elo (with records)
    const allFBS = [...new Set([
      ...Object.values(PK_CONFS).flat(),
      ...Object.keys(_pk.eloBase),
    ])].map(t => {
      const conf = pkConfOf(t) || (csvData.find(r=>r.team===t)?.conference) || '—';
      return {
        team: t,
        elo:  _pk.eloSim[t] || _pk.eloBase[t] || 0,
        conf,
        w:    _pk.wins[t]    || 0,
        l:    _pk.losses[t]  || 0,
        cw:   _pk.confWins[t]|| 0,
        cl:   _pk.confLoss[t]|| 0,
      };
    }).filter(t => t.elo > 0).sort((a,b) => b.elo - a.elo);

    const top25 = allFBS.slice(0, 25);

    // Seed the 12-team field
    const top4   = champList.slice(0, 4);
    const top4s  = new Set(top4.map(c => c.team));
    const rest   = champList.slice(4);
    const field  = [];
    const used   = new Set(top4.map(c => c.team));

    for (const c of rest) {
      if (field.length >= 8) break;
      if (!used.has(c.team)) { field.push({...c, autoB:true}); used.add(c.team); }
    }
    for (const t of allFBS) {
      if (field.length >= 8) break;
      if (!used.has(t.team)) { field.push({...t, autoB:false}); used.add(t.team); }
    }

    const seeds = [
      ...top4.map((t,i)  => ({...t, seed:i+1, bye:true})),
      ...field.map((t,i) => ({...t, seed:i+5, bye:false})),
    ];

    const r1 = [
      [seeds[4], seeds[11]],
      [seeds[5], seeds[10]],
      [seeds[6], seeds[9]],
      [seeds[7], seeds[8]],
    ];

    const rec = t => `${t.w}–${t.l}`;
    const cRec = t => (t.cw||t.cl) ? `${t.cw}–${t.cl}` : '';

    const seedRow = s => `
      <div style="display:flex;align-items:center;gap:0.35rem;padding:0.26rem 0.5rem;
                  margin-bottom:0.18rem;border-radius:var(--radius);
                  background:${s.seed<=4?'rgba(226,201,126,0.09)':'var(--bg3)'};
                  border:1px solid ${s.seed<=4?'var(--accent)':'var(--border)'}">
        <div style="font-family:var(--font-mono);font-size:0.64rem;color:var(--text-dim);
                    min-width:16px;text-align:right">${s.seed}</div>
        <div style="flex:1;font-size:0.75rem;font-weight:500">${s.team}
          ${s.bye?`<span style="font-size:0.5rem;color:var(--accent);font-family:var(--font-mono);
                               margin-left:0.2rem">BYE</span>`:''}
          ${champSet.has(s.team)?`<span style="font-size:0.5rem;color:var(--text-dim);
                                              font-family:var(--font-mono);margin-left:0.15rem">
                                    ${s.conf}★</span>`:''}
        </div>
        <div style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-muted);min-width:32px;text-align:right">${rec(s)}</div>
        <div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--text-dim);min-width:26px;text-align:right">${cRec(s)}</div>
        <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim)">${s.elo.toFixed(0)}</div>
      </div>`;

    const r1Row = ([hi,lo]) => `
      <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.28rem;
                  background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);
                  padding:0.32rem 0.6rem">
        <span style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim)">#${hi.seed}</span>
        <span style="flex:1;font-size:0.75rem;font-weight:600">${hi.team}</span>
        <span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-muted)">${rec(hi)}</span>
        <span style="font-size:0.62rem;color:var(--text-dim);font-family:var(--font-mono);margin:0 0.2rem">vs</span>
        <span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-muted)">${rec(lo)}</span>
        <span style="flex:1;font-size:0.75rem;text-align:right">${lo.team}</span>
        <span style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim)">#${lo.seed}</span>
        <span style="font-size:0.55rem;color:var(--text-dim);font-family:var(--font-mono);
                     margin-left:0.25rem">@ #${hi.seed}</span>
      </div>`;

    el.innerHTML = `
<div>
  <!-- Top 25 with full records -->
  <div style="margin-bottom:1.4rem">
    <div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;
                text-transform:uppercase;color:var(--text-dim);margin-bottom:0.4rem">
      Top 25 — simulated Elo after all picks &nbsp;★ = conference champion
    </div>
    <div style="background:var(--bg2);border:1px solid var(--border);
                border-radius:var(--radius-lg);overflow:hidden">
      <!-- Header -->
      <div style="display:flex;gap:0.35rem;padding:0.2rem 0.6rem;
                  background:var(--bg3);border-bottom:1px solid var(--border)">
        <div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:22px;text-align:right">#</div>
        <div style="flex:1;font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim)">Team</div>
        <div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:36px;text-align:right">W–L</div>
        <div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:32px;text-align:right">Conf</div>
        <div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:38px;text-align:right">Elo</div>
      </div>
      ${top25.map((t,i) => `
        <div style="display:flex;align-items:center;gap:0.35rem;padding:0.22rem 0.6rem;
                    border-bottom:1px solid var(--border)">
          <div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim);
                      min-width:22px;text-align:right">${i+1}</div>
          <div style="flex:1;font-size:0.75rem;font-weight:${champSet.has(t.team)?600:400}">${t.team}
            ${champSet.has(t.team)?`<span style="font-size:0.5rem;color:var(--accent);
                                               font-family:var(--font-mono);margin-left:0.2rem">★${t.conf}</span>`:''}
          </div>
          <div style="font-family:var(--font-mono);font-size:0.63rem;color:var(--text-muted);
                      min-width:36px;text-align:right">${rec(t)}</div>
          <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);
                      min-width:32px;text-align:right">${cRec(t)}</div>
          <div style="font-family:var(--font-mono);font-size:0.63rem;color:var(--text-dim);
                      min-width:38px;text-align:right">${t.elo.toFixed(0)}</div>
        </div>`).join('')}
    </div>
  </div>

  <!-- CFP Field + Bracket -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem">
    <div>
      <div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;
                  text-transform:uppercase;color:var(--text-dim);margin-bottom:0.4rem">
        CFP Field — 12 Teams
      </div>
      <div style="font-size:0.6rem;color:var(--text-dim);font-family:var(--font-mono);
                  margin-bottom:0.4rem">
        Seeds 1–4 (BYE): top 4 conf champs · 5–12: champs + at-large
        <span style="margin-left:0.5rem;color:var(--text-dim)">W–L · Conf · Elo</span>
      </div>
      ${seeds.map(seedRow).join('')}
    </div>
    <div>
      <div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;
                  text-transform:uppercase;color:var(--text-dim);margin-bottom:0.4rem">
        First Round — campus sites
      </div>
      ${r1.map(r1Row).join('')}

      <div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;
                  text-transform:uppercase;color:var(--text-dim);margin:0.8rem 0 0.4rem">
        Quarterfinals
      </div>
      <div style="font-size:0.7rem;color:var(--text-muted);font-family:var(--font-mono);
                  line-height:1.9;background:var(--bg2);border:1px solid var(--border);
                  border-radius:var(--radius);padding:0.55rem 0.7rem">
        ${seeds.slice(0,4).map(s=>`#${s.seed} ${s.team} (${rec(s)}) hosts lowest remaining`).join('<br>')}
      </div>

      <div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;
                  text-transform:uppercase;color:var(--text-dim);margin:0.8rem 0 0.4rem">
        Semifinals &amp; Championship
      </div>
      <div style="font-size:0.7rem;color:var(--text-muted);font-family:var(--font-mono);
                  line-height:1.9;background:var(--bg2);border:1px solid var(--border);
                  border-radius:var(--radius);padding:0.55rem 0.7rem">
        Semifinal 1 — Rose Bowl (Pasadena, Jan)<br>
        Semifinal 2 — Sugar Bowl (New Orleans, Jan)<br>
        Championship — Allegiant Stadium, Las Vegas (Jan 25)
      </div>
    </div>
  </div>

  <div style="margin-top:1rem;display:flex;gap:0.6rem">
    <button onclick="pkGo('conf')"
      style="background:var(--bg3);color:var(--text-muted);border:1px solid var(--border);
             border-radius:var(--radius);padding:0.32rem 0.75rem;font-family:var(--font-mono);
             font-size:0.67rem;cursor:pointer">← Conf Championships</button>
    <button onclick="pkGo('reg')"
      style="background:var(--bg3);color:var(--text-muted);border:1px solid var(--border);
             border-radius:var(--radius);padding:0.32rem 0.75rem;font-family:var(--font-mono);
             font-size:0.67rem;cursor:pointer">← Regular Season</button>
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
