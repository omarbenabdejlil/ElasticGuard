let relocationTimer = null;
let relocationCountdown = 10;
let relocationData = [];
let relocationFilter = 'all';

async function loadRelocationPage() {
  const el = document.getElementById('page-relocation');
  el.innerHTML = `
    <style>
      .rel-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; }
      .rel-title { font-size:22px; font-weight:bold; color:#1e3a5f; display:flex; align-items:center; gap:10px; }
      .rel-title-icon { font-size:20px; }
      .rel-controls { display:flex; align-items:center; gap:12px; }
      .rel-countdown { font-size:12px; color:#888; background:#f0f4f8; padding:4px 10px; border-radius:20px; }
      .rel-refresh-btn { background:#1e3a5f; color:#fff; border:none; padding:7px 16px; border-radius:8px; font-size:13px; cursor:pointer; }
      .rel-refresh-btn:hover { background:#2a4f7c; }
      .rel-metrics { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:24px; }
      .rel-metric { background:linear-gradient(135deg,#1e3a5f,#2a5f8f); border-radius:12px; padding:18px 20px; color:#fff; }
      .rel-metric-label { font-size:11px; text-transform:uppercase; letter-spacing:0.06em; opacity:0.75; margin-bottom:6px; }
      .rel-metric-val { font-size:28px; font-weight:700; line-height:1; }
      .rel-metric-sub { font-size:11px; opacity:0.6; margin-top:4px; }
      .rel-metric.green { background:linear-gradient(135deg,#0f6e56,#1d9e75); }
      .rel-metric.amber { background:linear-gradient(135deg,#7a4a00,#c47f0a); }
      .rel-metric.purple { background:linear-gradient(135deg,#3a1f6e,#6b3fa0); }
      .rel-filters { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
      .rel-filter { background:#f0f4f8; border:1.5px solid transparent; color:#555; padding:5px 14px; border-radius:20px; font-size:12px; cursor:pointer; font-weight:500; }
      .rel-filter:hover { background:#e2eaf4; }
      .rel-filter.active { background:#1e3a5f; color:#fff; border-color:#1e3a5f; }
      .rel-table-wrap { border-radius:12px; overflow:hidden; border:1px solid #dde4ee; background:#fff; }
      .rel-table { width:100%; border-collapse:collapse; font-size:13px; }
      .rel-table th { background:#1e3a5f; color:#fff; padding:11px 14px; text-align:left; font-size:11px; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; }
      .rel-table td { padding:11px 14px; border-bottom:1px solid #edf1f7; color:#2d3748; vertical-align:middle; }
      .rel-table tr:last-child td { border-bottom:none; }
      .rel-table tr:hover td { background:#f7faff; }
      .rel-index { font-family:monospace; font-size:12px; color:#1e3a5f; max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block; }
      .rel-pill { display:inline-block; font-size:11px; font-weight:700; padding:2px 8px; border-radius:20px; }
      .rel-pill-p { background:#dbeafe; color:#1e40af; }
      .rel-pill-r { background:#f3e8ff; color:#6b21a8; }
      .rel-nodes { font-family:monospace; font-size:11.5px; color:#444; }
      .rel-arrow { color:#aaa; margin:0 4px; }
      .rel-bar-wrap { display:flex; align-items:center; gap:8px; }
      .rel-bar-bg { flex:1; height:6px; background:#e2e8f0; border-radius:99px; overflow:hidden; min-width:60px; }
      .rel-bar-fill { height:100%; border-radius:99px; }
      .rel-pct { font-size:12px; font-weight:600; color:#2d3748; min-width:34px; text-align:right; }
      .rel-reason { display:inline-block; font-size:11px; font-weight:600; padding:3px 10px; border-radius:20px; }
      .rel-reason-rebalance { background:#e0f2fe; color:#0369a1; }
      .rel-reason-node_left { background:#fee2e2; color:#b91c1c; }
      .rel-reason-other { background:#fef9c3; color:#92400e; }
      .rel-explain-btn { background:#f0f4f8; border:1px solid #dde4ee; color:#1e3a5f; padding:4px 10px; border-radius:6px; font-size:11px; cursor:pointer; font-weight:600; }
      .rel-explain-btn:hover { background:#1e3a5f; color:#fff; }
      .rel-empty { text-align:center; padding:48px; color:#888; font-size:14px; }
      .rel-empty-icon { font-size:32px; margin-bottom:8px; }
    </style>

    <div class="rel-header">
      <div class="rel-title">
        <span class="rel-title-icon">&#8644;</span>
        Relocation Monitor
      </div>
      <div class="rel-controls">
        <span class="rel-countdown" id="rel-countdown">refresh in 10s</span>
        <button class="rel-refresh-btn" onclick="refreshRelocation()">&#8635; Refresh</button>
      </div>
    </div>

    <div class="rel-metrics" id="rel-metrics">
      <div class="rel-metric"><div class="rel-metric-label">Relocating shards</div><div class="rel-metric-val">—</div></div>
      <div class="rel-metric green"><div class="rel-metric-label">Avg bytes progress</div><div class="rel-metric-val">—</div></div>
      <div class="rel-metric amber"><div class="rel-metric-label">Indices affected</div><div class="rel-metric-val">—</div></div>
      <div class="rel-metric purple"><div class="rel-metric-label">Est. completion</div><div class="rel-metric-val">—</div></div>
    </div>

    <div class="rel-filters" id="rel-filters">
      <button class="rel-filter active" onclick="setRelFilter('all',this)">All</button>
      <button class="rel-filter" onclick="setRelFilter('primary',this)">Primary only</button>
      <button class="rel-filter" onclick="setRelFilter('replica',this)">Replica only</button>
      <button class="rel-filter" onclick="setRelFilter('rebalance',this)">Rebalance</button>
      <button class="rel-filter" onclick="setRelFilter('node_left',this)">Node left</button>
    </div>

    <div class="rel-table-wrap">
      <table class="rel-table">
        <thead>
          <tr>
            <th>Index</th>
            <th>Shard</th>
            <th>Source → Target</th>
            <th>Bytes %</th>
            <th>Translog %</th>
            <th>Reason</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="rel-tbody">
          <tr><td colspan="7" class="rel-empty">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  `;

  await refreshRelocation();
  startRelocationCountdown();
}

async function refreshRelocation() {
  try {
    const json = await API.get('/api/relocation');
    relocationData = json.shards || [];
    renderRelocation();
  } catch (e) {
    const tbody = document.getElementById('rel-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="rel-empty" style="color:#c0392b">Error: ${e.message}</td></tr>`;
  }
}

function setRelFilter(f, btn) {
  relocationFilter = f;
  document.querySelectorAll('.rel-filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRelocation();
}

function renderRelocation() {
  const filtered = relocationData.filter(r => {
    if (relocationFilter === 'primary')   return r.type === 'primary';
    if (relocationFilter === 'replica')   return r.type === 'replica';
    if (relocationFilter === 'rebalance') return r.reason === 'rebalance';
    if (relocationFilter === 'node_left') return r.reason === 'node_left';
    return true;
  });

  const avgBytes  = relocationData.length ? Math.round(relocationData.reduce((s,r) => s+r.bytes,0)/relocationData.length) : 0;
  const uniqueIdx = new Set(relocationData.map(r => r.index)).size;
  const etaMin    = relocationData.length ? Math.max(1, Math.round((100-avgBytes)/8)) : 0;

  const metrics = document.getElementById('rel-metrics');
  if (metrics) metrics.innerHTML = `
    <div class="rel-metric"><div class="rel-metric-label">Relocating shards</div><div class="rel-metric-val">${relocationData.length}</div><div class="rel-metric-sub">primary + replica</div></div>
    <div class="rel-metric green"><div class="rel-metric-label">Avg bytes progress</div><div class="rel-metric-val">${avgBytes}%</div><div class="rel-metric-sub">across active moves</div></div>
    <div class="rel-metric amber"><div class="rel-metric-label">Indices affected</div><div class="rel-metric-val">${uniqueIdx}</div><div class="rel-metric-sub">unique indices</div></div>
    <div class="rel-metric purple"><div class="rel-metric-label">Est. completion</div><div class="rel-metric-val">${etaMin ? '~'+etaMin+' min' : '—'}</div><div class="rel-metric-sub">based on avg speed</div></div>
  `;

  const tbody = document.getElementById('rel-tbody');
  if (!tbody) return;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="rel-empty"><div class="rel-empty-icon">${relocationData.length===0?'✓':'🔍'}</div>${relocationData.length===0?'No shards relocating right now':'No results for this filter'}</div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const barColor = r.bytes >= 70 ? '#1d9e75' : r.bytes >= 40 ? '#378add' : '#e67e22';
    const reasonClass = r.reason === 'rebalance' ? 'rel-reason-rebalance' : r.reason === 'node_left' ? 'rel-reason-node_left' : 'rel-reason-other';
    return `<tr>
      <td><span class="rel-index" title="${r.index}">${r.index}</span></td>
      <td><span class="rel-pill ${r.type==='primary'?'rel-pill-p':'rel-pill-r'}">${r.shard}${r.type==='primary'?'P':'R'}</span></td>
      <td><span class="rel-nodes">${r.source}<span class="rel-arrow">→</span>${r.target}</span></td>
      <td>
        <div class="rel-bar-wrap">
          <div class="rel-bar-bg"><div class="rel-bar-fill" style="width:${r.bytes}%;background:${barColor}"></div></div>
          <span class="rel-pct">${r.bytes}%</span>
        </div>
      </td>
      <td><span class="rel-pct">${r.translog}%</span></td>
      <td><span class="rel-reason ${reasonClass}">${r.reason}</span></td>
      <td><button class="rel-explain-btn" onclick="explainShard('${r.index}',${r.shard})">explain</button></td>
    </tr>`;
  }).join('');
}

async function explainShard(index, shard) {
  try {
    const json = await API.get(`/api/relocation/explain?index=${encodeURIComponent(index)}&shard=${shard}`);
    alert(JSON.stringify(json, null, 2));
  } catch(e) {
    alert('Error: ' + e.message);
  }
}

function startRelocationCountdown() {
  clearInterval(relocationTimer);
  relocationCountdown = 10;
  relocationTimer = setInterval(() => {
    relocationCountdown--;
    const el = document.getElementById('rel-countdown');
    if (!el) { clearInterval(relocationTimer); return; }
    el.textContent = relocationCountdown > 0 ? `refresh in ${relocationCountdown}s` : 'refreshing...';
    if (relocationCountdown <= 0) { refreshRelocation(); relocationCountdown = 10; }
  }, 1000);
}
