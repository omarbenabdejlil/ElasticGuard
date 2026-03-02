const express = require('express');
const router  = express.Router();
const { getClient, isConnected } = require('../lib/elastic');

function guard(req, res, next) {
  if (!isConnected()) return res.status(503).json({ error: 'Not connected' });
  next();
}
function parseMinAge(s) {
  if (!s) return 0;
  const m = String(s).match(/^(\d+\.?\d*)(ms|s|m|h|d)$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mul = { ms:1, s:1000, m:60000, h:3600000, d:86400000 };
  return n * (mul[m[2]] || 0);
}
function bh(b) {
  if (!b) return '0 B';
  const u = ['B','KB','MB','GB','TB']; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

// GET /api/policy-audit
router.get('/', guard, async (req, res) => {
  try {
    const client = getClient();

    const [policies, aliases, ilmExplain, catIndices] = await Promise.all([
      client.ilm.getLifecycle().catch(() => ({})),
      client.cat.aliases({ format: 'json' }).catch(() => []),
      client.ilm.explainLifecycle({ index: '*', only_managed: true }).catch(() => ({ indices: {} })),
      client.cat.indices({ format: 'json', bytes: 'b', h: 'index,health,docs.count,store.size' }).catch(() => []),
    ]);

    const aliasNames  = new Set(aliases.map(a => a.alias));
    const writeAlias  = new Set(aliases.filter(a => a['is.write.index'] === 'true').map(a => a.alias));

    // Count indices per policy
    const policyIndexCount = {};
    const policyIndexBytes = {};
    for (const [name, data] of Object.entries(ilmExplain.indices || {})) {
      const p = data.policy;
      if (!p) continue;
      policyIndexCount[p] = (policyIndexCount[p] || 0) + 1;
      const sizeStr = catIndices.find(i => i.index === name);
      policyIndexBytes[p] = (policyIndexBytes[p] || 0) + (parseInt(sizeStr?.['store.size']) || 0);
    }

    const PHASE_ORDER = ['hot','warm','cold','frozen','delete'];
    const results = [];

    for (const [policyName, policyData] of Object.entries(policies)) {
      const phases  = policyData.policy?.phases || {};
      const issues  = [];
      const phaseList = Object.keys(phases).filter(p => PHASE_ORDER.includes(p))
        .sort((a,b) => PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b));

      // ── Check 1: Phase min_age ordering ─────────────────────────
      let prevAge = 0; let prevPhase = null;
      for (const phaseName of phaseList) {
        const minAge = phases[phaseName]?.min_age;
        const ageMs  = parseMinAge(minAge);
        if (prevPhase && ageMs > 0 && ageMs <= prevAge) {
          issues.push({
            severity: 'critical',
            type: 'phase_order_conflict',
            title: `Phase age conflict: ${phaseName} min_age ≤ ${prevPhase} min_age`,
            detail: `${phaseName} (${minAge || '0ms'}) must be AFTER ${prevPhase} (${phases[prevPhase]?.min_age || '0ms'}). Index can never reach ${phaseName}.`,
            fix: `Set ${phaseName}.min_age to a value greater than ${phases[prevPhase]?.min_age || '0d'}`,
          });
        }
        if (ageMs > 0) { prevAge = ageMs; prevPhase = phaseName; }
      }

      // ── Check 2: Rollover with no alias on any managed index ────
      const hasRollover = phaseList.some(p => phases[p]?.actions?.rollover);
      if (hasRollover) {
        const managedByThis = Object.entries(ilmExplain.indices || {})
          .filter(([, d]) => d.policy === policyName).map(([n]) => n);
        const aliasedCount = managedByThis.filter(idxName => {
          // any alias pointing to this index that is also a write alias
          return aliases.some(a => a.index === idxName && writeAlias.has(a.alias));
        }).length;
        if (managedByThis.length > 0 && aliasedCount === 0) {
          issues.push({
            severity: 'critical',
            type: 'rollover_no_write_alias',
            title: 'Rollover configured but NO managed index has a write alias',
            detail: `${managedByThis.length} indices use this policy with rollover, but none has a write alias. Rollover will always fail.`,
            fix: `Create a write alias: POST /_aliases with { "add": { "index": "<current_index>", "alias": "<alias_name>", "is_write_index": true } }`,
          });
        }
      }

      // ── Check 3: Delete phase missing min_age ───────────────────
      if (phases.delete && !phases.delete.min_age) {
        issues.push({
          severity: 'critical',
          type: 'delete_no_age',
          title: 'Delete phase has no min_age — indices may be deleted immediately',
          detail: 'Without a min_age on the delete phase, Elasticsearch can delete indices right after creation depending on timing.',
          fix: 'Add a min_age to the delete phase: e.g. "min_age": "30d"',
        });
      }

      // ── Check 4: Freeze on ES 8+ (deprecated/removed) ──────────
      for (const phaseName of phaseList) {
        if (phases[phaseName]?.actions?.freeze) {
          issues.push({
            severity: 'warn',
            type: 'freeze_deprecated',
            title: `Freeze action in ${phaseName} phase — deprecated in ES 7.14, removed in ES 8`,
            detail: 'The freeze action is no longer available on ES 8+. Use the frozen tier (data_frozen role) instead.',
            fix: `Remove the freeze action from ${phaseName} phase and use data_frozen tier routing instead`,
          });
        }
      }

      // ── Check 5: Force merge > 1 segment (risky) ───────────────
      for (const phaseName of phaseList) {
        const fm = phases[phaseName]?.actions?.forcemerge;
        if (fm?.max_num_segments && fm.max_num_segments > 1) {
          issues.push({
            severity: 'warn',
            type: 'forcemerge_segments',
            title: `Force merge in ${phaseName} set to ${fm.max_num_segments} segments (recommended: 1)`,
            detail: 'Using more than 1 segment reduces compression efficiency and defeats the purpose of force merging.',
            fix: `Set forcemerge.max_num_segments to 1 in ${phaseName} phase`,
          });
        }
      }

      // ── Check 6: Hot phase with no rollover ─────────────────────
      if (phases.hot && !phases.hot.actions?.rollover) {
        issues.push({
          severity: 'high',
          type: 'hot_no_rollover',
          title: 'Hot phase has no rollover action',
          detail: 'Without rollover, the hot index grows indefinitely. It will never transition to warm/cold.',
          fix: 'Add a rollover action to the hot phase: max_size, max_age, or max_docs',
        });
      }

      // ── Check 7: Warm phase with forcemerge but no readonly ─────
      if (phases.warm?.actions?.forcemerge && !phases.warm?.actions?.readonly) {
        issues.push({
          severity: 'warn',
          type: 'forcemerge_without_readonly',
          title: 'Warm phase: force merge without readonly',
          detail: 'Force merging a writable index can conflict with ongoing writes. Set the index to readonly before force merging.',
          fix: 'Add "readonly": {} action to the warm phase, before forcemerge',
        });
      }

      // ── Check 8: Rollover max_docs only (no size/age) ───────────
      for (const phaseName of phaseList) {
        const ro = phases[phaseName]?.actions?.rollover;
        if (ro && ro.max_docs && !ro.max_size && !ro.max_age) {
          issues.push({
            severity: 'warn',
            type: 'rollover_docs_only',
            title: `${phaseName} rollover uses max_docs only — no size or age constraint`,
            detail: 'max_docs-only rollover can create thousands of tiny indices for low-volume streams, wasting heap and resources.',
            fix: 'Add max_size (e.g. "50gb") or max_age (e.g. "30d") alongside max_docs',
          });
        }
      }

      // ── Check 9: Policy has no indices using it ─────────────────
      const indexCount = policyIndexCount[policyName] || 0;
      if (indexCount === 0) {
        issues.push({
          severity: 'info',
          type: 'unused_policy',
          title: 'Policy is not used by any index',
          detail: 'No managed index currently references this policy. It may be orphaned.',
          fix: 'Verify this policy is still needed, or delete it to reduce clutter',
        });
      }

      const critCount = issues.filter(i => i.severity === 'critical').length;
      const highCount = issues.filter(i => i.severity === 'high').length;
      const warnCount = issues.filter(i => i.severity === 'warn').length;

      results.push({
        policy: policyName,
        phases: phaseList,
        phase_count: phaseList.length,
        index_count: indexCount,
        data_size: bh(policyIndexBytes[policyName] || 0),
        has_rollover: hasRollover,
        issues,
        issue_count: issues.length,
        critical: critCount,
        high: highCount,
        warn: warnCount,
        score: critCount * 100 + highCount * 10 + warnCount, // higher = worse
      });
    }

    results.sort((a,b) => b.score - a.score);

    const summary = {
      total_policies:      results.length,
      policies_with_issues: results.filter(r => r.issues.length > 0).length,
      clean_policies:      results.filter(r => r.issues.length === 0).length,
      total_critical:      results.reduce((s,r) => s + r.critical, 0),
      total_high:          results.reduce((s,r) => s + r.high, 0),
      total_warn:          results.reduce((s,r) => s + r.warn, 0),
    };

    res.json({ policies: results, summary });
  } catch(e) { res.status(500).json({ error: e.message, stack: e.stack }); }
});

module.exports = router;
