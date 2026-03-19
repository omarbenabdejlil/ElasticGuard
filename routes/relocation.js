const express = require('express');
const router = express.Router();
const { getClient, isConnected } = require('../lib/elastic');

function requireConnection(req, res, next) {
  if (!isConnected()) return res.status(503).json({ error: 'Not connected' });
  next();
}

router.get('/', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    const recovery = await client.cat.recovery({
      format: 'json',
      h: 'index,shard,type,stage,source_node,target_node,bytes_percent,translog_ops_percent',
      active_only: true
    });
    const shards = (recovery || [])
      .filter(r => r.stage !== 'done')
      .map(r => ({
        index:    r.index,
        shard:    parseInt(r.shard),
        type:     r.type === 'primary' ? 'primary' : 'replica',
        source:   r.source_node || 'unknown',
        target:   r.target_node || 'unknown',
        bytes:    Math.round(parseFloat(r.bytes_percent) || 0),
        translog: Math.round(parseFloat(r.translog_ops_percent) || 0),
        reason:   r.type === 'PEER' ? 'rebalance' : (r.type || 'unknown').toLowerCase()
      }));
    res.json({ shards });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/explain', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    const { index, shard } = req.query;
    const result = await client.cluster.allocationExplain({
      body: { index, shard: parseInt(shard), primary: true }
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
