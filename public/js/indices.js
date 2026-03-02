const Indices = {
  data: null,
  filters: { phase: '', tier: '', status: '', pattern: '', replica: '', sort: 'size_bytes', order: 'desc' },
  page: 1,
  perPage: 50,

  async load() {
    this.data = await API.indices(this.filters);
  },

  async render() {
    const el = document.getElementById('page-indices');
    el.innerHTML = '<div class="loading">Loading indices</div>';
    try {
      await this.load();
      this.renderContent(el);
    } catch(err) {
      el.innerHTML = `<div class="error-msg">Error: ${Utils.escapeHtml(err.message)}</div>`;
    }
  },

  renderContent(el) {
    const { indices, summary } = this.data;
    const paged = Utils.paginate(indices, this.page, this.perPage);

    el.innerHTML = `
      <div class="page-header page-header-row">
        <div><h1>Indices</h1><p>${summary.total} total indices — ${summary.filtered} shown</p></div>
        <button class="refresh-btn" id="idx-refresh">↻ Refresh</button>
      </div>

      <div class="stat-grid">
        <div class="stat-card green"><div class="label">Green</div><div class="value">${summary.health.green || 0}</div></div>
        <div class="stat-card yellow"><div class="label">Yellow</div><div class="value">${summary.health.yellow || 0}</div></div>
        <div class="stat-card red"><div class="label">Red</div><div class="value">${summary.health.red || 0}</div></div>
        <div class="stat-card accent"><div class="label">Total Size</div><div class="value" style="font-size:18px">${Utils.bytesToHuman(summary.total_size_bytes)}</div></div>
        ${Object.entries(summary.phases).map(([phase,count]) => `<div class="stat-card"><div class="label">${phase}</div><div class="value">${count}</div><div class="sub">phase</div></div>`).join('')}
      </div>

      ${this.renderFilterBar(summary)}

      <div class="table-wrap">
        <div class="table-toolbar">
          <span>Showing ${paged.items.length} of ${summary.filtered} indices</span>
          <div style="display:flex;gap:8px">
            <input type="text" class="search-input" id="idx-search" placeholder="Filter by name…" value="${Utils.escapeHtml(this.filters.pattern)}">
          </div>
        </div>
        <table>
          <thead><tr>
            <th data-sort="index">Index</th>
            <th data-sort="health">Health</th>
            <th data-sort="ilm_phase">Phase</th>
            <th data-sort="tier">Tier</th>
            <th data-sort="ilm_policy">ILM Policy</th>
            <th data-sort="size_bytes" class="sort-desc">Size</th>
            <th data-sort="primary_size_bytes">Primary Size</th>
            <th data-sort="docs">Docs</th>
            <th data-sort="primary_shards">Shards</th>
            <th data-sort="replicas">Replicas</th>
            <th>Alias</th>
            <th>Issues</th>
          </tr></thead>
          <tbody>
            ${paged.items.map(idx => this.row(idx)).join('')}
          </tbody>
        </table>
        <div class="pagination" id="idx-pagination"></div>
      </div>
    `;

    Utils.renderPagination(document.getElementById('idx-pagination'), this.page, paged.pages, (p) => {
      this.page = p; this.renderContent(el);
    });

    // Events
    document.getElementById('idx-refresh')?.addEventListener('click', () => this.render());

    // Filter bar events
    el.querySelectorAll('.filter-bar select').forEach(sel => {
      sel.addEventListener('change', () => {
        this.filters[sel.dataset.filter] = sel.value;
        this.page = 1; this.render();
      });
    });

    // Sort
    el.querySelectorAll('thead th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const s = th.dataset.sort;
        if (this.filters.sort === s) this.filters.order = this.filters.order === 'desc' ? 'asc' : 'desc';
        else { this.filters.sort = s; this.filters.order = 'desc'; }
        this.page = 1; this.render();
      });
    });

    // Search debounced
    const searchInput = document.getElementById('idx-search');
    searchInput?.addEventListener('input', Utils.debounce(() => {
      this.filters.pattern = searchInput.value;
      this.page = 1; this.render();
    }, 350));

    // Click row for detail
    el.querySelectorAll('tbody tr').forEach(tr => {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => {
        const idx = tr.dataset.index;
        if (idx) Indices.showDetail(idx);
      });
    });
  },

  renderFilterBar(summary) {
    const phases = Object.keys(summary.phases);
    const tiers = Object.keys(summary.tiers);
    return `
      <div class="filter-bar">
        <div class="filter-group"><label>PHASE</label>
          <select data-filter="phase">
            <option value="">All</option>
            ${phases.map(p => `<option value="${p}" ${this.filters.phase===p?'selected':''}>${p}</option>`).join('')}
          </select>
        </div>
        <div class="filter-sep"></div>
        <div class="filter-group"><label>TIER</label>
          <select data-filter="tier">
            <option value="">All</option>
            ${tiers.map(t => `<option value="${t}" ${this.filters.tier===t?'selected':''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="filter-sep"></div>
        <div class="filter-group"><label>HEALTH</label>
          <select data-filter="status">
            <option value="">All</option>
            <option value="green" ${this.filters.status==='green'?'selected':''}>green</option>
            <option value="yellow" ${this.filters.status==='yellow'?'selected':''}>yellow</option>
            <option value="red" ${this.filters.status==='red'?'selected':''}>red</option>
          </select>
        </div>
        <div class="filter-sep"></div>
        <div class="filter-group"><label>REPLICAS</label>
          <select data-filter="replica">
            <option value="">All</option>
            <option value="0" ${this.filters.replica==='0'?'selected':''}>No replica</option>
            <option value="gt0" ${this.filters.replica==='gt0'?'selected':''}>Has replica</option>
          </select>
        </div>
      </div>
    `;
  },

  row(idx) {
    const issues = [];
    if (!idx.ilm_managed) issues.push('<span class="badge badge-gray">no ILM</span>');
    if (idx.ilm_error) issues.push('<span class="badge badge-red">ILM error</span>');
    if (idx.replicas === 0) issues.push('<span class="badge badge-yellow">no replica</span>');
    if (!idx.rollover_alias && idx.ilm_managed) issues.push('<span class="badge badge-orange">no alias</span>');

    return `
      <tr data-index="${Utils.escapeHtml(idx.index)}">
        <td class="td-name"><span title="${Utils.escapeHtml(idx.index)}">${Utils.escapeHtml(idx.index)}</span></td>
        <td>${Utils.healthBadge(idx.health)}</td>
        <td>${Utils.phaseBadge(idx.ilm_phase)}</td>
        <td>${idx.tier ? `<span class="badge badge-${idx.tier === 'hot' ? 'red' : idx.tier === 'warm' ? 'orange' : idx.tier === 'cold' ? 'accent' : 'purple'}">${idx.tier}</span>` : '<span class="text-muted">—</span>'}</td>
        <td class="mono" style="font-size:11px;color:var(--text-1)">${idx.ilm_policy ? Utils.escapeHtml(idx.ilm_policy) : '<span class="text-muted">—</span>'}</td>
        <td class="td-num">${Utils.bytesToHuman(idx.size_bytes)}</td>
        <td class="td-num">${Utils.bytesToHuman(idx.primary_size_bytes)}</td>
        <td class="td-num">${Utils.numFormat(idx.docs)}</td>
        <td class="td-num">${idx.primary_shards}</td>
        <td class="td-num" style="color:${idx.replicas === 0 ? 'var(--yellow)' : 'var(--text-1)'}">${idx.replicas}</td>
        <td style="font-size:11px;color:var(--text-2)">${idx.rollover_alias ? `<span class="badge badge-green">${Utils.escapeHtml(idx.rollover_alias)}</span>` : '—'}</td>
        <td>${issues.join(' ')}</td>
      </tr>
    `;
  },

  async showDetail(indexName) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay active';
    modal.innerHTML = `<div class="modal-box" style="width:700px;max-height:80vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="font-size:16px;font-family:var(--mono)">${Utils.escapeHtml(indexName)}</h2>
        <button class="btn btn-ghost btn-sm" id="close-detail">✕ Close</button>
      </div>
      <div class="loading">Loading detail</div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#close-detail').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    try {
      const data = await API.indexDetail(indexName);
      const ilm = data.ilm || {};
      const st = data.stats?.total || {};
      const content = modal.querySelector('.modal-box div:last-child');
      content.innerHTML = `
        <div class="tabs" id="detail-tabs">
          <div class="tab active" data-tab="overview">Overview</div>
          <div class="tab" data-tab="ilm">ILM</div>
          <div class="tab" data-tab="shards">Shards (${data.shards?.length || 0})</div>
        </div>
        <div id="detail-tab-overview">
          <div class="kv-grid" style="margin-bottom:16px">
            <span class="kv-key">Docs</span><span class="kv-val">${Utils.numFormat(st.docs?.count)}</span>
            <span class="kv-key">Store Size</span><span class="kv-val">${Utils.bytesToHuman(st.store?.size_in_bytes)}</span>
            <span class="kv-key">Primary Size</span><span class="kv-val">${Utils.bytesToHuman(st.store?.total_data_set_size_in_bytes)}</span>
            <span class="kv-key">Segments</span><span class="kv-val">${st.segments?.count}</span>
            <span class="kv-key">Indexing (total)</span><span class="kv-val">${Utils.numFormat(st.indexing?.index_total)}</span>
            <span class="kv-key">Search queries</span><span class="kv-val">${Utils.numFormat(st.search?.query_total)}</span>
            <span class="kv-key">Refresh total</span><span class="kv-val">${Utils.numFormat(st.refresh?.total)}</span>
          </div>
        </div>
        <div id="detail-tab-ilm" style="display:none">
          <div class="kv-grid">
            <span class="kv-key">Policy</span><span class="kv-val">${ilm.policy || '—'}</span>
            <span class="kv-key">Phase</span><span class="kv-val">${Utils.phaseBadge(ilm.phase)}</span>
            <span class="kv-key">Action</span><span class="kv-val">${ilm.action || '—'}</span>
            <span class="kv-key">Step</span><span class="kv-val">${ilm.step || '—'}</span>
            <span class="kv-key">Age</span><span class="kv-val">${ilm.age || '—'}</span>
            <span class="kv-key">Failed step</span><span class="kv-val" style="color:var(--red)">${ilm.failed_step || '—'}</span>
            <span class="kv-key">Rollover alias</span><span class="kv-val">${data.settings?.index?.['lifecycle.rollover_alias'] || '—'}</span>
          </div>
          ${ilm.step_info ? `<div style="margin-top:12px;padding:10px;background:var(--bg-2);border-radius:6px;font-family:var(--mono);font-size:11px;color:var(--red)">${Utils.escapeHtml(JSON.stringify(ilm.step_info, null, 2))}</div>` : ''}
        </div>
        <div id="detail-tab-shards" style="display:none">
          <table><thead><tr><th>Shard</th><th>P/R</th><th>State</th><th>Size</th><th>Docs</th><th>Node</th></tr></thead>
          <tbody>${(data.shards || []).map(s => `<tr>
            <td class="td-num">${s.shard}</td>
            <td><span class="badge ${s.prirep==='p'?'badge-accent':'badge-gray'}">${s.prirep==='p'?'Primary':'Replica'}</span></td>
            <td><span class="badge ${s.state==='STARTED'?'badge-green':s.state==='UNASSIGNED'?'badge-red':'badge-yellow'}">${s.state}</span></td>
            <td class="td-num">${Utils.bytesToHuman(parseInt(s.store))}</td>
            <td class="td-num">${Utils.numFormat(parseInt(s.docs))}</td>
            <td class="mono" style="font-size:11px">${Utils.escapeHtml(s.node || 'unassigned')}</td>
          </tr>`).join('')}</tbody></table>
        </div>
      `;

      // Tab switching
      modal.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          modal.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          ['overview','ilm','shards'].forEach(t => {
            const el2 = modal.querySelector(`#detail-tab-${t}`);
            if (el2) el2.style.display = t === tab.dataset.tab ? '' : 'none';
          });
        });
      });
    } catch(err) {
      modal.querySelector('.loading')?.remove();
    }
  }
};
window.Indices = Indices;
