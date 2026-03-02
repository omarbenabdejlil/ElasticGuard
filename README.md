# ⚡ ElasticGuard

> Elasticsearch Cluster Inspector & Health Analyzer

## Features

### 📊 Dashboard
- Cluster health status (green/yellow/red)  
- Node-by-node CPU, Heap, Disk usage bars  
- Active/unassigned/relocating shard counts  
- Total store size, doc counts

### ⊞ Indices
- Full index list with ILM phase, tier, policy, sizes, shards, replicas  
- **Filters**: phase (hot/warm/cold/frozen/delete), tier, health, replica count  
- **Search** by name pattern  
- **Sortable** columns (size, docs, shards, name…)  
- Click any index for detailed modal: stats, ILM state, shard breakdown

### ⟳ ILM Policies  
- All policies with phase breakdown  
- **Auto-detects misconfigurations**:
  - `max_primary_shard_size` used instead of `max_size` (footgun!)
  - Missing or non-write rollover aliases
  - Delete phase without `min_age`
  - Frozen phase without `searchable_snapshots`
- Expand any policy to see which indices use it

### ◎ Jobs & Snapshots
- Snapshot repositories + last N snapshots per repo (state, duration, size)
- SLM policies + last success/failure
- Running cluster tasks
- Transforms status
- ML job states

### ⚠ Diagnostics (the main power feature)
- **ILM Alias Issues**: rollover alias missing, alias not a write index  
- **Shard-Size ILM Misconfig**: `max_primary_shard_size` × N shards = actual max (often 5–10× expected)
- **ILM Errors**: stuck indices with step_info + retry command
- **No Replica Indices**: cost calculator for adding 1 or 2 replicas  
- **Unassigned Shards**: primary vs replica, severity  
- **Oversized Indices**: >100GB with shard count analysis  
- **No ILM**: unmanaged indices sorted by size  
- **Shard Count Issues**: shards too large (>50GB) or too small  
- **Empty Old Indices**: 0-doc indices older than 7 days  
- Filter by category with one click

## Quick Start

```bash
npm install
npm start
# Open http://localhost:3000
```

## Connection
Enter your cluster URL + credentials in the web UI. Supports:
- Username/password
- API key  
- Self-signed TLS (skip verification option)
