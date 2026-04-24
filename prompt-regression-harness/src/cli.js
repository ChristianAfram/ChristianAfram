#!/usr/bin/env node
/**
 * cli.js
 * Main CLI entrypoint for the prompt regression harness.
 *
 * Usage:
 *   promptreg run [options]
 *   promptreg run --cases ./cases --model claude-haiku-4-5 --verbose
 *   promptreg run --cases ./cases --no-cache
 *   promptreg run --cases ./cases --tag smoke
 *   promptreg show-last
 *   promptreg clear-cache
 */

import { program } from 'commander';
import { existsSync, readdirSync, unlinkSync } from 'fs';
import { resolve, join } from 'path';
import chalk from 'chalk';
import ora from 'ora';

import { loadCases } from './loader.js';
import { Runner } from './runner.js';
import { runAssertions, summarizeResults } from './assertions.js';
import {
  saveRunResult,
  loadPreviousRunResult,
  diffRuns,
  diffSummary,
} from './differ.js';
import {
  printHeader,
  printCaseResult,
  printSummaryTable,
  printDiffSummary,
  printFinalLine,
  printOutput,
} from './reporter.js';

// ─── Version ──────────────────────────────────────────────────────────────────

program
  .name('promptreg')
  .description('Prompt regression harness — pytest for LLM prompts')
  .version('1.0.0');

// ─── run command ─────────────────────────────────────────────────────────────

program
  .command('run')
  .description('Run all test cases and compare against previous results')
  .option('-c, --cases <path>', 'Path to cases directory or file', './cases')
  .option(
    '-m, --model <model>',
    'Default Claude model',
    'claude-haiku-4-5'
  )
  .option('--max-tokens <n>', 'Default max tokens', (v) => parseInt(v), 1024)
  .option('--no-cache', 'Disable response caching (always hit live API)')
  .option('--cache-dir <path>', 'Cache directory', '.cache')
  .option('--results-dir <path>', 'Results directory', '.results')
  .option('-v, --verbose', 'Print full output for each case')
  .option('--tag <tag>', 'Only run cases with a specific tag')
  .option('--case <name>', 'Only run a single case by name')
  .option('--no-diff', 'Skip diff output')
  .option('--json', 'Output results as JSON to stdout (for CI)')
  .option(
    '--prompt-dir <path>',
    'Additional base directory for resolving prompt_file paths'
  )
  .action(async (opts) => {
    // ── Validate API key ──
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error(
        chalk.red(
          '\n  ✗ ANTHROPIC_API_KEY is not set.\n' +
          '    Export it before running: export ANTHROPIC_API_KEY=sk-ant-...\n'
        )
      );
      process.exit(1);
    }

    // ── Load test cases ──
    let loadedCases;
    try {
      const promptBaseDirs = opts.promptDir
        ? [resolve(opts.promptDir)]
        : [];
      loadedCases = loadCases(resolve(opts.cases), { promptBaseDirs });
    } catch (err) {
      console.error(chalk.red(`\n  ✗ Failed to load test cases:\n    ${err.message}\n`));
      process.exit(1);
    }

    let { cases } = loadedCases;

    // ── Filter by tag / name ──
    if (opts.tag) {
      cases = cases.filter((c) => c.tags.includes(opts.tag));
      if (cases.length === 0) {
        console.error(chalk.yellow(`\n  ⚠ No cases found with tag "${opts.tag}"\n`));
        process.exit(0);
      }
    }

    if (opts.case) {
      cases = cases.filter((c) => c.name === opts.case);
      if (cases.length === 0) {
        console.error(chalk.yellow(`\n  ⚠ No case found with name "${opts.case}"\n`));
        process.exit(1);
      }
    }

    // ── Setup runner ──
    const runner = new Runner({
      cacheDir: resolve(opts.cacheDir),
    });

    printHeader(cases.length, opts.model);

    // ── Execute each case ──
    const timestamp = new Date().toISOString();
    const caseResults = [];

    for (const tc of cases) {
      const spinner = ora({
        text: chalk.dim(`Running: ${tc.name}`),
        spinner: 'dots',
      }).start();

      let runResult;
      try {
        runResult = await runner.run({
          model: tc.model || opts.model,
          system: tc.systemPrompt || undefined,
          user: tc.input,
          max_tokens: tc.max_tokens || opts.maxTokens,
          temperature: tc.temperature,
          noCache: !opts.cache,
        });
      } catch (err) {
        spinner.fail(chalk.red(`API error on "${tc.name}": ${err.message}`));
        caseResults.push({
          id: tc.id,
          name: tc.name,
          description: tc.description,
          passed: false,
          output: null,
          cacheHit: false,
          elapsed_ms: null,
          usage: null,
          assertions: [
            {
              type: 'api_call',
              passed: false,
              message: `API call failed: ${err.message}`,
              detail: null,
            },
          ],
          summary: { total: 1, passed: 0, failed: 1, allPassed: false },
          error: err.message,
        });
        continue;
      }

      // ── Run assertions ──
      let assertionResults;
      try {
        assertionResults = await runAssertions(
          runResult.output,
          tc.assertions,
          runner._client
        );
      } catch (err) {
        spinner.fail(chalk.red(`Assertion error on "${tc.name}": ${err.message}`));
        continue;
      }

      const summary = summarizeResults(assertionResults);

      if (summary.allPassed) {
        spinner.succeed(
          chalk.green(`${tc.name}`) + chalk.dim(` [${summary.passed}/${summary.total} assertions]`)
        );
      } else {
        spinner.fail(
          chalk.red(`${tc.name}`) +
          chalk.dim(` [${summary.passed}/${summary.total} assertions — ${summary.failed} failed]`)
        );
      }

      caseResults.push({
        id: tc.id,
        name: tc.name,
        description: tc.description,
        passed: summary.allPassed,
        output: runResult.output,
        cacheHit: runResult.cacheHit,
        elapsed_ms: runResult.elapsed_ms || null,
        usage: runResult.usage || null,
        assertions: assertionResults,
        summary,
      });
    }

    // ── Build run record ──
    const totalPassed = caseResults.filter((c) => c.passed).length;
    const totalFailed = caseResults.length - totalPassed;

    const runRecord = {
      timestamp,
      summary: {
        total: caseResults.length,
        passed: totalPassed,
        failed: totalFailed,
      },
      cases: caseResults,
    };

    // ── Load previous run & compute diff ──
    const previousRun = loadPreviousRunResult(resolve(opts.resultsDir));
    saveRunResult(runRecord, resolve(opts.resultsDir));
    const diffResult = diffRuns(runRecord, previousRun);
    const diffCounts = diffSummary(diffResult.caseDiffs);

    // ── Detailed case output ──
    if (!opts.json) {
      const caseDiffMap = new Map(
        diffResult.caseDiffs.map((d) => [d.name, d])
      );

      for (const caseResult of caseResults) {
        const caseDiff = caseDiffMap.get(caseResult.name) || null;
        printCaseResult(caseResult, caseDiff);
        if (opts.verbose && caseResult.output) {
          printOutput(caseResult.output);
        }
      }

      printSummaryTable(runRecord);
      printDiffSummary(diffResult.caseDiffs, diffCounts, diffResult.hasPrevious);
      printFinalLine(runRecord.summary, runner.stats);
    }

    // ── JSON output mode ──
    if (opts.json) {
      console.log(JSON.stringify({ run: runRecord, diff: diffResult, diffCounts }, null, 2));
    }

    // ── Exit code for CI ──
    // Fail if any assertions failed OR if any cases regressed
    const hasRegressions = diffResult.hasPrevious && diffCounts.regressed > 0;
    const hasFailures = totalFailed > 0;

    if (hasFailures || hasRegressions) {
      process.exit(1);
    }

    process.exit(0);
  });

// ─── show-last command ────────────────────────────────────────────────────────

program
  .command('show-last')
  .description('Display results from the most recent run')
  .option('--results-dir <path>', 'Results directory', '.results')
  .action((opts) => {
    const { loadLastRunResult } = await import('./differ.js');
    const last = loadLastRunResult(resolve(opts.resultsDir));
    if (!last) {
      console.log(chalk.yellow('\n  No previous runs found.\n'));
      return;
    }
    console.log(JSON.stringify(last, null, 2));
  });

// ─── clear-cache command ──────────────────────────────────────────────────────

program
  .command('clear-cache')
  .description('Delete all cached API responses')
  .option('--cache-dir <path>', 'Cache directory', '.cache')
  .action((opts) => {
    const dir = resolve(opts.cacheDir);
    if (!existsSync(dir)) {
      console.log(chalk.yellow(`\n  Cache directory does not exist: ${dir}\n`));
      return;
    }
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    files.forEach((f) => unlinkSync(join(dir, f)));
    console.log(chalk.green(`\n  ✓ Cleared ${files.length} cached response(s)\n`));
  });

// ─── list command ─────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List all test cases without running them')
  .option('-c, --cases <path>', 'Path to cases directory or file', './cases')
  .action((opts) => {
    let loadedCases;
    try {
      loadedCases = loadCases(resolve(opts.cases), { strict: false });
    } catch (err) {
      console.error(chalk.red(`\n  ✗ ${err.message}\n`));
      process.exit(1);
    }

    const { cases, errors } = loadedCases;

    console.log(chalk.bold(`\n  Test Cases (${cases.length}):\n`));
    cases.forEach((c, i) => {
      const tags = c.tags.length ? chalk.dim(` [${c.tags.join(', ')}]`) : '';
      const model = c.model ? chalk.dim(` — ${c.model}`) : '';
      console.log(
        `  ${chalk.gray(`${i + 1}.`)} ${chalk.bold(c.name)}${tags}${model}`
      );
      if (c.description) console.log(chalk.gray(`     ${c.description}`));
      console.log(
        chalk.gray(`     ${c.assertions.length} assertions · ${c.file}`)
      );
    });

    if (errors.length > 0) {
      console.log(chalk.yellow(`\n  Warnings (${errors.length}):`));
      errors.forEach((e) => console.log(chalk.yellow(`  ⚠ ${e}`)));
    }

    console.log();
  });

// ─── Parse ────────────────────────────────────────────────────────────────────

program.parse(process.argv);
