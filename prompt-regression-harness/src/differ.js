/**
 * differ.js
 * Compares the current run results against the previous run.
 *
 * Results are stored in .results/<timestamp>.json
 * The "last run" is the most recent file in that directory.
 *
 * Each run result file has shape:
 * {
 *   timestamp: ISO string,
 *   summary: { total, passed, failed },
 *   cases: [
 *     {
 *       id, name, passed, output,
 *       assertions: [{ type, passed, message, detail }]
 *     }
 *   ]
 * }
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join, resolve } from 'path';
import { diffLines } from 'diff';
import chalk from 'chalk';

// ─── Storage ──────────────────────────────────────────────────────────────────

function getResultsDir(resultsDir) {
  const abs = resolve(resultsDir);
  if (!existsSync(abs)) mkdirSync(abs, { recursive: true });
  return abs;
}

export function saveRunResult(result, resultsDir = '.results') {
  const dir = getResultsDir(resultsDir);
  const timestamp = result.timestamp.replace(/[:.]/g, '-');
  const filename = `run-${timestamp}.json`;
  const path = join(dir, filename);
  writeFileSync(path, JSON.stringify(result, null, 2), 'utf-8');
  return path;
}

export function loadLastRunResult(resultsDir = '.results') {
  const dir = getResultsDir(resultsDir);
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('run-') && f.endsWith('.json'))
    .sort(); // lexicographic = chronological because of timestamp naming

  if (files.length === 0) return null;

  // Second to last (last is the one we just saved, which will be passed separately)
  const lastFile = files[files.length - 1];
  const path = join(dir, lastFile);
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export function loadPreviousRunResult(resultsDir = '.results') {
  const dir = getResultsDir(resultsDir);
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('run-') && f.endsWith('.json'))
    .sort();

  if (files.length < 2) return null; // Need at least 2: current + previous

  const prevFile = files[files.length - 2];
  const path = join(dir, prevFile);
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

// ─── Diffing ──────────────────────────────────────────────────────────────────

/**
 * @typedef {object} CaseDiff
 * @property {string} id
 * @property {string} name
 * @property {'new'|'same'|'regressed'|'fixed'|'changed'} status
 * @property {string|null} outputDiff   - Colored diff of output text
 * @property {AssertionDiff[]} assertionDiffs
 */

/**
 * @typedef {object} AssertionDiff
 * @property {string} type
 * @property {boolean|null} prevPassed
 * @property {boolean} currPassed
 * @property {'same'|'regressed'|'fixed'} status
 */

export function diffRuns(currentRun, previousRun) {
  if (!previousRun) {
    return {
      hasPrevious: false,
      caseDiffs: currentRun.cases.map((c) => ({
        id: c.id,
        name: c.name,
        status: 'new',
        outputDiff: null,
        assertionDiffs: (c.assertions || []).map((a) => ({
          type: a.type,
          prevPassed: null,
          currPassed: a.passed,
          status: 'new',
        })),
      })),
    };
  }

  // Build lookup map from previous run
  const prevByName = new Map(previousRun.cases.map((c) => [c.name, c]));
  const currByName = new Map(currentRun.cases.map((c) => [c.name, c]));

  const caseDiffs = [];

  for (const curr of currentRun.cases) {
    const prev = prevByName.get(curr.name);

    if (!prev) {
      caseDiffs.push({
        id: curr.id,
        name: curr.name,
        status: 'new',
        outputDiff: null,
        assertionDiffs: (curr.assertions || []).map((a) => ({
          type: a.type,
          prevPassed: null,
          currPassed: a.passed,
          status: 'new',
        })),
      });
      continue;
    }

    // Build assertion diffs
    const prevAssertionMap = new Map((prev.assertions || []).map((a) => [a.type, a]));
    const assertionDiffs = (curr.assertions || []).map((currA) => {
      const prevA = prevAssertionMap.get(currA.type);
      let status;
      if (!prevA) {
        status = 'new';
      } else if (prevA.passed && !currA.passed) {
        status = 'regressed';
      } else if (!prevA.passed && currA.passed) {
        status = 'fixed';
      } else {
        status = 'same';
      }
      return {
        type: currA.type,
        prevPassed: prevA?.passed ?? null,
        currPassed: currA.passed,
        status,
      };
    });

    // Determine overall case status
    const prevPassed = prev.passed;
    const currPassed = curr.passed;
    let caseStatus;
    if (prevPassed && !currPassed) {
      caseStatus = 'regressed';
    } else if (!prevPassed && currPassed) {
      caseStatus = 'fixed';
    } else if (prev.output !== curr.output) {
      caseStatus = 'changed';
    } else {
      caseStatus = 'same';
    }

    // Build output diff
    let outputDiff = null;
    if (prev.output !== curr.output) {
      const rawDiff = diffLines(prev.output || '', curr.output || '');
      outputDiff = rawDiff
        .map((part) => {
          const lines = part.value.split('\n').filter((_, i, arr) => i < arr.length - 1 || part.value.endsWith('\n') || i < arr.length - 1);
          return lines
            .map((line) => {
              if (part.added) return chalk.green(`+ ${line}`);
              if (part.removed) return chalk.red(`- ${line}`);
              return chalk.gray(`  ${line}`);
            })
            .join('\n');
        })
        .join('\n');
    }

    caseDiffs.push({
      id: curr.id,
      name: curr.name,
      status: caseStatus,
      outputDiff,
      assertionDiffs,
    });
  }

  // Also flag removed cases
  for (const prev of previousRun.cases) {
    if (!currByName.has(prev.name)) {
      caseDiffs.push({
        id: prev.id,
        name: prev.name,
        status: 'removed',
        outputDiff: null,
        assertionDiffs: [],
      });
    }
  }

  return { hasPrevious: true, caseDiffs };
}

/**
 * Returns a summary line for the diff.
 */
export function diffSummary(caseDiffs) {
  const counts = { new: 0, same: 0, regressed: 0, fixed: 0, changed: 0, removed: 0 };
  for (const d of caseDiffs) counts[d.status] = (counts[d.status] || 0) + 1;
  return counts;
}
