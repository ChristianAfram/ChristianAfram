/**
 * Run history store — persists run results to .cache/runs/<runId>.json
 * for later diffing and history display.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const RUNS_DIR = path.resolve('.cache', 'runs');

function ensureRunsDir() {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
}

/**
 * Generate a short run ID like "2024-12-01T14:30:00-a3f2"
 */
export function generateRunId() {
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-');
  const suffix = crypto.randomBytes(2).toString('hex');
  return `${ts}-${suffix}`;
}

/**
 * Save a completed run to disk.
 * @param {string} runId
 * @param {object} runData - { runId, startedAt, finishedAt, model, summary, results }
 */
export function saveRun(runId, runData) {
  ensureRunsDir();
  const file = path.join(RUNS_DIR, `${runId}.json`);
  fs.writeFileSync(file, JSON.stringify(runData, null, 2));
  return file;
}

/**
 * Load a run by ID.
 * @param {string} runId
 * @returns {object|null}
 */
export function loadRun(runId) {
  ensureRunsDir();
  const file = path.join(RUNS_DIR, `${runId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * List all past runs, newest first.
 * @param {number} limit
 * @returns {Array<{runId, startedAt, summary}>}
 */
export function listRuns(limit = 20) {
  ensureRunsDir();
  const files = fs
    .readdirSync(RUNS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit);

  return files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8'));
      return {
        runId: data.runId,
        startedAt: data.startedAt,
        model: data.model,
        summary: data.summary,
      };
    } catch {
      return { runId: f.replace('.json', ''), startedAt: '?', model: '?', summary: {} };
    }
  });
}

/**
 * Get the most recent run (used for auto-diff after a run).
 */
export function getPreviousRun(currentRunId) {
  const all = listRuns(50);
  const idx = all.findIndex(r => r.runId === currentRunId);
  if (idx === -1) return all[0] || null;
  return all[idx + 1] || null;
}
