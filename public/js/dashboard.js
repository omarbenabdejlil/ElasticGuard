const Dashboard = {
  async render() {
    const el = document.getElementById('page-dashboard');
    el.innerHTML = '<div class="loading">Loading cluster data</div>';
    try {
      const data = await API.clusterStatus();
      const h = data.health;
      const s = data.stats;

      const totalDisk = data.nodes.reduce((a,n) => a + (n.disk_total || 0), 0);
      const availDisk = data.nodes.reduce((a,n) => a + (n.disk_available || 0), 0);
      const usedDisk = totalDisk - availDisk;
      const diskPct = totalDisk ? Math.round(usedDisk / totalDisk * 100) : 0;

      // Fetch relocation data for alerts
      let relocationShards = [];
      let unassignedDetail = [];
      try {
        const relJson = await API.get('/api/relocation');
        relocationShards = relJson.shards || [];
      } catch(e) {}

      const unassignedPrimary = h.unassigned_shards > 0;
      const nodesHighDisk  = data.nodes.filter(n => n.disk_used_pct > 85);
      const nodesHighHeap  = data.nodes.filter(n => n.heap_used_pct > 85);
      const nodesHighCpu   = data.nodes.filter(n => n.os_cpu > 90);

      const alerts = [];
      if (h.status === 'red')
        alerts.push({ level:'red',   icon:'🔴', msg: `Cluster is <strong>RED</strong> — one or more primary shards unassigned. Data may be unavailable.` });
      if (h.status === 'yellow')
        alerts.push({ level:'yellow', icon:'🟡', msg: `Cluster is <strong>YELLOW</strong> — some replica shards unassigned.` });
      if (h.unassigned_shards > 0)
        alerts.push({ level: unassignedPrimary ? 'red' : 'yellow', icon: unassignedPrimary ? '🔴' : '🟡', msg: `<strong>${h.unassigned_shards} unassigned shard${h.unassigned_shards>1?'s':''}</strong> detected. <a href="#" onclick="document.querySelector('.nav-link[data-page=diagnostics]').click();return false;" style="color:inherit;text-decoration:underline">View in Diagnostics →</a>` });
      if (relocationShards.length > 0)
        alerts.push({ level:'info', icon:'🔵', msg: `<strong>${relocationShards.length} shard${relocationShards.length>1?'s':''} relocating</strong> — ${[...new Set(relocationShards.map(r=>r.index))].length} indices affected. <a href="#" onclick="document.querySelector('.nav-link[data-page=relocation]').click();return false;" style="color:inherit;text-decoration:underline">View in Relocation Monitor →</a>` });
      if (nodesHighDisk.length > 0)
        alerts.push({ level:'red',   icon:'💾', msg: `<strong>${nodesHighDisk.length} node${nodesHighDisk.length>1?'s':''}</strong> above 85% disk: ${nodesHighDisk.map(n=>n.name).join(', ')}` });
      if (nodesHighHeap.length > 0)
        alerts.push({ level:'yellow', icon:'🧠', msg: `<strong>${nodesHighHeap.length} node${nodesHighHeap.length>1?'s':''}</strong> above 85% heap: ${nodesHighHeap.map(n=>n.name).join(', ')}` });
      if (nodesHighCpu.length > 0)
        alerts.push({ level:'yellow', icon:'⚡', msg: `<strong>${nodesHighCpu.length} node${nodesHighCpu.length>1?'s':''}</strong> above 90% CPU: ${nodesHighCpu.map(n=>n.name).join(', ')}` });

      const alertColors = {
        red:    { bg:'#fef2f2', border:'#fca5a5', text:'#7f1d1d' },
        yellow: { bg:'#fffbeb', border:'#fcd34d', text:'#78350f' },
        info:   { bg:'#eff6ff', border:'#93c5fd', text:'#1e3a5f' },
      };

      const alertsHtml = alerts.length === 0
        ? `<div style="display:flex;align-items:center;gap:10px;padding:14px 18px;background:#f0fdf4;border:1px solid #86efac;border-radius:10px;color:#14532d;font-size:13px;font-weight:500">
            ✅ <span>All systems healthy — no active alerts</span>
           </div>`
        : alerts.map(a => {
            const c = alertColors[a.level] || alertColors.info;
            return `<div style="display:flex;align-items:flex-start;gap:12px;padding:13px 16px;background:${c.bg};border:1px solid ${c.border};border-radius:10px;color:${c.text};font-size:13px;line-height:1.5">
              <span style="font-size:16px;flex-shrink:0">${a.icon}</span>
              <span>${a.msg}</span>
            </div>`;
          }).join('');

      el.innerHTML = `
        <div class="page-header page-header-row">
          <div>
            <h1>Dashboard</h1>
            <p>Cluster overview &amp; node health</p>
          </div>
          <button class="refresh-btn" id="dash-refresh">↻ Refresh</button>
        </div>

        <div class="stat-grid">
          <div class="stat-card ${h.status}">
            <div class="label">Cluster Status</div>
            <div class="value" style="font-size:18px">${Utils.healthBadge(h.status)}</div>
            <div class="sub">${h.cluster_name}</div>
          </div>
          <div class="stat-card accent">
            <div class="label">Indices</div>
            <div class="value">${Utils.numFormat(s.indices_count)}</div>
            <div class="sub">${Utils.numFormat(s.docs_count)} docs</div>
          </div>
          <div class="stat-card accent">
            <div class="label">Total Store</div>
            <div class="value" style="font-size:20px">${Utils.bytesToHuman(s.store_size_bytes)}</div>
            <div class="sub">${Utils.bytesToHuman(usedDisk)} used of ${Utils.bytesToHuman(totalDisk)}</div>
          </div>
          <div class="stat-card">
            <div class="label">Nodes</div>
            <div class="value">${h.number_of_nodes}</div>
            <div class="sub">${h.number_of_data_nodes} data nodes</div>
          </div>
          <div class="stat-card ${h.active_shards > 0 ? '' : 'yellow'}">
            <div class="label">Active Shards</div>
            <div class="value">${Utils.numFormat(h.active_shards)}</div>
            <div class="sub">${h.active_primary_shards} primary</div>
          </div>
          <div class="stat-card ${h.unassigned_shards > 0 ? 'red' : 'green'}">
            <div class="label">Unassigned</div>
            <div class="value">${h.unassigned_shards}</div>
            <div class="sub">${h.relocating_shards} relocating</div>
          </div>
          <div class="stat-card ${h.initializing_shards > 0 ? 'yellow' : ''}">
            <div class="label">Initializing</div>
            <div class="value">${h.initializing_shards}</div>
            <div class="sub">shards</div>
          </div>
          <div class="stat-card ${diskPct > 85 ? 'red' : diskPct > 70 ? 'yellow' : 'green'}">
            <div class="label">Disk Used</div>
            <div class="value">${diskPct}%</div>
            <div class="sub">${Utils.bytesToHuman(availDisk)} free</div>
          </div>
        </div>

        <div class="section" style="margin-bottom:24px">
          <div class="section-header">
            <div class="section-title">🚨 Cluster Alerts <span class="section-count">${alerts.length} active</span></div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${alertsHtml}
          </div>
        </div>

        <div class="section">
          <div class="section-header">
            <div class="section-title">⬡ Nodes <span class="section-count">${data.nodes.length} nodes</span></div>
          </div>
          <div class="node-grid">
            ${data.nodes.map(n => Dashboard.nodeCard(n)).join('')}
          </div>
        </div>
      `;

      document.getElementById('dash-refresh')?.addEventListener('click', () => Dashboard.render());

      const badge = document.getElementById('cluster-name-nav');
      if (badge) badge.textContent = h.cluster_name;
      const dot = document.querySelector('.cluster-badge .status-dot');
      if (dot) { dot.className = 'status-dot ' + (h.status === 'green' ? 'green' : h.status === 'yellow' ? 'yellow' : 'red'); }

    } catch(err) {
      el.innerHTML = `<div class="error-msg">Error: ${Utils.escapeHtml(err.message)}</div>`;
    }
  },

  nodeCard(n) {
    const roles = (n.roles || []).map(r => `<span class="badge badge-${r === 'master' || r === 'cluster_manager' ? 'accent' : r === 'data_hot' ? 'red' : r.includes('warm') ? 'orange' : r.includes('cold') ? 'purple' : 'gray'}">${r.replace('data_','')}</span>`).join('');
    const cpuColor = n.os_cpu > 85 ? 'red' : n.os_cpu > 65 ? 'yellow' : 'green';
    const heapColor = n.heap_used_pct > 85 ? 'red' : n.heap_used_pct > 75 ? 'yellow' : 'green';
    const diskColor = n.disk_used_pct > 85 ? 'red' : n.disk_used_pct > 70 ? 'yellow' : 'green';

    return `
      <div class="node-card">
        <div class="node-name"><span class="status-dot green"></span>${Utils.escapeHtml(n.name)}</div>
        <div class="node-roles">${roles}</div>
        ${n.os_cpu != null ? `
          <div class="bar-row">
            <div class="bar-label"><span>CPU</span><span>${n.os_cpu}%</span></div>
            ${Utils.bar(n.os_cpu, cpuColor)}
          </div>` : ''}
        ${n.heap_used_pct != null ? `
          <div class="bar-row">
            <div class="bar-label"><span>Heap</span><span>${n.heap_used_pct}%</span></div>
            ${Utils.bar(n.heap_used_pct, heapColor)}
          </div>` : ''}
        ${n.disk_used_pct != null ? `
          <div class="bar-row">
            <div class="bar-label"><span>Disk</span><span>${n.disk_used_pct}% (${Utils.bytesToHuman(n.disk_available)} free)</span></div>
            ${Utils.bar(n.disk_used_pct, diskColor)}
          </div>` : ''}
      </div>
    `;
  }
};
window.Dashboard = Dashboard;
