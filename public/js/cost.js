const Cost = {
  data: null,
  pricePerGB: 0.10,

  async render() {
    const el = document.getElementById('page-cost');
    el.innerHTML = '<div class="loading">Calculating costs</div>';
    try {
      const data = await API.cost({ price_per_gb: this.pricePerGB });
      this.data = data;
      this.renderContent(el);
    } catch(e) {
      el.innerHTML = `<div class="error-msg">Error: ${Utils.escapeHtml(e.message)}</div>`;
    }
  },

  async reload(el) {
    const input = document.getElementById('price-input');
    if (input) this.pricePerGB = parseFloat(input.value) || 0.10;
    el.querySelector('#cost-body').innerHTML = '<div class="loading">Recalculating</div>';
    try {
      const data = await API.cost({ price_per_gb: this.pricePerGB });
      this.data = data;
      this.renderBody(el.querySelector('#cost-body'), data);
    } catch(e) {
      el.querySelector('#cost-body').innerHTML = `<div class="error-msg">${Utils.escapeHtml(e.message)}</div>`;
    }
  },

  renderContent(el) {
    el.innerHTML = `
      <div class="page-header page-header-row">
        <div>
          <h1>💰 Storage Cost Calculator</h1>
          <p>Estimate monthly and yearly storage costs per ILM phase — and see how much you save with best_compression.</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:12px;font-weight:bold;color:#555">$/GB/month:</label>
          <input type="number" id="price-input" value="${this.pricePerGB}" step="0.01" min="0.001"
            style="width:80px;padding:6px 8px;border:1px solid #ccc;border-radius:4px;font-size:13px">
          <button class="btn btn-primary" id="recalc-btn" style="width:auto;padding:8px 16px">Recalculate</button>
        </div>
      </div>

      <div class="feature-banner">
        <span class="feature-badge">NEW</span>
        This feature does not exist in Kibana. Enter your price per GB to instantly see monthly costs by ILM phase and the exact dollar savings from codec optimization.
      </div>

      <div id="cost-body"></div>
    `;
    this.renderBody(el.querySelector('#cost-body'), this.data);
    el.querySelector('#recalc-btn').addEventListener('click', () => this.reload(el));
  },

  renderBody(el, data) {
    const s = data.summary;
    const fmt = (n) => '$' + n.toFixed(2);
    const phaseColors = { hot:'red', warm:'orange', cold:'accent', frozen:'purple', delete:'gray', unmanaged:'gray' };

    el.innerHTML = `
      <!-- Summary stats -->
      <div class="stat-grid" style="margin-bottom:20px">
        <div class="stat-card accent">
          <div class="label">Total Data</div>
          <div class="value" style="font-size:20px">${s.total_data_human}</div>
          <div class="sub">${s.total_indices} indices</div>
        </div>
        <div class="stat-card red">
          <div class="label">Monthly Cost</div>
          <div class="value" style="font-size:20px">${fmt(s.monthly_cost)}</div>
          <div class="sub">${fmt(s.yearly_cost)} / year</div>
        </div>
        <div class="stat-card green">
          <div class="label">Codec Saving / Month</div>
          <div class="value" style="font-size:20px">${fmt(s.compression_saving_monthly)}</div>
          <div class="sub">${fmt(s.compression_saving_yearly)} / year · ${s.compression_saving_pct}% reduction</div>
        </div>
        <div class="stat-card yellow">
          <div class="label">Indices on Default Codec</div>
          <div class="value">${s.default_codec_indices}</div>
          <div class="sub">${Utils.bytesToHuman(s.default_codec_bytes)} suboptimal</div>
        </div>
      </div>

      <!-- By phase -->
      <div class="section">
        <div class="section-header">
          <div class="section-title">Cost by ILM Phase</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Phase</th><th>Indices</th><th>Size</th><th>Monthly Cost</th><th>Yearly Cost</th><th>Codec Saving/mo</th></tr></thead>
            <tbody>
              ${data.by_phase.map(p => `
                <tr>
                  <td><span class="badge badge-${phaseColors[p.phase]||'gray'}">${p.phase}</span></td>
                  <td class="td-num">${p.count}</td>
                  <td class="td-num">${p.total_bytes_human}</td>
                  <td class="td-num" style="font-weight:bold">${p.monthly_cost_fmt}</td>
                  <td class="td-num">${p.yearly_cost_fmt}</td>
                  <td class="td-num" style="color:${parseFloat(p.compression_saving_fmt.replace('$',''))>0?'#28a745':'#888'}">${p.compression_saving_fmt}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Top cost indices -->
      <div class="section">
        <div class="section-header">
          <div class="section-title">Top 20 Most Expensive Indices</div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Index</th><th>Phase</th><th>Codec</th><th>Size</th><th>Monthly</th><th>Yearly</th><th>Codec Saving</th></tr></thead>
            <tbody>
              ${data.top_cost_indices.map(i => `
                <tr>
                  <td class="td-name"><span title="${Utils.escapeHtml(i.index)}">${Utils.escapeHtml(i.index)}</span></td>
                  <td>${Utils.phaseBadge(i.phase)}</td>
                  <td><span class="badge badge-${i.codec==='best_compression'?'green':'yellow'}">${i.codec}</span></td>
                  <td class="td-num">${i.total_bytes_human}</td>
                  <td class="td-num" style="font-weight:bold">${i.monthly_cost}</td>
                  <td class="td-num">${i.yearly_cost}</td>
                  <td class="td-num" style="color:${i.compression_saving?'#28a745':'#aaa'}">${i.compression_saving || '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },
};
window.Cost = Cost;
