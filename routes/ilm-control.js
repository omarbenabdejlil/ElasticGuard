'use strict';

const express = require('express');
const router = express.Router();
const { getClient, isConnected } = require('../lib/elastic');

function requireConnection(req, res, next) {
  if (!isConnected()) return res.status(503).json({ error: 'Not connected to Elasticsearch' });
  next();
}

// ─── ILM POLICIES ────────────────────────────────────────────

router.get('/api/ilm-ctrl/policies', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    const body = await client.ilm.getLifecycle();
    const policies = Object.entries(body).map(([name, data]) => ({
      name, ...data, _meta: analyzePolicyQuality(data),
    }));
    res.json({ policies });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/ilm-ctrl/policies/:name', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    await client.ilm.putLifecycle({ name: req.params.name, policy: req.body.policy });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/ilm-ctrl/policies/:name', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    await client.ilm.deleteLifecycle({ name: req.params.name });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/ilm-ctrl/attach-by-prefix', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    const { prefix, policyName } = req.body;
    if (!prefix || !policyName) return res.status(400).json({ error: 'prefix and policyName required' });
    const indices = await client.indices.get({ index: `${prefix}*` });
    const names = Object.keys(indices);
    const results = await Promise.allSettled(
      names.map(index => client.indices.putSettings({
        index, settings: { 'index.lifecycle.name': policyName }
      }))
    );
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.map((r, i) => r.status === 'rejected' ? names[i] : null).filter(Boolean);
    res.json({ succeeded, failed, total: names.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/ilm-ctrl/attach', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    const { index, policyName } = req.body;
    await client.indices.putSettings({ index, settings: { 'index.lifecycle.name': policyName } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/ilm-ctrl/detach', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    await client.indices.putSettings({ index: req.body.index, settings: { 'index.lifecycle.name': null } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/ilm-ctrl/orphaned', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    const [allIndices, allPolicies] = await Promise.all([
      client.indices.getSettings({ index: '*', filter_path: '*.settings.index.lifecycle' }),
      client.ilm.getLifecycle(),
    ]);
    const policyNames = new Set(Object.keys(allPolicies));
    const orphaned = [], noPolicy = [];
    for (const [indexName, data] of Object.entries(allIndices)) {
      if (indexName.startsWith('.')) continue;
      const ilmName = data?.settings?.index?.lifecycle?.name;
      if (ilmName && !policyNames.has(ilmName)) orphaned.push({ index: indexName, referencedPolicy: ilmName });
      else if (!ilmName) noPolicy.push({ index: indexName });
    }
    res.json({ orphaned, noPolicy: noPolicy.slice(0, 200) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/ilm-ctrl/fix-orphaned', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    const { indices, policyName } = req.body;
    const results = await Promise.allSettled(
      indices.map(index => client.indices.putSettings({
        index, settings: { 'index.lifecycle.name': policyName }
      }))
    );
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.map((r, i) => r.status === 'rejected' ? indices[i] : null).filter(Boolean);
    res.json({ succeeded, failed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── TEMPLATES ───────────────────────────────────────────────

router.get('/api/ilm-ctrl/templates', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    const [composable, legacy] = await Promise.all([
      client.indices.getIndexTemplate(),
      client.indices.getTemplate().catch(() => ({})),
    ]);
    const composableList = (composable.index_templates || []).map(t => ({
      name: t.name, type: 'composable',
      indexPatterns: t.index_template.index_patterns,
      priority: t.index_template.priority,
      ilmPolicy: t.index_template?.template?.settings?.['index.lifecycle.name']
              || t.index_template?.template?.settings?.index?.lifecycle?.name
              || null,
      composedOf: t.index_template.composed_of || [],
    }));
    const legacyList = Object.entries(legacy).map(([name, data]) => ({
      name, type: 'legacy',
      indexPatterns: data.index_patterns,
      priority: data.order,
      ilmPolicy: data?.settings?.['index.lifecycle.name']
              || data?.settings?.index?.lifecycle?.name
              || null,
      composedOf: [],
    }));
    res.json({ templates: [...composableList, ...legacyList] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/api/ilm-ctrl/templates/:name', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    const data = await client.indices.getIndexTemplate({ name: req.params.name });
    res.json(data.index_templates?.[0] || {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/api/ilm-ctrl/templates/:name', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    await client.indices.putIndexTemplate({ name: req.params.name, ...req.body });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/api/ilm-ctrl/templates/:name', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    if (req.query.type === 'legacy') await client.indices.deleteTemplate({ name: req.params.name });
    else await client.indices.deleteIndexTemplate({ name: req.params.name });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── INDEX STATS ─────────────────────────────────────────────

router.get('/api/ilm-ctrl/index-stats', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    const { prefix, limit = 100 } = req.query;
    const indexPattern = prefix ? `${prefix}*` : '*';

    const [catIndices, settings, ilmResult] = await Promise.all([
      client.cat.indices({ index: indexPattern, h: 'index,health,status,pri,rep,docs.count,store.size,creation.date.string', format: 'json', bytes: 'gb', s: 'store.size:desc' }),
      client.indices.getSettings({ index: indexPattern, filter_path: '*.settings.index.lifecycle,*.settings.index.creation_date', ignore_unavailable: true }),
      client.ilm.explainLifecycle({ index: indexPattern }).catch(() => ({ indices: {} })),
    ]);

    const ilmData = ilmResult.indices || {};

    const stats = catIndices
      .filter(i => !i.index.startsWith('.'))
      .slice(0, parseInt(limit))
      .map(idx => {
        const idxSettings = settings[idx.index]?.settings?.index || {};
        const ilm = ilmData[idx.index] || null;
        const policyName = idxSettings?.lifecycle?.name || null;
        return {
          index: idx.index,
          health: idx.health,
          primaryShards: parseInt(idx['pri'] || 0),
          replicas: parseInt(idx['rep'] || 0),
          docsCount: parseInt(idx['docs.count'] || 0),
          storeSizeGb: parseFloat(idx['store.size'] || 0),
          creationDateString: idx['creation.date.string'],
          policyName,
          ilm: ilm ? formatIlmExplain(ilm) : null,
          rolloverEstimate: ilm ? estimateRollover(ilm) : null,
        };
      });

    res.json({ stats, total: stats.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── HELPERS ─────────────────────────────────────────────────

function analyzePolicyQuality(policyData) {
  const phases = policyData?.policy?.phases || {};
  const warnings = [];
  if (!phases.hot) warnings.push('No hot phase defined');
  if (!phases.delete && !phases.cold) warnings.push('No delete or cold phase');
  const hotRollover = phases.hot?.actions?.rollover;
  if (!hotRollover) warnings.push('Hot phase has no rollover action');
  else if (!hotRollover.max_age && !hotRollover.max_size && !hotRollover.max_docs)
    warnings.push('Rollover has no condition (max_age/max_size/max_docs)');
  const score = warnings.length === 0 ? 'good' : warnings.length === 1 ? 'warn' : 'bad';
  return { score, warnings };
}

function formatIlmExplain(data) {
  return { managed: data.managed, policy: data.policy, phase: data.phase, action: data.action, step: data.step, age: data.age, error: data.failed_step || null, phase_time_millis: data.phase_time_millis, step_info: data.step_info };
}

function estimateRollover(ilmData) {
  if (!ilmData?.phase_time_millis) return null;
  const ageInPhaseDays = Math.round((Date.now() - ilmData.phase_time_millis) / 86400000);
  const maxAgeDays = parseMaxAge(ilmData.step_info?.expected_value);
  if (maxAgeDays === null) return { ageInPhaseDays, maxAgeDays: null, daysUntilRollover: null, pct: null };
  return { ageInPhaseDays, maxAgeDays, daysUntilRollover: Math.max(0, maxAgeDays - ageInPhaseDays), pct: Math.min(100, Math.round((ageInPhaseDays / maxAgeDays) * 100)) };
}

function parseMaxAge(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d+)(d|h|m)$/);
  if (!match) return null;
  const [, num, unit] = match;
  if (unit === 'd') return parseInt(num);
  if (unit === 'h') return Math.round(parseInt(num) / 24);
  if (unit === 'm') return Math.round(parseInt(num) / 1440);
  return null;
}

module.exports = router;
