const express = require('express');
const router = express.Router();
const { getClient, isConnected } = require('../lib/elastic');

function requireConnection(req, res, next) {
  if (!isConnected()) return res.status(503).json({ error: 'Not connected to Elasticsearch' });
  next();
}

function bytesToHuman(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Codec definitions with real benchmark data from Elastic/research
const CODEC_INFO = {
  default: {
    name: 'default',
    algorithm: 'LZ4',
    es_versions: '≥ 1.0',
    description: 'Default Elasticsearch codec. Uses LZ4 with 60kB blocks + dictionary compression (since ES 7.10). Optimized for speed — best indexing throughput and fastest search retrieval.',
    compression_ratio: 0.55, // relative to raw data (lower = better compression)
    size_vs_default: 1.0,    // 1.0 = baseline
    write_speed: 1.0,        // 1.0 = baseline
    read_speed: 1.0,         // 1.0 = baseline (fastest)
    cpu_impact: 'low',
    use_case: 'Hot indices, high-ingest, real-time search, NRT requirements',
    pros: ['Fastest indexing speed', 'Fastest search/retrieval', 'Lowest CPU usage', 'Best for hot tier'],
    cons: ['Highest storage usage', 'Not ideal for archive data'],
    color: '#00d4ff',
    tier_recommendation: ['hot'],
  },
  best_compression: {
    name: 'best_compression',
    algorithm: 'ZSTD (ES ≥8.16) / DEFLATE (ES <8.16)',
    es_versions: '≥ 1.0 (ZSTD engine since 8.16)',
    description: 'High compression codec. On ES 8.16+, internally upgraded to ZSTD (from DEFLATE), giving up to 12% more compression + 14% better write throughput vs old DEFLATE. Uses larger blocks (2048 docs / 240kB) for maximum compression.',
    compression_ratio: 0.40,
    size_vs_default: 0.72,   // ~28% smaller than default
    write_speed: 0.88,       // ~12% slower than default (DEFLATE era), better with ZSTD
    read_speed: 0.82,        // slower due to larger blocks needing more decompression
    cpu_impact: 'medium-high',
    use_case: 'Warm/cold indices, compliance archives, storage-sensitive hot logs',
    pros: ['Best compression ratio', '~28% storage reduction vs default', 'ZSTD engine on ES 8.16+ is faster than old DEFLATE', 'Great for log data with repetitive fields'],
    cons: ['Slower stored field retrieval (larger blocks)', 'Higher CPU on decompression', 'Changing codec requires force merge to take full effect'],
    color: '#00e5a0',
    tier_recommendation: ['warm', 'cold', 'frozen'],
  },
  // Legacy escape hatch values (ES 8.x)
  legacy_default: {
    name: 'legacy_default',
    algorithm: 'LZ4 (legacy pre-7.10 blocks)',
    es_versions: '≥ 8.16 (escape hatch)',
    description: 'Escape hatch to the old LZ4 codec format used before Elasticsearch 7.10. Added in ES 8.16 to allow rollback if ZSTD causes issues. Not recommended for new indices.',
    compression_ratio: 0.65,
    size_vs_default: 1.15,
    write_speed: 0.98,
    read_speed: 1.02,
    cpu_impact: 'low',
    use_case: 'Legacy compatibility / rollback only',
    pros: ['Backward compatibility'],
    cons: ['Larger storage than default', 'Legacy format', 'Not recommended'],
    color: '#6b7d94',
    tier_recommendation: [],
  },
  legacy_best_compression: {
    name: 'legacy_best_compression',
    algorithm: 'DEFLATE (legacy)',
    es_versions: '≥ 8.16 (escape hatch)',
    description: 'Escape hatch to old DEFLATE codec (pre-ZSTD). Use only if rolling back from ES 8.16+ ZSTD causes unexpected issues. best_compression now performs better.',
    compression_ratio: 0.42,
    size_vs_default: 0.76,
    write_speed: 0.75,
    read_speed: 0.80,
    cpu_impact: 'high',
    use_case: 'Legacy rollback only',
    pros: ['High compression ratio'],
    cons: ['Slower than best_compression (ZSTD)', 'Legacy — use best_compression instead', 'High CPU'],
    color: '#6b7d94',
    tier_recommendation: [],
  },
};

// Savings estimation: apply a compression factor based on codec switch
function estimateSavings(currentSizeBytes, fromCodec, toCodec) {
  const from = CODEC_INFO[fromCodec] || CODEC_INFO['default'];
  const to = CODEC_INFO[toCodec] || CODEC_INFO['best_compression'];
  // Estimate "raw" data size from current codec's ratio, then apply new codec
  const estimatedRaw = currentSizeBytes / from.size_vs_default;
  const estimatedNew = estimatedRaw * to.size_vs_default;
  const savedBytes = currentSizeBytes - estimatedNew;
  return {
    current_bytes: currentSizeBytes,
    estimated_new_bytes: Math.max(0, estimatedNew),
    saved_bytes: Math.max(0, savedBytes),
    saved_pct: Math.round((savedBytes / currentSizeBytes) * 100),
  };
}

// GET /api/codec - analyze all indices codec usage + savings
router.get('/', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    const { pattern, codec } = req.query;

    const [catIndices, settings, clusterInfo] = await Promise.all([
      client.cat.indices({ format: 'json', bytes: 'b', h: 'index,health,status,pri,rep,docs.count,store.size,pri.store.size,segments.count' }),
      client.indices.getSettings({ index: '*' }).catch(() => ({})),
      client.info().catch(() => ({})),
    ]);

    // Get ES version
    const esVersion = clusterInfo.version?.number || 'unknown';
    const esMajor = parseInt(esVersion.split('.')[0]) || 7;
    const esMinor = parseInt(esVersion.split('.')[1]) || 0;
    const hasZstdNative = esMajor > 8 || (esMajor === 8 && esMinor >= 16);

    const indices = catIndices
      .filter(idx => !idx.index.startsWith('.') || req.query.system === 'true')
      .map(idx => {
        const idxSettings = settings[idx.index]?.settings?.index || {};
        const currentCodec = idxSettings.codec || 'default';
        const sizeBytes = parseInt(idx['store.size']) || 0;
        const primarySizeBytes = parseInt(idx['pri.store.size']) || 0;

        // Savings simulations for both codecs
        const savings_to_best = estimateSavings(primarySizeBytes, currentCodec, 'best_compression');
        const savings_to_default = estimateSavings(primarySizeBytes, currentCodec, 'default');

        return {
          index: idx.index,
          health: idx.health,
          current_codec: currentCodec,
          codec_info: CODEC_INFO[currentCodec] || { name: currentCodec, algorithm: 'unknown' },
          size_bytes: sizeBytes,
          primary_size_bytes: primarySizeBytes,
          docs: parseInt(idx['docs.count']) || 0,
          shards: parseInt(idx.pri) || 1,
          replicas: parseInt(idx.rep) || 0,
          segments: parseInt(idx['segments.count']) || 0,
          savings_to_best_compression: savings_to_best,
          savings_to_default: savings_to_default,
          already_optimal: currentCodec === 'best_compression',
        };
      });

    // Filters
    let filtered = indices;
    if (pattern) {
      const re = new RegExp(pattern.replace('*', '.*'), 'i');
      filtered = filtered.filter(i => re.test(i.index));
    }
    if (codec) {
      filtered = filtered.filter(i => i.current_codec === codec);
    }

    filtered.sort((a, b) => b.primary_size_bytes - a.primary_size_bytes);

    // Global savings summary
    const defaultIndices = indices.filter(i => i.current_codec === 'default');
    const bestCompIndices = indices.filter(i => i.current_codec === 'best_compression');
    const otherIndices = indices.filter(i => i.current_codec !== 'default' && i.current_codec !== 'best_compression');

    const totalDefaultSize = defaultIndices.reduce((s, i) => s + i.primary_size_bytes, 0);
    const totalBestCompSize = bestCompIndices.reduce((s, i) => s + i.primary_size_bytes, 0);
    const totalSize = indices.reduce((s, i) => s + i.primary_size_bytes, 0);

    // If all default indices switched to best_compression
    const potentialSavings = defaultIndices.reduce((s, i) => s + i.savings_to_best_compression.saved_bytes, 0);

    const summary = {
      es_version: esVersion,
      has_zstd_native: hasZstdNative,
      total_indices: indices.length,
      codec_breakdown: {
        default: defaultIndices.length,
        best_compression: bestCompIndices.length,
        other: otherIndices.length,
      },
      total_primary_size: totalSize,
      total_primary_size_human: bytesToHuman(totalSize),
      potential_savings_bytes: potentialSavings,
      potential_savings_human: bytesToHuman(potentialSavings),
      potential_savings_pct: totalSize > 0 ? Math.round((potentialSavings / totalSize) * 100) : 0,
      default_size_human: bytesToHuman(totalDefaultSize),
      best_comp_size_human: bytesToHuman(totalBestCompSize),
    };

    res.json({ indices: filtered, summary, codec_info: CODEC_INFO });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/codec/simulate - simulate savings for specific indices with a target codec
router.post('/simulate', requireConnection, async (req, res) => {
  try {
    const { indices: indexList, target_codec } = req.body;
    const client = getClient();

    if (!indexList || !target_codec) {
      return res.status(400).json({ error: 'indices and target_codec required' });
    }

    const [catIndices, settings] = await Promise.all([
      client.cat.indices({ format: 'json', bytes: 'b', h: 'index,store.size,pri.store.size,rep' }),
      client.indices.getSettings({ index: indexList.join(',') }).catch(() => ({})),
    ]);

    const indexMap = Object.fromEntries(catIndices.map(i => [i.index, i]));
    const results = indexList.map(name => {
      const idx = indexMap[name];
      if (!idx) return { index: name, error: 'not found' };
      const primarySize = parseInt(idx['pri.store.size']) || 0;
      const replicas = parseInt(idx.rep) || 0;
      const currentCodec = settings[name]?.settings?.index?.codec || 'default';
      const savings = estimateSavings(primarySize, currentCodec, target_codec);
      const totalSavings = savings.saved_bytes * (1 + replicas);
      return {
        index: name,
        current_codec: currentCodec,
        target_codec,
        primary_size: bytesToHuman(primarySize),
        primary_size_bytes: primarySize,
        estimated_new_primary: bytesToHuman(savings.estimated_new_bytes),
        saved_per_primary: bytesToHuman(savings.saved_bytes),
        total_with_replicas_savings: bytesToHuman(totalSavings),
        saved_pct: savings.saved_pct,
        replicas,
        api_command: generateApiCommand(name, target_codec, currentCodec),
      };
    });

    const totalSaved = results.reduce((s, r) => s + (r.saved_bytes || 0), 0);
    res.json({ results, total_saved: bytesToHuman(totalSaved) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function generateApiCommand(indexName, targetCodec, currentCodec) {
  return [
    `# Step 1: Update codec setting (only new segments will use it)`,
    `PUT /${indexName}/_settings`,
    `{ "index.codec": "${targetCodec}" }`,
    ``,
    `# Step 2 (recommended): Force merge to rewrite all segments with new codec`,
    `# Best done during low-traffic window`,
    `POST /${indexName}/_forcemerge?max_num_segments=1`,
    ``,
    `# Optional: Verify codec change`,
    `GET /${indexName}/_settings?filter_path=**.codec`,
  ].join('\n');
}

// POST /api/codec/cluster-impact
// Full cluster-wide impact analysis for a given codec strategy
router.post('/cluster-impact', requireConnection, async (req, res) => {
  try {
    const client = getClient();
    const {
      target_codec = 'best_compression',
      apply_to = 'all',         // 'all' | 'default_only' | 'by_phase' | 'by_tier'
      phases = [],              // if apply_to = 'by_phase'
      tiers = [],               // if apply_to = 'by_tier'
      exclude_pattern = '',
    } = req.body;

    // Fetch everything we need in parallel
    const [catIndices, settings, ilmExplain, nodes, catShards, clusterInfo] = await Promise.all([
      client.cat.indices({ format: 'json', bytes: 'b', h: 'index,health,status,pri,rep,docs.count,store.size,pri.store.size,segments.count,creation.date' }),
      client.indices.getSettings({ index: '*' }).catch(() => ({})),
      client.ilm.explainLifecycle({ index: '*', only_errors: false, only_managed: true }).catch(() => ({ indices: {} })),
      client.nodes.stats({ metric: ['fs'] }),
      client.cat.shards({ format: 'json', bytes: 'b', h: 'index,shard,prirep,state,store,node,ip' }).catch(() => []),
      client.info().catch(() => ({})),
    ]);

    const esVersion = clusterInfo.version?.number || 'unknown';
    const esMajor = parseInt(esVersion.split('.')[0]) || 7;
    const esMinor = parseInt(esVersion.split('.')[1]) || 0;
    const hasZstdNative = esMajor > 8 || (esMajor === 8 && esMinor >= 16);

    // Build node disk map: nodeName -> { total, available, used }
    const nodeDiskMap = {};
    const nodeNameMap = {};
    for (const [nodeId, node] of Object.entries(nodes.nodes || {})) {
      nodeDiskMap[node.name] = {
        id: nodeId,
        name: node.name,
        total: node.fs?.total?.total_in_bytes || 0,
        available: node.fs?.total?.available_in_bytes || 0,
        used: (node.fs?.total?.total_in_bytes || 0) - (node.fs?.total?.available_in_bytes || 0),
        roles: node.roles || [],
      };
      nodeNameMap[nodeId] = node.name;
    }

    // Build shard->node map: shardKey -> nodeName
    const shardNodeMap = {};
    for (const s of catShards) {
      if (s.state === 'STARTED' && s.node) {
        const key = `${s.index}__${s.shard}__${s.prirep}`;
        shardNodeMap[key] = s.node;
        if (!nodeDiskMap[s.node]) {
          nodeDiskMap[s.node] = { name: s.node, total: 0, available: 0, used: 0, roles: [] };
        }
      }
    }

    // Parse exclusion pattern
    const excludeRe = exclude_pattern ? new RegExp(exclude_pattern.replace('*', '.*'), 'i') : null;

    // Build enriched index list
    const allIndices = catIndices
      .filter(idx => !idx.index.startsWith('.'))
      .map(idx => {
        const idxSettings = settings[idx.index]?.settings?.index || {};
        const ilmData = ilmExplain.indices?.[idx.index];
        const currentCodec = idxSettings.codec || 'default';
        const primarySize = parseInt(idx['pri.store.size']) || 0;
        const totalSize = parseInt(idx['store.size']) || 0;
        const replicas = parseInt(idx.rep) || 0;
        const tier = idxSettings['routing.allocation.include._tier_preference']?.split(',')[0]?.replace('data_', '') || null;
        const phase = ilmData?.phase || null;

        return {
          index: idx.index,
          health: idx.health,
          current_codec: currentCodec,
          primary_size: primarySize,
          total_size: totalSize,
          replicas,
          docs: parseInt(idx['docs.count']) || 0,
          segments: parseInt(idx['segments.count']) || 0,
          tier,
          phase,
          ilm_policy: ilmData?.policy || null,
          creation_date: parseInt(idx['creation.date']) || null,
        };
      });

    // Determine which indices are in scope for this migration
    const inScopeIndices = allIndices.filter(idx => {
      if (excludeRe && excludeRe.test(idx.index)) return false;
      if (idx.current_codec === target_codec) return false; // already on target
      if (apply_to === 'default_only') return idx.current_codec === 'default';
      if (apply_to === 'by_phase') return phases.length === 0 || phases.includes(idx.phase);
      if (apply_to === 'by_tier') return tiers.length === 0 || tiers.includes(idx.tier);
      return true; // 'all'
    });

    // Calculate savings per index
    const migrateList = inScopeIndices.map(idx => {
      const savings = estimateSavings(idx.primary_size, idx.current_codec, target_codec);
      const totalWithReplicas = savings.saved_bytes * (1 + idx.replicas);
      return { ...idx, savings, total_saved_with_replicas: totalWithReplicas };
    });

    // Aggregate by tier
    const byTier = {};
    for (const idx of allIndices) {
      const t = idx.tier || 'unknown';
      if (!byTier[t]) byTier[t] = { tier: t, count: 0, total_primary: 0, in_scope: 0, saved: 0, saved_with_replicas: 0 };
      byTier[t].count++;
      byTier[t].total_primary += idx.primary_size;
    }
    for (const idx of migrateList) {
      const t = idx.tier || 'unknown';
      if (!byTier[t]) byTier[t] = { tier: t, count: 0, total_primary: 0, in_scope: 0, saved: 0, saved_with_replicas: 0 };
      byTier[t].in_scope++;
      byTier[t].saved += idx.savings.saved_bytes;
      byTier[t].saved_with_replicas += idx.total_saved_with_replicas;
    }

    // Aggregate by phase
    const byPhase = {};
    for (const idx of migrateList) {
      const p = idx.phase || 'unmanaged';
      if (!byPhase[p]) byPhase[p] = { phase: p, count: 0, saved: 0, saved_with_replicas: 0 };
      byPhase[p].count++;
      byPhase[p].saved += idx.savings.saved_bytes;
      byPhase[p].saved_with_replicas += idx.total_saved_with_replicas;
    }

    // Node-level impact: estimate freed bytes per node by distributing shard savings
    // We do this by looking at shards per node
    const nodeImpact = {};
    for (const [nodeName, disk] of Object.entries(nodeDiskMap)) {
      nodeImpact[nodeName] = {
        name: nodeName,
        roles: disk.roles,
        total_disk: disk.total,
        used_disk: disk.used,
        available_disk: disk.available,
        disk_pct: disk.total > 0 ? Math.round((disk.used / disk.total) * 100) : 0,
        estimated_freed: 0,
      };
    }

    // Map shard savings to nodes
    for (const s of catShards) {
      if (s.state !== 'STARTED' || !s.node) continue;
      const idx = migrateList.find(i => i.index === s.index);
      if (!idx) continue;
      const shardSize = parseInt(s.store) || 0;
      // savings ratio
      const ratio = idx.primary_size > 0 ? (idx.savings.saved_bytes / idx.primary_size) : 0;
      const freed = Math.round(shardSize * ratio);
      if (nodeImpact[s.node]) {
        nodeImpact[s.node].estimated_freed += freed;
      }
    }

    // Compute new disk state per node
    for (const n of Object.values(nodeImpact)) {
      n.estimated_new_used = Math.max(0, n.used_disk - n.estimated_freed);
      n.estimated_new_pct = n.total_disk > 0 ? Math.round((n.estimated_new_used / n.total_disk) * 100) : 0;
      n.estimated_new_available = n.total_disk - n.estimated_new_used;
    }

    // Overall numbers
    const totalCurrentPrimary = allIndices.reduce((s, i) => s + i.primary_size, 0);
    const totalCurrentAll = allIndices.reduce((s, i) => s + i.total_size, 0);
    const totalSavedPrimary = migrateList.reduce((s, i) => s + i.savings.saved_bytes, 0);
    const totalSavedAll = migrateList.reduce((s, i) => s + i.total_saved_with_replicas, 0);
    const totalSegments = migrateList.reduce((s, i) => s + i.segments, 0);

    // Cluster disk totals
    const clusterTotalDisk = Object.values(nodeDiskMap).reduce((s, n) => s + n.total, 0);
    const clusterUsedDisk = Object.values(nodeDiskMap).reduce((s, n) => s + n.used, 0);
    const clusterAvailDisk = clusterTotalDisk - clusterUsedDisk;

    // Watermark thresholds (ES defaults)
    const lowWatermark = 0.85;
    const highWatermark = 0.90;
    const floodWatermark = 0.95;

    // Prioritized migration order: biggest savings first, then by phase priority
    const phasePriority = { hot: 3, warm: 1, cold: 1, frozen: 2, delete: 0, unmanaged: 1 };
    migrateList.sort((a, b) => {
      // First: not-yet-on-target
      const pA = phasePriority[a.phase] || 1;
      const pB = phasePriority[b.phase] || 1;
      if (pA !== pB) return pB - pA;
      return b.savings.saved_bytes - a.savings.saved_bytes;
    });

    // Batch the migration into waves (to avoid overloading the cluster)
    const BATCH_SIZE = 20;
    const batches = [];
    for (let i = 0; i < migrateList.length; i += BATCH_SIZE) {
      batches.push(migrateList.slice(i, i + BATCH_SIZE));
    }

    res.json({
      meta: {
        es_version: esVersion,
        has_zstd_native: hasZstdNative,
        target_codec,
        apply_to,
        phases,
        tiers,
        exclude_pattern,
      },
      cluster: {
        total_disk: clusterTotalDisk,
        used_disk: clusterUsedDisk,
        available_disk: clusterAvailDisk,
        used_pct: clusterTotalDisk > 0 ? Math.round((clusterUsedDisk / clusterTotalDisk) * 100) : 0,
        total_primary: totalCurrentPrimary,
        total_all: totalCurrentAll,
        estimated_freed_primary: totalSavedPrimary,
        estimated_freed_all: totalSavedAll,
        savings_pct: totalCurrentAll > 0 ? Math.round((totalSavedAll / totalCurrentAll) * 100) : 0,
        cluster_disk_savings_pct: clusterTotalDisk > 0 ? ((totalSavedAll / clusterTotalDisk) * 100).toFixed(1) : 0,
        new_used_pct: clusterTotalDisk > 0 ? Math.round(((clusterUsedDisk - totalSavedAll) / clusterTotalDisk) * 100) : 0,
        total_segments_to_rewrite: totalSegments,
      },
      by_tier: Object.values(byTier),
      by_phase: Object.values(byPhase),
      nodes: Object.values(nodeImpact).filter(n => n.total_disk > 0),
      migration: {
        total_indices: migrateList.length,
        total_batches: batches.length,
        batches: batches.map((batch, i) => ({
          batch: i + 1,
          indices: batch.map(idx => ({
            index: idx.index,
            current_codec: idx.current_codec,
            phase: idx.phase,
            tier: idx.tier,
            primary_size: bytesToHuman(idx.primary_size),
            primary_size_bytes: idx.primary_size,
            saved: bytesToHuman(idx.savings.saved_bytes),
            saved_pct: idx.savings.saved_pct,
            replicas: idx.replicas,
            total_freed: bytesToHuman(idx.total_saved_with_replicas),
            segments: idx.segments,
          })),
          batch_saved: bytesToHuman(batch.reduce((s, i) => s + i.total_saved_with_replicas, 0)),
        })),
      },
      watermarks: {
        low: lowWatermark * 100,
        high: highWatermark * 100,
        flood: floodWatermark * 100,
        nodes_near_high: Object.values(nodeImpact).filter(n => n.disk_pct >= 85).map(n => n.name),
        nodes_improved_past_low: Object.values(nodeImpact).filter(n => n.disk_pct >= 85 && n.estimated_new_pct < 85).map(n => n.name),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

module.exports = router;
