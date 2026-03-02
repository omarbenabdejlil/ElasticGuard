const express = require('express');
const router  = express.Router();
const { getClient, isConnected } = require('../lib/elastic');

function guard(req, res, next) {
  if (!isConnected()) return res.status(503).json({ error: 'Not connected' });
  next();
}
function bh(b) {
  if (!b) return '0 B';
  const u = ['B','KB','MB','GB','TB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

// GET /api/simulator/nodes  — list nodes + disk + shards so UI can pick a node
router.get('/nodes', guard, async (req, res) => {
  try {
    const client = getClient();
    const [nodeStats, catShards, catNodes] = await Promise.all([
      client.nodes.stats({ metric: ['fs','os','jvm'] }),
      client.cat.shards({ format: 'json', bytes: 'b', h: 'index,shard,prirep,state,store,node' }).catch(() => []),
      client.cat.nodes({ format: 'json', h: 'name,ip,heapPercent,ramPercent,cpu,diskUsed,diskTotal,diskAvailPercent,role,master' }).catch(() => []),
    ]);

    const nodes = Object.entries(nodeStats.nodes).map(([id, n]) => {
      const total       = n.fs?.total?.total_in_bytes || 0;
      const avail       = n.fs?.total?.available_in_bytes || 0;
      const used        = total - avail;
      const nodeName    = n.name || id;
      const shards      = catShards.filter(s => s.node === nodeName && s.state === 'STARTED');
      const shardBytes  = shards.reduce((acc, sh) => acc + (parseInt(sh.store) || 0), 0);
      const heapUsed    = n.jvm?.mem?.heap_used_in_bytes || 0;
      const heapMax     = n.jvm?.mem?.heap_max_in_bytes  || 1;
      return {
        id,
        name:              nodeName,
        roles:             n.roles || [],
        total_disk:        total,
        used_disk:         used,
        avail_disk:        avail,
        disk_pct:          total > 0 ? Math.round(used / total * 100) : 0,
        disk_pct_human:    bh(used) + ' / ' + bh(total),
        heap_pct:          heapMax > 0 ? Math.round(heapUsed / heapMax * 100) : 0,
        cpu:               n.os?.cpu?.percent ?? 0,
        shard_count:       shards.length,
        shard_bytes:       shardBytes,
        shard_bytes_human: bh(shardBytes),
      };
    });
    nodes.sort((a,b) => b.shard_bytes - a.shard_bytes);
    res.json({ nodes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/simulator/remove-node  — simulate removing a node
router.post('/remove-node', guard, async (req, res) => {
  try {
    const { node_name } = req.body;
    if (!node_name) return res.status(400).json({ error: 'node_name required' });
    const client = getClient();

    const [nodeStats, catShards] = await Promise.all([
      client.nodes.stats({ metric: ['fs','os','jvm'] }),
      client.cat.shards({ format: 'json', bytes: 'b', h: 'index,shard,prirep,state,store,node' }).catch(() => []),
    ]);

    // Build node map
    const nodeMap = {};
    for (const [id, n] of Object.entries(nodeStats.nodes)) {
      const total = n.fs?.total?.total_in_bytes || 0;
      const avail = n.fs?.total?.available_in_bytes || 0;
      nodeMap[n.name] = {
        id, name: n.name, roles: n.roles || [],
        total_disk: total, used_disk: total - avail, avail_disk: avail,
        disk_pct: total > 0 ? Math.round((total - avail) / total * 100) : 0,
        projected_extra: 0,
      };
    }

    // Find shards on removed node
    const removedShards = catShards.filter(s => s.node === node_name && s.state === 'STARTED');
    const remainingNodes = Object.values(nodeMap).filter(n => n.name !== node_name);

    if (!nodeMap[node_name]) {
      return res.status(404).json({ error: `Node "${node_name}" not found` });
    }

    const removedNode = nodeMap[node_name];
    const removedBytes = removedShards.reduce((s, sh) => s + (parseInt(sh.store) || 0), 0);

    // For each shard on removed node, find where its replica/primary lives
    // and figure out which OTHER node would absorb it
    const shardMoves = [];
    const nodeLoad = {}; // track how many extra bytes per target node
    for (const n of remainingNodes) nodeLoad[n.name] = 0;

    // Group shards by index+shard to find replica targets
    const shardGroups = {};
    for (const s of catShards) {
      const key = `${s.index}__${s.shard}`;
      if (!shardGroups[key]) shardGroups[key] = [];
      shardGroups[key].push(s);
    }

    for (const sh of removedShards) {
      const key = `${sh.index}__${sh.shard}`;
      const group = shardGroups[key] || [];
      const bytes = parseInt(sh.store) || 0;

      // Find nodes that already have the other copy (replica/primary pair)
      const occupiedNodes = new Set(group.filter(g => g.node !== node_name).map(g => g.node));

      // Pick least-loaded remaining node that doesn't already have this shard
      const eligible = remainingNodes
        .filter(n => !occupiedNodes.has(n.name))
        .sort((a, b) => (a.used_disk + (nodeLoad[a.name]||0)) - (b.used_disk + (nodeLoad[b.name]||0)));

      const target = eligible[0] || remainingNodes[0];
      if (target) {
        nodeLoad[target.name] = (nodeLoad[target.name] || 0) + bytes;
        shardMoves.push({
          index: sh.index, shard: sh.shard, prirep: sh.prirep,
          bytes, bytes_human: bh(bytes),
          from: node_name, to: target.name,
        });
      }
    }

    // Build projected node state
    const projectedNodes = remainingNodes.map(n => {
      const extra    = nodeLoad[n.name] || 0;
      const newUsed  = n.used_disk + extra;
      const newPct   = n.total_disk > 0 ? Math.round(newUsed / n.total_disk * 100) : 0;
      const oldPct   = n.disk_pct;
      return {
        name: n.name, roles: n.roles,
        total_disk: n.total_disk, total_disk_human: bh(n.total_disk),
        old_used: n.used_disk, old_used_human: bh(n.used_disk), old_pct: oldPct,
        absorbs_bytes: extra, absorbs_human: bh(extra),
        new_used: newUsed, new_used_human: bh(newUsed), new_pct: newPct,
        crosses_85: oldPct < 85 && newPct >= 85,
        crosses_90: oldPct < 90 && newPct >= 90,
        is_safe: newPct < 85,
        status: newPct >= 90 ? 'DANGER' : newPct >= 85 ? 'WARNING' : 'OK',
      };
    });

    const dangerNodes  = projectedNodes.filter(n => n.status === 'DANGER');
    const warningNodes = projectedNodes.filter(n => n.status === 'WARNING');
    const safeToRemove = dangerNodes.length === 0 && warningNodes.length === 0;

    res.json({
      removed_node: {
        name: node_name, roles: removedNode.roles,
        shard_count: removedShards.length,
        shard_bytes: removedBytes, shard_bytes_human: bh(removedBytes),
      },
      verdict: safeToRemove ? 'SAFE' : dangerNodes.length > 0 ? 'DANGER' : 'WARNING',
      verdict_message: safeToRemove
        ? 'Safe to remove — no node will exceed the 85% low watermark.'
        : dangerNodes.length > 0
          ? `${dangerNodes.length} node(s) will exceed 90% HIGH watermark — DO NOT remove this node yet.`
          : `${warningNodes.length} node(s) will exceed 85% low watermark — proceed with caution.`,
      shard_moves: shardMoves,
      projected_nodes: projectedNodes.sort((a,b) => b.new_pct - a.new_pct),
      summary: {
        total_shards_to_move: shardMoves.length,
        total_bytes_to_move: removedBytes,
        total_bytes_human: bh(removedBytes),
        danger_nodes: dangerNodes.map(n => n.name),
        warning_nodes: warningNodes.map(n => n.name),
      },
    });
  } catch(e) { res.status(500).json({ error: e.message, stack: e.stack }); }
});

module.exports = router;
