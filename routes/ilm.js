const express = require('express');
const router = express.Router();
const { getClient, isConnected } = require('../lib/elastic');

function requireConnection(req, res, next) {
  if (!isConnected()) return res.status(503).json({ error: 'Not connected to Elasticsearch' });
  next();
}

function analyzeIlmPolicy(name, policy) {
  const issues = [];
  const phases = policy.policy?.phases || {};

  for (const [phaseName, phaseData] of Object.entries(phases)) {
    const rollover = phaseData.actions?.rollover;
    if (rollover) {
      // Check for shard-based conditions without size/age
      if (rollover.max_docs && !rollover.max_size && !rollover.max_age && !rollover.max_primary_shard_size) {
        issues.push({ type: 'warn', phase: phaseName, msg: 'Rollover uses max_docs only — can lead to unbalanced shard sizes' });
      }
      if (rollover.max_primary_shard_size && !rollover.max_age) {
        issues.push({ type: 'info', phase: phaseName, msg: 'max_primary_shard_size used without max_age — indices may grow very large if data is sparse' });
      }
      // Detect if using shard-size logic (common footgun)
      if (rollover.max_primary_shard_size && !rollover.max_size) {
        issues.push({ type: 'warn', phase: phaseName, msg: 'Uses max_primary_shard_size instead of max_size — rollover triggers per shard, not total index size. A 50gb limit with 5 shards = 250gb index.' });
      }
    }

    // Check delete phase has min_age
    if (phaseName === 'delete' && !phaseData.min_age) {
      issues.push({ type: 'warn', phase: phaseName, msg: 'Delete phase has no min_age — indices may be deleted immediately' });
    }

    // Frozen without searchable_snapshots
    if (phaseName === 'frozen' && !phaseData.actions?.searchable_snapshots) {
      issues.push({ type: 'info', phase: phaseName, msg: 'Frozen phase without searchable_snapshots configured' });
    }
  }

  return issues;
}

router.get('/', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    const { pattern } = req.query;

    const [policies, templates, aliases, catIndices] = await Promise.all([
      client.ilm.getLifecycle(),
      client.indices.getIndexTemplate({ name: '*' }).catch(() => ({ index_templates: [] })),
      client.cat.aliases({ format: 'json' }),
      client.cat.indices({ format: 'json', h: 'index,docs.count,store.size' }),
    ]);

    const aliasNames = new Set(aliases.map(a => a.alias));
    const writeAliases = new Set(aliases.filter(a => a['is.write.index'] === 'true').map(a => a.alias));

    // Map template -> ILM policy
    const templatePolicyMap = {};
    for (const t of (templates.index_templates || [])) {
      const pol = t.index_template?.template?.settings?.index?.lifecycle?.name;
      if (pol) templatePolicyMap[t.name] = pol;
    }

    const result = Object.entries(policies).map(([name, policy]) => {
      const issues = analyzeIlmPolicy(name, policy);
      const phases = Object.keys(policy.policy?.phases || {});

      // Find indices using this policy
      const indicesCount = catIndices.filter(i => {
        // We don't have ILM info here directly, but we can check later
        return false;
      }).length;

      // Check rollover alias existence
      const rolloverAction = Object.values(policy.policy?.phases || {})
        .find(p => p.actions?.rollover)?.actions?.rollover;

      if (rolloverAction) {
        // Policy uses rollover — check if there's a write alias somewhere
        const hasWriteAlias = writeAliases.size > 0;
        if (!hasWriteAlias) {
          issues.push({ type: 'warn', phase: 'hot', msg: 'Rollover policy but no write alias detected in cluster — indices may not roll over' });
        }
      }

      return {
        name,
        phases,
        policy: policy.policy,
        issues,
        has_rollover: !!Object.values(policy.policy?.phases || {}).find(p => p.actions?.rollover),
        modified_date: policy.modified_date,
        version: policy.version,
      };
    });

    let filtered = result;
    if (pattern) {
      const re = new RegExp(pattern.replace('*', '.*'), 'i');
      filtered = filtered.filter(p => re.test(p.name));
    }

    const summary = {
      total: result.length,
      with_issues: result.filter(p => p.issues.length > 0).length,
      with_rollover: result.filter(p => p.has_rollover).length,
    };

    res.json({ policies: filtered, summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ILM explain for indices using a specific policy
router.get('/:policy/indices', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    const explain = await client.ilm.explainLifecycle({ index: '*' });
    const indices = Object.entries(explain.indices || {})
      .filter(([_, v]) => v.policy === req.params.policy)
      .map(([index, data]) => ({ index, ...data }));
    res.json({ indices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
