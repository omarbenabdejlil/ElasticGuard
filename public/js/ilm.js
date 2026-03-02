const ILM = {
  data: null,
  filters: { pattern: '' },

  async render() {
    const el = document.getElementById('page-ilm');
    el.innerHTML = '<div class="loading">Loading ILM policies</div>';
    try {
      this.data = await API.ilm(this.filters);
      this.renderContent(el);
    } catch(err) {
      el.innerHTML = `<div class="error-msg">Error: ${Utils.escapeHtml(err.message)}</div>`;
    }
  },

  renderContent(el) {
    const { policies, summary } = this.data;

    el.innerHTML = `
      <div class="page-header page-header-row">
        <div><h1>ILM Policies</h1><p>${summary.total} policies — ${summary.with_issues} with issues</p></div>
        <button class="refresh-btn" id="ilm-refresh">↻ Refresh</button>
      </div>

      <div class="stat-grid">
        <div class="stat-card accent"><div class="label">Total Policies</div><div class="value">${summary.total}</div></div>
        <div class="stat-card ${summary.with_issues > 0 ? 'yellow' : 'green'}"><div class="label">With Issues</div><div class="value">${summary.with_issues}</div></div>
        <div class="stat-card"><div class="label">With Rollover</div><div class="value">${summary.with_rollover}</div></div>
      </div>

      <div class="filter-bar">
        <div class="filter-group"><label>SEARCH</label>
          <input type="text" id="ilm-search" class="search-input" placeholder="Filter by policy name…" value="${Utils.escapeHtml(this.filters.pattern)}">
        </div>
        <div class="filter-group"><label>SHOW</label>
          <select id="ilm-show">
            <option value="all">All</option>
            <option value="issues">With issues only</option>
            <option value="rollover">With rollover</option>
          </select>
        </div>
      </div>

      <div id="ilm-list">
        ${policies.map(p => this.policyCard(p)).join('')}
        ${policies.length === 0 ? '<div class="empty-state"><div class="icon">⟳</div><p>No policies match</p></div>' : ''}
      </div>
    `;

    document.getElementById('ilm-refresh')?.addEventListener('click', () => this.render());
    document.getElementById('ilm-search')?.addEventListener('input', Utils.debounce((e) => {
      this.filters.pattern = e.target.value;
      this.render();
    }, 350));

    // Policy expand
    el.querySelectorAll('.policy-card-header').forEach(header => {
      header.addEventListener('click', () => {
        const body = header.nextElementSibling;
        body.style.display = body.style.display === 'none' ? '' : 'none';
      });
    });

    // Load indices for a policy
    el.querySelectorAll('.load-policy-indices').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const policy = btn.dataset.policy;
        const container = btn.closest('.policy-body').querySelector('.policy-indices');
        btn.textContent = 'Loading…';
        try {
          const data = await API.ilmPolicyIndices(policy);
          container.innerHTML = `
            <table style="margin-top:8px"><thead><tr><th>Index</th><th>Phase</th><th>Action</th><th>Age</th><th>Error</th></tr></thead>
            <tbody>${data.indices.map(i => `<tr>
              <td class="mono" style="font-size:11px">${Utils.escapeHtml(i.index)}</td>
              <td>${Utils.phaseBadge(i.phase)}</td>
              <td><span class="text-muted" style="font-size:11px">${i.action || '—'}</span></td>
              <td class="mono text-muted" style="font-size:11px">${i.age || '—'}</td>
              <td>${i.failed_step ? `<span class="badge badge-red">${Utils.escapeHtml(i.failed_step)}</span>` : '—'}</td>
            </tr>`).join('')}</tbody></table>
          `;
        } catch { btn.textContent = 'Error'; }
      });
    });

    let showFilter = 'all';
    document.getElementById('ilm-show')?.addEventListener('change', (e) => {
      showFilter = e.target.value;
      el.querySelectorAll('.policy-card').forEach(card => {
        const hasIssues = card.dataset.issues === 'true';
        const hasRollover = card.dataset.rollover === 'true';
        let visible = true;
        if (showFilter === 'issues') visible = hasIssues;
        if (showFilter === 'rollover') visible = hasRollover;
        card.style.display = visible ? '' : 'none';
      });
    });
  },

  policyCard(p) {
    const phases = p.phases;
    const phaseDisplay = phases.map(ph => `${Utils.phaseBadge(ph)}`).join(' ');

    return `
      <div class="policy-card" style="margin-bottom:8px" data-issues="${p.issues.length > 0}" data-rollover="${p.has_rollover}">
        <div class="table-wrap">
          <div class="policy-card-header" style="padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:12px">
            <div style="flex:1">
              <div style="font-family:monospace;font-size:14px;font-weight:600">${Utils.escapeHtml(p.name)}</div>
              <div style="font-size:12px;color:#888;margin-top:4px">v${p.version || 1} · modified ${Utils.relativeTime(new Date(p.modified_date).getTime())}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              ${phaseDisplay}
              ${p.has_rollover ? '<span class="badge badge-accent">rollover</span>' : ''}
              ${p.issues.length > 0 ? `<span class="badge badge-yellow">⚠ ${p.issues.length} issue${p.issues.length>1?'s':''}</span>` : '<span class="badge badge-green">✓ clean</span>'}
              <span style="color:#888">▾</span>
            </div>
          </div>
          <div class="policy-body" style="padding:0 16px 16px;display:none">
            ${p.issues.length > 0 ? `
              <div style="margin-bottom:12px">
                ${p.issues.map(iss => `
                  <div class="issue-card ${iss.type}" style="margin-bottom:6px">
                    <div class="issue-header">
                      ${Utils.severityBadge(iss.type)}
                      <span style="font-size:11px;color:#888">phase: ${iss.phase}</span>
                    </div>
                    <div class="issue-msg">${Utils.escapeHtml(iss.msg)}</div>
                  </div>
                `).join('')}
              </div>
            ` : ''}

            <div style="margin-bottom:12px">
              ${Object.entries(p.policy?.phases || {}).map(([ph, phData]) => `
                <div style="margin-bottom:8px">
                  <div style="font-family:monospace;font-size:12px;color:#888;margin-bottom:4px">${ph.toUpperCase()} · min_age: ${phData.min_age || 'immediate'}</div>
                  <div style="display:flex;gap:8px;flex-wrap:wrap">
                    ${Object.keys(phData.actions || {}).map(action => {
                      const cfg = phData.actions[action];
                      const details = action === 'rollover' ? Object.entries(cfg).map(([k,v]) => `${k}: ${v}`).join(', ') : '';
                      return `<span class="badge badge-gray">${action}${details ? `: ${details}` : ''}</span>`;
                    }).join('')}
                  </div>
                </div>
              `).join('')}
            </div>

            <button class="btn btn-ghost btn-sm load-policy-indices" data-policy="${Utils.escapeHtml(p.name)}">Show indices using this policy</button>
            <div class="policy-indices"></div>
          </div>
        </div>
      </div>
    `;
  }
};
window.ILM = ILM;
