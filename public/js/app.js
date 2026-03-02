(function() {
  const pages = {
    dashboard:   Dashboard,
    indices:     Indices,
    ilm:         ILM,
    ilmhealth:   ILMHealth,
    snapshots:   Snapshots,
    diagnostics: Diagnostics,
    codec:       Codec,
    simulator:   Simulator,
    cost:        Cost,
    policyaudit: PolicyAudit,
  };

  let currentPage = null;

  function showPage(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.getElementById(`page-${name}`)?.classList.add('active');
    document.querySelector(`.nav-link[data-page="${name}"]`)?.classList.add('active');
    currentPage = name;
    pages[name]?.render();
  }

  function showApp() {
    document.getElementById('connect-modal').classList.remove('active');
    document.getElementById('main-app').style.display = 'flex';
    showPage('dashboard');
  }

  function showConnect() {
    document.getElementById('main-app').style.display = 'none';
    document.getElementById('connect-modal').classList.add('active');
  }

  document.getElementById('connect-btn').addEventListener('click', async () => {
    const btn   = document.getElementById('connect-btn');
    const errEl = document.getElementById('connect-error');
    errEl.style.display = 'none';
    btn.textContent = 'Connecting…';
    btn.disabled = true;
    try {
      const data = await API.connect({
        node:    document.getElementById('es-node').value.trim(),
        username:document.getElementById('es-user').value.trim(),
        password:document.getElementById('es-pass').value,
        apiKey:  document.getElementById('es-apikey').value.trim(),
        skipTLS: document.getElementById('es-skip-tls').checked,
      });
      document.getElementById('cluster-name-nav').textContent = data.cluster_name;
      showApp();
    } catch(err) {
      errEl.textContent = `Connection failed: ${err.message}`;
      errEl.style.display = 'block';
    } finally {
      btn.textContent = 'Connect';
      btn.disabled = false;
    }
  });

  document.querySelectorAll('#connect-modal input').forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('connect-btn').click();
    });
  });

  document.getElementById('disconnect-btn').addEventListener('click', async () => {
    await API.disconnect();
    showConnect();
  });

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      showPage(link.dataset.page);
    });
  });

  API.clusterStatus().then(data => {
    if (data.connected) showApp();
  }).catch(() => {});
})();
