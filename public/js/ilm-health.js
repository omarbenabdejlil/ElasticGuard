// ─── ILM Health Page ─────────────────────────────────────────────────────────
const ILMHealth = {
  data: null,
  activeTab: 'misconfigs',
  filters: { phase: '', policy: '', search: '' },
  expandedCards: new Set(),
  page: 1,
  perPage: 50,

  async render() {
    const el = document.getElementById('page-ilmhealth');
    if (!el) return;
    el.innerHTML = '<div class="loading">Analyzing ILM health across cluster</div>';
    try {
      this.data = await API.ilmHealth(this.filters);
      if (this.data.error) throw new Error(this.data.error);
      this.renderContent(el);
    } catch(err) {
      el.innerHTML = `<div class="error-msg">Error: ${Utils.escapeHtml(err.message)}</div>`;
    }
  },

  renderContent(el) {
    const { summary, phases, policies, nodes, misconfigurations, indices } = this.data;
    const total = summary.total_misconfigs || 0;
    const crit  = summary.critical_misconfigs || 0;
    const mc    = misconfigurations || {};

    const cnt = (arr) => arr?.length || 0;

    el.innerHTML = `
      <div class="page-header page-header-row">
        <div>
          <h1>ILM Health</h1>
          <p>// data consumption by phase &amp; node · misconfiguration audit · alias validation</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <select id="ilmh-phase-filter" style="background:#f8f9fa;border:1px solid #ddd;border-radius:4px;padding:5px 10px;color:#222;font-family:monospace;font-size:12px;cursor:pointer">
            <option value="">All phases</option>
            ${['hot','warm','cold','frozen','delete','unmanaged'].map(p =>
              `<option value="${p}" ${this.filters.phase===p?'selected':''}>${p}</option>`
            ).join('')}
          </select>
          <input type="text" id="ilmh-search" placeholder="Search index / policy…" value="${Utils.escapeHtml(this.filters.search)}"
            style="background:#f8f9fa;border:1px solid #ddd;border-radius:4px;padding:5px 10px;color:#222;font-family:monospace;font-size:12px;min-width:180px">
          <button class="refresh-btn" id="ilmh-refresh">↻ Refresh</button>
        </div>
      </div>

      <!-- Stats row -->
      <div class="stat-grid" style="margin-bottom:20px">
        <div class="stat-card accent">
          <div class="label">Managed Indices</div>
          <div class="value">${summary.managed_indices}</div>
          <div class="sub">${summary.total_policies} policies</div>
        </div>
        <div class="stat-card">
          <div class="label">Total Managed Size</div>
          <div class="value" style="font-size:20px">${summary.total_managed_size}</div>
        </div>
        <div class="stat-card ${crit>0?'red':total>0?'yellow':'green'}">
          <div class="label">Critical Issues</div>
          <div class="value">${crit}</div>
          <div class="sub">${total} total misconfigs</div>
        </div>
        <div class="stat-card ${cnt(mc.missing_alias)+cnt(mc.alias_not_exists)>0?'red':'green'}">
          <div class="label">Alias Errors</div>
          <div class="value">${cnt(mc.missing_alias)+cnt(mc.alias_not_exists)}</div>
          <div class="sub">${cnt(mc.alias_not_write)} not write alias</div>
        </div>
        <div class="stat-card ${cnt(mc.no_rollover_by_size)>0?'orange':'green'}">
          <div class="label">Bad Rollover</div>
          <div class="value">${cnt(mc.no_rollover_by_size)}</div>
          <div class="sub">shard-size / docs-only</div>
        </div>
        <div class="stat-card ${cnt(mc.no_rollover_at_all)>0?'yellow':'green'}">
          <div class="label">No Rollover</div>
          <div class="value">${cnt(mc.no_rollover_at_all)}</div>
          <div class="sub">index grows unbounded</div>
        </div>
      </div>

      <!-- Phase swimlane -->
      ${this.renderPhaseSwimlane(phases, summary)}

      <!-- Tabs -->
      <div class="tabs" id="ilmh-tabs">
        <div class="tab ${this.activeTab==='misconfigs'?'active':''}" data-tab="misconfigs">
          ⚠ Misconfigurations ${total>0?`<span class="counter-badge ${crit>0?'critical':'warn'}" style="margin-left:6px">${total}</span>`:''}
        </div>
        <div class="tab ${this.activeTab==='nodes'?'active':''}" data-tab="nodes">
          🖥 Node Consumption <span class="counter-badge ok" style="margin-left:6px">${nodes?.length||0}</span>
        </div>
        <div class="tab ${this.activeTab==='policies'?'active':''}" data-tab="policies">
          ⟳ Policy Stats <span class="counter-badge ok" style="margin-left:6px">${policies?.length||0}</span>
        </div>
        <div class="tab ${this.activeTab==='indices'?'active':''}" data-tab="indices">
          ⊞ Index Audit <span class="counter-badge ok" style="margin-left:6px">${indices?.length||0}</span>
        </div>
      </div>

      <div id="ilmh-tab-misconfigs" style="display:${this.activeTab==='misconfigs'?'':'none'}">${this.renderMisconfigs(mc)}</div>
      <div id="ilmh-tab-nodes"      style="display:${this.activeTab==='nodes'?'':'none'}">${this.renderNodes(nodes, phases)}</div>
      <div id="ilmh-tab-policies"   style="display:${this.activeTab==='policies'?'':'none'}">${this.renderPolicies(policies)}</div>
      <div id="ilmh-tab-indices"    style="display:${this.activeTab==='indices'?'':'none'}">${this.renderIndicesTable(indices)}</div>
    `;

    this.bindEvents(el);

    // ── BUG FIX: only render pagination when indices tab is visible ──
    if (this.activeTab === 'indices') {
      this.rebuildPagination(el, indices);
    }
  },

  // ── Pagination helper (safe — only called when element exists) ─────────────
  rebuildPagination(el, indices) {
    const paginationEl = document.getElementById('ilmh-pagination');
    if (!paginationEl) return;

    const search = this.filters.search.toLowerCase();
    const phaseF = this.filters.phase;
    let filtered = indices || [];
    if (search) filtered = filtered.filter(i => i.index.includes(search) || (i.policy||'').includes(search));
    if (phaseF)  filtered = filtered.filter(i => i.phase === phaseF);

    Utils.renderPagination(paginationEl, this.page, Math.ceil(filtered.length / this.perPage), (p) => {
      this.page = p;
      this.renderContent(el);
    });
  },

  // ── Phase Swimlane ──────────────────────────────────────────────────────────
  renderPhaseSwimlane(phases, summary) {
    if (!phases?.length) return '';
    const totalBytes = phases.reduce((s,p) => s+p.size_bytes, 0) || 1;
    const order  = ['hot','warm','cold','frozen','delete','unknown','unmanaged'];
    const colors = { hot:'#dc3545', warm:'#fd7e14', cold:'#2563eb', frozen:'#6f42c1', delete:'#888', unknown:'#ccc', unmanaged:'#ddd' };
    const sorted = [...phases].sort((a,b) => {
      const ai=order.indexOf(a.phase), bi=order.indexOf(b.phase);
      return (ai===-1?99:ai)-(bi===-1?99:bi);
    });

    return `
      <div class="section-group" style="margin-bottom:20px">
        <div class="section-group-header">
          <h3>📊 Data Distribution by ILM Phase</h3>
          <span style="font-size:11px;font-family:monospace;color:#888">${summary.total_managed_size} total managed</span>
        </div>
        <div style="padding:16px 20px">
          <div style="display:flex;height:26px;border-radius:6px;overflow:hidden;gap:1px;margin-bottom:16px">
            ${sorted.map(p => {
              const pct = p.size_bytes/totalBytes*100;
              if (pct < 0.5) return '';
              const c = colors[p.phase]||'#888';
              return `<div style="flex:${p.size_bytes};background:${c};display:flex;align-items:center;justify-content:center;min-width:0;overflow:hidden" title="${p.phase}: ${Utils.bytesToHuman(p.size_bytes)} (${pct.toFixed(1)}%)">
                ${pct>6?`<span style="font-size:10px;font-family:monospace;font-weight:700;color:#fff;white-space:nowrap">${p.phase} ${pct.toFixed(0)}%</span>`:''}
              </div>`;
            }).join('')}
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:8px">
            ${sorted.map(p => {
              const pct = p.size_bytes/totalBytes*100;
              const c = colors[p.phase]||'#888';
              return `<div style="background:#f8f9fa;border:1px solid #ddd;border-radius:4px;padding:12px;border-top:3px solid ${c}">
                <div style="font-family:monospace;font-size:10px;font-weight:700;color:${c};text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">${p.phase}</div>
                <div style="font-family:Arial, sans-serif;font-size:20px;font-weight:700;margin-bottom:2px">${Utils.bytesToHuman(p.size_bytes)}</div>
                <div style="font-size:10px;color:#888;font-family:monospace">${p.count} indices · ${pct.toFixed(1)}%</div>
                <div style="font-size:10px;color:#888;margin-top:3px">${Utils.numFormat(p.docs)} docs</div>
                <div style="margin-top:8px;background:#fff;border-radius:3px;height:3px"><div style="width:${Math.min(pct,100)}%;height:100%;background:${c}"></div></div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;
  },

  // ── Misconfigurations ───────────────────────────────────────────────────────
  renderMisconfigs(mc) {
    const sections = [
      { key:'missing_alias',       sev:'critical', title:'🔴 Missing Rollover Alias — rollover_alias not set',               desc:'These indices use a rollover policy but <strong>index.lifecycle.rollover_alias is not configured at all</strong>. ILM cannot roll them over — they will grow forever.', render: (items) => this.renderAliasCards(items,'missing') },
      { key:'alias_not_exists',    sev:'critical', title:'🔴 Rollover Alias Does Not Exist in Cluster',                       desc:'A rollover alias is configured but <strong>the alias does not actually exist</strong> in the cluster. Every rollover attempt will fail silently.', render: (items) => this.renderAliasCards(items,'not_exists') },
      { key:'alias_not_write',     sev:'high',     title:'🟠 Alias Exists but is NOT a Write Alias',                          desc:'The alias exists but <strong>is_write_index is not set to true</strong>. Rollover requires a designated write alias to switch new writes.', render: (items) => this.renderAliasCards(items,'not_write') },
      { key:'no_rollover_by_size', sev:'high',     title:'🟠 Rollover Uses Shard Size / max_docs — Total Index Size Unbounded', desc:'Using <strong>max_primary_shard_size</strong> or <strong>max_docs</strong> instead of <strong>max_size</strong>. The bar shows current size vs the effective per-policy limit.', render: (items) => this.renderShardSizeCards(items) },
      { key:'no_rollover_at_all',  sev:'warn',     title:'🟡 ILM Policy Has No Rollover Action',                              desc:'These indices have ILM but <strong>the policy defines no rollover</strong>. The index grows until a delete phase removes it.', render: (items) => this.renderNoRolloverTable(items) },
    ];

    const total = sections.reduce((s,sec) => s + (mc[sec.key]?.length||0), 0);
    if (!total) return `
      <div class="empty-state" style="padding:80px">
        <div class="icon">✅</div>
        <p style="margin-top:8px;font-size:14px;color:#28a745">No ILM misconfigurations detected</p>
        <p style="margin-top:4px">All managed indices have valid rollover and alias configuration.</p>
      </div>`;

    return sections.map(sec => {
      const items = mc[sec.key]||[];
      if (!items.length) return '';
      return `
        <div class="section-group" style="margin-bottom:14px">
          <div class="section-group-header">
            <h3 style="text-transform:none;font-size:13px">${sec.title}</h3>
            <span class="counter-badge ${sec.sev}">${items.length}</span>
          </div>
          <div style="padding:10px 16px 4px;border-bottom:1px solid #ddd">
            <p style="font-size:12px;color:#555;font-family:monospace;line-height:1.7">${sec.desc}</p>
          </div>
          <div style="padding:12px 16px">${sec.render(items)}</div>
        </div>`;
    }).join('');
  },

  renderAliasCards(items, type) {
    return items.map(item => {
      const sev = item.severity||'high';
      const id = `alias_${type}_${item.index}`;
      const open = this.expandedCards.has(id);
      return `
        <div class="misconfig-card ${sev}" style="margin-bottom:8px">
          <div class="misconfig-header" data-card="${Utils.escapeHtml(id)}">
            <div style="flex:1;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              ${Utils.severityBadge(sev)}
              <span style="font-family:monospace;font-size:13px;font-weight:600">${Utils.escapeHtml(item.index)}</span>
              ${Utils.phaseBadge(item.phase)}
              ${item.policy?`<span class="badge badge-gray">${Utils.escapeHtml(item.policy)}</span>`:''}
              ${item.rollover_alias
                ? `<span class="alias-pill ${type==='not_write'?'not-write':'missing'}">⚓ ${Utils.escapeHtml(item.rollover_alias)}</span>`
                : '<span class="alias-pill missing">no alias set</span>'}
            </div>
            <div style="display:flex;align-items:center;gap:16px;flex-shrink:0">
              <span style="font-family:monospace;font-size:12px;color:#888">${item.size}</span>
              <span style="color:#888">${open?'▴':'▾'}</span>
            </div>
          </div>
          <div class="misconfig-body" style="display:${open?'':'none'}">
            <p style="font-size:12px;font-family:monospace;color:#555;margin:12px 0 10px;line-height:1.7">⚠ ${Utils.escapeHtml(item.reason)}</p>
            ${item.fix?`<div style="font-size:10px;font-family:monospace;color:#888;margin-bottom:4px;letter-spacing:1px">// FIX:</div><div class="fix-block">${Utils.escapeHtml(item.fix)}</div>`:''}
          </div>
        </div>`;
    }).join('');
  },

  renderShardSizeCards(items) {
    return items.map(item => {
      const sev = item.severity||'high';
      const id  = `shardsize_${item.index}`;
      const open = this.expandedCards.has(id);
      const cur  = item.current_size_bytes||0;
      const lim  = item.estimated_max_bytes||0;
      const over = item.over_limit;
      const barMax = Math.max(cur,lim)*1.15||1;
      const curPct = Math.min(cur/barMax*100,100);
      const limPct = lim ? Math.min(lim/barMax*100,100) : null;
      return `
        <div class="misconfig-card ${sev}" style="margin-bottom:8px">
          <div class="misconfig-header" data-card="${Utils.escapeHtml(id)}">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:${lim?'10px':'0'}">
                ${Utils.severityBadge(sev)}
                <span style="font-family:monospace;font-size:13px;font-weight:600">${Utils.escapeHtml(item.index)}</span>
                ${Utils.phaseBadge(item.phase)}
                <span class="badge badge-gray">${Utils.escapeHtml(item.policy)}</span>
                ${over?'<span class="badge badge-red">⚠ OVER LIMIT</span>':''}
              </div>
              ${lim ? `
                <div style="padding-top:14px;padding-right:24px">
                  <div class="gap-bar-wrap">
                    <div class="gap-bar-current" style="width:${Math.min(curPct,limPct||100)}%;background:${over?'#dc3545':'#2563eb'}">
                      ${curPct>15?Utils.escapeHtml(item.current_size):''}
                    </div>
                    ${over&&limPct?`
                      <div class="gap-bar-overflow" style="left:${limPct}%;width:${Math.min(curPct-limPct,100-limPct)}%">
                        <span class="gap-label-right">+${Utils.escapeHtml(item.gap_human||'')} over</span>
                      </div>`:''
                    }
                    ${limPct?`<div class="gap-bar-limit" style="left:${limPct}%"><div class="gap-bar-limit-label">${Utils.escapeHtml(item.estimated_max_index_size)} limit</div></div>`:''}
                  </div>
                  <div style="display:flex;justify-content:space-between;font-size:10px;font-family:monospace;color:#888;margin-top:4px">
                    <span>current: <strong style="color:${over?'#dc3545':'#222'}">${Utils.escapeHtml(item.current_size)}</strong></span>
                    ${item.max_primary_shard_size?`<span>${item.pri_shards} shards × ${Utils.escapeHtml(item.max_primary_shard_size)} = <strong style="color:#ffc107">${Utils.escapeHtml(item.estimated_max_index_size)}</strong> effective max</span>`:''}
                  </div>
                </div>` : `<div style="font-size:12px;font-family:monospace;color:#555;margin-top:6px">Current: ${Utils.escapeHtml(item.current_size)} — max_docs only, no size limit</div>`}
            </div>
            <span style="color:#888;margin-left:12px;flex-shrink:0">${open?'▴':'▾'}</span>
          </div>
          <div class="misconfig-body" style="display:${open?'':'none'}">
            <p style="font-size:12px;font-family:monospace;color:#555;margin:12px 0 10px;line-height:1.7">⚠ ${Utils.escapeHtml(item.reason)}</p>
            <div style="font-size:10px;font-family:monospace;color:#888;margin-bottom:4px;letter-spacing:1px">// CURRENT ROLLOVER CONFIG:</div>
            <div class="fix-block">${Utils.escapeHtml(JSON.stringify(item.rollover_config,null,2))}</div>
            <div style="font-size:10px;font-family:monospace;color:#28a745;margin:12px 0 4px;letter-spacing:1px">// RECOMMENDED — use max_size:</div>
            <div class="fix-block">${Utils.escapeHtml(`PUT _ilm/policy/${item.policy}\n{\n  "policy": {\n    "phases": {\n      "hot": {\n        "actions": {\n          "rollover": {\n            "max_size": "50gb",\n            "max_age": "30d"\n          }\n        }\n      }\n    }\n  }\n}`)}</div>
          </div>
        </div>`;
    }).join('');
  },

  renderNoRolloverTable(items) {
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Index</th><th>Policy</th><th>Phase</th><th>Size</th><th>Age</th></tr></thead>
          <tbody>${items.slice(0,50).map(i=>`<tr>
            <td class="td-name mono" style="font-size:11px"><span title="${Utils.escapeHtml(i.index)}">${Utils.escapeHtml(i.index)}</span></td>
            <td><span class="badge badge-gray">${Utils.escapeHtml(i.policy||'—')}</span></td>
            <td>${Utils.phaseBadge(i.phase)}</td>
            <td class="td-num">${Utils.escapeHtml(i.size)}</td>
            <td class="td-num">${i.age_days!=null?i.age_days+'d':'—'}</td>
          </tr>`).join('')}</tbody>
        </table>
        ${items.length>50?`<div style="padding:10px 16px;font-size:11px;font-family:monospace;color:#888">… and ${items.length-50} more</div>`:''}
      </div>`;
  },

  // ── Nodes ───────────────────────────────────────────────────────────────────
  renderNodes(nodes, phases) {
    if (!nodes?.length) return '<div class="empty-state"><div class="icon">🖥</div><p>No node data available</p></div>';

    const order  = ['hot','warm','cold','frozen','delete','unmanaged','unknown'];
    const colors = { hot:'#ff3d6b', warm:'#ff6b35', cold:'#00ffe5', frozen:'#b57bee', delete:'#3d6b85', unknown:'#1a3550', unmanaged:'#1a3550' };

    const rolePri = n => {
      const r = n.roles||[];
      if (r.includes('data_hot'))     return 0;
      if (r.includes('data_warm'))    return 1;
      if (r.includes('data_cold'))    return 2;
      if (r.includes('data_frozen'))  return 3;
      if (r.includes('data_content') || r.includes('data')) return 4;
      return 5;
    };
    const sorted = [...nodes].sort((a,b)=>rolePri(a)-rolePri(b));

    return `
      <div style="margin-bottom:12px;padding:10px 14px;background:rgba(0,255,229,.04);border:1px solid rgba(0,255,229,.12);border-radius:4px;font-size:11px;font-family:monospace;color:#555">
        Each node shows disk usage with 85% / 90% watermark lines + how much data from each ILM phase lives on it.
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;padding:10px 14px;background:#fff;border:1px solid #ddd;border-radius:4px">
        ${order.filter(p=>phases?.some(ph=>ph.phase===p)).map(p=>`
          <div style="display:flex;align-items:center;gap:6px;font-size:11px;font-family:monospace">
            <div style="width:12px;height:12px;border-radius:2px;background:${colors[p]||'#666'}"></div><span>${p}</span>
          </div>`).join('')}
        <div style="display:flex;align-items:center;gap:6px;font-size:11px;font-family:monospace;margin-left:auto">
          <div style="width:14px;height:2px;background:#ffc107"></div><span>85%</span>
          <div style="width:14px;height:2px;background:#dc3545;margin-left:8px"></div><span>90%</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${sorted.map(n=>this.nodeCard(n,colors,order)).join('')}
      </div>`;
  },

  nodeCard(n, colors, order) {
    const tot  = n.total_disk||0;
    const used = n.used_disk||0;
    const pct  = tot>0 ? Math.round(used/tot*100) : null;
    const diskColor = pct>=90?'#dc3545':pct>=85?'#ffc107':'#28a745';
    const roleLabel = (n.roles||[]).filter(r=>r.startsWith('data')||r==='master'||r==='ingest').map(r=>r.replace('data_','')).join(' · ')||'data';
    const slices = order.map(p=>({phase:p,...(n.phases?.[p]||{})})).filter(p=>p.size_bytes>0);
    const totalShards = n.total_shard_bytes||0;

    return `
      <div style="background:#fff;border:1px solid ${pct>=85?'#dc3545':'#ddd'};border-radius:4px;padding:16px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;gap:12px;flex-wrap:wrap">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <div style="font-family:monospace;font-size:13px;font-weight:700">${Utils.escapeHtml(n.node)}</div>
            <span style="font-size:10px;padding:2px 8px;border-radius:3px;background:#e9ecef;color:#888;font-family:monospace">${roleLabel}</span>
            ${pct>=90?'<span class="badge badge-red">⚠ HIGH WATERMARK</span>':pct>=85?'<span class="badge badge-yellow">LOW WATERMARK</span>':''}
          </div>
          <div style="font-family:monospace;font-size:11px;color:#888;text-align:right">
            ${tot>0?`${Utils.bytesToHuman(used)} / ${Utils.bytesToHuman(tot)}`:''}
            ${n.cpu_pct!=null?` · CPU: ${n.cpu_pct}%`:''}
            ${n.heap_used_pct!=null?` · Heap: ${n.heap_used_pct}%`:''}
          </div>
        </div>

        ${tot>0?`
          <div style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;font-size:10px;font-family:monospace;color:#888;margin-bottom:4px">
              <span>Disk</span><span style="color:${diskColor};font-weight:700">${pct}%</span>
            </div>
            <div style="background:#e9ecef;border-radius:3px;height:8px;overflow:hidden;position:relative">
              <div style="height:100%;background:${diskColor};width:${Math.min(pct,100)}%;transition:width .5s"></div>
              <div style="position:absolute;top:0;left:85%;width:1px;height:100%;background:#ffc107"></div>
              <div style="position:absolute;top:0;left:90%;width:1px;height:100%;background:#dc3545"></div>
            </div>
          </div>`:''}

        ${slices.length>0?`
          <div>
            <div style="font-size:10px;font-family:monospace;color:#888;margin-bottom:6px;letter-spacing:.5px">DATA BY ILM PHASE · ${Utils.bytesToHuman(totalShards)}</div>
            <div class="node-phase-bar">
              ${slices.map(p=>{
                const pct2 = totalShards>0?p.size_bytes/totalShards*100:0;
                const c = colors[p.phase]||'#666';
                return `<div class="node-phase-segment" style="flex:${p.size_bytes};background:${c};color:${p.phase==='cold'||p.phase==='frozen'||p.phase==='delete'?'#fff':'#fff'}"
                  title="${p.phase}: ${Utils.bytesToHuman(p.size_bytes)} (${pct2.toFixed(1)}%) · ${p.shard_count} shards">
                  ${pct2>8?p.phase.substring(0,1).toUpperCase():''}
                </div>`;
              }).join('')}
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
              ${slices.map(p=>{
                const pct2 = totalShards>0?(p.size_bytes/totalShards*100).toFixed(1):'0';
                return `<div style="display:flex;align-items:center;gap:5px;font-size:10px;font-family:monospace">
                  <div style="width:8px;height:8px;border-radius:2px;background:${colors[p.phase]||'#666'}"></div>
                  <span style="color:#888">${p.phase}</span>
                  <span style="font-weight:700">${Utils.bytesToHuman(p.size_bytes)}</span>
                  <span style="color:#888">(${pct2}%)</span>
                </div>`;
              }).join('')}
            </div>
          </div>`:'<div style="font-size:11px;font-family:monospace;color:#888">No shard data on this node</div>'}
      </div>`;
  },

  // ── Policy Stats ────────────────────────────────────────────────────────────
  renderPolicies(policies) {
    if (!policies?.length) return '<div class="empty-state"><div class="icon">⟳</div><p>No policy data</p></div>';
    const colors = { hot:'#dc3545', warm:'#fd7e14', cold:'#2563eb', frozen:'#6f42c1', delete:'#888', unknown:'#ddd' };
    return `
      <div style="display:flex;flex-direction:column;gap:10px">
        ${policies.map(p=>{
          const phases = Object.entries(p.phases||{}).sort((a,b)=>b[1].size_bytes-a[1].size_bytes);
          return `
            <div style="background:#fff;border:1px solid #ddd;border-radius:4px;overflow:hidden">
              <div style="padding:14px 16px;border-bottom:1px solid #ddd;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                <div style="flex:1;min-width:0">
                  <div style="font-family:monospace;font-size:14px;font-weight:700;margin-bottom:2px">${Utils.escapeHtml(p.name)}</div>
                  <div style="font-size:11px;color:#888;font-family:monospace">${p.indices} indices · ${Utils.bytesToHuman(p.size_bytes)} · ${Utils.numFormat(p.docs)} docs</div>
                </div>
                ${phases.length>0?`<div style="display:flex;height:14px;width:100px;border-radius:3px;overflow:hidden;gap:1px">
                  ${phases.map(([ph,pd])=>`<div style="flex:${pd.size_bytes};background:${colors[ph]||'#666'}" title="${ph}: ${Utils.bytesToHuman(pd.size_bytes)}"></div>`).join('')}
                </div>`:''}
                ${p.issues>0?`<span class="badge badge-yellow">⚠ ${p.issues}</span>`:'<span class="badge badge-green">✓</span>'}
              </div>
              ${phases.length>0?`
                <div style="padding:12px 16px">
                  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px">
                    ${phases.map(([ph,pd])=>`
                      <div style="background:#f8f9fa;border-radius:4px;padding:10px;border-left:3px solid ${colors[ph]||'#ddd'}">
                        <div style="font-size:10px;font-family:monospace;color:${colors[ph]||'#888'};font-weight:700;text-transform:uppercase;margin-bottom:4px">${ph}</div>
                        <div style="font-family:Arial, sans-serif;font-size:16px;font-weight:700">${Utils.bytesToHuman(pd.size_bytes)}</div>
                        <div style="font-size:10px;color:#888;margin-top:2px">${pd.count} indices</div>
                      </div>`).join('')}
                  </div>
                </div>`:'' }
            </div>`;
        }).join('')}
      </div>`;
  },

  // ── Index Audit Table ────────────────────────────────────────────────────────
  renderIndicesTable(indices) {
    if (!indices?.length) return '<div class="empty-state"><div class="icon">⊞</div><p>No managed indices</p></div>';

    const search = this.filters.search.toLowerCase();
    const phaseF = this.filters.phase;
    let filtered = [...indices];
    if (search) filtered = filtered.filter(i => i.index.includes(search)||(i.policy||'').includes(search));
    if (phaseF)  filtered = filtered.filter(i => i.phase===phaseF);

    const paged = Utils.paginate(filtered, this.page, this.perPage);

    return `
      <div style="margin-bottom:10px;font-family:monospace;font-size:11px;color:#888">${filtered.length} indices${phaseF?' in phase: '+phaseF:''}</div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Index</th><th>Policy</th><th>Phase</th><th>Step</th>
            <th>Size</th><th>Docs</th><th>Aliases</th><th>Rollover Alias</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${paged.items.map(i=>`<tr style="${i.failed_step?'background:rgba(255,61,107,.04)':''}">
              <td class="td-name mono" style="font-size:11px"><span title="${Utils.escapeHtml(i.index)}">${Utils.escapeHtml(i.index)}</span></td>
              <td><span class="badge badge-gray" style="max-width:120px;overflow:hidden;text-overflow:ellipsis">${Utils.escapeHtml(i.policy||'—')}</span></td>
              <td>${Utils.phaseBadge(i.phase)}</td>
              <td><span style="font-size:10px;font-family:monospace;color:#888">${Utils.escapeHtml(i.step||'—')}</span></td>
              <td class="td-num">${Utils.bytesToHuman(i.size_bytes)}</td>
              <td class="td-num">${Utils.numFormat(i.docs)}</td>
              <td>${(i.aliases||[]).slice(0,2).map(a=>`<span class="alias-pill ${a.is_write?'write':''}">${a.is_write?'✎ ':''}${Utils.escapeHtml(a.alias)}</span>`).join(' ')}${(i.aliases||[]).length>2?`<span class="badge badge-gray">+${i.aliases.length-2}</span>`:''}</td>
              <td>${i.rollover_alias?`<span class="alias-pill">${Utils.escapeHtml(i.rollover_alias)}</span>`:'<span class="text-muted" style="font-size:11px">—</span>'}</td>
              <td>${i.failed_step?`<span class="badge badge-red">⚠ ${Utils.escapeHtml(i.failed_step)}</span>`:i.managed?'<span class="badge badge-green">ok</span>':'<span class="badge badge-gray">unmanaged</span>'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div class="pagination" id="ilmh-pagination"></div>
      </div>`;
  },

  // ── Events ──────────────────────────────────────────────────────────────────
  bindEvents(el) {
    el.querySelector('#ilmh-refresh')?.addEventListener('click', () => this.render());

    el.querySelector('#ilmh-phase-filter')?.addEventListener('change', (e) => {
      this.filters.phase = e.target.value; this.page=1; this.render();
    });
    el.querySelector('#ilmh-search')?.addEventListener('input', Utils.debounce((e) => {
      this.filters.search = e.target.value; this.page=1; this.render();
    }, 350));

    // Tab switching — no DOM dependency on inactive tab content
    el.querySelectorAll('#ilmh-tabs .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.activeTab = tab.dataset.tab;
        el.querySelectorAll('#ilmh-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        ['misconfigs','nodes','policies','indices'].forEach(t => {
          const d = document.getElementById(`ilmh-tab-${t}`);
          if (d) d.style.display = (t===tab.dataset.tab) ? '' : 'none';
        });
        // ── BUG FIX: only wire pagination when the indices tab is actually shown ──
        if (tab.dataset.tab === 'indices') {
          this.rebuildPagination(el, this.data?.indices);
        }
      });
    });

    // Expandable misconfig cards
    el.querySelectorAll('.misconfig-header[data-card]').forEach(header => {
      header.addEventListener('click', () => {
        const id   = header.dataset.card;
        const body = header.nextElementSibling;
        if (!body) return;
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : '';
        isOpen ? this.expandedCards.delete(id) : this.expandedCards.add(id);
        const chevron = header.querySelector('span:last-child');
        if (chevron) chevron.textContent = isOpen ? '▾' : '▴';
      });
    });
  },
};

window.ILMHealth = ILMHealth;
