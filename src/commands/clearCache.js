/**
 * `promptreg clear-cache` command.
 */

import { clearCache, cacheStats } from '../cache.js';
import chalk from 'chalk';

export async function clearCacheCommand() {
  const before = cacheStats();
  const deleted = clearCache();
  console.log(chalk.green(`✓ Cleared ${deleted} cached response(s) (was ${before.sizeKb} KB)`));
}
