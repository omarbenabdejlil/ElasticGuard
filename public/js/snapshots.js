const Snapshots = {
  async render() {
    const el = document.getElementById('page-snapshots');
    el.innerHTML = '<div class="loading">Loading jobs & snapshots</div>';
    try {
      const data = await API.snapshots();
      this.renderContent(el, data);
    } catch(err) {
      el.innerHTML = `<div class="error-msg">Error: ${Utils.escapeHtml(err.message)}</div>`;
    }
  },

  renderContent(el, data) {
    el.innerHTML = `
      <div class="page-header page-header-row">
        <div><h1>Jobs & Snapshots</h1><p>Repositories, SLM policies, transforms, ML jobs</p></div>
        <button class="refresh-btn" id="snap-refresh">↻ Refresh</button>
      </div>

      <div class="tabs" id="snap-tabs">
        <div class="tab active" data-tab="repos">Repositories (${data.repositories.length})</div>
        <div class="tab" data-tab="slm">SLM Policies (${data.slm_policies.length})</div>
        <div class="tab" data-tab="tasks">Running Tasks (${data.all_tasks.length})</div>
        <div class="tab" data-tab="transforms">Transforms (${data.transforms.length})</div>
        <div class="tab" data-tab="ml">ML Jobs (${data.ml_jobs.length})</div>
      </div>

      <div id="snap-tab-repos">${this.renderRepos(data)}</div>
      <div id="snap-tab-slm" style="display:none">${this.renderSLM(data)}</div>
      <div id="snap-tab-tasks" style="display:none">${this.renderTasks(data)}</div>
      <div id="snap-tab-transforms" style="display:none">${this.renderTransforms(data)}</div>
      <div id="snap-tab-ml" style="display:none">${this.renderML(data)}</div>
    `;

    document.getElementById('snap-refresh')?.addEventListener('click', () => this.render());

    el.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        el.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        ['repos','slm','tasks','transforms','ml'].forEach(t => {
          const div = document.getElementById(`snap-tab-${t}`);
          if (div) div.style.display = t === tab.dataset.tab ? '' : 'none';
        });
      });
    });
  },

  renderRepos(data) {
    if (!data.repositories.length) return '<div class="empty-state"><div class="icon">◎</div><p>No snapshot repositories configured</p></div>';
    return data.repositories.map(repo => {
      const latest = repo.latest_snapshot;
      const snapshots = data.snapshots[repo.name] || [];
      const succeeded = snapshots.filter(s => s.state === 'SUCCESS').length;
      const failed = snapshots.filter(s => s.state === 'FAILED').length;
      return `
        <div class="table-wrap" style="margin-bottom:16px">
          <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px">
            <div style="flex:1">
              <div style="font-family:var(--mono);font-size:14px;font-weight:600">◎ ${Utils.escapeHtml(repo.name)}</div>
              <div style="font-size:12px;color:var(--text-2);margin-top:2px">type: ${repo.type} · ${repo.snapshots_count} snapshots loaded · ${succeeded} succeeded · ${failed} failed</div>
            </div>
            ${latest ? `<div style="font-size:12px;color:var(--text-2)">Latest: <span class="badge ${latest.state==='SUCCESS'?'badge-green':latest.state==='IN_PROGRESS'?'badge-accent':'badge-red'}">${latest.state}</span> ${latest.snapshot}</div>` : ''}
          </div>
          <table>
            <thead><tr><th>Snapshot</th><th>State</th><th>Start</th><th>Duration</th><th>Indices</th><th>Size</th></tr></thead>
            <tbody>
              ${snapshots.slice(0, 20).map(s => {
                const start = s.start_time_in_millis ? new Date(s.start_time_in_millis) : null;
                const durMs = s.duration_in_millis || (s.end_time_in_millis - s.start_time_in_millis);
                const durSec = durMs ? Math.round(durMs / 1000) : null;
                return `<tr>
                  <td class="mono" style="font-size:12px">${Utils.escapeHtml(s.snapshot)}</td>
                  <td><span class="badge ${s.state==='SUCCESS'?'badge-green':s.state==='IN_PROGRESS'?'badge-accent':s.state==='PARTIAL'?'badge-yellow':'badge-red'}">${s.state}</span></td>
                  <td class="mono text-muted" style="font-size:11px">${start ? start.toLocaleString() : '—'}</td>
                  <td class="mono text-muted" style="font-size:11px">${durSec != null ? (durSec > 3600 ? `${Math.round(durSec/3600)}h` : durSec > 60 ? `${Math.round(durSec/60)}m` : `${durSec}s`) : '—'}</td>
                  <td class="td-num">${s.indices?.length || '—'}</td>
                  <td class="td-num">${s.stats?.total?.size_in_bytes ? Utils.bytesToHuman(s.stats.total.size_in_bytes) : '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }).join('');
  },

  renderSLM(data) {
    if (!data.slm_policies.length) return '<div class="empty-state"><div class="icon">⏱</div><p>No SLM policies configured</p></div>';
    return `<div class="table-wrap"><table>
      <thead><tr><th>Policy</th><th>Repository</th><th>Schedule</th><th>Retention</th><th>Last Success</th><th>Last Failure</th></tr></thead>
      <tbody>
        ${data.slm_policies.map(p => {
          const last = p.last_success;
          const fail = p.last_failure;
          return `<tr>
            <td class="mono" style="font-size:13px;font-weight:600">${Utils.escapeHtml(p.name)}</td>
            <td class="mono text-muted" style="font-size:12px">${Utils.escapeHtml(p.policy?.repository || '—')}</td>
            <td class="mono text-muted" style="font-size:11px">${Utils.escapeHtml(p.policy?.schedule || '—')}</td>
            <td class="mono text-muted" style="font-size:11px">${p.policy?.retention ? JSON.stringify(p.policy.retention) : '—'}</td>
            <td>${last ? `<span class="badge badge-green">✓ ${Utils.relativeTime(last.time_string ? new Date(last.time_string).getTime() : null)}</span>` : '<span class="text-muted">—</span>'}</td>
            <td>${fail ? `<span class="badge badge-red">✗ ${Utils.relativeTime(fail.time_string ? new Date(fail.time_string).getTime() : null)}</span>` : '<span class="badge badge-green">none</span>'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  },

  renderTasks(data) {
    if (!data.all_tasks.length) return '<div class="empty-state"><div class="icon">✓</div><p>No running tasks</p></div>';
    return `<div class="table-wrap"><table>
      <thead><tr><th>Task ID</th><th>Action</th><th>Node</th><th>Running for</th><th>Cancellable</th></tr></thead>
      <tbody>
        ${data.all_tasks.map(t => `<tr>
          <td class="mono text-muted" style="font-size:11px">${Utils.escapeHtml(t.id || '')}</td>
          <td class="mono" style="font-size:12px">${Utils.escapeHtml(t.action || '—')}</td>
          <td class="mono text-muted" style="font-size:11px">${Utils.escapeHtml(t.node || '—')}</td>
          <td class="mono text-muted" style="font-size:11px">${t.running_time_in_nanos ? Math.round(t.running_time_in_nanos / 1e9) + 's' : '—'}</td>
          <td>${t.cancellable ? '<span class="badge badge-yellow">yes</span>' : '<span class="badge badge-gray">no</span>'}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  },

  renderTransforms(data) {
    if (!data.transforms.length) return '<div class="empty-state"><div class="icon">⇄</div><p>No transforms configured</p></div>';
    return `<div class="table-wrap"><table>
      <thead><tr><th>Transform ID</th><th>State</th><th>Progress</th><th>Docs Processed</th><th>Last Updated</th></tr></thead>
      <tbody>
        ${data.transforms.map(t => `<tr>
          <td class="mono" style="font-size:13px">${Utils.escapeHtml(t.id)}</td>
          <td><span class="badge ${t.state==='started'?'badge-green':t.state==='stopped'?'badge-gray':'badge-yellow'}">${t.state}</span></td>
          <td>${t.checkpointing?.next?.checkpoint_progress?.docs_remaining != null ? `${Math.round((1 - t.checkpointing.next.checkpoint_progress.docs_remaining / (t.checkpointing.next.checkpoint_progress.total_docs || 1)) * 100)}%` : '—'}</td>
          <td class="td-num">${Utils.numFormat(t.stats?.documents_processed)}</td>
          <td class="mono text-muted" style="font-size:11px">${t.stats?.last_search_time ? new Date(t.stats.last_search_time).toLocaleString() : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  },

  renderML(data) {
    if (!data.ml_jobs.length) return '<div class="empty-state"><div class="icon">◈</div><p>No ML jobs configured</p></div>';
    return `<div class="table-wrap"><table>
      <thead><tr><th>Job ID</th><th>State</th><th>Processed</th><th>Model bytes</th><th>Last data time</th></tr></thead>
      <tbody>
        ${data.ml_jobs.map(j => `<tr>
          <td class="mono" style="font-size:13px">${Utils.escapeHtml(j.job_id)}</td>
          <td><span class="badge ${j.state==='opened'?'badge-green':j.state==='closed'?'badge-gray':'badge-yellow'}">${j.state}</span></td>
          <td class="td-num">${Utils.numFormat(j.data_counts?.processed_record_count)}</td>
          <td class="td-num">${Utils.bytesToHuman(j.model_size_stats?.model_bytes)}</td>
          <td class="mono text-muted" style="font-size:11px">${j.data_counts?.last_data_time ? new Date(j.data_counts.last_data_time).toLocaleString() : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  }
};
window.Snapshots = Snapshots;
