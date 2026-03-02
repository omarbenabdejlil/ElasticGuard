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

    // Get snapshot repos
    const repos = await client.snapshot.getRepository({ name: '*' }).catch(() => ({}));
    const repoNames = Object.keys(repos);

    // Get recent snapshots from each repo (last 50)
    const snapshotsByRepo = {};
    for (const repo of repoNames) {
      try {
        const snaps = await client.snapshot.get({ repository: repo, snapshot: '*', verbose: true, ignore_unavailable: true });
        snapshotsByRepo[repo] = (snaps.snapshots || []).slice(-50).reverse();
      } catch {
        snapshotsByRepo[repo] = [];
      }
    }

    // Get SLM policies
    const slmPolicies = await client.slm.getLifecycle().catch(() => ({}));

    // Get running tasks
    const tasks = await client.tasks.list({ detailed: true, group_by: 'parents' }).catch(() => ({ tasks: {} }));
    const snapshotTasks = [];
    const allTasks = [];

    const flattenTasks = (taskMap) => {
      for (const [id, task] of Object.entries(taskMap || {})) {
        allTasks.push({ id, ...task });
        if (task.children) flattenTasks(task.children);
      }
    };
    flattenTasks(tasks.tasks);

    // Get ILM status
    const ilmStatus = await client.ilm.getStatus().catch(() => ({}));

    // Get transform stats if available
    const transforms = await client.transform.getTransformStats({ transform_id: '*', size: 100 }).catch(() => ({ transforms: [] }));

    // Get ML jobs if available
    const mlJobs = await client.ml.getJobStats({ job_id: '*' }).catch(() => ({ jobs: [] }));

    res.json({
      repositories: Object.entries(repos).map(([name, config]) => ({
        name,
        type: config.type,
        settings: config.settings,
        snapshots_count: snapshotsByRepo[name]?.length || 0,
        latest_snapshot: snapshotsByRepo[name]?.[0] || null,
      })),
      snapshots: snapshotsByRepo,
      slm_policies: Object.entries(slmPolicies).map(([name, pol]) => ({
        name,
        ...pol,
      })),
      running_tasks: allTasks.filter(t => t.action?.includes('snapshot') || t.action?.includes('restore')),
      all_tasks: allTasks.slice(0, 50),
      ilm_status: ilmStatus,
      transforms: transforms.transforms || [],
      ml_jobs: mlJobs.jobs || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
