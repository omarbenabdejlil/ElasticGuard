const Simulator = {
  nodes: [],
  result: null,

  async render() {
    const el = document.getElementById('page-simulator');
    el.innerHTML = '<div class="loading">Loading nodes</div>';
    try {
      const data = await API.simulatorNodes();
      this.nodes = data.nodes || [];
      this.result = null;
      this.renderContent(el);
    } catch(e) {
      el.innerHTML = `<div class="error-msg">Error: ${Utils.escapeHtml(e.message)}</div>`;
    }
  },

  renderContent(el) {
    const nodes = this.nodes;
    el.innerHTML = `
      <div class="page-header">
        <h1>🧪 Shard Rebalance Simulator</h1>
        <p>Simulate removing a node and see exactly where its shards land — before you touch anything in production.</p>
      </div>

      <div class="feature-banner">
        <span class="feature-badge">NEW</span>
        This feature does not exist in Kibana. Pick any node and ElasticGuard will simulate the full shard redistribution across remaining nodes, flagging any that would cross the 85% or 90% disk watermark.
      </div>

      <div class="section">
        <div class="section-title">Select a node to simulate removal</div>
        <div class="node-grid" style="margin-top:12px">
          ${nodes.map(n => {
            const diskColor = n.disk_pct >= 90 ? 'red' : n.disk_pct >= 85 ? 'yellow' : 'green';
            const roleLabel = (n.roles || []).filter(r => r.startsWith('data') || r === 'master')
              .map(r => r.replace('data_','')).join(' · ') || 'master';
            return `
            <div class="node-card sim-node-card" data-node="${Utils.escapeHtml(n.name)}" style="cursor:pointer">
              <div class="node-name">
                <div class="status-dot ${n.disk_pct >= 90 ? 'red' : n.disk_pct >= 85 ? 'yellow' : 'green'}"></div>
                ${Utils.escapeHtml(n.name)}
                <span class="badge badge-gray" style="font-size:10px">${roleLabel}</span>
              </div>
              <div class="bar-row">
                <div class="bar-label"><span>Disk</span><span class="${'text-'+diskColor}">${n.disk_pct}%</span></div>
                ${Utils.bar(n.disk_pct)}
              </div>
              <div style="display:flex;gap:16px;font-size:11px;color:#888;margin-top:6px">
                <span>CPU ${n.cpu}%</span>
                <span>Heap ${n.heap_pct}%</span>
                <span>${n.shard_count} shards · ${n.shard_bytes_human}</span>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <div id="sim-result" style="margin-top:24px"></div>
    `;

    el.querySelectorAll('.sim-node-card').forEach(card => {
      card.addEventListener('click', () => this.simulate(card.dataset.node, el));
    });
  },

  async simulate(nodeName, el) {
    el.querySelectorAll('.sim-node-card').forEach(c => {
      c.classList.toggle('selected-node', c.dataset.node === nodeName);
    });
    const resultEl = document.getElementById('sim-result');
    resultEl.innerHTML = `<div class="loading">Simulating removal of <strong>${Utils.escapeHtml(nodeName)}</strong></div>`;
    try {
      const data = await API.simulatorRemove(nodeName);
      this.result = data;
      this.renderResult(resultEl, data);
    } catch(e) {
      resultEl.innerHTML = `<div class="error-msg">Simulation error: ${Utils.escapeHtml(e.message)}</div>`;
    }
  },

  renderResult(el, data) {
    const verdictColor = { SAFE: 'green', WARNING: 'yellow', DANGER: 'red' }[data.verdict] || 'gray';
    const verdictIcon  = { SAFE: '✅', WARNING: '⚠️', DANGER: '🚨' }[data.verdict] || '?';

    el.innerHTML = `
      <div class="section-group">
        <div class="section-group-header" style="background:${verdictColor==='red'?'#fff5f5':verdictColor==='yellow'?'#fffdf0':'#f0fff4'}">
          <h3>${verdictIcon} Simulation Result — Remove <strong>${Utils.escapeHtml(data.removed_node.name)}</strong></h3>
        </div>
        <div style="padding:16px">
          <div class="verdict-box verdict-${verdictColor}" style="margin-bottom:16px">
            <strong>${data.verdict}:</strong> ${Utils.escapeHtml(data.verdict_message)}
          </div>

          <div class="stat-grid" style="margin-bottom:16px">
            <div class="stat-card">
              <div class="label">Shards to Move</div>
              <div class="value">${data.summary.total_shards_to_move}</div>
            </div>
            <div class="stat-card">
              <div class="label">Data to Rebalance</div>
              <div class="value" style="font-size:20px">${data.summary.total_bytes_human}</div>
            </div>
            <div class="stat-card ${data.summary.danger_nodes.length > 0 ? 'red' : 'green'}">
              <div class="label">Nodes Over 90%</div>
              <div class="value">${data.summary.danger_nodes.length}</div>
            </div>
            <div class="stat-card ${data.summary.warning_nodes.length > 0 ? 'yellow' : 'green'}">
              <div class="label">Nodes Over 85%</div>
              <div class="value">${data.summary.warning_nodes.length}</div>
            </div>
          </div>

          <div class="section-title" style="margin-bottom:10px">Projected Node State After Removal</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Node</th><th>Before</th><th>After</th><th>Absorbs</th><th>Status</th></tr></thead>
              <tbody>
                ${data.projected_nodes.map(n => `
                  <tr style="${n.status==='DANGER'?'background:#fff5f5':n.status==='WARNING'?'background:#fffdf0':''}">
                    <td class="td-name"><span>${Utils.escapeHtml(n.name)}</span></td>
                    <td class="td-num">${n.old_pct}%</td>
                    <td class="td-num" style="font-weight:bold;color:${n.status==='DANGER'?'#dc3545':n.status==='WARNING'?'#856404':'#28a745'}">${n.new_pct}%</td>
                    <td class="td-num">${n.absorbs_human}</td>
                    <td><span class="badge badge-${n.status==='DANGER'?'red':n.status==='WARNING'?'yellow':'green'}">${n.status}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          ${data.shard_moves.length > 0 ? `
          <div style="margin-top:16px">
            <div class="section-title" style="margin-bottom:8px">Shard Move Plan (first 20)</div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Index</th><th>Shard</th><th>Type</th><th>Size</th><th>Destination</th></tr></thead>
                <tbody>
                  ${data.shard_moves.slice(0,20).map(m => `
                    <tr>
                      <td class="td-name"><span>${Utils.escapeHtml(m.index)}</span></td>
                      <td class="td-num">${m.shard}</td>
                      <td><span class="badge badge-${m.prirep==='p'?'accent':'gray'}">${m.prirep==='p'?'primary':'replica'}</span></td>
                      <td class="td-num">${m.bytes_human}</td>
                      <td style="color:#2563eb">${Utils.escapeHtml(m.to)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              ${data.shard_moves.length > 20 ? `<div style="padding:8px 14px;font-size:12px;color:#888">... and ${data.shard_moves.length - 20} more shard moves</div>` : ''}
            </div>
          </div>` : ''}
        </div>
      </div>
    `;
  },
};
window.Simulator = Simulator;
