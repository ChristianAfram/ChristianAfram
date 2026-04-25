/**
 * `promptreg diff <runId1> <runId2>` command.
 */

import { loadRun } from '../store.js';
import { compareRuns } from '../diff.js';
import { printDiff } from '../reporter.js';
import chalk from 'chalk';

export async function diffCommand(runId1, runId2) {
  const runA = loadRun(runId1);
  const runB = loadRun(runId2);

  if (!runA) {
    console.error(chalk.red(`Run not found: ${runId1}`));
    console.error(chalk.gray('Use `promptreg history` to list available runs.'));
    process.exit(1);
  }
  if (!runB) {
    console.error(chalk.red(`Run not found: ${runId2}`));
    console.error(chalk.gray('Use `promptreg history` to list available runs.'));
    process.exit(1);
  }

  const diffReport = compareRuns(runA, runB);
  printDiff(diffReport);

  process.exit(diffReport.summary.regressions > 0 ? 1 : 0);
}
