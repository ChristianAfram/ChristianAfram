/**
 * Diff engine — compares two run results and highlights regressions and improvements.
 */

import { diffWords } from 'diff';

/**
 * Compare two run result sets and produce a structured diff.
 *
 * @param {object} runA - older run data (from store)
 * @param {object} runB - newer run data (from store)
 * @returns {DiffReport}
 */
export function compareRuns(runA, runB) {
  const casesA = indexByCaseName(runA.results);
  const casesB = indexByCaseName(runB.results);

  const allNames = new Set([...Object.keys(casesA), ...Object.keys(casesB)]);
  const entries = [];

  for (const name of allNames) {
    const a = casesA[name];
    const b = casesB[name];

    if (!a) {
      entries.push({ name, status: 'added', a: null, b });
      continue;
    }
    if (!b) {
      entries.push({ name, status: 'removed', a, b: null });
      continue;
    }

    const statusChange = getStatusChange(a, b);
    const assertionDiff = diffAssertions(a.assertionResults, b.assertionResults);
    const responseDiff = b.response !== a.response
      ? diffWords(a.response || '', b.response || '')
      : null;

    entries.push({
      name,
      status: statusChange,
      a,
      b,
      assertionDiff,
      responseDiff,
      tokenDelta: (b.usage?.total_tokens ?? 0) - (a.usage?.total_tokens ?? 0),
      latencyDelta: (b.latencyMs ?? 0) - (a.latencyMs ?? 0),
    });
  }

  const regressions = entries.filter(e => e.status === 'regressed');
  const improvements = entries.filter(e => e.status === 'improved');
  const unchanged = entries.filter(e => e.status === 'unchanged');
  const added = entries.filter(e => e.status === 'added');
  const removed = entries.filter(e => e.status === 'removed');

  return {
    runIdA: runA.runId,
    runIdB: runB.runId,
    entries,
    summary: {
      total: entries.length,
      regressions: regressions.length,
      improvements: improvements.length,
      unchanged: unchanged.length,
      added: added.length,
      removed: removed.length,
    },
  };
}

function indexByCaseName(results) {
  const idx = {};
  for (const r of (results || [])) {
    idx[r.caseName] = r;
  }
  return idx;
}

function getStatusChange(a, b) {
  const aPassed = a.passed;
  const bPassed = b.passed;
  if (aPassed && !bPassed) return 'regressed';
  if (!aPassed && bPassed) return 'improved';
  if (!aPassed && !bPassed) {
    // Both failed — check if different assertions failed
    const aFailed = new Set((a.assertionResults || []).filter(r => !r.pass).map(r => r.label));
    const bFailed = new Set((b.assertionResults || []).filter(r => !r.pass).map(r => r.label));
    const changed = [...aFailed].some(l => !bFailed.has(l)) || [...bFailed].some(l => !aFailed.has(l));
    return changed ? 'changed' : 'unchanged';
  }
  // Both passed — check for response drift or token changes
  if (a.response !== b.response) return 'drifted';
  return 'unchanged';
}

function diffAssertions(aAssertions = [], bAssertions = []) {
  const aIdx = indexByLabel(aAssertions);
  const bIdx = indexByLabel(bAssertions);
  const allLabels = new Set([...Object.keys(aIdx), ...Object.keys(bIdx)]);
  const changes = [];

  for (const label of allLabels) {
    const a = aIdx[label];
    const b = bIdx[label];
    if (!a || !b) continue;
    if (a.pass !== b.pass) {
      changes.push({
        label,
        from: a.pass ? 'PASS' : 'FAIL',
        to: b.pass ? 'PASS' : 'FAIL',
        message: b.message,
      });
    }
  }
  return changes;
}

function indexByLabel(assertions) {
  const idx = {};
  for (const a of assertions) idx[a.label] = a;
  return idx;
}

/**
 * Render a word-diff array (from the `diff` library) as a compact string
 * with +/- markers for terminal display.
 */
export function renderWordDiff(wordDiff) {
  if (!wordDiff) return '';
  return wordDiff
    .map(part => {
      if (part.added) return `[+${part.value}]`;
      if (part.removed) return `[-${part.value}]`;
      return part.value;
    })
    .join('');
}
