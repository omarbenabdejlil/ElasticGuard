const express = require('express');
const router = express.Router();
const { getClient, isConnected } = require('../lib/elastic');

function req(req, res, next) {
  if (!isConnected()) return res.status(503).json({ error: 'Not connected to Elasticsearch' });
  next();
}

function bytes(n) {
  if (!n || n === 0) return '0 B';
  const u = ['B','KB','MB','GB','TB','PB'];
  let i = 0; while (n >= 1024 && i < u.length-1) { n /= 1024; i++; }
  return `${n.toFixed(i===0?0:1)} ${u[i]}`;
}

function parseSize(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d+\.?\d*)\s*(gb|mb|kb|tb|b)?$/i);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const unit = (m[2]||'b').toLowerCase();
  return num * ({b:1,kb:1024,mb:1024**2,gb:1024**3,tb:1024**4}[unit]||1);
}

// ─── Main ILM health endpoint ─────────────────────────────────────────────
router.get('/', req, async (req2, res) => {
  try {
    const client = getClient();
    const { phase, policy_filter, node_filter } = req2.query;

    const [
      ilmExplain,
      policies,
      catIndices,
      aliases,
      settings,
      catShards,
      nodes,
    ] = await Promise.all([
      client.ilm.explainLifecycle({ index: '*', only_errors: false, only_managed: false }).catch(() => ({ indices: {} })),
      client.ilm.getLifecycle().catch(() => ({})),
      client.cat.indices({ format: 'json', bytes: 'b', h: 'index,health,status,pri,rep,docs.count,store.size,pri.store.size,segments.count,creation.date' }),
      client.cat.aliases({ format: 'json' }).catch(() => []),
      client.indices.getSettings({ index: '*' }).catch(() => ({})),
      client.cat.shards({ format: 'json', bytes: 'b', h: 'index,shard,prirep,state,store,node,ip' }).catch(() => []),
      client.nodes.stats({ metric: ['fs','os','jvm'] }).catch(() => ({ nodes: {} })),
    ]);

    const aliasNames = new Set(aliases.map(a => a.alias));
    const writeAliases = new Set(aliases.filter(a => a['is.write.index'] === 'true').map(a => a.alias));

    // Build alias → index map + index → aliases map
    const indexToAliases = {};
    const aliasToIndices = {};
    for (const a of aliases) {
      if (!indexToAliases[a.index]) indexToAliases[a.index] = [];
      indexToAliases[a.index].push({ alias: a.alias, is_write: a['is.write.index'] === 'true' });
      if (!aliasToIndices[a.alias]) aliasToIndices[a.alias] = [];
      aliasToIndices[a.alias].push(a.index);
    }

    // Build index size map from cat indices
    const indexSizeMap = {};
    for (const idx of catIndices) {
      indexSizeMap[idx.index] = {
        size_bytes: parseInt(idx['store.size']) || 0,
        primary_size_bytes: parseInt(idx['pri.store.size']) || 0,
        docs: parseInt(idx['docs.count']) || 0,
        pri: parseInt(idx.pri) || 1,
        rep: parseInt(idx.rep) || 0,
        health: idx.health,
        creation_date: parseInt(idx['creation.date']) || null,
        segments: parseInt(idx['segments.count']) || 0,
      };
    }

    // Shard → node map
    const shardNodeMap = {}; // "index__shard__p" → node
    const nodeShardBytes = {}; // nodeName → bytes
    for (const s of catShards) {
      if (s.state !== 'STARTED') continue;
      shardNodeMap[`${s.index}__${s.shard}__${s.prirep}`] = s.node;
      if (!nodeShardBytes[s.node]) nodeShardBytes[s.node] = 0;
      nodeShardBytes[s.node] += parseInt(s.store) || 0;
    }

    // Build node disk info
    const nodeInfo = {};
    for (const [nid, n] of Object.entries(nodes.nodes || {})) {
      nodeInfo[n.name] = {
        id: nid,
        name: n.name,
        roles: n.roles || [],
        total_disk: n.fs?.total?.total_in_bytes || 0,
        available_disk: n.fs?.total?.available_in_bytes || 0,
        used_disk: (n.fs?.total?.total_in_bytes||0) - (n.fs?.total?.available_in_bytes||0),
        heap_used_pct: n.jvm?.mem ? Math.round(n.jvm.mem.heap_used_in_bytes/n.jvm.mem.heap_max_in_bytes*100) : null,
        cpu_pct: n.os?.cpu?.percent || null,
        shard_bytes: nodeShardBytes[n.name] || 0,
      };
    }

    // ── PER-POLICY analysis ──────────────────────────────────────────────
    const policyStats = {}; // policyName → { indices, phases: { hot:{size,docs,count}, ... } }
    const phaseStats = {};  // phase → { size_bytes, docs, count, policies: Set }

    // Enrich every managed index with its ILM state
    const allManagedIndices = [];
    const misconfigurations = {
      no_rollover_by_size: [],    // ILM has rollover but uses ONLY max_docs / max_primary_shard_size (not max_size)
      missing_alias: [],          // rollover policy but no lifecycle.rollover_alias
      alias_not_write: [],        // alias exists but isn't a write alias
      alias_not_exists: [],       // rollover_alias set but alias doesn't exist in cluster
      no_rollover_at_all: [],     // index has ILM but policy has NO rollover action at all
      rollover_alias_multi_write: [], // multiple write aliases on same alias (danger)
    };

    for (const [idxName, ilm] of Object.entries(ilmExplain.indices || {})) {
      if (idxName.startsWith('.')) continue;
      const policyName = ilm.policy;
      const polData = policyName ? policies[policyName] : null;
      const idxSettings = settings[idxName]?.settings?.index || {};
      const sizeInfo = indexSizeMap[idxName] || {};
      const currentPhase = ilm.phase || 'unknown';

      // Apply filters
      if (phase && currentPhase !== phase) continue;
      if (policy_filter && policyName !== policy_filter) continue;

      const entry = {
        index: idxName,
        policy: policyName,
        phase: currentPhase,
        action: ilm.action,
        step: ilm.step,
        age: ilm.age,
        managed: ilm.managed,
        failed_step: ilm.failed_step || null,
        step_info: ilm.step_info || null,
        size_bytes: sizeInfo.size_bytes || 0,
        primary_size_bytes: sizeInfo.primary_size_bytes || 0,
        docs: sizeInfo.docs || 0,
        pri: sizeInfo.pri || 1,
        rep: sizeInfo.rep || 0,
        health: sizeInfo.health,
        rollover_alias: idxSettings['lifecycle.rollover_alias'] || null,
        aliases: indexToAliases[idxName] || [],
        creation_date: sizeInfo.creation_date,
      };

      allManagedIndices.push(entry);

      // Per-policy aggregation
      if (policyName) {
        if (!policyStats[policyName]) {
          policyStats[policyName] = { name: policyName, indices: 0, size_bytes: 0, docs: 0, phases: {}, issues: 0 };
        }
        policyStats[policyName].indices++;
        policyStats[policyName].size_bytes += entry.size_bytes;
        policyStats[policyName].docs += entry.docs;
        if (!policyStats[policyName].phases[currentPhase]) {
          policyStats[policyName].phases[currentPhase] = { count: 0, size_bytes: 0, docs: 0 };
        }
        policyStats[policyName].phases[currentPhase].count++;
        policyStats[policyName].phases[currentPhase].size_bytes += entry.size_bytes;
        policyStats[policyName].phases[currentPhase].docs += entry.docs;
      }

      // Per-phase aggregation
      if (!phaseStats[currentPhase]) {
        phaseStats[currentPhase] = { phase: currentPhase, count: 0, size_bytes: 0, docs: 0, policies: new Set() };
      }
      phaseStats[currentPhase].count++;
      phaseStats[currentPhase].size_bytes += entry.size_bytes;
      phaseStats[currentPhase].docs += entry.docs;
      if (policyName) phaseStats[currentPhase].policies.add(policyName);

      // ── MISCONFIGURATION CHECKS ─────────────────────────────────────────
      if (!polData) continue;
      const phases = polData.policy?.phases || {};
      const hotPhase = phases.hot;
      const rolloverConfig = hotPhase?.actions?.rollover;
      const hasRolloverAction = Object.values(phases).some(p => p.actions?.rollover);
      const rolloverAliasVal = entry.rollover_alias;

      // 1. ILM has rollover but NO max_size (only max_docs or max_primary_shard_size)
      if (rolloverConfig) {
        const hasMaxSize = !!rolloverConfig.max_size;
        const hasMaxPrimaryShard = !!rolloverConfig.max_primary_shard_size;
        const hasMaxDocs = !!rolloverConfig.max_docs;
        const hasMaxAge = !!rolloverConfig.max_age;

        if (!hasMaxSize && (hasMaxPrimaryShard || hasMaxDocs)) {
          const shardSizeBytes = hasMaxPrimaryShard ? parseSize(rolloverConfig.max_primary_shard_size) : null;
          const estMaxBytes = shardSizeBytes ? shardSizeBytes * entry.pri : null;
          const overLimit = estMaxBytes && entry.primary_size_bytes > estMaxBytes * 0.8;

          misconfigurations.no_rollover_by_size.push({
            index: idxName,
            policy: policyName,
            phase: currentPhase,
            current_size: bytes(entry.primary_size_bytes),
            current_size_bytes: entry.primary_size_bytes,
            rollover_config: rolloverConfig,
            max_primary_shard_size: rolloverConfig.max_primary_shard_size || null,
            max_docs: rolloverConfig.max_docs || null,
            pri_shards: entry.pri,
            estimated_max_index_size: estMaxBytes ? bytes(estMaxBytes) : null,
            estimated_max_bytes: estMaxBytes,
            over_limit: overLimit,
            gap_bytes: overLimit ? entry.primary_size_bytes - estMaxBytes : null,
            gap_human: (overLimit && estMaxBytes) ? bytes(entry.primary_size_bytes - estMaxBytes) : null,
            severity: overLimit ? 'critical' : hasMaxPrimaryShard ? 'high' : 'warn',
            reason: hasMaxPrimaryShard
              ? `max_primary_shard_size (${rolloverConfig.max_primary_shard_size}) × ${entry.pri} shards = ~${estMaxBytes?bytes(estMaxBytes):'?'} real max, not the per-shard value`
              : `max_docs only — no size guard, index can grow unbounded`,
          });
        }
      }

      // 2–4. Rollover alias checks
      if (hasRolloverAction) {
        if (!rolloverAliasVal) {
          misconfigurations.missing_alias.push({
            index: idxName,
            policy: policyName,
            phase: currentPhase,
            size: bytes(entry.primary_size_bytes),
            size_bytes: entry.primary_size_bytes,
            severity: 'critical',
            reason: 'index.lifecycle.rollover_alias is not set — ILM cannot perform rollover',
            fix: `PUT /${idxName}/_settings\n{"index.lifecycle.rollover_alias": "<your-alias>"}`,
          });
        } else if (!aliasNames.has(rolloverAliasVal)) {
          misconfigurations.alias_not_exists.push({
            index: idxName,
            policy: policyName,
            phase: currentPhase,
            rollover_alias: rolloverAliasVal,
            size: bytes(entry.primary_size_bytes),
            size_bytes: entry.primary_size_bytes,
            severity: 'critical',
            reason: `Alias "${rolloverAliasVal}" is set but does NOT exist in the cluster`,
            fix: `POST /_aliases\n{"actions":[{"add":{"index":"${idxName}","alias":"${rolloverAliasVal}","is_write_index":true}}]}`,
          });
        } else if (!writeAliases.has(rolloverAliasVal)) {
          misconfigurations.alias_not_write.push({
            index: idxName,
            policy: policyName,
            phase: currentPhase,
            rollover_alias: rolloverAliasVal,
            size: bytes(entry.primary_size_bytes),
            size_bytes: entry.primary_size_bytes,
            severity: 'high',
            reason: `Alias "${rolloverAliasVal}" exists but is NOT a write alias — rollover will fail silently`,
            fix: `POST /_aliases\n{"actions":[{"add":{"index":"${idxName}","alias":"${rolloverAliasVal}","is_write_index":true}}]}`,
          });
        }
      }

      // 5. Has ILM but policy has NO rollover at all (index grows forever)
      if (ilm.managed && !hasRolloverAction) {
        const ageDays = entry.creation_date ? Math.round((Date.now() - entry.creation_date) / 86400000) : null;
        misconfigurations.no_rollover_at_all.push({
          index: idxName,
          policy: policyName,
          phase: currentPhase,
          size: bytes(entry.primary_size_bytes),
          size_bytes: entry.primary_size_bytes,
          age_days: ageDays,
          severity: 'warn',
          reason: 'Policy has no rollover action — index will grow indefinitely until delete phase',
        });
      }
    }

    // Serialize phaseStats (remove Set → array)
    const phaseStatsArr = Object.values(phaseStats).map(p => ({
      ...p,
      policies: [...p.policies],
    }));

    // Per-node breakdown: how much data per phase per node
    const nodePhaseBreakdown = {};
    for (const s of catShards) {
      if (!s.node || s.state !== 'STARTED') continue;
      const idxIlm = ilmExplain.indices?.[s.index];
      const phaseName = idxIlm?.phase || 'unmanaged';
      const policyName = idxIlm?.policy || null;
      const shardBytes = parseInt(s.store) || 0;

      if (!nodePhaseBreakdown[s.node]) nodePhaseBreakdown[s.node] = {};
      if (!nodePhaseBreakdown[s.node][phaseName]) {
        nodePhaseBreakdown[s.node][phaseName] = { size_bytes: 0, shard_count: 0, index_count: new Set() };
      }
      nodePhaseBreakdown[s.node][phaseName].size_bytes += shardBytes;
      nodePhaseBreakdown[s.node][phaseName].shard_count++;
      nodePhaseBreakdown[s.node][phaseName].index_count.add(s.index);
    }

    // Build final node breakdown (serialize Sets)
    const nodeBreakdownArr = Object.entries(nodePhaseBreakdown).map(([nodeName, phases]) => {
      const disk = nodeInfo[nodeName] || {};
      const totalShardBytes = Object.values(phases).reduce((s, p) => s + p.size_bytes, 0);
      return {
        node: nodeName,
        roles: disk.roles || [],
        total_disk: disk.total_disk || 0,
        used_disk: disk.used_disk || 0,
        available_disk: disk.available_disk || 0,
        disk_pct: disk.total_disk ? Math.round(disk.used_disk/disk.total_disk*100) : null,
        cpu_pct: disk.cpu_pct,
        heap_used_pct: disk.heap_used_pct,
        total_shard_bytes: totalShardBytes,
        phases: Object.fromEntries(
          Object.entries(phases).map(([ph, d]) => [ph, {
            size_bytes: d.size_bytes,
            shard_count: d.shard_count,
            index_count: d.index_count.size,
          }])
        ),
      };
    }).sort((a,b) => b.total_disk - a.total_disk);

    // Sort misconfigs
    const sortBySeverityThenSize = (a,b) => {
      const sev = {critical:0,high:1,warn:2,info:3};
      const s = (sev[a.severity]||3) - (sev[b.severity]||3);
      return s !== 0 ? s : b.size_bytes - a.size_bytes;
    };
    misconfigurations.no_rollover_by_size.sort(sortBySeverityThenSize);
    misconfigurations.missing_alias.sort(sortBySeverityThenSize);
    misconfigurations.alias_not_exists.sort(sortBySeverityThenSize);
    misconfigurations.alias_not_write.sort(sortBySeverityThenSize);

    // Policy stats with phase breakdown (sorted by size)
    const policyStatsArr = Object.values(policyStats).sort((a,b) => b.size_bytes - a.size_bytes);

    // Global misconfig summary
    const totalMisconfigs = Object.values(misconfigurations).reduce((s, arr) => s + arr.length, 0);
    const criticalMisconfigs = [
      ...misconfigurations.missing_alias,
      ...misconfigurations.alias_not_exists,
      ...misconfigurations.no_rollover_by_size.filter(i => i.severity === 'critical'),
    ].length;

    res.json({
      summary: {
        managed_indices: allManagedIndices.length,
        total_policies: Object.keys(policyStats).length,
        total_misconfigs: totalMisconfigs,
        critical_misconfigs: criticalMisconfigs,
        phase_breakdown: phaseStatsArr,
        total_managed_size: bytes(allManagedIndices.reduce((s,i)=>s+i.size_bytes,0)),
        total_managed_size_bytes: allManagedIndices.reduce((s,i)=>s+i.size_bytes,0),
      },
      phases: phaseStatsArr,
      policies: policyStatsArr,
      nodes: nodeBreakdownArr,
      misconfigurations,
      indices: allManagedIndices.sort((a,b) => b.size_bytes - a.size_bytes).slice(0, 500),
    });
  } catch(err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

module.exports = router;
