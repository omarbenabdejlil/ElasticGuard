const express = require('express');
const router  = express.Router();
const { getClient, isConnected } = require('../lib/elastic');

function guard(req, res, next) {
  if (!isConnected()) return res.status(503).json({ error: 'Not connected' });
  next();
}
function bh(b) {
  if (!b) return '0 B';
  const u = ['B','KB','MB','GB','TB','PB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

// GET /api/cost?price_per_gb=0.10
router.get('/', guard, async (req, res) => {
  try {
    const client = getClient();
    const pricePerGB = parseFloat(req.query.price_per_gb) || 0.10; // USD/GB/month default

    const [catIndices, settings, ilmExplain, nodeStats] = await Promise.all([
      client.cat.indices({ format: 'json', bytes: 'b', h: 'index,health,pri,rep,docs.count,store.size,pri.store.size' }),
      client.indices.getSettings({ index: '*' }).catch(() => ({})),
      client.ilm.explainLifecycle({ index: '*', only_managed: true }).catch(() => ({ indices: {} })),
      client.nodes.stats({ metric: ['fs'] }),
    ]);

    const pricePerByte = pricePerGB / (1024 ** 3);

    const indices = catIndices
      .filter(i => !i.index.startsWith('.'))
      .map(idx => {
        const ilm      = ilmExplain.indices?.[idx.index];
        const codec    = settings[idx.index]?.settings?.index?.codec || 'default';
        const totalBytes = parseInt(idx['store.size']) || 0;
        const priBytes   = parseInt(idx['pri.store.size']) || 0;
        const replicas   = parseInt(idx.rep) || 0;
        const phase      = ilm?.phase || 'unmanaged';
        const policy     = ilm?.policy || null;

        // Savings if migrated to best_compression (~28% smaller)
        const compressionSavingBytes = codec === 'default'
          ? Math.round(priBytes * 0.28 * (1 + replicas))
          : 0;

        // Cost to add replicas
        const cost_add_1_replica = priBytes * pricePerByte;

        return {
          index: idx.index,
          phase, policy, codec, replicas,
          total_bytes: totalBytes,
          pri_bytes: priBytes,
          monthly_cost: totalBytes * pricePerByte,
          compression_saving_bytes: compressionSavingBytes,
          compression_saving_monthly: compressionSavingBytes * pricePerByte,
          cost_add_1_replica,
          docs: parseInt(idx['docs.count']) || 0,
        };
      });

    // Group by phase
    const byPhase = {};
    for (const idx of indices) {
      if (!byPhase[idx.phase]) byPhase[idx.phase] = { phase: idx.phase, count: 0, total_bytes: 0, monthly_cost: 0, compression_saving: 0 };
      byPhase[idx.phase].count++;
      byPhase[idx.phase].total_bytes  += idx.total_bytes;
      byPhase[idx.phase].monthly_cost += idx.monthly_cost;
      byPhase[idx.phase].compression_saving += idx.compression_saving_bytes * pricePerByte;
    }

    // Cluster disk totals
    let clusterTotal = 0, clusterUsed = 0;
    for (const n of Object.values(nodeStats.nodes || {})) {
      clusterTotal += n.fs?.total?.total_in_bytes || 0;
      const avail   = n.fs?.total?.available_in_bytes || 0;
      clusterUsed  += (n.fs?.total?.total_in_bytes || 0) - avail;
    }

    const totalMonthly     = indices.reduce((s, i) => s + i.monthly_cost, 0);
    const totalCompSaving  = indices.reduce((s, i) => s + i.compression_saving_monthly, 0);
    const defaultIndices   = indices.filter(i => i.codec === 'default');

    res.json({
      price_per_gb: pricePerGB,
      cluster: {
        total_disk: clusterTotal, total_disk_human: bh(clusterTotal),
        used_disk:  clusterUsed,  used_disk_human:  bh(clusterUsed),
        monthly_hardware_cost: clusterTotal / (1024**3) * pricePerGB,
      },
      summary: {
        total_indices:       indices.length,
        total_data_bytes:    indices.reduce((s,i) => s + i.total_bytes, 0),
        total_data_human:    bh(indices.reduce((s,i) => s + i.total_bytes, 0)),
        monthly_cost:        totalMonthly,
        yearly_cost:         totalMonthly * 12,
        compression_saving_monthly:  totalCompSaving,
        compression_saving_yearly:   totalCompSaving * 12,
        compression_saving_pct:      totalMonthly > 0 ? Math.round(totalCompSaving / totalMonthly * 100) : 0,
        default_codec_indices:       defaultIndices.length,
        default_codec_bytes:         defaultIndices.reduce((s,i) => s + i.total_bytes, 0),
      },
      by_phase: Object.values(byPhase).sort((a,b) => b.monthly_cost - a.monthly_cost).map(p => ({
        ...p,
        total_bytes_human:  bh(p.total_bytes),
        monthly_cost_fmt:   '$' + p.monthly_cost.toFixed(2),
        yearly_cost_fmt:    '$' + (p.monthly_cost * 12).toFixed(2),
        compression_saving_fmt: '$' + p.compression_saving.toFixed(2),
      })),
      top_cost_indices: [...indices]
        .sort((a,b) => b.monthly_cost - a.monthly_cost)
        .slice(0, 20)
        .map(i => ({
          index: i.index, phase: i.phase, codec: i.codec,
          total_bytes_human: bh(i.total_bytes),
          monthly_cost: '$' + i.monthly_cost.toFixed(4),
          yearly_cost:  '$' + (i.monthly_cost * 12).toFixed(2),
          compression_saving: i.compression_saving_monthly > 0 ? '$' + i.compression_saving_monthly.toFixed(4) : null,
        })),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
