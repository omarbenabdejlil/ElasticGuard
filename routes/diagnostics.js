const express = require('express');
const router = express.Router();
const { getClient, isConnected } = require('../lib/elastic');

function requireConnection(req, res, next) {
  if (!isConnected()) return res.status(503).json({ error: 'Not connected to Elasticsearch' });
  next();
}

function bytesToHuman(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

function parseSize(sizeStr) {
  if (!sizeStr) return null;
  const match = sizeStr.match(/^(\d+\.?\d*)(gb|mb|kb|tb|b)$/i);
  if (!match) return null;
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  const mult = { b: 1, kb: 1024, mb: 1024**2, gb: 1024**3, tb: 1024**4 };
  return num * (mult[unit] || 1);
}

router.get('/', requireConnection, async (req, res) => {
  try {
    const client = getClient();

    const [catIndices, ilmExplain, policies, aliases, settings, catShards] = await Promise.all([
      client.cat.indices({ format: 'json', bytes: 'b', h: 'index,health,status,pri,rep,docs.count,store.size,pri.store.size,creation.date' }),
      client.ilm.explainLifecycle({ index: '*', only_errors: false, only_managed: true }).catch(() => ({ indices: {} })),
      client.ilm.getLifecycle().catch(() => ({})),
      client.cat.aliases({ format: 'json' }),
      client.indices.getSettings({ index: '*', filter_path: '**.lifecycle*,**.routing*' }).catch(() => ({})),
      client.cat.shards({ format: 'json', bytes: 'b', h: 'index,shard,prirep,state,docs,store,ip,node' }).catch(() => []),
    ]);

    const aliasNames = new Set(aliases.map(a => a.alias));
    const writeAliases = new Set(aliases.filter(a => a['is.write.index'] === 'true').map(a => a.alias));
    const aliasToIndex = {};
    for (const a of aliases) {
      if (!aliasToIndex[a.alias]) aliasToIndex[a.alias] = [];
      aliasToIndex[a.alias].push(a.index);
    }

    const diagnostics = {
      // 1. ILM: rollover alias missing or not a write alias
      ilm_alias_issues: [],
      // 2. ILM: using shard size (max_primary_shard_size) without index-level size
      ilm_shard_size_issues: [],
      // 3. Indices with no replicas
      no_replica_indices: [],
      // 4. ILM error/stuck indices
      ilm_error_indices: [],
      // 5. Unassigned shards
      unassigned_shards: [],
      // 6. Oversized indices (top 10 above 100GB)
      oversized_indices: [],
      // 7. Indices not managed by any ILM
      no_ilm_indices: [],
      // 8. Indices with too many/too few shards
      shard_issues: [],
      // 9. Old indices with 0 docs
      empty_old_indices: [],
      // 10. Indices in ILM error
      ilm_errors: [],
    };

    // Build index map
    const indexMap = {};
    for (const idx of catIndices) {
      if (idx.index.startsWith('.')) continue;
      indexMap[idx.index] = {
        index: idx.index,
        health: idx.health,
        status: idx.status,
        pri: parseInt(idx.pri) || 1,
        rep: parseInt(idx.rep) || 0,
        docs: parseInt(idx['docs.count']) || 0,
        size_bytes: parseInt(idx['store.size']) || 0,
        primary_size_bytes: parseInt(idx['pri.store.size']) || 0,
        creation_date: parseInt(idx['creation.date']) || null,
        ilm: ilmExplain.indices?.[idx.index] || null,
        settings: settings[idx.index]?.settings?.index || {},
      };
    }

    for (const [idxName, idx] of Object.entries(indexMap)) {
      const ilm = idx.ilm;
      const policy = ilm?.policy ? policies[ilm.policy] : null;

      // --- 1. ILM alias issues ---
      if (ilm?.managed && ilm?.policy) {
        const pol = policies[ilm.policy]?.policy?.phases || {};
        const hasRollover = Object.values(pol).some(p => p.actions?.rollover);
        if (hasRollover) {
          const rolloverAlias = idx.settings['lifecycle.rollover_alias'] || idx.settings['lifecycle']?.['rollover_alias'];
          if (!rolloverAlias) {
            diagnostics.ilm_alias_issues.push({
              index: idxName,
              policy: ilm.policy,
              phase: ilm.phase,
              issue: 'No rollover alias configured (index.lifecycle.rollover_alias missing)',
              severity: 'critical',
            });
          } else if (!aliasNames.has(rolloverAlias)) {
            diagnostics.ilm_alias_issues.push({
              index: idxName,
              policy: ilm.policy,
              phase: ilm.phase,
              rollover_alias: rolloverAlias,
              issue: `Rollover alias "${rolloverAlias}" does not exist`,
              severity: 'critical',
            });
          } else if (!writeAliases.has(rolloverAlias)) {
            diagnostics.ilm_alias_issues.push({
              index: idxName,
              policy: ilm.policy,
              phase: ilm.phase,
              rollover_alias: rolloverAlias,
              issue: `Alias "${rolloverAlias}" exists but is NOT a write alias — rollover will fail`,
              severity: 'high',
            });
          }
        }
      }

      // --- 2. Shard size ILM issues ---
      if (ilm?.policy && policy) {
        const phases = policy.policy?.phases || {};
        for (const [phaseName, phaseData] of Object.entries(phases)) {
          const rollover = phaseData.actions?.rollover;
          if (rollover?.max_primary_shard_size && !rollover?.max_size) {
            const shardSizeBytes = parseSize(rollover.max_primary_shard_size);
            const estimatedMaxBytes = shardSizeBytes ? shardSizeBytes * idx.pri : null;
            diagnostics.ilm_shard_size_issues.push({
              index: idxName,
              policy: ilm.policy,
              phase: phaseName,
              current_size_bytes: idx.size_bytes,
              current_size: bytesToHuman(idx.size_bytes),
              primary_shards: idx.pri,
              max_primary_shard_size: rollover.max_primary_shard_size,
              estimated_max_index_size: estimatedMaxBytes ? bytesToHuman(estimatedMaxBytes) : 'unknown',
              issue: `Uses max_primary_shard_size (${rollover.max_primary_shard_size}) × ${idx.pri} shards = up to ~${estimatedMaxBytes ? bytesToHuman(estimatedMaxBytes) : '?'} per index, not total size`,
              severity: idx.size_bytes > (estimatedMaxBytes || 0) * 0.8 ? 'high' : 'warn',
            });
          }
        }
      }

      // --- 3. No replica ---
      if (idx.rep === 0) {
        const replicaStorageCost = idx.primary_size_bytes; // 1 replica = double primary
        diagnostics.no_replica_indices.push({
          index: idxName,
          health: idx.health,
          phase: ilm?.phase,
          primary_size_bytes: idx.primary_size_bytes,
          primary_size: bytesToHuman(idx.primary_size_bytes),
          cost_1_replica: bytesToHuman(replicaStorageCost),
          cost_2_replicas: bytesToHuman(replicaStorageCost * 2),
          docs: idx.docs,
          policy: ilm?.policy,
        });
      }

      // --- 4. ILM errors ---
      if (ilm?.failed_step || ilm?.step === 'ERROR') {
        diagnostics.ilm_errors.push({
          index: idxName,
          policy: ilm.policy,
          phase: ilm.phase,
          action: ilm.action,
          failed_step: ilm.failed_step,
          step_info: ilm.step_info,
          retry_failed: ilm.is_auto_retryable_error,
          age: ilm.age,
        });
      }

      // --- 5. No ILM ---
      if (!ilm || !ilm.managed) {
        diagnostics.no_ilm_indices.push({
          index: idxName,
          size_bytes: idx.size_bytes,
          size: bytesToHuman(idx.size_bytes),
          docs: idx.docs,
          creation_date: idx.creation_date,
          age_days: idx.creation_date ? Math.round((Date.now() - idx.creation_date) / 86400000) : null,
        });
      }

      // --- 6. Oversized ---
      if (idx.size_bytes > 100 * 1024 ** 3) {
        diagnostics.oversized_indices.push({
          index: idxName,
          size_bytes: idx.size_bytes,
          size: bytesToHuman(idx.size_bytes),
          primary_size: bytesToHuman(idx.primary_size_bytes),
          docs: idx.docs,
          shards: idx.pri,
          phase: ilm?.phase,
          policy: ilm?.policy,
        });
      }

      // --- 7. Empty old indices ---
      if (idx.docs === 0 && idx.creation_date) {
        const ageDays = Math.round((Date.now() - idx.creation_date) / 86400000);
        if (ageDays > 7) {
          diagnostics.empty_old_indices.push({
            index: idxName,
            age_days: ageDays,
            size_bytes: idx.size_bytes,
            size: bytesToHuman(idx.size_bytes),
            phase: ilm?.phase,
            policy: ilm?.policy,
          });
        }
      }

      // --- 8. Shard size issues ---
      if (idx.pri > 0 && idx.size_bytes > 0) {
        const avgShardSizeGB = idx.primary_size_bytes / idx.pri / 1024 ** 3;
        if (avgShardSizeGB > 50) {
          diagnostics.shard_issues.push({
            index: idxName,
            issue: 'too_large',
            avg_shard_size: bytesToHuman(idx.primary_size_bytes / idx.pri),
            total_size: bytesToHuman(idx.size_bytes),
            primary_shards: idx.pri,
            recommendation: `Consider increasing shard count — avg shard ${avgShardSizeGB.toFixed(1)}GB exceeds 50GB recommendation`,
          });
        } else if (avgShardSizeGB < 0.001 && idx.docs > 0) {
          diagnostics.shard_issues.push({
            index: idxName,
            issue: 'too_many_shards',
            avg_shard_size: bytesToHuman(idx.primary_size_bytes / idx.pri),
            total_size: bytesToHuman(idx.size_bytes),
            primary_shards: idx.pri,
            recommendation: 'Shards are very small — consider reducing shard count or using shrink API',
          });
        }
      }
    }

    // --- Unassigned shards ---
    const unassigned = catShards.filter(s => s.state === 'UNASSIGNED');
    diagnostics.unassigned_shards = unassigned.map(s => ({
      index: s.index,
      shard: s.shard,
      prirep: s.prirep,
      state: s.state,
    }));

    // Sort by severity/size
    diagnostics.oversized_indices.sort((a, b) => b.size_bytes - a.size_bytes);
    diagnostics.no_replica_indices.sort((a, b) => b.primary_size_bytes - a.primary_size_bytes);
    diagnostics.no_ilm_indices.sort((a, b) => b.size_bytes - a.size_bytes);

    // Global summary
    const totalNoReplicaBytes = diagnostics.no_replica_indices.reduce((s, i) => s + i.primary_size_bytes, 0);
    const summary = {
      critical_issues: diagnostics.ilm_alias_issues.filter(i => i.severity === 'critical').length
        + diagnostics.ilm_errors.length
        + diagnostics.unassigned_shards.length,
      total_issues: Object.values(diagnostics).reduce((s, arr) => s + arr.length, 0),
      no_replica_storage_cost_1x: bytesToHuman(totalNoReplicaBytes),
      no_replica_storage_cost_2x: bytesToHuman(totalNoReplicaBytes * 2),
      no_replica_count: diagnostics.no_replica_indices.length,
    };

    res.json({ diagnostics, summary });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

module.exports = router;
