const express = require('express');
const router = express.Router();
const { getClient, isConnected } = require('../lib/elastic');

function requireConnection(req, res, next) {
  if (!isConnected()) return res.status(503).json({ error: 'Not connected to Elasticsearch' });
  next();
}

router.get('/', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    const { phase, tier, pattern, status, replica, sort = 'store.size', order = 'desc' } = req.query;

    // Get all indices stats
    const [catIndices, ilmExplain, settings, aliases] = await Promise.all([
      client.cat.indices({ format: 'json', bytes: 'b', h: 'index,health,status,pri,rep,docs.count,store.size,pri.store.size,segments.count' }),
      client.ilm.explainLifecycle({ index: '*', only_errors: false, only_managed: false }).catch(() => ({ indices: {} })),
      client.indices.getSettings({ index: '*' }).catch(() => ({})),
      client.cat.aliases({ format: 'json' }).catch(() => []),
    ]);

    const aliasSet = new Set(aliases.map(a => a.alias));

    const indices = catIndices
      .filter(idx => !idx.index.startsWith('.') || req.query.system === 'true')
      .map(idx => {
        const ilmData = ilmExplain.indices?.[idx.index];
        const idxSettings = settings[idx.index]?.settings?.index || {};
        const tierPref = idxSettings['routing.allocation.include._tier_preference'] || idxSettings['routing']?.['allocation']?.['include']?.['_tier_preference'] || null;

        return {
          index: idx.index,
          health: idx.health,
          status: idx.status,
          primary_shards: parseInt(idx.pri),
          replicas: parseInt(idx.rep),
          docs: parseInt(idx['docs.count']) || 0,
          size_bytes: parseInt(idx['store.size']) || 0,
          primary_size_bytes: parseInt(idx['pri.store.size']) || 0,
          segments: parseInt(idx['segments.count']) || 0,
          ilm_policy: ilmData?.policy || null,
          ilm_phase: ilmData?.phase || null,
          ilm_action: ilmData?.action || null,
          ilm_step: ilmData?.step || null,
          ilm_managed: !!ilmData?.managed,
          ilm_error: ilmData?.failed_step || null,
          tier: tierPref ? tierPref.split(',')[0].replace('data_', '') : null,
          has_alias: aliasSet.has(idx.index),
          rollover_alias: idxSettings['lifecycle.rollover_alias'] || idxSettings['lifecycle']?.['rollover_alias'] || null,
        };
      });

    // Apply filters
    let filtered = indices;
    if (phase) filtered = filtered.filter(i => i.ilm_phase === phase);
    if (tier) filtered = filtered.filter(i => i.tier === tier);
    if (status) filtered = filtered.filter(i => i.health === status);
    if (pattern) {
      const re = new RegExp(pattern.replace('*', '.*'), 'i');
      filtered = filtered.filter(i => re.test(i.index));
    }
    if (replica === '0') filtered = filtered.filter(i => i.replicas === 0);
    if (replica === 'gt0') filtered = filtered.filter(i => i.replicas > 0);
    if (req.query.orphan === 'true') filtered = filtered.filter(i => i.tier === 'content' && !i.ilm_phase);

    // Sort
    filtered.sort((a, b) => {
      const av = a[sort] ?? 0, bv = b[sort] ?? 0;
      return order === 'desc' ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
    });

    // Summary stats
    const summary = {
      total: indices.length,
      filtered: filtered.length,
      phases: {},
      tiers: {},
      health: { green: 0, yellow: 0, red: 0 },
      total_size_bytes: 0,
      no_replica_size_bytes: 0,
      orphan_count: 0,
      orphan_size_bytes: 0,
    };
    indices.forEach(i => {
      if (i.tier === 'content' && !i.ilm_phase) {
        summary.orphan_count++;
        summary.orphan_size_bytes += i.size_bytes;
      }
      if (i.ilm_phase) summary.phases[i.ilm_phase] = (summary.phases[i.ilm_phase] || 0) + 1;
      if (i.tier) summary.tiers[i.tier] = (summary.tiers[i.tier] || 0) + 1;
      if (i.health) summary.health[i.health] = (summary.health[i.health] || 0) + 1;
      summary.total_size_bytes += i.size_bytes;
      if (i.replicas === 0) summary.no_replica_size_bytes += i.primary_size_bytes;
    });

    res.json({ indices: filtered, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single index detail
router.get('/:index', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    const { index } = req.params;

    const [stats, settings, mappings, ilm, shards] = await Promise.all([
      client.indices.stats({ index }),
      client.indices.getSettings({ index }),
      client.indices.getMapping({ index }),
      client.ilm.explainLifecycle({ index }).catch(() => ({ indices: {} })),
      client.cat.shards({ index, format: 'json', bytes: 'b' }),
    ]);

    res.json({
      index,
      stats: stats.indices[index],
      settings: settings[index]?.settings,
      mappings: mappings[index]?.mappings,
      ilm: ilm.indices[index],
      shards,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
