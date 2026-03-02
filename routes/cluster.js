const express = require('express');
const router = express.Router();
const { createClient, getClient, getConfig, isConnected, disconnect } = require('../lib/elastic');

// Connect to cluster
router.post('/connect', async (req, res) => {
  const { node, username, password, apiKey, skipTLS } = req.body;
  if (!node) return res.status(400).json({ error: 'node URL is required' });

  try {
    const client = createClient({ node, username, password, apiKey, skipTLS });
    const health = await client.cluster.health();
    res.json({ success: true, cluster_name: health.cluster_name, status: health.status });
  } catch (err) {
    disconnect();
    res.status(500).json({ error: err.message });
  }
});

router.post('/disconnect', (req, res) => {
  disconnect();
  res.json({ success: true });
});

router.get('/status', async (req, res) => {
  if (!isConnected()) return res.json({ connected: false });
  try {
    const client = getClient();
    const health = await client.cluster.health();
    const stats = await client.cluster.stats();
    const nodes = await client.nodes.stats({ metric: ['os', 'fs', 'jvm', 'process'] });

    const nodeList = Object.entries(nodes.nodes).map(([id, n]) => ({
      id,
      name: n.name,
      roles: n.roles,
      os_cpu: n.os?.cpu?.percent,
      heap_used_pct: n.jvm?.mem ? Math.round((n.jvm.mem.heap_used_in_bytes / n.jvm.mem.heap_max_in_bytes) * 100) : null,
      disk_total: n.fs?.total?.total_in_bytes,
      disk_available: n.fs?.total?.available_in_bytes,
      disk_used_pct: n.fs?.total ? Math.round(((n.fs.total.total_in_bytes - n.fs.total.available_in_bytes) / n.fs.total.total_in_bytes) * 100) : null,
    }));

    res.json({
      connected: true,
      config: { node: getConfig().node, username: getConfig().username },
      health: {
        cluster_name: health.cluster_name,
        status: health.status,
        number_of_nodes: health.number_of_nodes,
        number_of_data_nodes: health.number_of_data_nodes,
        active_primary_shards: health.active_primary_shards,
        active_shards: health.active_shards,
        unassigned_shards: health.unassigned_shards,
        initializing_shards: health.initializing_shards,
        relocating_shards: health.relocating_shards,
      },
      stats: {
        indices_count: stats.indices?.count,
        docs_count: stats.indices?.docs?.count,
        store_size_bytes: stats.indices?.store?.size_in_bytes,
      },
      nodes: nodeList,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
