/* ============================================================
   ElasticGuard — ILM Control, Templates, Orphaned, Index Stats
   ============================================================ */

// ── RENDER FUNCTIONS appelées par app.js au changement de page ──

window.renderIlmControlPage = async function(container) {
  container.innerHTML = `
    <div class="page-header">
      <div><h2>ILM Policy Manager</h2><p class="subtitle">Create, edit, bulk-assign lifecycle policies</p></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" onclick="renderIlmControlPage(document.getElementById('page-ilm-control'))">↻ Refresh</button>
        <button class="btn btn-primary" onclick="ilmCtrl.openCreatePolicy()">+ New Policy</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="card-title">⚡ Bulk Attach by Prefix</div>
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-top:12px">
        <div class="form-group" style="flex:1;min-width:180px;margin:0">
          <label>Index Prefix</label>
          <input class="form-input" id="ic-bulk-prefix" placeholder="valentine-logs-" />
        </div>
        <div class="form-group" style="flex:1;min-width:180px;margin:0">
          <label>Policy Name</label>
          <select class="form-input" id="ic-bulk-policy"><option value="">— loading —</option></select>
        </div>
        <button class="btn btn-primary" onclick="ilmCtrl.bulkAttach()">Attach</button>
      </div>
    </div>

    <div class="stats-row" id="ic-stats-row">
      <div class="stat-card"><div class="stat-label">Total Policies</div><div class="stat-value" id="ic-s-total">…</div></div>
      <div class="stat-card"><div class="stat-label">Good</div><div class="stat-value green" id="ic-s-good">…</div></div>
      <div class="stat-card"><div class="stat-label">Warn</div><div class="stat-value yellow" id="ic-s-warn">…</div></div>
      <div class="stat-card"><div class="stat-label">Bad</div><div class="stat-value red" id="ic-s-bad">…</div></div>
    </div>

    <div class="search-bar-row">
      <input class="form-input" id="ic-search" placeholder="Filter policies…" oninput="ilmCtrl.filterTable()" style="max-width:360px" />
    </div>

    <div class="table-wrap">
      <table><thead><tr>
        <th>Policy Name</th><th>Phases</th><th>Rollover Conditions</th><th>Quality</th><th>Actions</th>
      </tr></thead><tbody id="ic-tbody"><tr><td colspan="5" class="loading-cell">Loading…</td></tr></tbody></table>
    </div>

    <!-- Modal -->
    <div id="ic-modal" class="modal-overlay" style="display:none">
      <div class="modal-box" style="max-width:620px">
        <h3 id="ic-modal-title">Create ILM Policy</h3>
        <div class="form-group"><label>Policy Name</label><input class="form-input" id="ic-pname" placeholder="my-policy" /></div>
        <div class="form-group"><label>Policy JSON</label><textarea class="form-input" id="ic-pjson" rows="14" style="font-family:monospace;font-size:12px" placeholder='{"phases":{"hot":{"actions":{"rollover":{"max_age":"30d","max_size":"50gb"}}},"delete":{"min_age":"90d","actions":{"delete":{}}}}}' ></textarea></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button class="btn btn-ghost" onclick="ilmCtrl.closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="ilmCtrl.savePolicy()">Save</button>
        </div>
      </div>
    </div>`;

  await ilmCtrl.load();
};

window.renderTemplatesPage = async function(container) {
  container.innerHTML = `
    <div class="page-header">
      <div><h2>Index Template Manager</h2><p class="subtitle">Composable & legacy templates with ILM assignments</p></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost" onclick="renderTemplatesPage(document.getElementById('page-templates'))">↻ Refresh</button>
        <button class="btn btn-primary" onclick="tmplCtrl.openCreate()">+ New Template</button>
      </div>
    </div>
    <div class="stats-row">
      <div class="stat-card"><div class="stat-label">Composable</div><div class="stat-value" id="tm-s-comp">…</div></div>
      <div class="stat-card"><div class="stat-label">Legacy</div><div class="stat-value" id="tm-s-leg">…</div></div>
      <div class="stat-card"><div class="stat-label">With ILM</div><div class="stat-value green" id="tm-s-ilm">…</div></div>
      <div class="stat-card"><div class="stat-label">Without ILM</div><div class="stat-value yellow" id="tm-s-noilm">…</div></div>
    </div>
    <div class="search-bar-row" style="display:flex;gap:10px">
      <input class="form-input" id="tm-search" placeholder="Filter templates…" oninput="tmplCtrl.filter()" style="flex:1;max-width:360px" />
      <select class="form-input" id="tm-type" onchange="tmplCtrl.filter()" style="width:160px">
        <option value="">All types</option><option value="composable">Composable</option><option value="legacy">Legacy</option>
      </select>
    </div>
    <div class="table-wrap">
      <table><thead><tr>
        <th>Template Name</th><th>Type</th><th>Index Patterns</th><th>Priority</th><th>ILM Policy</th><th>Actions</th>
      </tr></thead><tbody id="tm-tbody"><tr><td colspan="6" class="loading-cell">Loading…</td></tr></tbody></table>
    </div>
    <div id="tm-modal" class="modal-overlay" style="display:none">
      <div class="modal-box" style="max-width:620px">
        <h3 id="tm-modal-title">Create Template</h3>
        <div class="form-group"><label>Template Name</label><input class="form-input" id="tm-name" placeholder="my-template" /></div>
        <div class="form-group"><label>Template JSON</label><textarea class="form-input" id="tm-json" rows="12" style="font-family:monospace;font-size:12px" placeholder='{"index_patterns":["my-logs-*"],"priority":100,"template":{"settings":{"index.lifecycle.name":"my-policy"}}}' ></textarea></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button class="btn btn-ghost" onclick="tmplCtrl.closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="tmplCtrl.save()">Save</button>
        </div>
      </div>
    </div>`;
  await tmplCtrl.load();
};

window.renderOrphanedPage = async function(container) {
  container.innerHTML = `
    <div class="page-header">
      <div><h2>Orphaned Index Fixer</h2><p class="subtitle">Broken ILM references & unmanaged indices</p></div>
      <button class="btn btn-ghost" onclick="orphanCtrl.load()">↻ Scan Now</button>
    </div>
    <div class="stats-row">
      <div class="stat-card"><div class="stat-label">Broken ILM Ref</div><div class="stat-value red" id="or-s-broken">—</div></div>
      <div class="stat-card"><div class="stat-label">No ILM Assigned</div><div class="stat-value yellow" id="or-s-none">—</div></div>
      <div class="stat-card"><div class="stat-label">Selected</div><div class="stat-value" id="or-s-sel">0</div></div>
      <div class="stat-card"><div class="stat-label">Policies Available</div><div class="stat-value" id="or-s-pol">—</div></div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div class="card-title">🔧 Bulk Fix Selected</div>
      <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-top:12px">
        <div class="form-group" style="flex:1;min-width:220px;margin:0">
          <label>Assign Policy</label>
          <select class="form-input" id="or-fix-policy"><option value="">— select policy —</option></select>
        </div>
        <button class="btn btn-primary" onclick="orphanCtrl.fixSelected()">✓ Fix Selected</button>
        <button class="btn btn-ghost" onclick="orphanCtrl.selectAllBroken()">Select All Broken</button>
      </div>
    </div>
    <div style="margin-bottom:8px;font-size:13px;font-weight:600;color:var(--text-muted)">BROKEN ILM REFERENCES</div>
    <div class="table-wrap" style="margin-bottom:24px">
      <table><thead><tr>
        <th style="width:32px"><input type="checkbox" onchange="orphanCtrl.toggleAll('broken',this.checked)"/></th>
        <th>Index Name</th><th>Referenced Policy</th><th>Status</th><th>Actions</th>
      </tr></thead><tbody id="or-broken-tbody"><tr><td colspan="5" class="loading-cell">Click Scan Now</td></tr></tbody></table>
    </div>
    <div style="margin-bottom:8px;font-size:13px;font-weight:600;color:var(--text-muted)">UNMANAGED INDICES (no ILM)</div>
    <div style="display:flex;gap:10px;margin-bottom:10px">
      <input class="form-input" id="or-search" placeholder="Filter…" oninput="orphanCtrl.filterNone()" style="max-width:300px"/>
      <select class="form-input" id="or-assign-policy" style="width:200px"><option value="">— assign policy —</option></select>
      <button class="btn btn-primary" onclick="orphanCtrl.assignSelected()">Assign to Selected</button>
    </div>
    <div class="table-wrap">
      <table><thead><tr>
        <th style="width:32px"><input type="checkbox" onchange="orphanCtrl.toggleAll('none',this.checked)"/></th>
        <th>Index Name</th><th>Actions</th>
      </tr></thead><tbody id="or-none-tbody"><tr><td colspan="3" class="loading-cell">Click Scan Now</td></tr></tbody></table>
    </div>`;
  await orphanCtrl.load();
};

window.renderIdxStatsPage = async function(container) {
  container.innerHTML = `
    <div class="page-header">
      <div><h2>Index Statistics</h2><p class="subtitle">Per-index health, ILM phase, rollover countdown</p></div>
      <button class="btn btn-ghost" onclick="idxStats.load()">↻ Refresh</button>
    </div>
    <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">
      <input class="form-input" id="is-search" placeholder="Filter by name…" oninput="idxStats.filter()" style="flex:1;min-width:180px;max-width:320px"/>
      <input class="form-input" id="is-prefix" placeholder="Prefix (e.g. valentine-)" style="max-width:240px"/>
      <button class="btn btn-primary" onclick="idxStats.load()">Apply</button>
      <select class="form-input" id="is-health" onchange="idxStats.filter()" style="width:140px">
        <option value="">All health</option>
        <option value="green">🟢 Green</option>
        <option value="yellow">🟡 Yellow</option>
        <option value="red">🔴 Red</option>
      </select>
    </div>
    <div id="is-grid" class="indices-grid" style="grid-template-columns:repeat(auto-fill,minmax(360px,1fr))">
      <div class="loading-cell" style="grid-column:1/-1;padding:60px;text-align:center">Loading…</div>
    </div>`;
  await idxStats.load();
};

// ── API helper ──
async function icApi(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function icToast(msg, type='success') {
  if (window.showToast) { window.showToast(msg, type); return; }
  alert(msg);
}

function fmtN(n) {
  if (!n) return '0';
  if (n >= 1e9) return (n/1e9).toFixed(1)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return String(n);
}

// ════════════════════════════════════════════════
// ILM CONTROL CTRL
// ════════════════════════════════════════════════
const ilmCtrl = {
  data: [],

  async load() {
    const tbody = document.getElementById('ic-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">Loading…</td></tr>';
    try {
      const { policies } = await icApi('GET', '/api/ilm-ctrl/policies');
      this.data = policies;
      this.renderTable();
      this.fillPolicySelect('ic-bulk-policy', policies.map(p => p.name));

      const g = policies.filter(p => p._meta?.score === 'good').length;
      const w = policies.filter(p => p._meta?.score === 'warn').length;
      const b = policies.filter(p => p._meta?.score === 'bad').length;
      document.getElementById('ic-s-total').textContent = policies.length;
      document.getElementById('ic-s-good').textContent  = g;
      document.getElementById('ic-s-warn').textContent  = w;
      document.getElementById('ic-s-bad').textContent   = b;
    } catch(e) { icToast(e.message, 'error'); }
  },

  renderTable(list) {
    const data = list || this.data;
    const tbody = document.getElementById('ic-tbody');
    if (!tbody) return;
    if (!data.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No policies found</td></tr>'; return; }
    tbody.innerHTML = data.map(p => {
      const phases = p.policy?.phases || {};
      const phaseNames = ['hot','warm','cold','frozen','delete'].filter(ph => phases[ph]);
      const rv = phases.hot?.actions?.rollover;
      const rvStr = rv ? [rv.max_age, rv.max_size, rv.max_docs].filter(Boolean).join(' / ') : '—';
      const score = p._meta?.score || 'good';
      const warnings = p._meta?.warnings || [];
      const cls = score === 'good' ? 'badge-green' : score === 'warn' ? 'badge-yellow' : 'badge-red';
      return `<tr>
        <td style="font-family:monospace;color:var(--accent-blue)">${p.name}</td>
        <td>${phaseNames.map(ph=>`<span class="badge ${ph}">${ph}</span>`).join(' ') || '<span class="badge red">none</span>'}</td>
        <td style="font-family:monospace;font-size:12px">${rvStr}</td>
        <td>
          <span class="health-badge ${cls}">${score.toUpperCase()}</span>
          ${warnings.map(w=>`<div style="font-size:11px;color:var(--yellow)">⚠ ${w}</div>`).join('')}
        </td>
        <td>
          <button class="btn btn-sm" onclick="ilmCtrl.edit('${p.name}')">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="ilmCtrl.delete('${p.name}')">Delete</button>
        </td>
      </tr>`;
    }).join('');
  },

  filterTable() {
    const q = document.getElementById('ic-search')?.value.toLowerCase() || '';
    this.renderTable(this.data.filter(p => p.name.toLowerCase().includes(q)));
  },

  fillPolicySelect(id, names) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">— select policy —</option>' + names.map(n=>`<option>${n}</option>`).join('');
  },

  openCreatePolicy() {
    document.getElementById('ic-modal-title').textContent = 'Create ILM Policy';
    document.getElementById('ic-pname').value = '';
    document.getElementById('ic-pname').readOnly = false;
    document.getElementById('ic-pjson').value = '';
    document.getElementById('ic-modal').style.display = 'flex';
  },

  async edit(name) {
    try {
      const { policies } = await icApi('GET', '/api/ilm-ctrl/policies');
      const p = policies.find(x => x.name === name);
      document.getElementById('ic-modal-title').textContent = 'Edit: ' + name;
      document.getElementById('ic-pname').value = name;
      document.getElementById('ic-pname').readOnly = true;
      document.getElementById('ic-pjson').value = JSON.stringify(p.policy, null, 2);
      document.getElementById('ic-modal').style.display = 'flex';
    } catch(e) { icToast(e.message, 'error'); }
  },

  closeModal() { document.getElementById('ic-modal').style.display = 'none'; },

  async savePolicy() {
    const name = document.getElementById('ic-pname').value.trim();
    let policy;
    try { policy = JSON.parse(document.getElementById('ic-pjson').value); } catch { icToast('Invalid JSON', 'error'); return; }
    try {
      await icApi('PUT', `/api/ilm-ctrl/policies/${name}`, { policy });
      icToast(`Policy '${name}' saved`);
      this.closeModal();
      this.load();
    } catch(e) { icToast(e.message, 'error'); }
  },

  async delete(name) {
    if (!confirm(`Delete policy '${name}'?`)) return;
    try {
      await icApi('DELETE', `/api/ilm-ctrl/policies/${name}`);
      icToast('Deleted');
      this.load();
    } catch(e) { icToast(e.message, 'error'); }
  },

  async bulkAttach() {
    const prefix = document.getElementById('ic-bulk-prefix')?.value.trim();
    const policyName = document.getElementById('ic-bulk-policy')?.value;
    if (!prefix || !policyName) { icToast('Prefix and policy required', 'error'); return; }
    try {
      const r = await icApi('POST', '/api/ilm-ctrl/attach-by-prefix', { prefix, policyName });
      icToast(`Attached to ${r.succeeded}/${r.total} indices${r.failed?.length ? ` (${r.failed.length} failed)` : ''}`);
    } catch(e) { icToast(e.message, 'error'); }
  },
};

// ════════════════════════════════════════════════
// TEMPLATES CTRL
// ════════════════════════════════════════════════
const tmplCtrl = {
  data: [],

  async load() {
    const tbody = document.getElementById('tm-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">Loading…</td></tr>';
    try {
      const { templates } = await icApi('GET', '/api/ilm-ctrl/templates');
      this.data = templates;
      this.render();
      document.getElementById('tm-s-comp').textContent  = templates.filter(t=>t.type==='composable').length;
      document.getElementById('tm-s-leg').textContent   = templates.filter(t=>t.type==='legacy').length;
      document.getElementById('tm-s-ilm').textContent   = templates.filter(t=>t.ilmPolicy).length;
      document.getElementById('tm-s-noilm').textContent = templates.filter(t=>!t.ilmPolicy).length;
    } catch(e) { icToast(e.message, 'error'); }
  },

  render(list) {
    const data = list || this.data;
    const tbody = document.getElementById('tm-tbody');
    if (!tbody) return;
    if (!data.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No templates</td></tr>'; return; }
    tbody.innerHTML = data.map(t => `<tr>
      <td style="font-family:monospace;color:var(--accent-blue)">${t.name}</td>
      <td><span class="badge ${t.type==='composable'?'blue':'gray'}">${t.type}</span></td>
      <td style="font-size:11px">${(t.indexPatterns||[]).map(p=>`<code>${p}</code>`).join(', ')}</td>
      <td style="font-family:monospace">${t.priority ?? '—'}</td>
      <td>${t.ilmPolicy ? `<span class="health-badge badge-green">${t.ilmPolicy}</span>` : '<span class="health-badge badge-yellow">none</span>'}</td>
      <td>
        <button class="btn btn-sm" onclick="tmplCtrl.edit('${t.name}','${t.type}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="tmplCtrl.delete('${t.name}','${t.type}')">Delete</button>
      </td>
    </tr>`).join('');
  },

  filter() {
    const q = document.getElementById('tm-search')?.value.toLowerCase() || '';
    const type = document.getElementById('tm-type')?.value || '';
    this.render(this.data.filter(t => t.name.toLowerCase().includes(q) && (!type || t.type === type)));
  },

  openCreate() {
    document.getElementById('tm-modal-title').textContent = 'Create Template';
    document.getElementById('tm-name').value = '';
    document.getElementById('tm-name').readOnly = false;
    document.getElementById('tm-json').value = '';
    document.getElementById('tm-modal').style.display = 'flex';
  },

  async edit(name, type) {
    try {
      const data = await icApi('GET', `/api/ilm-ctrl/templates/${name}`);
      document.getElementById('tm-modal-title').textContent = 'Edit: ' + name;
      document.getElementById('tm-name').value = name;
      document.getElementById('tm-name').readOnly = true;
      document.getElementById('tm-json').value = JSON.stringify(data.index_template || data, null, 2);
      document.getElementById('tm-modal').style.display = 'flex';
    } catch(e) { icToast(e.message, 'error'); }
  },

  closeModal() { document.getElementById('tm-modal').style.display = 'none'; },

  async save() {
    const name = document.getElementById('tm-name').value.trim();
    let body;
    try { body = JSON.parse(document.getElementById('tm-json').value); } catch { icToast('Invalid JSON','error'); return; }
    try {
      await icApi('PUT', `/api/ilm-ctrl/templates/${name}`, body);
      icToast('Template saved');
      this.closeModal();
      this.load();
    } catch(e) { icToast(e.message, 'error'); }
  },

  async delete(name, type) {
    if (!confirm(`Delete '${name}'?`)) return;
    try {
      await icApi('DELETE', `/api/ilm-ctrl/templates/${name}?type=${type}`);
      icToast('Deleted');
      this.load();
    } catch(e) { icToast(e.message, 'error'); }
  },
};

// ════════════════════════════════════════════════
// ORPHAN CTRL
// ════════════════════════════════════════════════
const orphanCtrl = {
  broken: [], none: [], policyNames: [],

  async load() {
    try {
      const [{ orphaned, noPolicy }, { policies }] = await Promise.all([
        icApi('GET', '/api/ilm-ctrl/orphaned'),
        icApi('GET', '/api/ilm-ctrl/policies'),
      ]);
      this.broken = orphaned;
      this.none = noPolicy;
      this.policyNames = policies.map(p => p.name);
      this.renderBroken();
      this.renderNone();
      this.fillSelects();
      document.getElementById('or-s-broken').textContent = orphaned.length;
      document.getElementById('or-s-none').textContent   = noPolicy.length;
      document.getElementById('or-s-pol').textContent    = policies.length;
    } catch(e) { icToast(e.message, 'error'); }
  },

  renderBroken(list) {
    const data = list || this.broken;
    const tbody = document.getElementById('or-broken-tbody');
    if (!tbody) return;
    if (!data.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">✓ No broken references</td></tr>'; return; }
    tbody.innerHTML = data.map(o => `<tr>
      <td><input type="checkbox" class="chk-broken" data-index="${o.index}" onchange="orphanCtrl.countSel()"/></td>
      <td style="font-family:monospace;color:var(--accent-blue)">${o.index}</td>
      <td style="font-family:monospace;color:var(--red)">${o.referencedPolicy}</td>
      <td><span class="health-badge badge-red">Missing</span></td>
      <td>
        <button class="btn btn-sm" onclick="orphanCtrl.quickAttach('${o.index}')">Fix</button>
        <button class="btn btn-sm btn-danger" onclick="orphanCtrl.detach('${o.index}')">Clear</button>
      </td>
    </tr>`).join('');
  },

  renderNone(list) {
    const data = list || this.none;
    const tbody = document.getElementById('or-none-tbody');
    if (!tbody) return;
    if (!data.length) { tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">✓ All indices have ILM</td></tr>'; return; }
    tbody.innerHTML = data.map(o => `<tr>
      <td><input type="checkbox" class="chk-none" data-index="${o.index}" onchange="orphanCtrl.countSel()"/></td>
      <td style="font-family:monospace">${o.index}</td>
      <td><button class="btn btn-sm" onclick="orphanCtrl.quickAttach('${o.index}')">Assign ILM</button></td>
    </tr>`).join('');
  },

  filterNone() {
    const q = document.getElementById('or-search')?.value.toLowerCase() || '';
    this.renderNone(this.none.filter(o => o.index.toLowerCase().includes(q)));
  },

  fillSelects() {
    const opts = '<option value="">— select policy —</option>' + this.policyNames.map(n=>`<option>${n}</option>`).join('');
    ['or-fix-policy','or-assign-policy'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = opts;
    });
  },

  countSel() {
    const n = document.querySelectorAll('.chk-broken:checked,.chk-none:checked').length;
    const el = document.getElementById('or-s-sel');
    if (el) el.textContent = n;
  },

  toggleAll(type, checked) {
    document.querySelectorAll(type === 'broken' ? '.chk-broken' : '.chk-none').forEach(c => c.checked = checked);
    this.countSel();
  },

  selectAllBroken() { this.toggleAll('broken', true); },

  async fixSelected() {
    const policyName = document.getElementById('or-fix-policy')?.value;
    if (!policyName) { icToast('Select a policy', 'error'); return; }
    const indices = [...document.querySelectorAll('.chk-broken:checked')].map(c => c.dataset.index);
    if (!indices.length) { icToast('No indices selected', 'error'); return; }
    try {
      const r = await icApi('POST', '/api/ilm-ctrl/fix-orphaned', { indices, policyName });
      icToast(`Fixed ${r.succeeded}/${indices.length}`);
      this.load();
    } catch(e) { icToast(e.message, 'error'); }
  },

  async assignSelected() {
    const policyName = document.getElementById('or-assign-policy')?.value;
    if (!policyName) { icToast('Select a policy', 'error'); return; }
    const indices = [...document.querySelectorAll('.chk-none:checked')].map(c => c.dataset.index);
    if (!indices.length) { icToast('No indices selected', 'error'); return; }
    try {
      const r = await icApi('POST', '/api/ilm-ctrl/fix-orphaned', { indices, policyName });
      icToast(`Assigned to ${r.succeeded}/${indices.length}`);
      this.load();
    } catch(e) { icToast(e.message, 'error'); }
  },

  async quickAttach(index) {
    const policy = prompt(`Assign ILM policy to ${index}:\nPolicy name:`);
    if (!policy) return;
    try {
      await icApi('POST', '/api/ilm-ctrl/attach', { index, policyName: policy });
      icToast(`Attached '${policy}' → ${index}`);
      this.load();
    } catch(e) { icToast(e.message, 'error'); }
  },

  async detach(index) {
    if (!confirm(`Clear ILM from '${index}'?`)) return;
    try {
      await icApi('POST', '/api/ilm-ctrl/detach', { index });
      icToast('ILM cleared');
      this.load();
    } catch(e) { icToast(e.message, 'error'); }
  },
};

// ════════════════════════════════════════════════
// INDEX STATS
// ════════════════════════════════════════════════
const idxStats = {
  data: [],

  async load() {
    const grid = document.getElementById('is-grid');
    if (grid) grid.innerHTML = '<div style="grid-column:1/-1;padding:60px;text-align:center;color:var(--text-muted)">Loading…</div>';
    const prefix = document.getElementById('is-prefix')?.value.trim() || '';
    try {
      const params = new URLSearchParams({ limit: 200 });
      if (prefix) params.set('prefix', prefix);
      const { stats } = await icApi('GET', `/api/ilm-ctrl/index-stats?${params}`);
      this.data = stats;
      this.filter();
    } catch(e) {
      if (grid) grid.innerHTML = `<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--red)">Error: ${e.message}</div>`;
    }
  },

  filter() {
    const q      = document.getElementById('is-search')?.value.toLowerCase() || '';
    const health = document.getElementById('is-health')?.value || '';
    this.render(this.data.filter(s => s.index.toLowerCase().includes(q) && (!health || s.health === health)));
  },

  render(data) {
    const grid = document.getElementById('is-grid');
    if (!grid) return;
    if (!data.length) { grid.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--text-muted)">No indices match</div>'; return; }

    const phases = ['hot','warm','cold','frozen','delete'];
    grid.innerHTML = data.map(s => {
      const hcls = s.health === 'green' ? 'green' : s.health === 'yellow' ? 'yellow' : 'red';
      const cur = s.ilm?.phase;
      const pipeline = phases.map((ph,i) =>
        `<span style="padding:2px 7px;border-radius:3px;font-size:10px;font-family:monospace;font-weight:600;
          border:1px solid ${ph===cur?'var(--accent-blue)':'var(--border)'};
          color:${ph===cur?'var(--accent-blue)':'var(--text-muted)'};
          background:${ph===cur?'rgba(59,130,246,.1)':'transparent'}">${ph}</span>
        ${i<4?'<span style="color:var(--border);font-size:11px">›</span>':''}`
      ).join('');

      const r = s.rolloverEstimate;
      let rollHtml = '';
      if (r && r.maxAgeDays !== null) {
        const bc = r.pct < 60 ? 'var(--green)' : r.pct < 85 ? 'var(--yellow)' : 'var(--red)';
        rollHtml = `
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:4px">
              <span>Rollover: ${r.ageInPhaseDays}d / ${r.maxAgeDays}d</span>
              <span style="color:${bc}">${r.daysUntilRollover}d left</span>
            </div>
            <div style="background:var(--border);border-radius:2px;height:4px">
              <div style="background:${bc};height:4px;border-radius:2px;width:${r.pct}%"></div>
            </div>
          </div>`;
      }

      return `
        <div class="index-card" style="border:1px solid var(--border);border-radius:6px;padding:16px;background:var(--card-bg)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
            <div style="font-family:monospace;font-size:11px;color:var(--accent-blue);word-break:break-all">${s.index}</div>
            <span class="health-dot ${hcls}" title="${s.health}"></span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;margin-bottom:10px">
            <div><div style="font-size:10px;color:var(--text-muted)">Size</div><div style="font-family:monospace;font-size:12px">${s.storeSizeGb} GB</div></div>
            <div><div style="font-size:10px;color:var(--text-muted)">Docs</div><div style="font-family:monospace;font-size:12px">${fmtN(s.docsCount)}</div></div>
            <div><div style="font-size:10px;color:var(--text-muted)">Shards</div><div style="font-family:monospace;font-size:12px">${s.primaryShards}P / ${s.replicas}R</div></div>
            <div><div style="font-size:10px;color:var(--text-muted)">Created</div><div style="font-family:monospace;font-size:12px">${s.creationDateString||'—'}</div></div>
          </div>
          ${s.policyName
            ? `<div style="margin-bottom:6px"><span class="health-badge badge-green" style="font-size:10px">${s.policyName}</span></div>
               <div style="display:flex;align-items:center;gap:2px;flex-wrap:wrap">${pipeline}</div>
               ${s.ilm?.error ? `<div style="font-size:11px;color:var(--red);margin-top:4px">✖ ${s.ilm.error}</div>` : ''}`
            : `<div style="font-size:11px;color:var(--yellow)">⚠ No ILM policy assigned</div>`}
          ${rollHtml}
        </div>`;
    }).join('');
  },
};
