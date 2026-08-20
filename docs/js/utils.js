/* ============================================================
   EloRankings — Shared JS (utils.js)
   Load this on every page. No dependencies.
   ============================================================ */
'use strict';

// ── CSV parser ────────────────────────────────────────────────
window.parseCSV = function(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    vals.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => {
      const v = (vals[i] || '').replace(/^"|"$/g, '');
      obj[h] = v === '' ? null : v;
    });
    return obj;
  });
};

// ── Fetch CSV with cache-busting ──────────────────────────────
window.fetchCSV = async function(path) {
  try {
    const res = await fetch(path + '?t=' + Date.now());
    if (!res.ok) throw new Error(res.status + ' ' + path);
    return window.parseCSV(await res.text());
  } catch(e) {
    console.warn('fetchCSV:', e.message);
    return null;
  }
};

// ── Number formatters ─────────────────────────────────────────
window.fmt = {
  elo:   v => v == null ? '—' : Number(v).toFixed(1),
  pct:   v => v == null ? '—' : (Number(v) * 100).toFixed(1) + '%',
  num:   v => v == null ? '—' : Math.round(Number(v)).toLocaleString(),
  maybe: v => (v == null || v === 'NA' || v === 'null' || v === '') ? '—' : v,
  date:  v => {
    if (!v) return '—';
    try { return new Date(v).toLocaleDateString(undefined, {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
    catch(_) { return v; }
  }
};

// ── Elo math ─────────────────────────────────────────────────
window.eloWinProb = function(eloA, eloB, hca = 0) {
  return 1 / (1 + Math.pow(10, (eloB - (eloA + hca)) / 400));
};

window.eloSpread = function(eloA, eloB, hca = 0, scale = 35) {
  return ((eloA + hca - eloB) / scale).toFixed(1);
};

window.eloBarWidth = function(elo, maxElo, minElo = 1400, maxW = 90) {
  const range = (maxElo - minElo) || 1;
  return Math.max(3, Math.min(maxW, ((elo - minElo) / range) * maxW));
};

// ── Sortable table ────────────────────────────────────────────
window.makeSortable = function(tableEl) {
  if (!tableEl) return;
  const ths = tableEl.querySelectorAll('thead th');
  let sortCol = null, sortDir = -1;

  ths.forEach((th, idx) => {
    const icon = document.createElement('span');
    icon.className = 'sort-icon'; icon.textContent = ' ↕';
    th.appendChild(icon);

    th.addEventListener('click', () => {
      if (sortCol === idx) sortDir *= -1;
      else { sortCol = idx; sortDir = -1; }

      ths.forEach(t => { t.classList.remove('sorted'); t.querySelector('.sort-icon').textContent = ' ↕'; });
      th.classList.add('sorted');
      th.querySelector('.sort-icon').textContent = sortDir === -1 ? ' ↓' : ' ↑';

      const tbody = tableEl.querySelector('tbody');
      const rows  = Array.from(tbody.querySelectorAll('tr'));
      rows.sort((a, b) => {
        const av = a.cells[idx]?.dataset.val ?? a.cells[idx]?.textContent ?? '';
        const bv = b.cells[idx]?.dataset.val ?? b.cells[idx]?.textContent ?? '';
        const an = parseFloat(av), bn = parseFloat(bv);
        if (!isNaN(an) && !isNaN(bn)) return (an - bn) * sortDir;
        return av.localeCompare(bv) * sortDir;
      });
      rows.forEach(r => tbody.appendChild(r));
    });
  });
};

// ── Live table search ─────────────────────────────────────────
window.makeSearchable = function(inputEl, tableEl) {
  if (!inputEl || !tableEl) return;
  inputEl.addEventListener('input', () => {
    const q = inputEl.value.toLowerCase().trim();
    tableEl.querySelectorAll('tbody tr').forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
};

// ── Tab switcher ──────────────────────────────────────────────
window.initTabs = function(tabsEl, panels) {
  // tabsEl: container with .tab buttons, data-tab attr
  // panels: { tabName: domElement }
  const tabs = tabsEl.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      Object.values(panels).forEach(p => { if (p) p.hidden = true; });
      const panel = panels[tab.dataset.tab];
      if (panel) panel.hidden = false;
      tab.dispatchEvent(new CustomEvent('tabactivated', { bubbles: true }));
    });
  });
  if (tabs[0]) tabs[0].click();
};

// ── Toast ─────────────────────────────────────────────────────
window.toast = function(msg, ms = 2400) {
  let el = document.getElementById('_toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '_toast'; el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
};

// ── Export current data as CSV download ───────────────────────
window.downloadCSV = function(data, filename, cols) {
  if (!data || !data.length) { toast('No data to export'); return; }
  const keys = cols || Object.keys(data[0]);
  const csv  = [keys.join(','), ...data.map(r => keys.map(k => {
    const v = r[k] ?? '';
    return String(v).includes(',') ? '"' + v + '"' : v;
  }).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
  toast('Exported ' + data.length + ' rows');
};

// ── Build rankings table HTML ─────────────────────────────────
window.buildTable = function(rows_html, headers) {
  // headers: array of { label, type }
  const ths = headers.map(h =>
    `<th data-type="${h.type || 'string'}">${h.label}</th>`
  ).join('');
  return `<div class="table-wrap">
    <table class="tbl" id="mainTable">
      <thead><tr>${ths}</tr></thead>
      <tbody>${rows_html}</tbody>
    </table>
  </div>`;
};

// ── Set active nav link ───────────────────────────────────────
window.setNavActive = function() {
  const path = window.location.pathname;
  document.querySelectorAll('.nav-links a').forEach(a => {
    const href = a.getAttribute('href') || '';
    const name = href.split('/').pop().replace('.html','');
    if (name && path.includes(name)) a.classList.add('active');
  });
};

// ── Parse numeric fields on raw CSV rows ──────────────────────
window.coerceRow = function(r) {
  const elo          = parseFloat(r.elo)          || 0;
  const resume_score = parseFloat(r.resume_score) || 0;
  const win_pct      = parseFloat(r.win_pct)      || 0;
  // Use pr from CSV if available (R computes: Elo × win_pct^0.6 + √quality_resume)
  // Fall back to computing it client-side for sports that don't have a pr column
  const pr_csv = parseFloat(r.pr);
  const pr = !isNaN(pr_csv) && pr_csv > 0
    ? pr_csv
    : elo * Math.pow(Math.max(0.01, win_pct), 0.6) + Math.sqrt(resume_score);
  // Rolling-checkpoint movement columns (added by R/elo_engine.R's attach_movers()).
  // Older CSVs written before that shipped won't have these — parseFloat(undefined)
  // is NaN, so elo_change/baseline_elo come through as null and callers fall back
  // to the 1500 season-start baseline until the next scheduled run backfills them.
  const elo_change_csv   = parseFloat(r.elo_change);
  const baseline_elo_csv = parseFloat(r.baseline_elo);
  return {
    ...r,
    rank:         parseInt(r.rank)          || 0,
    elo,
    wins:         parseInt(r.wins)          || 0,
    losses:       parseInt(r.losses)        || 0,
    games_played: parseInt(r.games_played)  || 0,
    win_pct,
    sos:          parseFloat(r.sos)         || 0,
    best_win_elo: parseFloat(r.best_win_elo)|| 0,
    resume_score,
    pr,
    elo_change:   isNaN(elo_change_csv)   ? null : elo_change_csv,
    baseline_elo: isNaN(baseline_elo_csv) ? null : baseline_elo_csv,
    baseline_date: r.baseline_date || null,
  };
};

// ── Season auto-detection ──────────────────────────────────────
// Mirrors the season-labeling rules baked into each R/update_*.R script
// (e.g. NFL is named by the year the season STARTS, NBA/NHL/CBB by the
// year it ENDS). Used to extend hardcoded `seasons` arrays and to flip
// homepage "Live/Off-season" badges automatically as seasons roll over,
// instead of requiring a manual yearly edit to every sport's HTML page.
window.EloSeason = (function () {
  const RULES = {
    NFL:    { boundaryMonth: 9,  labelsBy: 'start' }, // Sep–Feb, named by start year
    CFB:    { boundaryMonth: 8,  labelsBy: 'start' }, // Aug–Jan, named by start year
    NBA:    { boundaryMonth: 10, labelsBy: 'end'   }, // Oct–Jun, named by spring year
    NHL:    { boundaryMonth: 10, labelsBy: 'end'   }, // Oct–Jun, named by spring year
    CBB:    { boundaryMonth: 11, labelsBy: 'end'   }, // Nov–Apr, named by spring year
    MLB:    { boundaryMonth: 3,  labelsBy: 'start' }, // Mar–Oct, named by calendar year
    CBASE:  { boundaryMonth: 1,  labelsBy: 'start' }, // Feb–Jun, named by calendar year
    Soccer: { boundaryMonth: 8,  labelsBy: 'end'   }, // Aug–May, named by end year
  };
  const WINDOWS = {
    NFL: [9, 2], CFB: [8, 1], NBA: [10, 6], NHL: [10, 6],
    CBB: [11, 4], MLB: [3, 10], CBASE: [2, 6], Soccer: [8, 5],
  };

  // The season label that should be "current" right now, per this sport's
  // own naming convention (matches the CURRENT_SEASON logic in the R scripts).
  function currentLabel(sport) {
    const r = RULES[sport];
    if (!r) return new Date().getFullYear();
    const now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1;
    const started = m >= r.boundaryMonth;
    return r.labelsBy === 'start' ? (started ? y : y - 1) : (started ? y + 1 : y);
  }

  // Extend a hardcoded seasons array with whatever season(s) should exist
  // by now, without removing anything already there. A season slightly
  // ahead of its data is safe — the page already shows an empty state
  // ("Run the GitHub Actions workflow...") until the CSV lands.
  function withCurrent(seasons, sport) {
    const list = (seasons || []).slice();
    const cur  = currentLabel(sport);
    [cur + 1, cur].forEach(yr => { if (!list.includes(yr)) list.unshift(yr); });
    return list.sort((a, b) => b - a);
  }

  // Rough "is this sport actively being played right now" check, for
  // homepage Live/Off-season badges.
  function isLive(sport) {
    const w = WINDOWS[sport];
    if (!w) return true;
    const m = new Date().getMonth() + 1;
    const [start, end] = w;
    return start <= end ? (m >= start && m <= end) : (m >= start || m <= end);
  }

  return { currentLabel, withCurrent, isLive };
})();

document.addEventListener('DOMContentLoaded', window.setNavActive);
