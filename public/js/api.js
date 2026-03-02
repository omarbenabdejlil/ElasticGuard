const API = {
  async fetch(path, opts = {}) {
    const res  = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  async get(path)        { return this.fetch(path); },
  async post(path, body) { return this.fetch(path, { method: 'POST', body: JSON.stringify(body) }); },

  connect:          (cfg)    => API.post('/api/cluster/connect', cfg),
  disconnect:       ()       => API.post('/api/cluster/disconnect', {}),
  clusterStatus:    ()       => API.get('/api/cluster/status'),
  indices:          (p = {}) => API.get('/api/indices?' + new URLSearchParams(p)),
  indexDetail:      (n)      => API.get(`/api/indices/${encodeURIComponent(n)}`),
  ilm:              (p = {}) => API.get('/api/ilm?' + new URLSearchParams(p)),
  ilmPolicyIndices: (pol)    => API.get(`/api/ilm/${encodeURIComponent(pol)}/indices`),
  snapshots:        ()       => API.get('/api/snapshots'),
  diagnostics:      ()       => API.get('/api/diagnostics'),
  ilmHealth:        (p = {}) => API.get('/api/ilm-health?' + new URLSearchParams(p)),
  codec:            (p = {}) => API.get('/api/codec?' + new URLSearchParams(p)),

  // New features
  simulatorNodes:   ()       => API.get('/api/simulator/nodes'),
  simulatorRemove:  (node)   => API.post('/api/simulator/remove-node', { node_name: node }),
  cost:             (p = {}) => API.get('/api/cost?' + new URLSearchParams(p)),
  policyAudit:      ()       => API.get('/api/policy-audit'),
};
window.API = API;
