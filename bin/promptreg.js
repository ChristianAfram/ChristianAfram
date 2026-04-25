#!/usr/bin/env node
/**
 * promptreg — Prompt Regression Harness CLI
 * Usage:
 *   promptreg run [--cases <dir>] [--prompts <dir>] [--filter <name>] [--no-cache]
 *   promptreg diff <runId1> <runId2>
 *   promptreg history
 *   promptreg clear-cache
 */

import { program } from 'commander';
import path from 'path';
import { fileURLToPath } from 'url';
import { runCommand } from '../src/commands/run.js';
import { diffCommand } from '../src/commands/diff.js';
import { historyCommand } from '../src/commands/history.js';
import { clearCacheCommand } from '../src/commands/clearCache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

program
  .name('promptreg')
  .description('Prompt regression harness — pytest for your prompts')
  .version('0.1.0');

program
  .command('run')
  .description('Run all test cases against their prompts')
  .option('-c, --cases <dir>', 'Directory containing YAML test cases', 'cases')
  .option('-p, --prompts <dir>', 'Directory containing prompt files', 'prompts')
  .option('-f, --filter <pattern>', 'Only run cases matching this pattern (glob)')
  .option('--no-cache', 'Bypass response cache and always call the API')
  .option('--model <model>', 'Claude model to use', 'claude-3-5-haiku-20241022')
  .option('--output <format>', 'Output format: pretty | json | ci', 'pretty')
  .action(async (opts) => {
    const exitCode = await runCommand(opts);
    process.exit(exitCode);
  });

program
  .command('diff <runId1> <runId2>')
  .description('Show diff between two historical runs')
  .action(async (runId1, runId2) => {
    await diffCommand(runId1, runId2);
  });

program
  .command('history')
  .description('List past runs with pass/fail summary')
  .option('-n, --limit <n>', 'Number of runs to show', '10')
  .action(async (opts) => {
    await historyCommand(opts);
  });

program
  .command('clear-cache')
  .description('Clear the response cache')
  .action(async () => {
    await clearCacheCommand();
  });

program.parse();
