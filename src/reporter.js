/**
 * Reporter — formats and prints test results to the terminal.
 * Supports 'pretty' (default), 'json', and 'ci' (compact, no color) modes.
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { renderWordDiff } from './diff.js';

const PASS = chalk.green('✓ PASS');
const FAIL = chalk.red('✗ FAIL');
const WARN = chalk.yellow('⚠ WARN');
const SKIP = chalk.gray('○ SKIP');

// ─── Header / Footer ─────────────────────────────────────────────────────────

export function printHeader(opts) {
  console.log();
  console.log(chalk.bold.cyan('┌─────────────────────────────────────────────┐'));
  console.log(chalk.bold.cyan('│') + chalk.bold('  promptreg — Prompt Regression Harness       ') + chalk.bold.cyan('│'));
  console.log(chalk.bold.cyan('└─────────────────────────────────────────────┘'));
  console.log(chalk.gray(`  Model   : ${opts.model}`));
  console.log(chalk.gray(`  Cases   : ${opts.cases}`));
  console.log(chalk.gray(`  Cache   : ${opts.cache ? 'enabled' : chalk.yellow('disabled')}`));
  console.log();
}

export function printSummary(runId, summary, runData) {
  const { total, passed, failed, errors, cacheHits } = summary;
  const allPassed = failed === 0 && errors === 0;

  console.log();
  console.log(chalk.bold('─── Summary ───────────────────────────────────────────'));

  const table = new Table({
    head: ['', 'Count'],
    colWidths: [20, 10],
    style: { head: ['cyan'] },
  });

  table.push(
    [chalk.green('Passed'), chalk.green(String(passed))],
    [chalk.red('Failed'), failed > 0 ? chalk.red(String(failed)) : chalk.gray('0')],
    [chalk.yellow('Errors'), errors > 0 ? chalk.yellow(String(errors)) : chalk.gray('0')],
    [chalk.gray('Total cases'), String(total)],
    [chalk.gray('Cache hits'), `${cacheHits}/${total}`],
  );

  console.log(table.toString());

  if (allPassed) {
    console.log(chalk.bold.green(`\n  ✓ All ${total} test case(s) passed`));
  } else {
    console.log(chalk.bold.red(`\n  ✗ ${failed} of ${total} case(s) failed`));
  }

  console.log(chalk.gray(`\n  Run ID : ${runId}`));
  console.log(chalk.gray(`  Saved  : .cache/runs/${runId}.json`));
  console.log();
}

// ─── Individual case output ───────────────────────────────────────────────────

export function printCaseResult(caseResult) {
  const { caseName, passed, error, assertionResults, usage, latencyMs, cacheHit } = caseResult;

  const status = error ? WARN : passed ? PASS : FAIL;
  const cacheTag = cacheHit ? chalk.gray(' [cached]') : '';
  const tokens = usage ? chalk.gray(` ${usage.total_tokens} tok`) : '';
  const latency = latencyMs ? chalk.gray(` ${latencyMs}ms`) : '';

  console.log(`  ${status} ${chalk.bold(caseName)}${cacheTag}${tokens}${latency}`);

  if (error) {
    console.log(chalk.yellow(`       Error: ${error}`));
    return;
  }

  for (const ar of (assertionResults || [])) {
    if (!ar.pass) {
      console.log(chalk.red(`       ✗ [${ar.label}] ${ar.message}`));
    } else if (process.env.VERBOSE || process.env.DEBUG) {
      console.log(chalk.green(`       ✓ [${ar.label}] ${ar.message}`));
    }
  }
}

// ─── Diff output ──────────────────────────────────────────────────────────────

export function printDiff(diffReport) {
  const { runIdA, runIdB, entries, summary } = diffReport;

  console.log();
  console.log(chalk.bold('─── Diff ──────────────────────────────────────────────'));
  console.log(chalk.gray(`  ${runIdA}  →  ${runIdB}`));
  console.log();

  if (summary.regressions === 0 && summary.improvements === 0 && summary.added === 0 && summary.removed === 0) {
    console.log(chalk.gray('  No changes between runs.\n'));
    return;
  }

  for (const entry of entries) {
    const { name, status, assertionDiff, responseDiff, tokenDelta } = entry;

    if (status === 'unchanged') continue;

    const badge = {
      regressed:   chalk.red('↓ REGRESSED'),
      improved:    chalk.green('↑ IMPROVED'),
      drifted:     chalk.yellow('~ DRIFTED'),
      changed:     chalk.yellow('~ CHANGED'),
      added:       chalk.cyan('+ ADDED'),
      removed:     chalk.gray('- REMOVED'),
    }[status] || chalk.gray(status);

    console.log(`  ${badge}  ${chalk.bold(name)}`);

    if (assertionDiff && assertionDiff.length > 0) {
      for (const change of assertionDiff) {
        const arrow = change.to === 'PASS' ? chalk.green(`FAIL → PASS`) : chalk.red(`PASS → FAIL`);
        console.log(chalk.gray(`    [${change.label}]`) + ` ${arrow}: ${change.message}`);
      }
    }

    if (responseDiff) {
      const snippet = renderWordDiff(responseDiff).slice(0, 300);
      console.log(chalk.gray(`    Response diff: `) + snippet + (snippet.length >= 300 ? '…' : ''));
    }

    if (tokenDelta !== undefined && tokenDelta !== 0) {
      const sign = tokenDelta > 0 ? `+${tokenDelta}` : `${tokenDelta}`;
      console.log(chalk.gray(`    Token delta: ${tokenDelta > 0 ? chalk.yellow(sign) : chalk.green(sign)} tokens`));
    }

    console.log();
  }

  // Summary line
  const parts = [];
  if (summary.regressions) parts.push(chalk.red(`${summary.regressions} regressed`));
  if (summary.improvements) parts.push(chalk.green(`${summary.improvements} improved`));
  if (summary.added) parts.push(chalk.cyan(`${summary.added} added`));
  if (summary.removed) parts.push(chalk.gray(`${summary.removed} removed`));
  if (summary.drifted) parts.push(chalk.yellow(`${summary.drifted} drifted`));

  console.log('  ' + parts.join('  ·  '));
  console.log();
}

// ─── History output ───────────────────────────────────────────────────────────

export function printHistory(runs) {
  if (runs.length === 0) {
    console.log(chalk.gray('  No runs found. Run `promptreg run` first.'));
    return;
  }

  const table = new Table({
    head: ['Run ID', 'Started At', 'Model', 'Pass', 'Fail', 'Total'],
    style: { head: ['cyan'] },
    colWidths: [32, 24, 30, 8, 8, 8],
  });

  for (const run of runs) {
    const { runId, startedAt, model, summary = {} } = run;
    const passed = summary.passed ?? '-';
    const failed = summary.failed ?? '-';
    const total = summary.total ?? '-';
    const failStr = Number(failed) > 0 ? chalk.red(String(failed)) : chalk.green(String(failed));
    table.push([runId, startedAt, model || '-', chalk.green(String(passed)), failStr, String(total)]);
  }

  console.log();
  console.log(table.toString());
  console.log();
}

// ─── JSON output ──────────────────────────────────────────────────────────────

export function printJson(runData) {
  console.log(JSON.stringify(runData, null, 2));
}

// ─── CI output ────────────────────────────────────────────────────────────────

export function printCi(runData) {
  const { summary, results } = runData;
  console.log(`[promptreg] ${summary.passed}/${summary.total} passed  ${summary.failed} failed  run=${runData.runId}`);
  for (const r of results) {
    if (!r.passed) {
      console.log(`  FAIL ${r.caseName}`);
      for (const ar of (r.assertionResults || [])) {
        if (!ar.pass) console.log(`       - ${ar.label}: ${ar.message}`);
      }
    }
  }
}
