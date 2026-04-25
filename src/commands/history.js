/**
 * `promptreg history` command.
 */

import { listRuns } from '../store.js';
import { printHistory } from '../reporter.js';

export async function historyCommand(opts) {
  const limit = parseInt(opts.limit, 10) || 10;
  const runs = listRuns(limit);
  printHistory(runs);
}
