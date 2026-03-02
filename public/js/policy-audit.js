const PolicyAudit = {
  data: null,
  expanded: new Set(),

  async render() {
    const el = document.getElementById('page-policyaudit');
    el.innerHTML = '<div class="loading">Auditing ILM policies</div>';
    try {
      const data = await API.policyAudit();
      this.data = data;
      this.renderContent(el);
    } catch(e) {
      el.innerHTML = `<div class="error-msg">Error: ${Utils.escapeHtml(e.message)}</div>`;
    }
  },

  renderContent(el) {
    const { policies, summary } = this.data;
    const sevColor = { critical:'red', high:'orange', warn:'yellow', info:'accent' };

    el.innerHTML = `
      <div class="page-header page-header-row">
        <div>
          <h1>🔍 ILM Policy Conflict Detector</h1>
          <p>Automatically scans every ILM policy for logical errors, broken rollover configs, and dangerous settings.</p>
        </div>
        <button class="refresh-btn" id="pa-refresh">↻ Refresh</button>
      </div>

      <div class="feature-banner">
        <span class="feature-badge">NEW</span>
        Kibana shows you your policies — but never tells you if they're broken. This tool detects phase order conflicts, missing write aliases, dangerous delete phases, deprecated actions, and more.
      </div>

      <div class="stat-grid" style="margin-bottom:20px">
        <div class="stat-card">
          <div class="label">Total Policies</div>
          <div class="value">${summary.total_policies}</div>
        </div>
        <div class="stat-card ${summary.total_critical > 0 ? 'red' : 'green'}">
          <div class="label">Critical Issues</div>
          <div class="value">${summary.total_critical}</div>
        </div>
        <div class="stat-card ${summary.total_high > 0 ? 'orange' : 'green'}">
          <div class="label">High Issues</div>
          <div class="value">${summary.total_high}</div>
        </div>
        <div class="stat-card green">
          <div class="label">Clean Policies</div>
          <div class="value">${summary.clean_policies}</div>
          <div class="sub">out of ${summary.total_policies}</div>
        </div>
      </div>

      <div id="pa-policies">
        ${policies.map(pol => {
          const hasIssues = pol.issues.length > 0;
          const topSev    = pol.critical > 0 ? 'critical' : pol.high > 0 ? 'high' : pol.warn > 0 ? 'warn' : 'info';
          const isOpen    = this.expanded.has(pol.policy);
          return `
          <div class="misconfig-card ${hasIssues ? topSev : ''}" style="margin-bottom:8px">
            <div class="misconfig-header policy-toggle" data-policy="${Utils.escapeHtml(pol.policy)}">
              <div style="flex:1;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                ${hasIssues ? `<span class="badge badge-${sevColor[topSev]||'gray'}">${topSev}</span>` : '<span class="badge badge-green">✓ CLEAN</span>'}
                <strong>${Utils.escapeHtml(pol.policy)}</strong>
                <span class="badge badge-gray">${pol.phase_count} phases</span>
                <span class="badge badge-gray">${pol.index_count} indices</span>
                <span style="font-size:11px;color:#888">${pol.data_size}</span>
              </div>
              <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
                ${pol.critical > 0 ? `<span class="counter-badge critical">${pol.critical} critical</span>` : ''}
                ${pol.high > 0     ? `<span class="counter-badge high">${pol.high} high</span>` : ''}
                ${pol.warn > 0     ? `<span class="counter-badge warn">${pol.warn} warn</span>` : ''}
                <span style="color:#888">${isOpen ? '▴' : '▾'}</span>
              </div>
            </div>
            <div class="misconfig-body" style="display:${isOpen?'block':'none'}">
              ${hasIssues ? pol.issues.map(issue => `
                <div style="border-left:3px solid ${issue.severity==='critical'?'#dc3545':issue.severity==='high'?'#fd7e14':issue.severity==='warn'?'#ffc107':'#2563eb'};padding:10px 14px;margin:10px 0;background:#fafafa;border-radius:0 4px 4px 0">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                    <span class="badge badge-${sevColor[issue.severity]||'gray'}">${issue.severity}</span>
                    <strong style="font-size:13px">${Utils.escapeHtml(issue.title)}</strong>
                  </div>
                  <p style="font-size:12px;color:#555;margin-bottom:6px;line-height:1.6">${Utils.escapeHtml(issue.detail)}</p>
                  <div class="fix-block">// FIX: ${Utils.escapeHtml(issue.fix)}</div>
                </div>
              `).join('') : '<div style="padding:14px;color:#28a745;font-size:13px">✓ No issues found in this policy.</div>'}
            </div>
          </div>`;
        }).join('')}
      </div>
    `;

    el.querySelectorAll('.policy-toggle').forEach(h => {
      h.addEventListener('click', () => {
        const p = h.dataset.policy;
        this.expanded.has(p) ? this.expanded.delete(p) : this.expanded.add(p);
        this.renderContent(el);
      });
    });
    el.querySelector('#pa-refresh')?.addEventListener('click', () => this.render());
  },
};
window.PolicyAudit = PolicyAudit;
