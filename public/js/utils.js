const Utils = {
  bytesToHuman(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return `${bytes.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  },

  numFormat(n) {
    if (n == null) return '-';
    if (n >= 1e9) return (n/1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
    return n.toString();
  },

  healthBadge(h) {
    const map = { green: 'badge-green', yellow: 'badge-yellow', red: 'badge-red' };
    return `<span class="badge ${map[h] || 'badge-gray'}">${h || 'unknown'}</span>`;
  },

  phaseBadge(phase) {
    const map = { hot: 'badge-red', warm: 'badge-orange', cold: 'badge-accent', frozen: 'badge-purple', delete: 'badge-gray' };
    return phase ? `<span class="badge ${map[phase] || 'badge-gray'}">${phase}</span>` : '<span class="text-muted">—</span>';
  },

  severityBadge(sev) {
    const map = { critical: 'badge-red', high: 'badge-orange', warn: 'badge-yellow', info: 'badge-accent' };
    return `<span class="badge ${map[sev] || 'badge-gray'}">${sev}</span>`;
  },

  relativeTime(ms) {
    if (!ms) return '-';
    const diff = Date.now() - ms;
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
  },

  daysAgo(ms) {
    if (!ms) return '-';
    return `${Math.round((Date.now() - ms) / 86400000)}d ago`;
  },

  escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  },

  barColor(pct) {
    if (pct > 85) return 'red';
    if (pct > 65) return 'yellow';
    return 'green';
  },

  bar(pct, color) {
    const c = color || Utils.barColor(pct);
    return `<div class="bar-bg"><div class="bar-fill ${c}" style="width:${Math.min(pct,100)}%"></div></div>`;
  },

  paginate(items, page, perPage) {
    const start = (page - 1) * perPage;
    return { items: items.slice(start, start + perPage), total: items.length, pages: Math.ceil(items.length / perPage) };
  },

  renderPagination(container, currentPage, totalPages, onChange) {
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || Math.abs(i - currentPage) <= 2) {
        pages.push(i);
      } else if (pages[pages.length-1] !== '...') {
        pages.push('...');
      }
    }
    container.innerHTML = pages.map(p =>
      p === '...' ? `<span style="color:#888">…</span>` :
      `<button class="page-btn${p === currentPage ? ' active' : ''}" data-p="${p}">${p}</button>`
    ).join('');
    container.querySelectorAll('.page-btn').forEach(btn => {
      btn.addEventListener('click', () => onChange(parseInt(btn.dataset.p)));
    });
  },

  debounce(fn, delay) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  },
};

window.Utils = Utils;
