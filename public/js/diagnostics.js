const Diagnostics = {
  data: null,
  activeFilter: '',

  async render() {
    const el = document.getElementById('page-diagnostics');
    el.innerHTML = '<div class="loading">Running diagnostics — analyzing cluster health</div>';
    try {
      this.data = await API.diagnostics();
      this.renderContent(el);
    } catch(err) {
      el.innerHTML = `<div class="error-msg">Error: ${Utils.escapeHtml(err.message)}</div>`;
    }
  },

  renderContent(el) {
    const { diagnostics: d, summary } = this.data;

    el.innerHTML = `
      <div class="page-header page-header-row">
        <div>
          <h1>Diagnostics</h1>
          <p>Automated analysis: ILM misconfigs, replica gaps, oversized indices, shard issues</p>
        </div>
        <button class="refresh-btn" id="diag-refresh">↻ Refresh</button>
      </div>

      <div class="stat-grid">
        <div class="stat-card ${summary.critical_issues > 0 ? 'red' : 'green'}">
          <div class="label">Critical Issues</div>
          <div class="value">${summary.critical_issues}</div>
        </div>
        <div class="stat-card ${summary.total_issues > 0 ? 'yellow' : 'green'}">
          <div class="label">Total Issues</div>
          <div class="value">${summary.total_issues}</div>
        </div>
        <div class="stat-card">
          <div class="label">No-Replica Indices</div>
          <div class="value">${summary.no_replica_count}</div>
          <div class="sub">+${summary.no_replica_storage_cost_1x} if 1 replica</div>
        </div>
        <div class="stat-card ${summary.critical_issues === 0 && summary.total_issues === 0 ? 'green' : ''}">
          <div class="label">+2 Replicas Cost</div>
          <div class="value" style="font-size:18px">${summary.no_replica_storage_cost_2x}</div>
          <div class="sub">storage needed</div>
        </div>
      </div>

      <!-- Category filter pills -->
      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
        ${[
          { key: '', label: 'All', count: summary.total_issues },
          { key: 'ilm_alias', label: '🔗 ILM Alias', count: d.ilm_alias_issues.length },
          { key: 'ilm_shard', label: '⚖ Shard Size ILM', count: d.ilm_shard_size_issues.length },
          { key: 'ilm_error', label: '💥 ILM Errors', count: d.ilm_errors.length },
          { key: 'no_replica', label: '⚠ No Replica', count: d.no_replica_indices.length },
          { key: 'unassigned', label: '🔴 Unassigned Shards', count: d.unassigned_shards.length },
          { key: 'oversized', label: '📦 Oversized', count: d.oversized_indices.length },
          { key: 'no_ilm', label: '🚫 No ILM', count: d.no_ilm_indices.length },
          { key: 'shard_issues', label: '⚡ Shard Issues', count: d.shard_issues.length },
          { key: 'empty_old', label: '🗑 Empty Old', count: d.empty_old_indices.length },
        ].map(c => `<button class="diag-filter-btn btn btn-ghost btn-sm${this.activeFilter === c.key ? ' active-filter' : ''}" data-key="${c.key}" style="${c.count > 0 ? '' : 'opacity:0.4'}">
          ${c.label} <span style="color:#2563eb">${c.count}</span>
        </button>`).join('')}
      </div>

      <style>.active-filter { border-color: #2563eb !important; color: #2563eb !important; }</style>

      <div id="diag-sections">
        ${this.renderSection('ilm_alias', '🔗 ILM Rollover Alias Issues', d.ilm_alias_issues, this.renderAliasIssue)}
        ${this.renderSection('ilm_shard', '⚖ Shard-Size ILM Misconfiguration', d.ilm_shard_size_issues, this.renderShardIssue)}
        ${this.renderSection('ilm_error', '💥 ILM Errors / Stuck Indices', d.ilm_errors, this.renderIlmError)}
        ${this.renderSection('no_replica', '⚠ Indices Without Replicas', d.no_replica_indices, this.renderNoReplica)}
        ${this.renderSection('unassigned', '🔴 Unassigned Shards', d.unassigned_shards, this.renderUnassigned)}
        ${this.renderSection('oversized', '📦 Oversized Indices (>100GB)', d.oversized_indices, this.renderOversized)}
        ${this.renderSection('no_ilm', '🚫 Indices Without ILM Policy', d.no_ilm_indices, this.renderNoIlm)}
        ${this.renderSection('shard_issues', '⚡ Shard Count Issues', d.shard_issues, this.renderShardCountIssue)}
        ${this.renderSection('empty_old', '🗑 Empty Indices Older Than 7 Days', d.empty_old_indices, this.renderEmptyOld)}
      </div>
    `;

    document.getElementById('diag-refresh')?.addEventListener('click', () => this.render());

    el.querySelectorAll('.diag-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.activeFilter = btn.dataset.key;
        // Update active state
        el.querySelectorAll('.diag-filter-btn').forEach(b => b.classList.remove('active-filter'));
        btn.classList.add('active-filter');
        // Show/hide sections
        el.querySelectorAll('.diag-section').forEach(sec => {
          const key = sec.dataset.key;
          sec.style.display = (!this.activeFilter || key === this.activeFilter) ? '' : 'none';
        });
      });
    });
  },

  renderSection(key, title, items, rowFn) {
    if (!items.length) return `<div class="diag-section section" data-key="${key}">
      <div class="section-header">
        <div class="section-title">${title} <span class="section-count">0</span></div>
      </div>
      <div class="empty-state" style="padding:20px;text-align:left"><span style="color:#28a745">✓ No issues found</span></div>
    </div>`;

    return `<div class="diag-section section" data-key="${key}">
      <div class="section-header">
        <div class="section-title">${title} <span class="section-count">${items.length}</span></div>
      </div>
      <div class="issue-list">
        ${items.map(item => rowFn(item)).join('')}
      </div>
    </div>`;
  },

  renderAliasIssue: (item) => `
    <div class="issue-card ${item.severity}">
      <div class="issue-header">
        ${Utils.severityBadge(item.severity)}
        <span class="index-name">${Utils.escapeHtml(item.index)}</span>
        ${Utils.phaseBadge(item.phase)}
      </div>
      <div class="issue-msg">${Utils.escapeHtml(item.issue)}</div>
      <div class="issue-meta">
        <span>policy: <strong>${Utils.escapeHtml(item.policy)}</strong></span>
        ${item.rollover_alias ? `<span>alias: <strong>${Utils.escapeHtml(item.rollover_alias)}</strong></span>` : ''}
        <span style="color:#2563eb">Fix: Set index.lifecycle.rollover_alias to a valid write alias, or create the alias with is_write_index=true</span>
      </div>
    </div>
  `,

  renderShardIssue: (item) => `
    <div class="issue-card ${item.severity}">
      <div class="issue-header">
        ${Utils.severityBadge(item.severity)}
        <span class="index-name">${Utils.escapeHtml(item.index)}</span>
        ${Utils.phaseBadge(item.phase)}
      </div>
      <div class="issue-msg">${Utils.escapeHtml(item.issue)}</div>
      <div class="issue-meta">
        <span>policy: <strong>${Utils.escapeHtml(item.policy)}</strong></span>
        <span>current size: <strong>${item.current_size}</strong></span>
        <span>primary shards: <strong>${item.primary_shards}</strong></span>
        <span>max_primary_shard_size: <strong>${item.max_primary_shard_size}</strong></span>
        <span>estimated max index size: <strong style="color:#856404">${item.estimated_max_index_size}</strong></span>
      </div>
      <div style="margin-top:8px;padding:8px 10px;background:rgba(124,58,237,0.1);border-radius:6px;font-size:11px;font-family:monospace;color:#a78bfa">
        💡 Fix: Switch to max_size (total index size) instead of max_primary_shard_size, or add max_age as a fallback condition.
      </div>
    </div>
  `,

  renderIlmError: (item) => `
    <div class="issue-card critical">
      <div class="issue-header">
        ${Utils.severityBadge('critical')}
        <span class="index-name">${Utils.escapeHtml(item.index)}</span>
        ${Utils.phaseBadge(item.phase)}
      </div>
      <div class="issue-msg">Failed at step: <strong>${Utils.escapeHtml(item.failed_step || '—')}</strong> (action: ${Utils.escapeHtml(item.action || '—')})</div>
      ${item.step_info ? `<div style="margin-top:6px;padding:8px;background:rgba(255,77,109,0.08);border-radius:4px;font-family:monospace;font-size:11px;color:#dc3545;white-space:pre-wrap">${Utils.escapeHtml(JSON.stringify(item.step_info, null, 2))}</div>` : ''}
      <div class="issue-meta">
        <span>policy: <strong>${Utils.escapeHtml(item.policy)}</strong></span>
        <span>age: ${item.age || '—'}</span>
        <span>auto-retryable: ${item.retry_failed ? 'yes' : 'no'}</span>
        <span style="color:#2563eb">Fix: POST /${Utils.escapeHtml(item.index)}/_ilm/retry</span>
      </div>
    </div>
  `,

  renderNoReplica: (item) => `
    <div class="issue-card warn">
      <div class="issue-header">
        ${Utils.healthBadge(item.health)}
        <span class="index-name">${Utils.escapeHtml(item.index)}</span>
        ${Utils.phaseBadge(item.phase)}
      </div>
      <div class="issue-meta" style="margin-top:0">
        <span>primary size: <strong>${item.primary_size}</strong></span>
        <span>docs: ${Utils.numFormat(item.docs)}</span>
        <span>policy: ${item.policy ? Utils.escapeHtml(item.policy) : '—'}</span>
      </div>
      <div style="margin-top:8px;display:flex;gap:12px;font-size:12px;font-family:monospace">
        <div style="padding:8px 12px;background:rgba(0,229,160,0.06);border:1px solid rgba(0,229,160,0.15);border-radius:6px">
          <div style="color:#888;margin-bottom:2px">+1 replica cost</div>
          <div style="color:#28a745;font-weight:700">${item.cost_1_replica}</div>
        </div>
        <div style="padding:8px 12px;background:rgba(0,212,255,0.06);border:1px solid rgba(0,212,255,0.15);border-radius:6px">
          <div style="color:#888;margin-bottom:2px">+2 replicas cost</div>
          <div style="color:#2563eb;font-weight:700">${item.cost_2_replicas}</div>
        </div>
      </div>
    </div>
  `,

  renderUnassigned: (item) => `
    <div class="issue-card critical">
      <div class="issue-header">
        ${Utils.severityBadge('critical')}
        <span class="index-name">${Utils.escapeHtml(item.index)}</span>
        <span class="badge ${item.prirep === 'p' ? 'badge-red' : 'badge-yellow'}">${item.prirep === 'p' ? 'Primary' : 'Replica'} shard ${item.shard}</span>
      </div>
      <div class="issue-msg">Shard is UNASSIGNED — ${item.prirep === 'p' ? '⚠️ data may be unavailable' : 'reduced redundancy'}</div>
    </div>
  `,

  renderOversized: (item) => `
    <div class="issue-card warn">
      <div class="issue-header">
        <span class="badge badge-orange">oversized</span>
        <span class="index-name">${Utils.escapeHtml(item.index)}</span>
        ${Utils.phaseBadge(item.phase)}
      </div>
      <div class="issue-meta" style="margin-top:0">
        <span>total: <strong style="color:#fd7e14">${item.size}</strong></span>
        <span>primary: ${item.primary_size}</span>
        <span>shards: ${item.shards}</span>
        <span>docs: ${Utils.numFormat(item.docs)}</span>
        <span>policy: ${item.policy ? Utils.escapeHtml(item.policy) : 'none'}</span>
      </div>
    </div>
  `,

  renderNoIlm: (item) => `
    <div class="issue-card info">
      <div class="issue-header">
        <span class="badge badge-gray">no ILM</span>
        <span class="index-name">${Utils.escapeHtml(item.index)}</span>
        ${item.age_days ? `<span class="text-muted" style="font-size:11px">${item.age_days}d old</span>` : ''}
      </div>
      <div class="issue-meta" style="margin-top:0">
        <span>size: ${item.size}</span>
        <span>docs: ${Utils.numFormat(item.docs)}</span>
        <span style="color:#888">Consider adding an ILM policy for automated lifecycle management</span>
      </div>
    </div>
  `,

  renderShardCountIssue: (item) => `
    <div class="issue-card warn">
      <div class="issue-header">
        <span class="badge badge-yellow">${item.issue === 'too_large' ? 'shards too large' : 'too many shards'}</span>
        <span class="index-name">${Utils.escapeHtml(item.index)}</span>
      </div>
      <div class="issue-msg">${Utils.escapeHtml(item.recommendation)}</div>
      <div class="issue-meta" style="margin-top:4px">
        <span>avg shard: <strong>${item.avg_shard_size}</strong></span>
        <span>total: ${item.total_size}</span>
        <span>primary shards: ${item.primary_shards}</span>
      </div>
    </div>
  `,

  renderEmptyOld: (item) => `
    <div class="issue-card info">
      <div class="issue-header">
        <span class="badge badge-gray">empty</span>
        <span class="index-name">${Utils.escapeHtml(item.index)}</span>
        <span class="text-muted" style="font-size:11px">${item.age_days}d old</span>
      </div>
      <div class="issue-meta" style="margin-top:0">
        <span>size: ${item.size}</span>
        <span>phase: ${item.phase || '—'}</span>
        <span>policy: ${item.policy || 'none'}</span>
        <span style="color:#888">Consider deleting or archiving this empty index</span>
      </div>
    </div>
  `,
};
window.Diagnostics = Diagnostics;
