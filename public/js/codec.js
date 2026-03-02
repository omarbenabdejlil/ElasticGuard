const Codec = {
  data: null,
  impact: null,
  filters: { pattern: '', codec: '' },
  page: 1,
  perPage: 50,
  activeTab: 'impact',

  wizard: {
    target_codec: 'best_compression',
    apply_to: 'all',
    phases: [],
    tiers: [],
    exclude_pattern: '',
  },

  async render() {
    const el = document.getElementById('page-codec');
    el.innerHTML = '<div class="loading">Loading codec data</div>';
    try {
      this.data = await fetch('/api/codec?' + new URLSearchParams(this.filters)).then(r => r.json());
      if (this.data.error) throw new Error(this.data.error);
      this.renderContent(el);
    } catch(err) {
      el.innerHTML = `<div class="error-msg">Error: ${Utils.escapeHtml(err.message)}</div>`;
    }
  },

  renderContent(el) {
    const { indices, summary, codec_info } = this.data;

    el.innerHTML = `
      <div class="page-header page-header-row">
        <div>
          <h1>Codec Analyzer</h1>
          <p>Real cluster impact analysis — storage savings, node disk relief, migration planning</p>
        </div>
        <button class="refresh-btn" id="codec-refresh">↻ Refresh</button>
      </div>

      ${this.renderVersionBanner(summary)}

      <div class="stat-grid" style="margin-bottom:20px">
        <div class="stat-card accent">
          <div class="label">Total Indices</div>
          <div class="value">${summary.total_indices}</div>
        </div>
        <div class="stat-card">
          <div class="label">Using LZ4 (default)</div>
          <div class="value" style="color:#00d4ff">${summary.codec_breakdown.default}</div>
          <div class="sub">${summary.default_size_human} primary</div>
        </div>
        <div class="stat-card">
          <div class="label">best_compression</div>
          <div class="value" style="color:#00e5a0">${summary.codec_breakdown.best_compression}</div>
          <div class="sub">${summary.best_comp_size_human} primary</div>
        </div>
        <div class="stat-card ${summary.potential_savings_pct >= 15 ? 'yellow' : ''}">
          <div class="label">Max Potential Saving</div>
          <div class="value" style="font-size:20px">${summary.potential_savings_human}</div>
          <div class="sub">~${summary.potential_savings_pct}% if all → best_compression</div>
        </div>
      </div>

      <div class="tabs" id="codec-tabs">
        <div class="tab ${this.activeTab==='impact'?'active':''}" data-tab="impact">🎯 Cluster Impact Simulator</div>
        <div class="tab ${this.activeTab==='indices'?'active':''}" data-tab="indices">⊞ Indices (${indices.length})</div>
        <div class="tab ${this.activeTab==='reference'?'active':''}" data-tab="reference">📖 Codec Reference</div>
      </div>

      <div id="codec-tab-impact" style="display:${this.activeTab==='impact'?'':'none'}">
        ${this.renderImpactWizard(summary)}
      </div>

      <div id="codec-tab-indices" style="display:${this.activeTab==='indices'?'':'none'}">
        ${this.renderIndicesTab(indices)}
      </div>

      <div id="codec-tab-reference" style="display:${this.activeTab==='reference'?'':'none'}">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px;margin-bottom:20px">
          ${this.renderCodecCard('default', codec_info.default, summary)}
          ${this.renderCodecCard('best_compression', codec_info.best_compression, summary)}
        </div>
        ${this.renderComparisonTable(summary)}
        <div style="margin-top:20px">${this.renderEducation(summary)}</div>
      </div>
    `;

    el.querySelectorAll('#codec-tabs .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.activeTab = tab.dataset.tab;
        el.querySelectorAll('#codec-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        ['impact','indices','reference'].forEach(t => {
          const d = document.getElementById(`codec-tab-${t}`);
          if (d) d.style.display = t === tab.dataset.tab ? '' : 'none';
        });
      });
    });

    document.getElementById('codec-refresh')?.addEventListener('click', () => this.render());
    this.bindWizardEvents(el, summary);
    this.bindIndicesEvents(el);

    // Restore impact results if previously computed
    if (this.impact) {
      const r = document.getElementById('impact-results');
      if (r) this.renderImpactResults(r, this.impact);
    }
  },

  renderVersionBanner(summary) {
    if (!summary.has_zstd_native) return `
      <div style="padding:10px 16px;background:rgba(245,166,35,0.08);border:1px solid rgba(245,166,35,0.2);border-radius:var(--radius);font-size:12px;font-family:var(--mono);color:var(--yellow);margin-bottom:16px;display:flex;align-items:center;gap:12px">
        <span style="font-size:18px">⚠</span>
        <div>ES <strong>${summary.es_version}</strong> — native ZSTD requires ES ≥ 8.16. <code>best_compression</code> uses DEFLATE on your version. Still saves ~22% storage. Upgrading to 8.16+ adds +12% compression AND +14% write throughput.</div>
      </div>`;
    return `
      <div style="padding:10px 16px;background:rgba(0,229,160,0.06);border:1px solid rgba(0,229,160,0.15);border-radius:var(--radius);font-size:12px;font-family:var(--mono);color:var(--green);margin-bottom:16px;display:flex;align-items:center;gap:12px">
        <span style="font-size:18px">✓</span>
        <div>ES <strong>${summary.es_version}</strong> — native ZSTD active. <code>best_compression</code> uses ZSTD: best compression + fast write speeds.</div>
      </div>`;
  },

  // ── WIZARD ────────────────────────────────────────────────────────────────
  renderImpactWizard(summary) {
    const allPhases = ['hot','warm','cold','frozen','delete'];
    const allTiers  = ['hot','warm','cold','frozen','content'];

    return `
      <div style="display:grid;grid-template-columns:300px 1fr;gap:20px;align-items:start">

        <!-- Controls -->
        <div>
          <div class="table-wrap" style="padding:20px">
            <div style="font-family:var(--mono);font-size:12px;font-weight:700;color:var(--accent);margin-bottom:16px;letter-spacing:1px">⚙ MIGRATION SCENARIO</div>

            <!-- Codec picker -->
            <div style="margin-bottom:14px">
              <div style="font-size:11px;color:var(--text-2);font-family:var(--mono);margin-bottom:8px">TARGET CODEC</div>
              <div style="display:flex;gap:8px">
                ${['default','best_compression'].map(c => `
                  <button class="codec-pick-btn" data-codec="${c}" style="flex:1;padding:10px 8px;border-radius:var(--radius);border:2px solid ${this.wizard.target_codec===c?'var(--accent)':'var(--border)'};background:${this.wizard.target_codec===c?'var(--accent-dim)':'var(--bg-2)'};color:${this.wizard.target_codec===c?'var(--accent)':'var(--text-1)'};cursor:pointer;font-family:var(--mono);font-size:10px;text-align:center;transition:all 0.15s">
                    <div style="font-size:20px;margin-bottom:4px">${c==='default'?'⚡':'🗜'}</div>
                    <div style="font-weight:700">${c}</div>
                    <div style="color:var(--text-2);margin-top:2px;font-size:10px">${c==='default'?'LZ4 · fastest':'ZSTD · smallest'}</div>
                  </button>
                `).join('')}
              </div>
            </div>

            <!-- Apply to -->
            <div style="margin-bottom:14px">
              <div style="font-size:11px;color:var(--text-2);font-family:var(--mono);margin-bottom:6px">APPLY TO</div>
              <select id="wizard-apply-to" style="width:100%;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;color:var(--text-0);font-family:var(--mono);font-size:12px">
                <option value="all" ${this.wizard.apply_to==='all'?'selected':''}>All eligible indices</option>
                <option value="default_only" ${this.wizard.apply_to==='default_only'?'selected':''}>Only indices using default (LZ4)</option>
                <option value="by_phase" ${this.wizard.apply_to==='by_phase'?'selected':''}>Filter by ILM phase</option>
                <option value="by_tier" ${this.wizard.apply_to==='by_tier'?'selected':''}>Filter by tier</option>
              </select>
            </div>

            <!-- Phase picker -->
            <div id="wizard-phases" style="display:${this.wizard.apply_to==='by_phase'?'':'none'};margin-bottom:14px">
              <div style="font-size:11px;color:var(--text-2);font-family:var(--mono);margin-bottom:6px">PHASES</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${allPhases.map(p => `
                  <button class="phase-pick-btn" data-phase="${p}" style="padding:5px 12px;border-radius:4px;border:1px solid ${this.wizard.phases.includes(p)?'var(--accent)':'var(--border)'};background:${this.wizard.phases.includes(p)?'var(--accent-dim)':'var(--bg-2)'};color:${this.wizard.phases.includes(p)?'var(--accent)':'var(--text-2)'};cursor:pointer;font-family:var(--mono);font-size:11px;transition:all 0.15s">${p}</button>
                `).join('')}
              </div>
            </div>

            <!-- Tier picker -->
            <div id="wizard-tiers" style="display:${this.wizard.apply_to==='by_tier'?'':'none'};margin-bottom:14px">
              <div style="font-size:11px;color:var(--text-2);font-family:var(--mono);margin-bottom:6px">TIERS</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${allTiers.map(t => `
                  <button class="tier-pick-btn" data-tier="${t}" style="padding:5px 12px;border-radius:4px;border:1px solid ${this.wizard.tiers.includes(t)?'var(--accent)':'var(--border)'};background:${this.wizard.tiers.includes(t)?'var(--accent-dim)':'var(--bg-2)'};color:${this.wizard.tiers.includes(t)?'var(--accent)':'var(--text-2)'};cursor:pointer;font-family:var(--mono);font-size:11px;transition:all 0.15s">${t}</button>
                `).join('')}
              </div>
            </div>

            <!-- Exclude -->
            <div style="margin-bottom:20px">
              <div style="font-size:11px;color:var(--text-2);font-family:var(--mono);margin-bottom:6px">EXCLUDE PATTERN (regex)</div>
              <input type="text" id="wizard-exclude" placeholder=".monitoring-*|system-*" value="${Utils.escapeHtml(this.wizard.exclude_pattern)}"
                style="width:100%;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);padding:8px 10px;color:var(--text-0);font-family:var(--mono);font-size:12px">
            </div>

            <button id="run-impact-btn" class="btn btn-primary" style="width:100%;padding:14px;font-size:14px;letter-spacing:0.3px">
              🎯 &nbsp;Analyze Cluster Impact
            </button>
          </div>

          <!-- Mini codec info -->
          <div class="table-wrap" style="padding:16px;margin-top:12px">
            <div style="font-family:var(--mono);font-size:10px;font-weight:700;color:var(--text-2);margin-bottom:10px;letter-spacing:1px">SELECTED CODEC INFO</div>
            ${this.renderMiniCodecInfo(this.wizard.target_codec, summary)}
          </div>
        </div>

        <!-- Results area -->
        <div id="impact-results">
          <div style="background:var(--bg-1);border:1px solid var(--border);border-radius:var(--radius);padding:80px 40px;text-align:center;color:var(--text-2)">
            <div style="font-size:56px;margin-bottom:16px;opacity:0.4">🎯</div>
            <div style="font-family:var(--mono);font-size:14px;margin-bottom:8px;color:var(--text-1)">Configure your migration scenario</div>
            <div style="font-size:12px;max-width:360px;margin:0 auto;line-height:1.6">
              Select a target codec, choose which indices to include, then click <strong style="color:var(--accent)">Analyze Cluster Impact</strong> to see the full before/after picture of your infrastructure.
            </div>
          </div>
        </div>
      </div>
    `;
  },

  renderMiniCodecInfo(codec, summary) {
    const isZstd = summary.has_zstd_native;
    const info = {
      default: { algo:'LZ4 + dictionary', write:'100% (fastest)', read:'100% (fastest)', storage:'Baseline', cpu:'Low' },
      best_compression: { algo: isZstd?'ZSTD level 3':'DEFLATE + dict', write: isZstd?'~96%':'~88%', read:'~82%', storage: isZstd?'-28 to -35%':'-22 to -26%', cpu: isZstd?'Medium':'Medium-High' },
    };
    const c = info[codec] || info.default;
    return `
      <div class="kv-grid" style="font-size:12px;row-gap:8px">
        <span class="kv-key">Algorithm</span><span class="kv-val text-accent mono">${c.algo}</span>
        <span class="kv-key">Write speed</span><span class="kv-val">${c.write}</span>
        <span class="kv-key">Read speed</span><span class="kv-val">${c.read}</span>
        <span class="kv-key">Storage</span><span class="kv-val text-green">${c.storage}</span>
        <span class="kv-key">CPU impact</span><span class="kv-val">${c.cpu}</span>
      </div>`;
  },

  bindWizardEvents(el, summary) {
    el.querySelectorAll('.codec-pick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.wizard.target_codec = btn.dataset.codec;
        // update button styles without full re-render
        el.querySelectorAll('.codec-pick-btn').forEach(b => {
          const isActive = b.dataset.codec === this.wizard.target_codec;
          b.style.borderColor = isActive ? 'var(--accent)' : 'var(--border)';
          b.style.background = isActive ? 'var(--accent-dim)' : 'var(--bg-2)';
          b.style.color = isActive ? 'var(--accent)' : 'var(--text-1)';
        });
        const mini = el.querySelector('.table-wrap:nth-of-type(2) .kv-grid')?.closest('.table-wrap');
        if (mini) mini.querySelector('.kv-grid').parentElement.innerHTML = `
          <div style="font-family:var(--mono);font-size:10px;font-weight:700;color:var(--text-2);margin-bottom:10px;letter-spacing:1px">SELECTED CODEC INFO</div>
          ${this.renderMiniCodecInfo(this.wizard.target_codec, summary)}`;
      });
    });

    document.getElementById('wizard-apply-to')?.addEventListener('change', (e) => {
      this.wizard.apply_to = e.target.value;
      const pd = document.getElementById('wizard-phases');
      const td = document.getElementById('wizard-tiers');
      if (pd) pd.style.display = e.target.value === 'by_phase' ? '' : 'none';
      if (td) td.style.display = e.target.value === 'by_tier' ? '' : 'none';
    });

    el.querySelectorAll('.phase-pick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = btn.dataset.phase;
        if (this.wizard.phases.includes(p)) this.wizard.phases = this.wizard.phases.filter(x=>x!==p);
        else this.wizard.phases.push(p);
        const active = this.wizard.phases.includes(p);
        btn.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
        btn.style.background = active ? 'var(--accent-dim)' : 'var(--bg-2)';
        btn.style.color = active ? 'var(--accent)' : 'var(--text-2)';
      });
    });

    el.querySelectorAll('.tier-pick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tier;
        if (this.wizard.tiers.includes(t)) this.wizard.tiers = this.wizard.tiers.filter(x=>x!==t);
        else this.wizard.tiers.push(t);
        const active = this.wizard.tiers.includes(t);
        btn.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
        btn.style.background = active ? 'var(--accent-dim)' : 'var(--bg-2)';
        btn.style.color = active ? 'var(--accent)' : 'var(--text-2)';
      });
    });

    document.getElementById('wizard-exclude')?.addEventListener('input', (e) => {
      this.wizard.exclude_pattern = e.target.value;
    });

    document.getElementById('run-impact-btn')?.addEventListener('click', () => this.runClusterImpact());
  },

  async runClusterImpact() {
    const btn = document.getElementById('run-impact-btn');
    const resultsEl = document.getElementById('impact-results');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span style="animation:spin 0.8s linear infinite;display:inline-block">⟳</span> Analyzing…'; }
    if (resultsEl) resultsEl.innerHTML = '<div class="loading" style="padding:80px;text-align:center">Fetching cluster data — nodes, shards, ILM phases, disk usage…</div>';

    try {
      const resp = await fetch('/api/codec/cluster-impact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_codec: this.wizard.target_codec,
          apply_to: this.wizard.apply_to,
          phases: this.wizard.phases,
          tiers: this.wizard.tiers,
          exclude_pattern: this.wizard.exclude_pattern,
        }),
      }).then(r => r.json());

      if (resp.error) throw new Error(resp.error);
      this.impact = resp;
      this.renderImpactResults(resultsEl, resp);
    } catch(err) {
      if (resultsEl) resultsEl.innerHTML = `<div class="error-msg">Error: ${Utils.escapeHtml(err.message)}</div>`;
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '🎯 &nbsp;Analyze Cluster Impact'; }
    }
  },

  renderImpactResults(el, data) {
    const { meta, cluster, by_tier, by_phase, nodes, migration, watermarks } = data;

    el.innerHTML = `
      <!-- Headline numbers -->
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px">
        <div style="background:var(--bg-1);border:1px solid rgba(0,229,160,0.3);border-radius:var(--radius);padding:16px;border-top:3px solid var(--green)">
          <div style="font-size:10px;font-family:var(--mono);color:var(--text-2);letter-spacing:1px;margin-bottom:6px">TOTAL STORAGE FREED</div>
          <div style="font-size:30px;font-weight:700;font-family:var(--mono);color:var(--green)">${Utils.bytesToHuman(cluster.estimated_freed_all)}</div>
          <div style="font-size:11px;color:var(--text-2);margin-top:4px;font-family:var(--mono)">primaries + replicas · ${cluster.savings_pct}% of total store</div>
        </div>
        <div style="background:var(--bg-1);border:1px solid var(--border);border-radius:var(--radius);padding:16px;border-top:3px solid var(--accent)">
          <div style="font-size:10px;font-family:var(--mono);color:var(--text-2);letter-spacing:1px;margin-bottom:6px">INDICES TO MIGRATE</div>
          <div style="font-size:30px;font-weight:700;font-family:var(--mono);color:var(--accent)">${migration.total_indices}</div>
          <div style="font-size:11px;color:var(--text-2);margin-top:4px;font-family:var(--mono)">${migration.total_batches} batches · ${Utils.numFormat(cluster.total_segments_to_rewrite)} segments to rewrite</div>
        </div>

        <!-- Disk before/after visual -->
        <div style="background:var(--bg-1);border:1px solid var(--border);border-radius:var(--radius);padding:16px">
          <div style="font-size:10px;font-family:var(--mono);color:var(--text-2);letter-spacing:1px;margin-bottom:8px">CLUSTER DISK — BEFORE</div>
          <div style="font-size:26px;font-weight:700;font-family:var(--mono);color:${cluster.used_pct>=85?'var(--red)':cluster.used_pct>=70?'var(--yellow)':'var(--text-0)'};">${cluster.used_pct}%</div>
          <div style="margin:8px 0;background:var(--bg-2);border-radius:4px;height:12px;overflow:hidden;position:relative">
            <div style="height:100%;background:${cluster.used_pct>=90?'var(--red)':cluster.used_pct>=85?'var(--yellow)':'var(--accent)'};width:${Math.min(cluster.used_pct,100)}%"></div>
            <div style="position:absolute;top:0;left:85%;width:1px;height:100%;background:rgba(245,166,35,0.7)"></div>
            <div style="position:absolute;top:0;left:90%;width:1px;height:100%;background:rgba(255,77,109,0.7)"></div>
          </div>
          <div style="font-size:11px;color:var(--text-2);font-family:var(--mono)">${Utils.bytesToHuman(cluster.used_disk)} / ${Utils.bytesToHuman(cluster.total_disk)}</div>
        </div>
        <div style="background:var(--bg-1);border:1px solid rgba(0,229,160,0.2);border-radius:var(--radius);padding:16px">
          <div style="font-size:10px;font-family:var(--mono);color:var(--text-2);letter-spacing:1px;margin-bottom:8px">CLUSTER DISK — AFTER</div>
          <div style="font-size:26px;font-weight:700;font-family:var(--mono);color:var(--green)">${cluster.new_used_pct}%</div>
          <div style="margin:8px 0;background:var(--bg-2);border-radius:4px;height:12px;overflow:hidden;position:relative">
            <div style="height:100%;background:${cluster.new_used_pct>=90?'var(--red)':cluster.new_used_pct>=85?'var(--yellow)':'var(--green)'};width:${Math.min(cluster.new_used_pct,100)}%"></div>
            <div style="position:absolute;top:0;left:85%;width:1px;height:100%;background:rgba(245,166,35,0.7)"></div>
            <div style="position:absolute;top:0;left:90%;width:1px;height:100%;background:rgba(255,77,109,0.7)"></div>
          </div>
          <div style="font-size:11px;color:var(--green);font-family:var(--mono)">-${cluster.cluster_disk_savings_pct}% of total cluster disk</div>
        </div>
      </div>

      <!-- Context badge -->
      <div style="padding:8px 14px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);font-family:var(--mono);font-size:11px;color:var(--text-2);margin-bottom:14px;display:flex;gap:16px;flex-wrap:wrap;align-items:center">
        <span>Scenario: <strong style="color:var(--text-0)">${meta.apply_to}</strong></span>
        <span>→ codec: <strong style="color:var(--accent)">${meta.target_codec}</strong></span>
        <span>engine: <strong style="color:var(--accent)">${meta.has_zstd_native?'ZSTD (native)':'DEFLATE'}</strong></span>
        ${meta.phases?.length?`<span>phases: <strong style="color:var(--yellow)">${meta.phases.join(', ')}</strong></span>`:''}
        ${meta.tiers?.length?`<span>tiers: <strong style="color:var(--yellow)">${meta.tiers.join(', ')}</strong></span>`:''}
        ${meta.exclude_pattern?`<span>excluded: <strong style="color:var(--orange)">${Utils.escapeHtml(meta.exclude_pattern)}</strong></span>`:''}
        ${watermarks.nodes_near_high?.length?`<span style="color:var(--red)">⚠ ${watermarks.nodes_near_high.length} node(s) near high watermark</span>`:''}
        ${watermarks.nodes_improved_past_low?.length?`<span style="color:var(--green)">✓ ${watermarks.nodes_improved_past_low.length} node(s) will drop below 85% watermark</span>`:''}
      </div>

      <!-- Inner breakdown tabs -->
      <div class="tabs" id="impact-inner-tabs">
        <div class="tab active" data-itab="nodes">🖥 Node Impact (${nodes?.length||0})</div>
        <div class="tab" data-itab="tiers">🗂 By Tier</div>
        <div class="tab" data-itab="phases">⟳ By ILM Phase</div>
        <div class="tab" data-itab="plan">📋 Migration Plan (${migration.total_indices} indices)</div>
      </div>

      <div id="impact-inner-nodes">${this.renderNodeImpact(nodes, watermarks)}</div>
      <div id="impact-inner-tiers" style="display:none">${this.renderTierBreakdown(by_tier)}</div>
      <div id="impact-inner-phases" style="display:none">${this.renderPhaseBreakdown(by_phase)}</div>
      <div id="impact-inner-plan" style="display:none">${this.renderMigrationPlan(migration, meta)}</div>
    `;

    el.querySelectorAll('#impact-inner-tabs .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        el.querySelectorAll('#impact-inner-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        ['nodes','tiers','phases','plan'].forEach(t => {
          const d = document.getElementById(`impact-inner-${t}`);
          if (d) d.style.display = t === tab.dataset.itab ? '' : 'none';
        });
      });
    });

    // Copy script button
    document.getElementById('copy-script-btn')?.addEventListener('click', function() {
      const pre = this.closest('div').previousElementSibling;
      if (pre) { navigator.clipboard.writeText(pre.textContent); this.textContent = '✓ Copied!'; setTimeout(()=>this.textContent='📋 Copy script',2000); }
    });
  },

  renderNodeImpact(nodes, watermarks) {
    if (!nodes?.length) return '<div class="empty-state"><div class="icon">🖥</div><p>No node disk data available (nodes may not expose fs stats)</p></div>';
    const sorted = [...nodes].sort((a,b) => b.disk_pct - a.disk_pct);
    return `
      <div style="padding:8px 14px;background:rgba(124,58,237,0.08);border:1px solid rgba(124,58,237,0.2);border-radius:var(--radius);font-size:11px;font-family:var(--mono);color:#a78bfa;margin-bottom:12px">
        Watermarks — low: <strong>85%</strong> (stops allocation) · high: <strong>90%</strong> (relocates shards) · flood: <strong>95%</strong> (read-only). Dashed lines shown on bars.
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${sorted.map(n => this.renderNodeBar(n)).join('')}
      </div>`;
  },

  renderNodeBar(n) {
    const roleLabel = (n.roles||[]).filter(r=>r.startsWith('data')||r==='master'||r==='ingest').map(r=>r.replace('data_','')).join(' · ') || 'node';
    const isHot = (n.roles||[]).some(r=>r.includes('hot'));
    const isWarm = (n.roles||[]).some(r=>r.includes('warm'));
    const roleColor = isHot?'var(--red)':isWarm?'var(--orange)':'var(--text-2)';
    const pb = n.disk_pct;
    const pa = n.estimated_new_pct;
    const freed = n.estimated_freed;
    const crossedLow = pb >= 85 && pa < 85;
    const crossedHigh = pb >= 90 && pa < 90;

    return `
      <div style="background:var(--bg-1);border:1px solid ${freed>0?'rgba(0,229,160,0.15)':'var(--border)'};border-radius:var(--radius);padding:14px 16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-family:var(--mono);font-size:13px;font-weight:600">${Utils.escapeHtml(n.name)}</span>
            <span style="font-size:10px;padding:2px 7px;border-radius:3px;background:rgba(255,255,255,0.04);color:${roleColor};font-family:var(--mono)">${roleLabel}</span>
            ${pb>=95?'<span class="badge badge-red">FLOOD STAGE</span>':pb>=90?'<span class="badge badge-red">HIGH WATERMARK</span>':pb>=85?'<span class="badge badge-yellow">LOW WATERMARK</span>':''}
            ${crossedLow?'<span class="badge badge-green">↓ will drop below 85%</span>':''}
            ${crossedHigh&&!crossedLow?'<span class="badge badge-green">↓ will drop below 90%</span>':''}
          </div>
          <span style="font-family:var(--mono);font-size:11px;color:var(--text-2)">${Utils.bytesToHuman(n.total_disk)}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 28px 1fr;gap:8px;align-items:center">
          <div>
            <div style="display:flex;justify-content:space-between;font-size:11px;font-family:var(--mono);margin-bottom:4px">
              <span style="color:var(--text-2)">Before</span>
              <span style="font-weight:600;color:${pb>=90?'var(--red)':pb>=85?'var(--yellow)':'var(--text-1)'}">${pb}% · ${Utils.bytesToHuman(n.used_disk)}</span>
            </div>
            <div style="background:var(--bg-2);border-radius:3px;height:10px;position:relative;overflow:hidden">
              <div style="height:100%;background:${pb>=90?'var(--red)':pb>=85?'var(--yellow)':'var(--accent)'};width:${Math.min(pb,100)}%"></div>
              <div style="position:absolute;top:0;left:85%;width:1px;height:100%;background:rgba(245,166,35,0.8)"></div>
              <div style="position:absolute;top:0;left:90%;width:1px;height:100%;background:rgba(255,77,109,0.8)"></div>
            </div>
          </div>
          <div style="text-align:center;font-size:16px;color:${freed>0?'var(--green)':'var(--text-2)'}">→</div>
          <div>
            <div style="display:flex;justify-content:space-between;font-size:11px;font-family:var(--mono);margin-bottom:4px">
              <span style="color:var(--text-2)">After</span>
              <span style="font-weight:600;color:${pa>=90?'var(--red)':pa>=85?'var(--yellow)':'var(--green)'}">${pa}% · ${Utils.bytesToHuman(n.estimated_new_used)}</span>
            </div>
            <div style="background:var(--bg-2);border-radius:3px;height:10px;position:relative;overflow:hidden">
              <div style="height:100%;background:${pa>=90?'var(--red)':pa>=85?'var(--yellow)':'var(--green)'};width:${Math.min(pa,100)}%"></div>
              <div style="position:absolute;top:0;left:85%;width:1px;height:100%;background:rgba(245,166,35,0.8)"></div>
              <div style="position:absolute;top:0;left:90%;width:1px;height:100%;background:rgba(255,77,109,0.8)"></div>
            </div>
          </div>
        </div>
        <div style="margin-top:6px;font-size:11px;font-family:var(--mono);color:${freed>0?'var(--green)':'var(--text-2)'}">
          ${freed>0 ? `↓ ~${Utils.bytesToHuman(freed)} freed on this node` : 'No shards in scope on this node'}
        </div>
      </div>`;
  },

  renderTierBreakdown(byTier) {
    if (!byTier?.length) return '<div class="empty-state"><p>No tier data</p></div>';
    const tc = {hot:'var(--red)',warm:'var(--orange)',cold:'var(--accent)',frozen:'#a78bfa',content:'var(--text-1)',unknown:'var(--text-2)'};
    return `<div class="table-wrap"><table>
      <thead><tr><th>Tier</th><th>Indices</th><th>In Scope</th><th>Primary Size</th><th>Est. Primary Freed</th><th>Est. Total Freed (incl. replicas)</th><th>% Saved</th></tr></thead>
      <tbody>${byTier.sort((a,b)=>b.saved_with_replicas-a.saved_with_replicas).map(t=>`<tr>
        <td><span style="color:${tc[t.tier]||'var(--text-1)'};font-family:var(--mono);font-weight:600">${t.tier}</span></td>
        <td class="td-num">${t.count}</td>
        <td class="td-num"><span class="badge badge-accent">${t.in_scope}</span></td>
        <td class="td-num">${Utils.bytesToHuman(t.total_primary)}</td>
        <td class="td-num text-green">${Utils.bytesToHuman(t.saved)}</td>
        <td class="td-num" style="color:var(--green);font-weight:600">${Utils.bytesToHuman(t.saved_with_replicas)}</td>
        <td class="td-num">${t.total_primary>0?`<span class="badge ${(t.saved/t.total_primary*100)>15?'badge-green':'badge-gray'}">${Math.round(t.saved/t.total_primary*100)}%</span>`:'—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  },

  renderPhaseBreakdown(byPhase) {
    if (!byPhase?.length) return '<div class="empty-state"><p>No ILM phase data</p></div>';
    return `<div class="table-wrap"><table>
      <thead><tr><th>ILM Phase</th><th>Indices</th><th>Est. Primary Freed</th><th>Est. Total Freed (incl. replicas)</th></tr></thead>
      <tbody>${byPhase.sort((a,b)=>b.saved_with_replicas-a.saved_with_replicas).map(p=>`<tr>
        <td>${Utils.phaseBadge(p.phase)}</td>
        <td class="td-num">${p.count}</td>
        <td class="td-num text-green">${Utils.bytesToHuman(p.saved)}</td>
        <td class="td-num" style="color:var(--green);font-weight:600">${Utils.bytesToHuman(p.saved_with_replicas)}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  },

  renderMigrationPlan(migration, meta) {
    if (!migration.total_indices) return `
      <div class="empty-state" style="padding:40px">
        <div class="icon">✓</div>
        <p>No indices need migration — all eligible indices are already on <strong>${meta.target_codec}</strong></p>
      </div>`;

    const fullScript = [
      `# ─── Step 1: Apply codec to all ${migration.total_indices} indices ───`,
      ...migration.batches.flatMap(b => b.indices.map(i =>
        `PUT /${i.index}/_settings\n{"index.codec":"${meta.target_codec}"}`
      )),
      ``,
      `# ─── Step 2: Force merge batch by batch (during low-traffic windows) ───`,
      `# Each force merge rewrites all segments — CPU + I/O intensive`,
      ...migration.batches.map(b =>
        `\n# Batch ${b.batch}/${migration.total_batches} — est. ${b.batch_saved} freed\n` +
        b.indices.map(i => `POST /${i.index}/_forcemerge?max_num_segments=1`).join('\n')
      ),
    ].join('\n');

    return `
      <div style="margin-bottom:12px;padding:12px 16px;background:rgba(0,229,160,0.06);border:1px solid rgba(0,229,160,0.15);border-radius:var(--radius);font-size:12px;font-family:var(--mono);color:var(--green)">
        💡 <strong>Important:</strong> The codec setting only affects new segments. Run <code>_forcemerge</code> to rewrite existing ones. Do <strong>one batch at a time</strong> — monitor CPU and I/O between batches.
      </div>

      <div style="background:var(--bg-1);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:16px;overflow:hidden">
        <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
          <span style="font-family:var(--mono);font-size:12px;font-weight:700">Full migration script</span>
          <button class="btn btn-ghost btn-sm" id="copy-script-btn">📋 Copy</button>
        </div>
        <pre id="migration-script" style="font-family:var(--mono);font-size:11px;color:var(--accent);padding:16px;overflow:auto;max-height:260px;margin:0;white-space:pre">${Utils.escapeHtml(fullScript)}</pre>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px">
        ${migration.batches.map(batch => `
          <div style="background:var(--bg-1);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
            <div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
              <span style="font-family:var(--mono);font-size:13px;font-weight:600">
                Batch ${batch.batch} <span style="color:var(--text-2);font-weight:400">/ ${migration.total_batches} · ${batch.indices.length} indices</span>
              </span>
              <span style="font-size:12px;font-family:var(--mono);color:var(--green)">↓ ${batch.batch_saved} freed</span>
            </div>
            <table>
              <thead><tr><th>Index</th><th>Phase</th><th>Tier</th><th>Codec</th><th>Primary</th><th>Freed</th><th>%</th><th>Segments</th></tr></thead>
              <tbody>
                ${batch.indices.map(i=>`<tr>
                  <td class="mono" style="font-size:11px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${Utils.escapeHtml(i.index)}">${Utils.escapeHtml(i.index)}</td>
                  <td>${Utils.phaseBadge(i.phase)}</td>
                  <td>${i.tier?`<span class="badge badge-${i.tier==='hot'?'red':i.tier==='warm'?'orange':i.tier==='cold'?'accent':'gray'}">${i.tier}</span>`:'—'}</td>
                  <td>${this.codecBadge(i.current_codec)}</td>
                  <td class="td-num">${i.primary_size}</td>
                  <td class="td-num text-green">${i.freed}</td>
                  <td class="td-num"><span class="badge ${i.saved_pct>20?'badge-green':i.saved_pct>10?'badge-yellow':'badge-gray'}">${i.saved_pct}%</span></td>
                  <td class="td-num text-muted">${i.segments}</td>
                </tr>`).join('')}
              </tbody>
            </table>
          </div>
        `).join('')}
      </div>`;
  },

  // ── INDICES TAB ────────────────────────────────────────────────────────────
  renderIndicesTab(indices) {
    const paged = Utils.paginate(indices, this.page, this.perPage);
    return `
      <div class="filter-bar">
        <div class="filter-group"><label>CODEC</label>
          <select id="codec-filter">
            <option value="">All</option>
            <option value="default" ${this.filters.codec==='default'?'selected':''}>default (LZ4)</option>
            <option value="best_compression" ${this.filters.codec==='best_compression'?'selected':''}>best_compression</option>
          </select>
        </div>
        <div class="filter-sep"></div>
        <div class="filter-group"><label>SEARCH</label>
          <input type="text" id="codec-search" class="search-input" placeholder="Filter by name…" value="${Utils.escapeHtml(this.filters.pattern)}">
        </div>
      </div>
      <div class="table-wrap">
        <div class="table-toolbar">
          <span class="mono" style="font-size:12px">${paged.items.length} of ${indices.length} indices</span>
        </div>
        <table>
          <thead><tr><th>Index</th><th>Codec</th><th>Algorithm</th><th>Primary Size</th><th>Total Size</th><th>Docs</th><th>Replicas</th><th>→ best_compression saving</th><th>Segments</th></tr></thead>
          <tbody>${paged.items.map(idx => this.row(idx)).join('')}</tbody>
        </table>
        <div class="pagination" id="codec-pagination"></div>
      </div>`;
  },

  bindIndicesEvents(el) {
    document.getElementById('codec-filter')?.addEventListener('change', (e) => {
      this.filters.codec = e.target.value; this.page = 1; this.render();
    });
    document.getElementById('codec-search')?.addEventListener('input', Utils.debounce((e) => {
      this.filters.pattern = e.target.value; this.page = 1; this.render();
    }, 350));
    if (this.data) {
      Utils.renderPagination(document.getElementById('codec-pagination'), this.page, Math.ceil(this.data.indices.length / this.perPage), (p) => {
        this.page = p; this.render();
      });
    }

    // Copy script button (could appear in migration plan)
    document.getElementById('copy-script-btn')?.addEventListener('click', function() {
      const pre = document.getElementById('migration-script');
      if (pre) { navigator.clipboard.writeText(pre.textContent).catch(()=>{}); this.textContent = '✓ Copied!'; setTimeout(()=>this.textContent='📋 Copy',2000); }
    });
  },

  row(idx) {
    const sav = idx.savings_to_best_compression;
    const pct = sav?.saved_pct || 0;
    const best = idx.current_codec === 'best_compression';
    return `
      <tr data-index="${Utils.escapeHtml(idx.index)}">
        <td class="td-name"><span title="${Utils.escapeHtml(idx.index)}">${Utils.escapeHtml(idx.index)}</span></td>
        <td>${this.codecBadge(idx.current_codec)}</td>
        <td class="mono text-muted" style="font-size:11px">${Utils.escapeHtml(idx.codec_info?.algorithm || idx.current_codec)}</td>
        <td class="td-num">${Utils.bytesToHuman(idx.primary_size_bytes)}</td>
        <td class="td-num text-muted">${Utils.bytesToHuman(idx.size_bytes)}</td>
        <td class="td-num">${Utils.numFormat(idx.docs)}</td>
        <td class="td-num">${idx.replicas}</td>
        <td class="td-num">${best?'<span class="badge badge-green">✓ optimal</span>':pct>0?`<span class="badge ${pct>20?'badge-yellow':'badge-gray'}">-${pct}% (~${Utils.bytesToHuman(sav.saved_bytes)})</span>`:'<span class="text-muted">—</span>'}</td>
        <td class="td-num text-muted">${idx.segments}</td>
      </tr>`;
  },

  codecBadge(codec) {
    const map = { default:'<span class="badge badge-accent">default (LZ4)</span>', best_compression:'<span class="badge badge-green">best_compression</span>', legacy_default:'<span class="badge badge-gray">legacy_default</span>', legacy_best_compression:'<span class="badge badge-gray">legacy_best_comp</span>' };
    return map[codec] || `<span class="badge badge-gray">${Utils.escapeHtml(String(codec))}</span>`;
  },

  // ── REFERENCE TAB ──────────────────────────────────────────────────────────
  renderCodecCard(name, info, summary) {
    if (!info) return '';
    const wb = Math.round(info.write_speed * 100);
    const rb = Math.round(info.read_speed * 100);
    const cb = Math.round((1 - info.compression_ratio) * 100);
    return `
      <div style="background:var(--bg-1);border:1px solid var(--border);border-radius:var(--radius);padding:20px;border-top:3px solid ${info.color||'var(--border)'}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">${this.codecBadge(name)}<span style="font-size:11px;color:var(--text-2);font-family:var(--mono)">${info.es_versions}</span></div>
        <div style="font-size:12px;font-family:var(--mono);color:var(--accent);margin-bottom:8px">${Utils.escapeHtml(info.algorithm)}</div>
        <p style="font-size:12px;color:var(--text-1);margin-bottom:14px;line-height:1.6">${Utils.escapeHtml(info.description)}</p>
        <div class="bar-row"><div class="bar-label"><span>Write Speed</span><span>${wb}%</span></div>${Utils.bar(wb,wb>=90?'green':wb>=75?'yellow':'red')}</div>
        <div class="bar-row"><div class="bar-label"><span>Read Speed</span><span>${rb}%</span></div>${Utils.bar(rb,rb>=90?'green':rb>=75?'yellow':'red')}</div>
        <div class="bar-row"><div class="bar-label"><span>Compression</span><span>${cb}%</span></div>${Utils.bar(cb,cb>=60?'green':cb>=40?'yellow':'red')}</div>
        <div style="margin-top:12px">${(info.pros||[]).map(p=>`<div style="font-size:11px;color:var(--green);font-family:var(--mono);margin-bottom:2px">+ ${Utils.escapeHtml(p)}</div>`).join('')}${(info.cons||[]).map(c=>`<div style="font-size:11px;color:var(--text-2);font-family:var(--mono);margin-bottom:2px">− ${Utils.escapeHtml(c)}</div>`).join('')}</div>
        <div style="margin-top:12px;padding:8px 10px;background:var(--bg-2);border-radius:6px;font-size:11px;font-family:var(--mono);color:var(--text-2)"><strong style="color:var(--text-1)">Best for:</strong> ${Utils.escapeHtml(info.use_case)}</div>
      </div>`;
  },

  renderComparisonTable(summary) {
    const z = summary.has_zstd_native;
    return `
      <div class="table-wrap">
        <div style="padding:14px 16px;border-bottom:1px solid var(--border)"><div class="section-title">📊 Benchmark Comparison</div><div style="font-size:11px;color:var(--text-2);font-family:var(--mono);margin-top:4px">Sources: Elastic blog · AWS OpenSearch benchmarks · community log workload tests</div></div>
        <table><thead><tr><th>Codec</th><th>Algorithm</th><th>Storage vs LZ4</th><th>Write Speed</th><th>Read Speed</th><th>CPU</th><th>Best for</th></tr></thead>
        <tbody>
          <tr><td>${this.codecBadge('default')}</td><td class="mono text-accent" style="font-size:12px">LZ4 + dict</td><td><span class="badge badge-gray">baseline</span></td><td><span class="badge badge-green">fastest ⚡</span></td><td><span class="badge badge-green">fastest ⚡</span></td><td><span class="badge badge-green">low</span></td><td style="font-size:11px">Hot tier, NRT, high ingest</td></tr>
          <tr style="background:rgba(0,229,160,0.03)"><td>${this.codecBadge('best_compression')}</td><td class="mono" style="font-size:12px;color:var(--green)">${z?'ZSTD level 3':'DEFLATE + dict'}</td><td><span class="badge badge-green">${z?'-28 to -35%':'-22 to -26%'}</span></td><td><span class="badge badge-yellow">${z?'~same as LZ4':'-12 to -25%'}</span></td><td><span class="badge badge-yellow">-10 to -20%</span></td><td><span class="badge badge-yellow">${z?'medium':'medium-high'}</span></td><td style="font-size:11px">Warm/cold, archives, logs</td></tr>
        </tbody></table>
      </div>`;
  },

  renderEducation(summary) {
    return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">
      <div style="background:var(--bg-1);border:1px solid var(--border);border-radius:var(--radius);padding:16px"><div style="font-family:var(--mono);font-size:12px;font-weight:600;color:var(--accent);margin-bottom:8px">🔄 How codec changes work</div><div style="font-size:12px;color:var(--text-1);line-height:1.7;font-family:var(--mono)">Only applies to new Lucene segments. To migrate existing data: <code>_forcemerge?max_num_segments=1</code> rewrites all segments. CPU + I/O intensive — do during low-traffic windows.</div></div>
      <div style="background:var(--bg-1);border:1px solid var(--border);border-radius:var(--radius);padding:16px"><div style="font-family:var(--mono);font-size:12px;font-weight:600;color:var(--yellow);margin-bottom:8px">⚡ Hot/Warm strategy</div><div style="font-size:12px;color:var(--text-1);line-height:1.7;font-family:var(--mono)">Keep <code>default</code> on hot for max ingest speed. Apply <code>best_compression</code> on warm/cold. Configure ILM to trigger a forcemerge action after rollover.</div></div>
      <div style="background:var(--bg-1);border:1px solid var(--border);border-radius:var(--radius);padding:16px"><div style="font-family:var(--mono);font-size:12px;font-weight:600;color:var(--green);margin-bottom:8px">📦 What gets compressed</div><div style="font-size:12px;color:var(--text-1);line-height:1.7;font-family:var(--mono)"><code>index.codec</code> only compresses <strong>stored fields</strong>: <code>_source</code> and <code>_id</code>. Inverted index, doc values, and points are handled separately by Lucene.</div></div>
      <div style="background:var(--bg-1);border:1px solid var(--border);border-radius:var(--radius);padding:16px"><div style="font-family:var(--mono);font-size:12px;font-weight:600;color:var(--orange);margin-bottom:8px">📊 Savings by data type</div><div style="font-size:12px;color:var(--text-1);line-height:1.6;font-family:var(--mono)">Log data (repetitive): 30–45%<br>JSON + metadata: 22–35%<br>Time-series metrics: 10–20%<br>Binary/random: 0–5%<br><span style="color:var(--green)">SFR infra logs → expect 25–40%</span></div></div>
    </div>`;
  },
};

window.Codec = Codec;
