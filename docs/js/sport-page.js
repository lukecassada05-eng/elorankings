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

  
  // ──────────────────────────────────────────────────────────
  // CFB SEASON PICK'EM
  // Isolated block — uses NO nested template literals.
  // All HTML built with plain string concatenation.
  // ──────────────────────────────────────────────────────────

  // ── State ─────────────────────────────────────────────────
  var _pk = {
    yr: null, schedule: [], scores: {}, confGames: [], confChamps: {},
    wins: {}, losses: {}, confWins: {}, confLoss: {},
    eloBase: {}, eloSim: {}
  };

  // ── Conference membership (canonical ESPN shortDisplayNames) ─
  var PK_CONFS = {
    "SEC":["Alabama","Arkansas","Auburn","Florida","Georgia","Kentucky","LSU",
           "Mississippi State","Missouri","Ole Miss","South Carolina","Tennessee",
           "Texas","Texas A&M","Vanderbilt","Oklahoma"],
    "Big Ten":["Illinois","Indiana","Iowa","Maryland","Michigan","Michigan State",
               "Minnesota","Nebraska","Northwestern","Ohio State","Penn State",
               "Purdue","Rutgers","Wisconsin","UCLA","USC","Oregon","Washington"],
    "Big 12":["Baylor","BYU","Cincinnati","Colorado","Houston","Iowa State","Kansas",
              "Kansas State","Oklahoma State","TCU","Texas Tech","UCF","Utah",
              "West Virginia","Arizona","Arizona State"],
    "ACC":["Boston College","California","Clemson","Duke","Florida State","Georgia Tech",
           "Louisville","Miami","NC State","North Carolina","Pittsburgh",
           "SMU","Stanford","Syracuse","Virginia","Virginia Tech","Wake Forest"],
    "Mountain West":["Air Force","Boise State","Colorado State","Fresno State","Hawai'i",
                     "Nevada","New Mexico","San Diego State","San Jose State","UNLV",
                     "Utah State","Wyoming"],
    "AAC":["Army","Charlotte","East Carolina","FAU","Memphis","Navy","North Texas",
           "Rice","South Florida","Temple","Tulane","UTSA"],
    "Sun Belt":["Appalachian State","Arkansas State","Coastal Carolina","Georgia Southern",
                "Georgia State","James Madison","Louisiana","Marshall","Old Dominion",
                "South Alabama","Southern Miss","Texas State","Troy","UL Monroe"],
    "MAC":["Akron","Ball State","Bowling Green","Buffalo","Central Michigan",
           "Eastern Michigan","Kent State","Massachusetts","Miami (OH)",
           "Northern Illinois","Ohio","Toledo","Western Michigan"],
    "C-USA":["FIU","Florida Atlantic","Jacksonville State","Kennesaw State","Liberty",
             "Louisiana Tech","Middle Tennessee","New Mexico State","Sam Houston",
             "UAB","UTEP","Western Kentucky"],
    "Independent":["Notre Dame","Army","Navy","Connecticut","UMass"]
  };

  // ── Divisions (only Sun Belt & MAC have them in 2025-26) ──
  var PK_DIVS = {
    "Sun Belt": {
      "East":["Georgia Southern","Georgia State","South Alabama","Coastal Carolina",
              "James Madison","Old Dominion"],
      "West":["Louisiana","Troy","Arkansas State","UL Monroe","Southern Miss",
              "Texas State","Marshall","Appalachian State"]
    },
    "MAC": {
      "East":["Ohio","Miami (OH)","Bowling Green","Kent State","Buffalo",
              "Akron","Massachusetts"],
      "West":["Central Michigan","Western Michigan","Northern Illinois",
              "Ball State","Eastern Michigan","Toledo"]
    }
  };

  // ── ESPN name → canonical name ─────────────────────────────
  var PK_ALIAS = {
    "Miss St":"Mississippi State","Mississippi St":"Mississippi State",
    "Miss. St.":"Mississippi State","Ole Miss":"Ole Miss",
    "Florida St":"Florida State","FSU":"Florida State","Fla. State":"Florida State",
    "NC State":"NC State","N.C. State":"NC State",
    "Georgia Tech":"Georgia Tech","Ga. Tech":"Georgia Tech",
    "Ohio St":"Ohio State","Penn St":"Penn State",
    "Michigan St":"Michigan State","Mich. St.":"Michigan State",
    "Kansas St":"Kansas State","Iowa St":"Iowa State",
    "Oklahoma St":"Oklahoma State","Okla. St.":"Oklahoma State",
    "West Virginia":"West Virginia","WVU":"West Virginia",
    "Boise St":"Boise State","Fresno St":"Fresno State",
    "Utah St":"Utah State","San Diego St":"San Diego State","SDSU":"San Diego State",
    "San José St":"San Jose State","San Jose St":"San Jose State","SJSU":"San Jose State",
    "Colorado St":"Colorado State","Hawaii":"Hawai'i",
    "ECU":"East Carolina","USF":"South Florida","UConn":"Connecticut",
    "App State":"Appalachian State","Appalachian St":"Appalachian State",
    "GA Southern":"Georgia Southern","Ga Southern":"Georgia Southern",
    "Georgia St":"Georgia State","Ga St":"Georgia State",
    "Coastal":"Coastal Carolina","Coastal Car":"Coastal Carolina",
    "S. Alabama":"South Alabama","South Ala":"South Alabama",
    "ODU":"Old Dominion","Old Dom.":"Old Dominion",
    "Southern Miss":"Southern Miss","So. Miss":"Southern Miss",
    "UL Monroe":"UL Monroe","ULM":"UL Monroe",
    "La.":"Louisiana","ULL":"Louisiana",
    "Ark St":"Arkansas State","Arkansas St":"Arkansas State",
    "Texas St":"Texas State","James Madison":"James Madison","JMU":"James Madison",
    "C Michigan":"Central Michigan","CMU":"Central Michigan",
    "E Michigan":"Eastern Michigan","EMU":"Eastern Michigan",
    "W Michigan":"Western Michigan","WMU":"Western Michigan",
    "N Illinois":"Northern Illinois","NIU":"Northern Illinois",
    "Ball St":"Ball State","Kent St":"Kent State",
    "Miami OH":"Miami (OH)","Miami (Ohio)":"Miami (OH)",
    "UMass":"Massachusetts","Mass.":"Massachusetts",
    "WKU":"Western Kentucky","W. Kentucky":"Western Kentucky","Western KY":"Western Kentucky",
    "MTSU":"Middle Tennessee","Middle Tenn":"Middle Tennessee",
    "FAU":"Florida Atlantic","Fla. Atlantic":"Florida Atlantic",
    "FIU":"FIU","La. Tech":"Louisiana Tech","La Tech":"Louisiana Tech",
    "New Mexico St":"New Mexico State","NMSU":"New Mexico State",
    "Kennesaw St":"Kennesaw State","Jax State":"Jacksonville State",
    "Jacksonville St":"Jacksonville State","Sam Hous.":"Sam Houston",
    "N Dakota St":"North Dakota State","NDSU":"North Dakota State",
    "Pitt":"Pittsburgh","UNC":"North Carolina","UVA":"Virginia"
  };

  function pkResolve(t) { return PK_ALIAS[t] || t; }

  function pkConfOf(team) {
    var t = pkResolve(team);
    for (var conf in PK_CONFS) {
      if (PK_CONFS[conf].indexOf(t) !== -1) return conf;
    }
    return null;
  }

  // ── Rebuild standings from all scores ─────────────────────
  function pkBuild() {
    _pk.wins={}; _pk.losses={}; _pk.confWins={}; _pk.confLoss={};
    _pk.eloSim = JSON.parse(JSON.stringify(_pk.eloBase));
    var K = 30;

    for (var i=0; i<_pk.schedule.length; i++) {
      var g = _pk.schedule[i];
      var s = _pk.scores[g.id];
      if (!s || s.homeScore==='' || s.awayScore==='' ||
          s.homeScore==null || s.awayScore==null) continue;
      var hs = parseInt(s.homeScore), as_ = parseInt(s.awayScore);
      if (isNaN(hs)||isNaN(as_)||hs===as_) continue;

      var winner = pkResolve(hs>as_?g.homeTeam:g.awayTeam);
      var loser  = pkResolve(hs>as_?g.awayTeam:g.homeTeam);
      _pk.wins[winner]  = (_pk.wins[winner]  || 0) + 1;
      _pk.losses[loser] = (_pk.losses[loser] || 0) + 1;

      var cW = pkConfOf(winner), cL = pkConfOf(loser);
      if (cW && cW===cL && cW!=='Independent') {
        _pk.confWins[winner] = (_pk.confWins[winner]||0) + 1;
        _pk.confLoss[loser]  = (_pk.confLoss[loser] ||0) + 1;
      }
      var margin = Math.abs(hs-as_);
      var rW = _pk.eloSim[winner]||1500, rL = _pk.eloSim[loser]||1500;
      var eW = 1/(1+Math.pow(10,(rL-rW)/400));
      var delta = K*Math.log(margin+1)*(1-eW);
      _pk.eloSim[winner] = rW+delta;
      _pk.eloSim[loser]  = rL-delta;
    }
    // Apply conf champ game results
    for (var j=0; j<_pk.confGames.length; j++) {
      var cg = _pk.confGames[j];
      if (cg.homeScore==null||cg.awayScore==null||cg.homeScore===cg.awayScore) continue;
      var cw = cg.homeScore>cg.awayScore?cg.homeTeam:cg.awayTeam;
      var cl = cg.homeScore>cg.awayScore?cg.awayTeam:cg.homeTeam;
      var margin2 = Math.abs(cg.homeScore-cg.awayScore);
      var rW2=_pk.eloSim[cw]||1500, rL2=_pk.eloSim[cl]||1500;
      var eW2=1/(1+Math.pow(10,(rL2-rW2)/400));
      _pk.eloSim[cw]=rW2+K*Math.log(margin2+1)*(1-eW2);
      _pk.eloSim[cl]=rL2-K*Math.log(margin2+1)*(1-eW2);
    }
  }

  // Sort teams by conf record then H2H then overall then Elo
  function pkSort(teams) {
    return teams.slice().sort(function(a,b){
      var acp=(a.cw+a.cl)?a.cw/(a.cw+a.cl):0, bcp=(b.cw+b.cl)?b.cw/(b.cw+b.cl):0;
      if (Math.abs(bcp-acp)>0.001) return bcp-acp;
      var awp=(a.w+a.l)?a.w/(a.w+a.l):0, bwp=(b.w+b.l)?b.w/(b.w+b.l):0;
      if (Math.abs(bwp-awp)>0.001) return bwp-awp;
      return (b.elo||1500)-(a.elo||1500);
    });
  }

  function pkTeam(t) {
    return {team:t, cw:_pk.confWins[t]||0, cl:_pk.confLoss[t]||0,
            w:_pk.wins[t]||0, l:_pk.losses[t]||0,
            elo:_pk.eloSim[t]||_pk.eloBase[t]||1500};
  }

  // ── Entry point ───────────────────────────────────────────
  async function renderPickem() {
    var el = document.getElementById('panel-pickem');
    if (!el || CFG.sport !== 'CFB') return;

    // Load base Elo from current season
    if (!allSeasonData[currentSeason]) {
      try {
        var raw = await fetchCSV(CFG.dataPath + currentSeason + '.csv');
        if (raw) allSeasonData[currentSeason] = raw.map(coerceRow);
      } catch(e) {}
    }
    _pk.eloBase = {};
    (allSeasonData[currentSeason]||[]).forEach(function(r){
      if (r.team && r.elo) _pk.eloBase[r.team] = parseFloat(r.elo);
    });
    _pk.eloSim = JSON.parse(JSON.stringify(_pk.eloBase));
    _pk.yr = currentSeason+1;
    _pk.schedule=[]; _pk.scores={}; _pk.confGames=[]; _pk.confChamps={};

    pkDrawShell();
    pkFetchSched(_pk.yr);
  }

  // ── Shell UI ──────────────────────────────────────────────
  function pkDrawShell() {
    var el = document.getElementById('panel-pickem');
    if (!el) return;
    var seasonOpts = '';
    (CFG.seasons||[]).slice(0,5).forEach(function(y){
      seasonOpts += '<option value="'+y+'">'+y+'</option>';
    });
    var eloOpts = '';
    (CFG.seasons||[]).slice(0,5).forEach(function(y){
      eloOpts += '<option value="'+y+'">'+y+' Elo</option>';
    });
    el.innerHTML =
      '<div style="max-width:920px">'
      +'<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:0.9rem 1.1rem;margin-bottom:1rem">'
      +'<div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap">'
      +'<div style="font-size:0.86rem;font-weight:600;color:var(--text)">🏈 '+_pk.yr+' CFB Season Pick\'em</div>'
      +'<div style="display:flex;align-items:center;gap:0.4rem;margin-left:auto">'
      +'<span style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim)">Season:</span>'
      +'<select onchange="pkLoadYear(parseInt(this.value))" style="font-family:var(--font-mono);font-size:0.7rem;background:var(--bg3);border:1px solid var(--border-md);color:var(--text);border-radius:var(--radius);padding:0.2rem 0.4rem">'+seasonOpts+'</select>'
      +'</div></div>'
      +'<div style="font-size:0.68rem;color:var(--text-muted);font-family:var(--font-mono);margin-top:0.4rem;line-height:1.55">'
      +'Every FBS game in date/week order · enter scores → conf standings decide champ games → CFP bracket + Top 25'
      +'</div>'
      +'<div style="display:flex;align-items:center;gap:0.5rem;margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);flex-wrap:wrap">'
      +'<span style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim)">⚡ Auto-predict using</span>'
      +'<select id="pk-elo-yr" style="font-family:var(--font-mono);font-size:0.7rem;background:var(--bg3);border:1px solid var(--border-md);color:var(--text);border-radius:var(--radius);padding:0.2rem 0.4rem">'+eloOpts+'</select>'
      +'<button onclick="pkAutoPredict()" style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);padding:0.28rem 0.85rem;font-family:var(--font-mono);font-size:0.7rem;font-weight:600;cursor:pointer">Fill all games →</button>'
      +'<span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim)">(home-field +45 Elo · score from gap)</span>'
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

  window.pkTab = function(ph) {
    ['reg','conf','cfp'].forEach(function(p){
      var panel = document.getElementById('pk-'+p);
      var btn   = document.getElementById('pk-tab-'+p);
      if (!panel || !btn) return;
      if (p===ph) { panel.removeAttribute('hidden'); btn.style.borderBottomColor='var(--accent)'; btn.style.color='var(--accent)'; }
      else        { panel.setAttribute('hidden',''); btn.style.borderBottomColor='transparent'; btn.style.color='var(--text-muted)'; }
    });
    pkBuild();
    if (ph==='conf') pkDrawConf();
    if (ph==='cfp')  pkDrawCFP();
  };

  window.pkLoadYear = async function(yr) {
    var baseYr = yr-1;
    if (!allSeasonData[baseYr]) {
      try { var raw=await fetchCSV(CFG.dataPath+baseYr+'.csv'); if(raw) allSeasonData[baseYr]=raw.map(coerceRow); } catch(e){}
    }
    _pk.eloBase={};
    (allSeasonData[baseYr]||allSeasonData[currentSeason]||[]).forEach(function(r){
      if(r.team&&r.elo) _pk.eloBase[r.team]=parseFloat(r.elo);
    });
    _pk.eloSim=JSON.parse(JSON.stringify(_pk.eloBase));
    _pk.yr=yr; _pk.schedule=[]; _pk.scores={}; _pk.confGames=[]; _pk.confChamps={};
    pkDrawShell();
    pkFetchSched(yr);
  };

  // ── Fetch schedule by week ────────────────────────────────
  async function pkFetchSched(yr) {
    pkSetReg('<div class="loading"><div class="spinner"></div>Loading '+yr+' schedule from ESPN…</div>');
    var games=[], seen={};
    // Weeks 0-13 regular season + 15 (Army-Navy only)
    var weeks=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,15];
    var BATCH=4;
    var fetched=0;
    for (var b=0; b<weeks.length; b+=BATCH) {
      var batch=weeks.slice(b,b+BATCH);
      await Promise.all(batch.map(async function(wk){
        var url='https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates='+yr+'&seasontype=2&week='+wk+'&groups=80&limit=300';
        try {
          var res=await fetch(url,{mode:'cors'});
          if(!res.ok) return;
          var data=await res.json();
          if(!data.events) return;
          data.events.forEach(function(ev){
            try {
              var comp=ev.competitions&&ev.competitions[0];
              if(!comp) return;
              var competitors=comp.competitors||[];
              var home=null,away=null;
              competitors.forEach(function(c){ if(c.homeAway==='home') home=c; else away=c; });
              if(!home||!away) return;
              var key=ev.id||(home.team.id+'_'+away.team.id+'_w'+wk);
              if(seen[key]) return;
              seen[key]=1;
              var hn=home.team.shortDisplayName, an=away.team.shortDisplayName;
              // Week 15: only Army-Navy
              if(wk===15&&hn!=='Army'&&hn!=='Navy'&&an!=='Army'&&an!=='Navy') return;
              var completed=!!(comp.status&&comp.status.type&&comp.status.type.completed);
              var dt=ev.date?ev.date.slice(0,10):null;
              if(dt&&dt.startsWith('1970')) dt=null;
              var hs=completed?(parseInt(home.score)||null):null;
              var as_=completed?(parseInt(away.score)||null):null;
              games.push({id:key,week:wk,date:dt,homeTeam:hn,awayTeam:an,
                          neutral:!!(comp.neutralSite),completed:completed,
                          homeScore:hs,awayScore:as_});
              fetched++;
            } catch(e){}
          });
        } catch(e){}
      }));
      pkSetReg('<div style="padding:1rem;font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted)">Loading '+yr+' schedule… '+fetched+' games found so far</div>');
    }
    games.sort(function(a,b){
      if(a.week!==b.week) return a.week-b.week;
      if(!a.date&&!b.date) return 0;
      if(!a.date) return 1;
      if(!b.date) return -1;
      return a.date<b.date?-1:a.date>b.date?1:0;
    });
    _pk.schedule=games;
    if(!games.length){
      pkSetReg('<div style="padding:1.5rem;font-family:var(--font-mono);font-size:0.78rem;color:var(--text-muted);text-align:center;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg)">'
        +'<div style="font-size:0.88rem;color:var(--text);margin-bottom:0.5rem">📅 '+yr+' schedule not available yet</div>'
        +'ESPN hasn\'t published the '+yr+' CFB schedule yet (usually July–August).<br><br>'
        +'<button onclick="pkLoadYear('+(yr-1)+')" style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);padding:0.4rem 1.1rem;font-family:var(--font-mono);font-size:0.73rem;font-weight:600;cursor:pointer">Load '+(yr-1)+' season instead →</button>'
        +'</div>');
      return;
    }
    // Pre-fill completed games
    games.forEach(function(g){
      if(g.completed&&g.homeScore!=null&&g.awayScore!=null)
        _pk.scores[g.id]={homeScore:g.homeScore,awayScore:g.awayScore};
    });
    pkBuild();
    pkDrawReg();
  }

  function pkSetReg(html) {
    var el=document.getElementById('pk-reg');
    if(el) el.innerHTML=html;
  }

  // ── Draw regular season games ─────────────────────────────
  function pkDrawReg() {
    var el=document.getElementById('pk-reg');
    if(!el) return;
    var picked=0;
    Object.keys(_pk.scores).forEach(function(id){
      var s=_pk.scores[id];
      if(s.homeScore!==''&&s.homeScore!=null&&s.awayScore!==''&&s.awayScore!=null) picked++;
    });
    var total=_pk.schedule.length;
    var completed=_pk.schedule.filter(function(g){return g.completed;}).length;

    var html='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem">'
      +'<div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-dim)">'+total+' games'+(completed?' · '+completed+' final (ESPN)':'')+' · '+picked+' predicted</div>'
      +'<button onclick="pkTab(\'conf\')" style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);padding:0.35rem 1rem;font-family:var(--font-mono);font-size:0.72rem;font-weight:600;cursor:pointer">Next: Conf Championships →</button>'
      +'</div>';

    // Group by week
    var byWeek={};
    _pk.schedule.forEach(function(g){
      var wk=g.week||0;
      if(!byWeek[wk]) byWeek[wk]=[];
      byWeek[wk].push(g);
    });
    Object.keys(byWeek).sort(function(a,b){return parseInt(a)-parseInt(b);}).forEach(function(wk){
      var games=byWeek[wk];
      var label=parseInt(wk)===0?'Week 0':'Week '+wk;
      var datedGames=games.filter(function(g){return g.date;});
      var range='';
      if(datedGames.length){
        var dates=datedGames.map(function(g){return g.date;}).sort();
        var d0=new Date(dates[0]+'T12:00:00'), d1=new Date(dates[dates.length-1]+'T12:00:00');
        var fmt=function(d){return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});};
        range=' — '+(d0.toDateString()===d1.toDateString()?fmt(d0):fmt(d0)+'–'+fmt(d1));
      }
      html+='<div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin:0.85rem 0 0.35rem;padding-top:0.5rem;border-top:1px solid var(--border)">'
        +label+range+' <span style="opacity:0.6">('+games.length+' games)</span></div>';
      games.forEach(function(g){
        var s=_pk.scores[g.id]||{};
        var hs=s.homeScore!=null?s.homeScore:'';
        var as_=s.awayScore!=null?s.awayScore:'';
        var hsi=parseInt(hs), asi=parseInt(as_);
        var homeWin=(!isNaN(hsi)&&!isNaN(asi)&&hsi!==asi&&hsi>asi);
        var awayWin=(!isNaN(hsi)&&!isNaN(asi)&&hsi!==asi&&asi>hsi);
        var dateStr=g.date?new Date(g.date+'T12:00:00').toLocaleDateString('en-US',{month:'numeric',day:'numeric'}):'TBD';
        var hSide=g.neutral?'N':'H', aSide=g.neutral?'N':'A';
        var hStyle='flex:1;font-size:0.77rem;font-weight:'+(homeWin?'600':'400')+';color:'+(homeWin?'var(--accent)':'var(--text)');
        var aStyle='flex:1;text-align:right;font-size:0.77rem;font-weight:'+(awayWin?'600':'400')+';color:'+(awayWin?'var(--accent)':'var(--text)');
        html+='<div data-gid="'+g.id+'" style="display:flex;align-items:center;gap:0.4rem;padding:0.3rem 0.55rem;margin-bottom:0.18rem;border-radius:var(--radius);background:'+(g.completed?'var(--bg2)':'var(--bg3)')+';border:1px solid '+(g.completed?'var(--border)':'var(--border-md)')+'">'
          +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:36px;text-align:center">'+dateStr+'</div>'
          +'<div class="pk-hn" style="'+hStyle+'">'+g.homeTeam+' <span style="font-size:0.55rem;color:var(--text-dim);font-family:var(--font-mono)">'+hSide+'</span></div>'
          +'<input type="number" min="0" max="99" value="'+hs+'" placeholder="–"'+(g.completed?' disabled':'')
          +' onchange="pkScore(\''+g.id+'\',\'home\',this.value)"'
          +' style="width:40px;text-align:center;font-family:var(--font-mono);font-size:0.82rem;background:'+(g.completed?'transparent':'var(--bg2)')+';border:'+(g.completed?'none':'1px solid var(--border-md)')+';color:var(--text);border-radius:var(--radius);padding:0.22rem;-moz-appearance:textfield;-webkit-appearance:none">'
          +'<span style="color:var(--text-dim);font-size:0.78rem">–</span>'
          +'<input type="number" min="0" max="99" value="'+as_+'" placeholder="–"'+(g.completed?' disabled':'')
          +' onchange="pkScore(\''+g.id+'\',\'away\',this.value)"'
          +' style="width:40px;text-align:center;font-family:var(--font-mono);font-size:0.82rem;background:'+(g.completed?'transparent':'var(--bg2)')+';border:'+(g.completed?'none':'1px solid var(--border-md)')+';color:var(--text);border-radius:var(--radius);padding:0.22rem;-moz-appearance:textfield;-webkit-appearance:none">'
          +'<div class="pk-an" style="'+aStyle+'"><span style="font-size:0.55rem;color:var(--text-dim);font-family:var(--font-mono)">'+aSide+'</span> '+g.awayTeam+'</div>'
          +(g.completed?'<span style="font-size:0.55rem;color:var(--text-dim);font-family:var(--font-mono);min-width:32px;text-align:right">FINAL</span>':'')
          +'</div>';
      });
    });
    html+='<div style="margin-top:1rem;display:flex;justify-content:flex-end">'
      +'<button onclick="pkTab(\'conf\')" style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);padding:0.4rem 1.1rem;font-family:var(--font-mono);font-size:0.73rem;font-weight:600;cursor:pointer">Next: Conf Championships →</button>'
      +'</div>';
    el.innerHTML=html;
  }

  window.pkScore = function(id, side, val) {
    if(!_pk.scores[id]) _pk.scores[id]={homeScore:'',awayScore:''};
    var n=(val===''||val==null)?'':parseInt(val);
    if(side==='home') _pk.scores[id].homeScore=n;
    else              _pk.scores[id].awayScore=n;
    // Update winner highlight on this row
    var row=document.querySelector('[data-gid="'+id+'"]');
    if(row){
      var s=_pk.scores[id];
      var hs=parseInt(s.homeScore), as_=parseInt(s.awayScore);
      var hn=row.querySelector('.pk-hn'), an=row.querySelector('.pk-an');
      if(hn&&an&&!isNaN(hs)&&!isNaN(as_)&&hs!==as_){
        hn.style.fontWeight=hs>as_?'600':'400'; hn.style.color=hs>as_?'var(--accent)':'var(--text)';
        an.style.fontWeight=as_>hs?'600':'400'; an.style.color=as_>hs?'var(--accent)':'var(--text)';
      }
    }
    // Update count
    var picked=Object.keys(_pk.scores).filter(function(id2){
      var s2=_pk.scores[id2];
      return s2.homeScore!==''&&s2.homeScore!=null&&s2.awayScore!==''&&s2.awayScore!=null;
    }).length;
    var countEl=document.querySelector('#pk-reg div[style*="font-mono"]');
    if(countEl) countEl.textContent=_pk.schedule.length+' games · '+picked+' predicted';
  };

  // ── Auto-predict ──────────────────────────────────────────
  window.pkAutoPredict = async function() {
    var selEl=document.getElementById('pk-elo-yr');
    var eloYr=parseInt(selEl&&selEl.value)||currentSeason;
    var btn=document.querySelector('[onclick="pkAutoPredict()"]');
    if(btn){btn.textContent='Loading…';btn.disabled=true;}
    if(!allSeasonData[eloYr]){
      try{var raw=await fetchCSV(CFG.dataPath+eloYr+'.csv');if(raw)allSeasonData[eloYr]=raw.map(coerceRow);}catch(e){}
    }
    var eloMap={};
    (allSeasonData[eloYr]||[]).forEach(function(r){if(r.team&&r.elo)eloMap[r.team]=parseFloat(r.elo);});
    if(!Object.keys(eloMap).length){
      if(btn){btn.textContent='Fill all games →';btn.disabled=false;}
      return;
    }
    function getElo(team){
      var t=pkResolve(team);
      return eloMap[t]||eloMap[team]||1500;
    }
    // Realistic CFB score pools — all valid football scores (multiples of TD/FG/safety)
    // Grouped by how lopsided the game is expected to be
    var SCORE_POOLS = [
      // [maxDiff, winnerOpts, loserOpts]
      [30,  [21,24,27,28,31,34,35],         [17,20,21,24,27,28,31]],
      [80,  [24,27,28,31,34,35,38,41],      [14,17,20,21,24,27,28]],
      [150, [28,31,34,35,38,41,42,45],      [10,13,14,17,20,21,24]],
      [250, [35,38,41,42,45,48,49,52],      [7,10,13,14,17,20,21]],
      [9999,[42,45,48,49,52,55,56,59],      [0,3,7,10,13,14,17]]
    ];
    function pickScore(pool){ return pool[Math.floor(Math.random()*pool.length)]; }

    var filled=0;
    _pk.schedule.forEach(function(g){
      if(g.completed) return;
      var eH=getElo(g.homeTeam)+(g.neutral?0:45), eA=getElo(g.awayTeam);
      var absDiff=Math.abs(eH-eA);
      var favHome=(eH>=eA);

      // Pick the right pool based on Elo gap
      var pool=SCORE_POOLS[SCORE_POOLS.length-1];
      for(var pi=0;pi<SCORE_POOLS.length;pi++){
        if(absDiff<=SCORE_POOLS[pi][0]){ pool=SCORE_POOLS[pi]; break; }
      }
      var winScore  = pickScore(pool[1]);
      var loseScore = pickScore(pool[2]);

      // Ensure winner actually beats loser (pick again if needed)
      var attempts=0;
      while(winScore<=loseScore&&attempts<10){
        winScore=pickScore(pool[1]); loseScore=pickScore(pool[2]); attempts++;
      }
      if(winScore<=loseScore) loseScore=Math.max(0,winScore-7);

      // Upset probability — favorites win most of the time
      // Close game: ~30% upset, moderate: ~15%, big: ~6%, mismatch: ~2%
      var upsetChance = absDiff<50 ? 0.30 : absDiff<150 ? 0.15 : absDiff<300 ? 0.06 : 0.02;
      var favWins = Math.random() > upsetChance;

      var hs, as_;
      if(!favWins) {
        // Upset: always use the closest score pool so upsets look like upsets (close games)
        var upsetPool = SCORE_POOLS[0]; // tightest margins
        var uWin  = pickScore(upsetPool[1]);
        var uLose = pickScore(upsetPool[2]);
        var att=0;
        while(uWin<=uLose&&att<10){uWin=pickScore(upsetPool[1]);uLose=pickScore(upsetPool[2]);att++;}
        if(uWin<=uLose) uLose=Math.max(0,uWin-3);
        // Underdog wins narrowly
        if(favHome){ hs=uLose; as_=uWin; }   // away team upset
        else        { hs=uWin;  as_=uLose; }  // home team upset (already underdog)
      } else {
        if(favHome){ hs=winScore; as_=loseScore; }
        else        { hs=loseScore; as_=winScore; }
      }
      _pk.scores[g.id]={homeScore:hs,awayScore:as_};
      filled++;
    });
    pkBuild();
    pkDrawReg();
    if(btn){btn.textContent='Fill all games →';btn.disabled=false;}
    if(window.toast) toast('Auto-filled '+filled+' games using '+eloYr+' Elo');
  };

  // ── Draw conference championships ─────────────────────────
  function pkDrawConf() {
    var el=document.getElementById('pk-conf');
    if(!el) return;
    pkBuild();

    var html='<div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);margin-bottom:1rem;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);padding:0.75rem 1rem;line-height:1.6">'
      +'Standings from your picks. <b style="color:var(--text)">Sun Belt &amp; MAC</b> use East/West division leaders. All others: top-2 by conf W% (tiebreaker: overall W% → Elo). Enter the championship score to set the conf champion.'
      +'</div>'
      +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:1rem;margin-bottom:1.2rem">';

    Object.keys(PK_CONFS).forEach(function(conf){
      if(conf==='Independent') return;
      var teams=(PK_CONFS[conf]||[]).map(pkTeam);
      var divDef=PK_DIVS[conf];
      var homeT='',awayT='';

      if(divDef){
        var divNames=Object.keys(divDef);
        var leaders=divNames.map(function(div){
          var dt=divDef[div];
          var filtered=teams.filter(function(t){return dt.indexOf(t.team)!==-1;});
          return pkSort(filtered)[0];
        }).filter(function(x){return x;});
        homeT=(leaders[0]&&leaders[0].team)||'';
        awayT=(leaders[1]&&leaders[1].team)||'';
      } else {
        var sorted=pkSort(teams);
        homeT=(sorted[0]&&sorted[0].team)||'';
        awayT=(sorted[1]&&sorted[1].team)||'';
      }

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
          for(var i=0;i<Math.min(divObjs.length,5);i++){
            var t=divObjs[i];
            var c=i===0?'var(--text)':'var(--text-muted)';
            html+='<div style="display:flex;gap:0.25rem;padding:0.1rem 0;font-size:0.7rem;color:'+c+'">'
              +'<span style="flex:1;font-weight:'+(i===0?'600':'400')+'">'+t.team+'</span>'
              +'<span style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim)">'+t.cw+'–'+t.cl+'</span>'
              +'<span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);margin-left:0.2rem">('+t.w+'–'+t.l+')</span>'
              +'</div>';
          }
          html+='</div>';
        });
        html+='</div>';
      } else {
        var sorted2=pkSort(teams);
        html+='<div style="margin-bottom:0.6rem">';
        for(var i=0;i<Math.min(sorted2.length,8);i++){
          var t=sorted2[i]; var c=i<2?'var(--text)':'var(--text-muted)';
          html+='<div style="display:flex;gap:0.3rem;padding:0.1rem 0;font-size:0.72rem;color:'+c+'">'
            +'<span style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim);min-width:14px;text-align:right">'+(i+1)+'</span>'
            +'<span style="flex:1;font-weight:'+(i<2?'600':'400')+'">'+t.team+'</span>'
            +'<span style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-dim)">'+t.cw+'–'+t.cl+'</span>'
            +'<span style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);margin-left:0.2rem">('+t.w+'–'+t.l+')</span>'
            +'</div>';
        }
        if(sorted2.length>8) html+='<div style="font-size:0.6rem;color:var(--text-dim);font-family:var(--font-mono);margin-top:0.1rem">+'+(sorted2.length-8)+' more</div>';
        html+='</div>';
      }

      var champLabel=champ?('Championship &middot; <strong style="color:var(--accent)">'+champ+' wins</strong>'):(homeT&&awayT?'Championship &middot; '+homeT+' vs '+awayT:'Championship &middot; TBD');
      var confKey=conf.replace(/[^a-zA-Z0-9]/g,'_');
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

    html+='</div><div style="display:flex;justify-content:flex-end">'
      +'<button onclick="pkTab(\'cfp\')" style="background:var(--accent);color:#1a1611;border:none;border-radius:var(--radius);padding:0.4rem 1.1rem;font-family:var(--font-mono);font-size:0.73rem;font-weight:600;cursor:pointer">Generate CFP Bracket + Top 25 →</button>'
      +'</div>';
    el.innerHTML=html;

    // Store matchups for pkCG lookup
    window._pkCGMap={};
    Object.keys(PK_CONFS).forEach(function(conf){
      if(conf==='Independent') return;
      var teams=(PK_CONFS[conf]||[]).map(pkTeam);
      var divDef=PK_DIVS[conf];
      var homeT='',awayT='';
      if(divDef){
        var leaders=Object.keys(divDef).map(function(div){
          var filtered=teams.filter(function(t){return divDef[div].indexOf(t.team)!==-1;});
          return pkSort(filtered)[0];
        }).filter(Boolean);
        homeT=(leaders[0]&&leaders[0].team)||'';awayT=(leaders[1]&&leaders[1].team)||'';
      } else {
        var s=pkSort(teams);homeT=(s[0]&&s[0].team)||'';awayT=(s[1]&&s[1].team)||'';
      }
      window._pkCGMap[conf.replace(/[^a-zA-Z0-9]/g,'_')]={conf:conf,homeT:homeT,awayT:awayT};
    });
  }

  window.pkCG = function(input) {
    var confKey=input.getAttribute('data-conf-key');
    var side=input.getAttribute('data-side');
    var val=input.value;
    var map=(window._pkCGMap&&window._pkCGMap[confKey])||{};
    var conf=map.conf||confKey;
    var homeT=map.homeT||'';
    var awayT=map.awayT||'';
    var e=null;
    for(var i=0;i<_pk.confGames.length;i++){if(_pk.confGames[i].conf===conf){e=_pk.confGames[i];break;}}
    if(!e){e={conf:conf,homeTeam:homeT,awayTeam:awayT,homeScore:null,awayScore:null,champ:''};_pk.confGames.push(e);}
    e.homeTeam=homeT;e.awayTeam=awayT;
    var n=parseInt(val);
    if(side==='home') e.homeScore=isNaN(n)?null:n;
    else              e.awayScore=isNaN(n)?null:n;
    if(e.homeScore!=null&&e.awayScore!=null&&e.homeScore!==e.awayScore){
      e.champ=e.homeScore>e.awayScore?e.homeTeam:e.awayTeam;
      _pk.confChamps[conf]=e.champ;
      pkBuild();
    } else {e.champ='';delete _pk.confChamps[conf];}
    var lbl=document.getElementById('pkcl-'+confKey);
    if(lbl) lbl.innerHTML=e.champ?('Championship &middot; <strong style="color:var(--accent)">'+e.champ+' wins</strong>'):'Championship &middot; '+homeT+' vs '+awayT;
  };

  // ── Draw CFP bracket + Top 25 ─────────────────────────────
  function pkDrawCFP() {
    var el=document.getElementById('pk-cfp');
    if(!el) return;
    pkBuild();

    // Determine conf champions
    var champions={};
    Object.keys(PK_CONFS).forEach(function(conf){
      if(conf==='Independent') return;
      var picked=_pk.confChamps[conf];
      if(picked){
        champions[conf]={team:picked,elo:_pk.eloSim[picked]||1500,conf:conf,
          w:_pk.wins[picked]||0,l:_pk.losses[picked]||0,
          cw:_pk.confWins[picked]||0,cl:_pk.confLoss[picked]||0};
      } else {
        var teams=(PK_CONFS[conf]||[]).map(pkTeam);
        var divDef=PK_DIVS[conf];
        var leader;
        if(divDef){
          var leaders=Object.keys(divDef).map(function(div){
            return pkSort(teams.filter(function(t){return divDef[div].indexOf(t.team)!==-1;}))[0];
          }).filter(Boolean);
          leader=leaders.sort(function(a,b){return (b.elo||0)-(a.elo||0);})[0];
        } else {
          leader=pkSort(teams)[0];
        }
        if(leader) champions[conf]={team:leader.team,elo:leader.elo,conf:conf,w:leader.w,l:leader.l,cw:leader.cw,cl:leader.cl};
      }
    });

    var champArr=Object.values(champions).sort(function(a,b){return b.elo-a.elo;});
    var champSet={};champArr.forEach(function(c){champSet[c.team]=1;});

    // All FBS teams by Elo
    var allTeams={};
    Object.values(PK_CONFS).forEach(function(arr){arr.forEach(function(t){allTeams[t]=1;});});
    Object.keys(_pk.eloBase).forEach(function(t){allTeams[t]=1;});
    var allFBS=Object.keys(allTeams).map(function(t){
      return {team:t,elo:_pk.eloSim[t]||_pk.eloBase[t]||0,
              conf:pkConfOf(t)||'—',w:_pk.wins[t]||0,l:_pk.losses[t]||0,
              cw:_pk.confWins[t]||0,cl:_pk.confLoss[t]||0};
    }).filter(function(t){return t.elo>0;}).sort(function(a,b){return b.elo-a.elo;});

    var top25=allFBS.slice(0,25);

    // Seed field: top-4 champs get bye, rest are champs + at-large
    var top4=champArr.slice(0,4);
    var used={};top4.forEach(function(c){used[c.team]=1;});
    var field=[];
    champArr.slice(4).forEach(function(c){if(field.length<8&&!used[c.team]){field.push(c);used[c.team]=1;}});
    allFBS.forEach(function(t){if(field.length<8&&!used[t.team]){field.push(t);used[t.team]=1;}});

    var seeds=top4.map(function(t,i){return Object.assign({},t,{seed:i+1,bye:true});})
      .concat(field.map(function(t,i){return Object.assign({},t,{seed:i+5,bye:false});}));

    var r1=[[seeds[4],seeds[11]],[seeds[5],seeds[10]],[seeds[6],seeds[9]],[seeds[7],seeds[8]]];

    function rec(t){return t.w+'–'+t.l;}
    function cRec(t){return (t.cw||t.cl)?t.cw+'–'+t.cl:'';}

    // Build Top 25 table
    var t25html='<div style="margin-bottom:1.4rem"><div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin-bottom:0.4rem">Top 25 — simulated Elo after all picks &nbsp;★ = conf champion</div>'
      +'<div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden">'
      +'<div style="display:flex;gap:0.35rem;padding:0.2rem 0.6rem;background:var(--bg3);border-bottom:1px solid var(--border)">'
      +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:22px;text-align:right">#</div>'
      +'<div style="flex:1;font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim)">Team</div>'
      +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:36px;text-align:right">W–L</div>'
      +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:32px;text-align:right">Conf</div>'
      +'<div style="font-family:var(--font-mono);font-size:0.55rem;color:var(--text-dim);min-width:38px;text-align:right">Elo</div>'
      +'</div>';
    top25.forEach(function(t,i){
      var star=champSet[t.team]?('<span style="font-size:0.5rem;color:var(--accent);font-family:var(--font-mono);margin-left:0.2rem">★'+t.conf+'</span>'):'';
      t25html+='<div style="display:flex;align-items:center;gap:0.35rem;padding:0.22rem 0.6rem;border-bottom:1px solid var(--border)">'
        +'<div style="font-family:var(--font-mono);font-size:0.65rem;color:var(--text-dim);min-width:22px;text-align:right">'+(i+1)+'</div>'
        +'<div style="flex:1;font-size:0.75rem;font-weight:'+(champSet[t.team]?'600':'400')+'">'+t.team+star+'</div>'
        +'<div style="font-family:var(--font-mono);font-size:0.63rem;color:var(--text-muted);min-width:36px;text-align:right">'+rec(t)+'</div>'
        +'<div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim);min-width:32px;text-align:right">'+cRec(t)+'</div>'
        +'<div style="font-family:var(--font-mono);font-size:0.63rem;color:var(--text-dim);min-width:38px;text-align:right">'+t.elo.toFixed(0)+'</div>'
        +'</div>';
    });
    t25html+='</div></div>';

    // Build seed list
    var seedHtml='<div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin-bottom:0.42rem">CFP Field — 12 Teams</div>'
      +'<div style="font-size:0.6rem;color:var(--text-dim);font-family:var(--font-mono);margin-bottom:0.4rem">Seeds 1–4 (BYE): top 4 conf champs · 5–12: champs + at-large</div>';
    seeds.forEach(function(s){
      var bg=s.seed<=4?'rgba(226,201,126,0.09)':'var(--bg3)';
      var bdr=s.seed<=4?'var(--accent)':'var(--border)';
      var byeSpan=s.bye?'<span style="font-size:0.5rem;color:var(--accent);font-family:var(--font-mono);margin-left:0.2rem">BYE</span>':'';
      var starSpan=champSet[s.team]?('<span style="font-size:0.5rem;color:var(--text-dim);font-family:var(--font-mono);margin-left:0.15rem">'+s.conf+'★</span>'):'';
      seedHtml+='<div style="display:flex;align-items:center;gap:0.35rem;padding:0.26rem 0.5rem;margin-bottom:0.18rem;border-radius:var(--radius);background:'+bg+';border:1px solid '+bdr+'">'
        +'<div style="font-family:var(--font-mono);font-size:0.64rem;color:var(--text-dim);min-width:16px;text-align:right">'+s.seed+'</div>'
        +'<div style="flex:1;font-size:0.75rem;font-weight:500">'+s.team+byeSpan+starSpan+'</div>'
        +'<div style="font-family:var(--font-mono);font-size:0.62rem;color:var(--text-muted);min-width:32px;text-align:right">'+rec(s)+'</div>'
        +'<div style="font-family:var(--font-mono);font-size:0.58rem;color:var(--text-dim);min-width:26px;text-align:right">'+cRec(s)+'</div>'
        +'<div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--text-dim)">'+s.elo.toFixed(0)+'</div>'
        +'</div>';
    });

    // Build first round
    var r1html='<div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin-bottom:0.42rem">First Round — campus sites</div>';
    r1.forEach(function(pair){
      var hi=pair[0],lo=pair[1];
      r1html+='<div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.28rem;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:0.32rem 0.6rem">'
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
    r1html+='<div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin:0.8rem 0 0.4rem">Quarterfinals</div>'
      +'<div style="font-size:0.7rem;color:var(--text-muted);font-family:var(--font-mono);line-height:1.9;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:0.55rem 0.7rem">';
    seeds.slice(0,4).forEach(function(s){r1html+='#'+s.seed+' '+s.team+' ('+rec(s)+') hosts lowest remaining<br>';});
    r1html+='</div><div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-dim);margin:0.8rem 0 0.4rem">Semifinals &amp; Championship</div>'
      +'<div style="font-size:0.7rem;color:var(--text-muted);font-family:var(--font-mono);line-height:1.9;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:0.55rem 0.7rem">'
      +'Semifinal 1 — Rose Bowl (Pasadena, Jan)<br>Semifinal 2 — Sugar Bowl (New Orleans, Jan)<br>Championship — Neutral site (Jan)'
      +'</div>';

    el.innerHTML=t25html
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:1.2rem">'+seedHtml+'</div>'+r1html+'</div>'
      +'<div style="margin-top:1rem;display:flex;gap:0.6rem">'
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
