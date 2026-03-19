const Diagnostics = {
  data: null,
  activeFilter: '',
  searchQuery: '',
  pageSize: 25,
  pages: {},

  async render() {
    const el = document.getElementById('page-diagnostics');
    el.innerHTML = '<div class="loading">Running diagnostics — analyzing cluster health</div>';
    try {
      this.data = await API.diagnostics();
      this.pages = {};
      this.renderContent(el);
    } catch(err) {
      el.innerHTML = `<div class="error-msg">Error: ${Utils.escapeHtml(err.message)}</div>`;
    }
  },

  getPage(key) { return this.pages[key] || 1; },
  setPage(key, p) { this.pages[key] = p; this.rerenderSection(key); },

  filterItems(items) {
    if (!this.searchQuery) return items;
    const q = this.searchQuery.toLowerCase();
    return items.filter(i => JSON.stringify(i).toLowerCase().includes(q));
  },

  renderContent(el) {
    const { diagnostics: d, summary } = this.data;
    const cats = [
      { key: 'ilm_alias',   label: '🔗 ILM Alias',       count: d.ilm_alias_issues.length },
      { key: 'ilm_shard',   label: '⚖ Shard Size ILM',   count: d.ilm_shard_size_issues.length },
      { key: 'ilm_error',   label: '💥 ILM Errors',       count: d.ilm_errors.length },
      { key: 'no_replica',  label: '⚠ No Replica',        count: d.no_replica_indices.length },
      { key: 'unassigned',  label: '🔴 Unassigned',        count: d.unassigned_shards.length },
      { key: 'oversized',   label: '📦 Oversized',         count: d.oversized_indices.length },
      { key: 'no_ilm',      label: '🚫 No ILM',            count: d.no_ilm_indices.length },
      { key: 'shard_issues',label: '⚡ Shard Issues',      count: d.shard_issues.length },
      { key: 'empty_old',   label: '🗑 Empty Old',          count: d.empty_old_indices.length },
    ];

    el.innerHTML = `
      <style>
        .diag-filter-btn { transition: all 0.15s; }
        .diag-filter-btn.active-filter { border-color:#2563eb!important;color:#2563eb!important;background:#eff6ff!important; }
        .diag-search { width:100%;padding:9px 14px;border:1px solid #dde4ee;border-radius:10px;font-size:13px;margin-bottom:16px;outline:none; }
        .diag-search:focus { border-color:#2563eb; }
        .diag-table { width:100%;border-collapse:collapse;font-size:12.5px; }
        .diag-table thead th { background:#1e3a5f !important;color:#fff !important;padding:9px 12px;text-align:left;font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;position:sticky;top:0;z-index:1; }
        .diag-table td { padding:9px 12px;border-bottom:1px solid #edf1f7;vertical-align:middle;color:#2d3748; }
        .diag-table tr:hover td { background:#f7faff; }
        .diag-table tr:last-child td { border-bottom:none; }
        .diag-wrap { border:1px solid #dde4ee;border-radius:12px;overflow:hidden;margin-bottom:6px; }
        .diag-section-hdr { display:flex;align-items:center;justify-content:space-between;padding:13px 16px;background:#f8fafc;border-bottom:1px solid #edf1f7;cursor:pointer;user-select:none; }
        .diag-section-hdr:hover { background:#f0f4f8; }
        .diag-section-title { font-size:13px;font-weight:600;color:#1e3a5f;display:flex;align-items:center;gap:8px; }
        .diag-section-body { display:none; }
        .diag-section-body.open { display:block; }
        .diag-chevron { transition:transform 0.2s;font-style:normal;font-size:11px; }
        .diag-chevron.open { transform:rotate(90deg); }
        .diag-pagination { display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f8fafc;border-top:1px solid #edf1f7;font-size:12px;color:#666; }
        .diag-page-btns { display:flex;gap:6px; }
        .diag-page-btn { padding:4px 10px;border:1px solid #dde4ee;border-radius:6px;background:#fff;cursor:pointer;font-size:12px; }
        .diag-page-btn:hover { background:#eff6ff;border-color:#2563eb;color:#2563eb; }
        .diag-page-btn.active { background:#1e3a5f;color:#fff;border-color:#1e3a5f; }
        .diag-page-btn:disabled { opacity:0.4;cursor:default; }
        .sev-critical { display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:#fee2e2;color:#b91c1c; }
        .sev-high     { display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:#fef3c7;color:#92400e; }
        .sev-warn     { display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:#fff7ed;color:#c2410c; }
        .sev-info     { display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:#eff6ff;color:#1d4ed8; }
        .idx-cell { font-family:monospace;font-size:11.5px;color:#1e3a5f;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
        .fix-tip { font-size:11px;color:#2563eb;font-style:italic; }
        .empty-ok { padding:16px;color:#15803d;font-size:13px; }
      </style>

      <div class="page-header page-header-row">
        <div><h1>Diagnostics</h1><p>Automated analysis: ILM misconfigs, replica gaps, oversized indices, shard issues</p></div>
        <button class="refresh-btn" id="diag-refresh">↻ Refresh</button>
      </div>

      <div class="stat-grid">
        <div class="stat-card ${summary.critical_issues > 0 ? 'red' : 'green'}">
          <div class="label">Critical Issues</div><div class="value">${summary.critical_issues}</div>
        </div>
        <div class="stat-card ${summary.total_issues > 0 ? 'yellow' : 'green'}">
          <div class="label">Total Issues</div><div class="value">${summary.total_issues}</div>
        </div>
        <div class="stat-card">
          <div class="label">No-Replica Indices</div><div class="value">${summary.no_replica_count}</div>
          <div class="sub">+${summary.no_replica_storage_cost_1x} if 1 replica</div>
        </div>
        <div class="stat-card">
          <div class="label">+2 Replicas Cost</div>
          <div class="value" style="font-size:18px">${summary.no_replica_storage_cost_2x}</div>
          <div class="sub">storage needed</div>
        </div>
      </div>

      <input class="diag-search" id="diag-search" placeholder="🔍  Search across all issues — index name, policy, message..." type="text">

      <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
        <button class="diag-filter-btn btn btn-ghost btn-sm active-filter" data-key="">All <span style="color:#2563eb">${summary.total_issues}</span></button>
        ${cats.map(c => `<button class="diag-filter-btn btn btn-ghost btn-sm${c.count===0?' diag-zero':''}" data-key="${c.key}" style="${c.count===0?'opacity:0.4':''}">${c.label} <span style="color:#2563eb">${c.count}</span></button>`).join('')}
      </div>

      <div id="diag-sections">
        ${this.renderSection('ilm_alias',    '🔗 ILM Rollover Alias Issues',           d.ilm_alias_issues,    this.tblAliasIssue.bind(this))}
        ${this.renderSection('ilm_shard',    '⚖ Shard-Size ILM Misconfiguration',      d.ilm_shard_size_issues, this.tblShardIssue.bind(this))}
        ${this.renderSection('ilm_error',    '💥 ILM Errors / Stuck Indices',           d.ilm_errors,          this.tblIlmError.bind(this))}
        ${this.renderSection('no_replica',   '⚠ Indices Without Replicas',             d.no_replica_indices,  this.tblNoReplica.bind(this))}
        ${this.renderSection('unassigned',   '🔴 Unassigned Shards',                    d.unassigned_shards,   this.tblUnassigned.bind(this))}
        ${this.renderSection('oversized',    '📦 Oversized Indices (>100 GB)',           d.oversized_indices,   this.tblOversized.bind(this))}
        ${this.renderSection('no_ilm',       '🚫 Indices Without ILM Policy',           d.no_ilm_indices,      this.tblNoIlm.bind(this))}
        ${this.renderSection('shard_issues', '⚡ Shard Count Issues',                   d.shard_issues,        this.tblShardCount.bind(this))}
        ${this.renderSection('empty_old',    '🗑 Empty Indices Older Than 7 Days',       d.empty_old_indices,   this.tblEmptyOld.bind(this))}
      </div>
    `;

    document.getElementById('diag-refresh')?.addEventListener('click', () => this.render());

    document.getElementById('diag-search')?.addEventListener('input', e => {
      this.searchQuery = e.target.value.trim();
      this.pages = {};
      this.rerenderAllSections();
    });

    el.querySelectorAll('.diag-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeFilter = btn.dataset.key;
        el.querySelectorAll('.diag-filter-btn').forEach(b => b.classList.remove('active-filter'));
        btn.classList.add('active-filter');
        el.querySelectorAll('.diag-wrap').forEach(sec => {
          sec.style.display = (!this.activeFilter || sec.dataset.key === this.activeFilter) ? '' : 'none';
        });
      });
    });

    el.querySelectorAll('.diag-section-hdr').forEach(hdr => {
      hdr.addEventListener('click', () => {
        const body = hdr.nextElementSibling;
        const chev = hdr.querySelector('.diag-chevron');
        body.classList.toggle('open');
        chev.classList.toggle('open');
      });
    });
  },

  renderSection(key, title, items, tblFn) {
    const filtered = this.filterItems(items);
    const page = this.getPage(key);
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / this.pageSize));
    const start = (page - 1) * this.pageSize;
    const slice = filtered.slice(start, start + this.pageSize);
    const isOpen = false;

    const countBadge = total === 0
      ? `<span style="background:#f0fdf4;color:#15803d;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600">✓ 0</span>`
      : `<span style="background:${total > 100 ? '#fee2e2' : '#fff7ed'};color:${total > 100 ? '#b91c1c' : '#92400e'};padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600">${total}</span>`;

    const tableHtml = total === 0
      ? `<div class="empty-ok">✓ No issues found</div>`
      : `<div style="overflow-x:auto"><table class="diag-table">${tblFn(slice)}</table></div>
         ${totalPages > 1 ? this.renderPagination(key, page, totalPages, start, slice.length, total) : ''}`;

    return `
      <div class="diag-wrap" data-key="${key}">
        <div class="diag-section-hdr">
          <div class="diag-section-title">
            <i class="diag-chevron ${isOpen ? 'open' : ''}">▶</i>
            ${title} ${countBadge}
          </div>
          ${total > 0 ? `<span style="font-size:11px;color:#888">page ${page}/${totalPages} · showing ${Math.min(this.pageSize, total)} of ${total}</span>` : ''}
        </div>
        <div class="diag-section-body ${isOpen ? 'open' : ''}" id="diag-body-${key}">
          ${tableHtml}
        </div>
      </div>`;
  },

  renderPagination(key, page, totalPages, start, count, total) {
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || Math.abs(i - page) <= 2) {
        pages.push(i);
      } else if (pages[pages.length-1] !== '...') {
        pages.push('...');
      }
    }
    return `<div class="diag-pagination">
      <span>Showing ${start+1}–${start+count} of ${total}</span>
      <div class="diag-page-btns">
        <button class="diag-page-btn" onclick="Diagnostics.setPage('${key}',${page-1})" ${page===1?'disabled':''}>‹ Prev</button>
        ${pages.map(p => p === '...'
          ? `<span style="padding:4px 6px;color:#aaa">…</span>`
          : `<button class="diag-page-btn ${p===page?'active':''}" onclick="Diagnostics.setPage('${key}',${p})">${p}</button>`
        ).join('')}
        <button class="diag-page-btn" onclick="Diagnostics.setPage('${key}',${page+1})" ${page===totalPages?'disabled':''}>Next ›</button>
      </div>
    </div>`;
  },

  rerenderSection(key) {
    const { diagnostics: d } = this.data;
    const map = {
      ilm_alias:    [d.ilm_alias_issues,     this.tblAliasIssue.bind(this),  '🔗 ILM Rollover Alias Issues'],
      ilm_shard:    [d.ilm_shard_size_issues, this.tblShardIssue.bind(this),  '⚖ Shard-Size ILM Misconfiguration'],
      ilm_error:    [d.ilm_errors,            this.tblIlmError.bind(this),    '💥 ILM Errors / Stuck Indices'],
      no_replica:   [d.no_replica_indices,    this.tblNoReplica.bind(this),   '⚠ Indices Without Replicas'],
      unassigned:   [d.unassigned_shards,     this.tblUnassigned.bind(this),  '🔴 Unassigned Shards'],
      oversized:    [d.oversized_indices,     this.tblOversized.bind(this),   '📦 Oversized Indices (>100 GB)'],
      no_ilm:       [d.no_ilm_indices,        this.tblNoIlm.bind(this),       '🚫 Indices Without ILM Policy'],
      shard_issues: [d.shard_issues,          this.tblShardCount.bind(this),  '⚡ Shard Count Issues'],
      empty_old:    [d.empty_old_indices,     this.tblEmptyOld.bind(this),    '🗑 Empty Indices Older Than 7 Days'],
    };
    const wrap = document.querySelector(`.diag-wrap[data-key="${key}"]`);
    if (!wrap) return;
    const [items, tblFn, title] = map[key];
    wrap.outerHTML = this.renderSection(key, title, items, tblFn);
    document.querySelector(`.diag-wrap[data-key="${key}"] .diag-section-hdr`)
      ?.addEventListener('click', function() {
        const body = this.nextElementSibling;
        const chev = this.querySelector('.diag-chevron');
        body.classList.toggle('open');
        chev.classList.toggle('open');
      });
  },

  rerenderAllSections() {
    ['ilm_alias','ilm_shard','ilm_error','no_replica','unassigned','oversized','no_ilm','shard_issues','empty_old']
      .forEach(k => this.rerenderSection(k));
  },

  // ── Table renderers ───────────────────────────────────────────────────────

  tblAliasIssue(items) {
    return `<thead><tr><th>Severity</th><th>Index</th><th>Phase</th><th>Policy</th><th>Issue</th></tr></thead><tbody>
      ${items.map(i => `<tr>
        <td><span class="sev-${i.severity}">${i.severity}</span></td>
        <td class="idx-cell" title="${Utils.escapeHtml(i.index)}">${Utils.escapeHtml(i.index)}</td>
        <td>${i.phase || '—'}</td>
        <td style="font-family:monospace;font-size:11px">${Utils.escapeHtml(i.policy)}</td>
        <td>${Utils.escapeHtml(i.issue)}<br><span class="fix-tip">Fix: Set index.lifecycle.rollover_alias to a valid write alias</span></td>
      </tr>`).join('')}</tbody>`;
  },

  tblShardIssue(items) {
    return `<thead><tr><th>Index</th><th>Phase</th><th>Policy</th><th>Current size</th><th>Shards</th><th>Max shard size</th><th>Est. max</th></tr></thead><tbody>
      ${items.map(i => `<tr>
        <td class="idx-cell" title="${Utils.escapeHtml(i.index)}">${Utils.escapeHtml(i.index)}</td>
        <td>${i.phase||'—'}</td>
        <td style="font-family:monospace;font-size:11px">${Utils.escapeHtml(i.policy)}</td>
        <td>${i.current_size}</td>
        <td>${i.primary_shards}</td>
        <td>${i.max_primary_shard_size}</td>
        <td style="color:#c2410c;font-weight:600">${i.estimated_max_index_size}</td>
      </tr>`).join('')}</tbody>`;
  },

  tblIlmError(items) {
    return `<thead><tr><th>Index</th><th>Phase</th><th>Failed step</th><th>Policy</th><th>Age</th><th>Auto-retry</th><th>Fix</th></tr></thead><tbody>
      ${items.map(i => `<tr>
        <td class="idx-cell" title="${Utils.escapeHtml(i.index)}">${Utils.escapeHtml(i.index)}</td>
        <td>${i.phase||'—'}</td>
        <td style="color:#b91c1c;font-weight:600">${Utils.escapeHtml(i.failed_step||'—')}</td>
        <td style="font-family:monospace;font-size:11px">${Utils.escapeHtml(i.policy)}</td>
        <td>${i.age||'—'}</td>
        <td>${i.retry_failed?'✓ yes':'✗ no'}</td>
        <td><span class="fix-tip">POST /${Utils.escapeHtml(i.index)}/_ilm/retry</span></td>
      </tr>`).join('')}</tbody>`;
  },

  tblNoReplica(items) {
    return `<thead><tr><th>Index</th><th>Health</th><th>Phase</th><th>Primary size</th><th>Docs</th><th>+1 replica cost</th><th>+2 replicas cost</th></tr></thead><tbody>
      ${items.map(i => `<tr>
        <td class="idx-cell" title="${Utils.escapeHtml(i.index)}">${Utils.escapeHtml(i.index)}</td>
        <td>${Utils.healthBadge(i.health)}</td>
        <td>${i.phase||'—'}</td>
        <td>${i.primary_size}</td>
        <td>${Utils.numFormat(i.docs)}</td>
        <td style="color:#15803d;font-weight:600">${i.cost_1_replica}</td>
        <td style="color:#1d4ed8;font-weight:600">${i.cost_2_replicas}</td>
      </tr>`).join('')}</tbody>`;
  },

  tblUnassigned(items) {
    return `<thead><tr><th>Index</th><th>Shard</th><th>Type</th><th>Severity</th></tr></thead><tbody>
      ${items.map(i => `<tr>
        <td class="idx-cell" title="${Utils.escapeHtml(i.index)}">${Utils.escapeHtml(i.index)}</td>
        <td>${i.shard}</td>
        <td><span class="sev-${i.prirep==='p'?'critical':'warn'}">${i.prirep==='p'?'Primary':'Replica'}</span></td>
        <td>${i.prirep==='p'?'⚠️ Data may be unavailable':'Reduced redundancy'}</td>
      </tr>`).join('')}</tbody>`;
  },

  tblOversized(items) {
    return `<thead><tr><th>Index</th><th>Phase</th><th>Total size</th><th>Primary size</th><th>Shards</th><th>Docs</th><th>Policy</th></tr></thead><tbody>
      ${items.map(i => `<tr>
        <td class="idx-cell" title="${Utils.escapeHtml(i.index)}">${Utils.escapeHtml(i.index)}</td>
        <td>${i.phase||'—'}</td>
        <td style="color:#c2410c;font-weight:600">${i.size}</td>
        <td>${i.primary_size}</td>
        <td>${i.shards}</td>
        <td>${Utils.numFormat(i.docs)}</td>
        <td style="font-family:monospace;font-size:11px">${i.policy||'none'}</td>
      </tr>`).join('')}</tbody>`;
  },

  tblNoIlm(items) {
    return `<thead><tr><th>Index</th><th>Size</th><th>Docs</th><th>Age (days)</th></tr></thead><tbody>
      ${items.map(i => `<tr>
        <td class="idx-cell" title="${Utils.escapeHtml(i.index)}">${Utils.escapeHtml(i.index)}</td>
        <td>${i.size}</td>
        <td>${Utils.numFormat(i.docs)}</td>
        <td>${i.age_days != null ? i.age_days+'d' : '—'}</td>
      </tr>`).join('')}</tbody>`;
  },

  tblShardCount(items) {
    return `<thead><tr><th>Index</th><th>Issue</th><th>Avg shard size</th><th>Total size</th><th>Primary shards</th><th>Recommendation</th></tr></thead><tbody>
      ${items.map(i => `<tr>
        <td class="idx-cell" title="${Utils.escapeHtml(i.index)}">${Utils.escapeHtml(i.index)}</td>
        <td><span class="sev-warn">${i.issue==='too_large'?'too large':'too many'}</span></td>
        <td>${i.avg_shard_size}</td>
        <td>${i.total_size}</td>
        <td>${i.primary_shards}</td>
        <td style="font-size:11px;color:#666">${Utils.escapeHtml(i.recommendation)}</td>
      </tr>`).join('')}</tbody>`;
  },

  tblEmptyOld(items) {
    return `<thead><tr><th>Index</th><th>Age</th><th>Size</th><th>Phase</th><th>Policy</th></tr></thead><tbody>
      ${items.map(i => `<tr>
        <td class="idx-cell" title="${Utils.escapeHtml(i.index)}">${Utils.escapeHtml(i.index)}</td>
        <td>${i.age_days}d</td>
        <td>${i.size}</td>
        <td>${i.phase||'—'}</td>
        <td style="font-family:monospace;font-size:11px">${i.policy||'none'}</td>
      </tr>`).join('')}</tbody>`;
  },
};
window.Diagnostics = Diagnostics;
