/**
 * reporter.js
 * Terminal output formatting for prompt regression test results.
 * Inspired by pytest's output style.
 */

import chalk from 'chalk';
import { table } from 'table';

// ─── Icons & badges ───────────────────────────────────────────────────────────

const PASS = chalk.green('✓');
const FAIL = chalk.red('✗');
const WARN = chalk.yellow('⚠');
const NEW_BADGE  = chalk.cyan('[NEW]');
const REG_BADGE  = chalk.red('[REGRESSED]');
const FIX_BADGE  = chalk.green('[FIXED]');
const CHG_BADGE  = chalk.yellow('[CHANGED]');
const SAME_BADGE = chalk.gray('[SAME]');
const REM_BADGE  = chalk.gray('[REMOVED]');

function statusBadge(status) {
  const map = {
    new: NEW_BADGE,
    regressed: REG_BADGE,
    fixed: FIX_BADGE,
    changed: CHG_BADGE,
    same: SAME_BADGE,
    removed: REM_BADGE,
  };
  return map[status] || chalk.gray(`[${status.toUpperCase()}]`);
}

// ─── Individual test case reporting ──────────────────────────────────────────

export function printCaseResult(caseResult, caseDiff = null) {
  const icon = caseResult.passed ? PASS : FAIL;
  const badge = caseDiff ? ` ${statusBadge(caseDiff.status)}` : '';
  const name = caseResult.passed
    ? chalk.bold(caseResult.name)
    : chalk.bold.red(caseResult.name);

  console.log(`\n${icon} ${name}${badge}`);

  if (caseResult.description) {
    console.log(chalk.gray(`  ${caseResult.description}`));
  }

  // Print assertion results
  for (let i = 0; i < caseResult.assertions.length; i++) {
    const a = caseResult.assertions[i];
    const aIcon = a.passed ? chalk.green('  ✓') : chalk.red('  ✗');
    const aType = chalk.dim(a.type.padEnd(14));
    const aMsg  = a.passed ? chalk.dim(a.message) : chalk.red(a.message);

    // Check if this assertion changed
    let diffNote = '';
    if (caseDiff) {
      const ad = caseDiff.assertionDiffs[i];
      if (ad) {
        if (ad.status === 'regressed') diffNote = chalk.red(' ↓ regressed');
        else if (ad.status === 'fixed')     diffNote = chalk.green(' ↑ fixed');
      }
    }

    console.log(`${aIcon} ${aType} ${aMsg}${diffNote}`);

    // Print failure details
    if (!a.passed && a.detail) {
      const detail = JSON.stringify(a.detail, null, 2)
        .split('\n')
        .map((l) => chalk.gray(`      ${l}`))
        .join('\n');
      console.log(detail);
    }
  }

  // Print metadata
  const meta = [];
  if (caseResult.cacheHit) meta.push(chalk.dim('(cached)'));
  if (caseResult.elapsed_ms) meta.push(chalk.dim(`${caseResult.elapsed_ms}ms`));
  if (caseResult.usage) {
    meta.push(chalk.dim(`↑${caseResult.usage.input_tokens}t ↓${caseResult.usage.output_tokens}t`));
  }
  if (meta.length) console.log(`  ${meta.join(' · ')}`);

  // Print output diff if available
  if (caseDiff?.outputDiff) {
    console.log(chalk.dim('\n  Output diff (prev → curr):'));
    caseDiff.outputDiff
      .split('\n')
      .slice(0, 30) // cap diff output at 30 lines to avoid flooding terminal
      .forEach((line) => console.log(`  ${line}`));
    const lines = caseDiff.outputDiff.split('\n').length;
    if (lines > 30) console.log(chalk.dim(`  ... (${lines - 30} more lines)`));
  }
}

// ─── Summary table ────────────────────────────────────────────────────────────

export function printSummaryTable(runResult) {
  console.log('\n' + chalk.bold('─'.repeat(60)));
  console.log(chalk.bold('  RESULTS SUMMARY'));
  console.log(chalk.bold('─'.repeat(60)));

  const rows = runResult.cases.map((c) => [
    c.passed ? PASS : FAIL,
    chalk.bold(c.name),
    `${c.summary.passed}/${c.summary.total}`,
    c.cacheHit ? chalk.dim('cached') : '',
    c.elapsed_ms ? `${c.elapsed_ms}ms` : '',
  ]);

  const config = {
    border: {
      topBody: '─', topJoin: '┬', topLeft: '┌', topRight: '┐',
      bottomBody: '─', bottomJoin: '┴', bottomLeft: '└', bottomRight: '┘',
      bodyLeft: '│', bodyRight: '│', bodyJoin: '│',
      joinBody: '─', joinLeft: '├', joinRight: '┤', joinJoin: '┼',
    },
    columns: {
      0: { width: 3, alignment: 'center' },
      1: { width: 36 },
      2: { width: 10, alignment: 'center' },
      3: { width: 8, alignment: 'center' },
      4: { width: 8, alignment: 'right' },
    },
  };

  const headerRow = [
    '',
    chalk.bold('Test Case'),
    chalk.bold('Asserts'),
    chalk.bold('Cache'),
    chalk.bold('Time'),
  ];

  console.log(table([headerRow, ...rows], config));
}

// ─── Diff summary ─────────────────────────────────────────────────────────────

export function printDiffSummary(caseDiffs, diffCounts, hasPrevious) {
  if (!hasPrevious) {
    console.log(chalk.cyan('\n  ℹ First run — no previous results to compare against.'));
    return;
  }

  console.log(chalk.bold('\n  DIFF vs PREVIOUS RUN'));
  const parts = [];
  if (diffCounts.regressed > 0) parts.push(chalk.red(`${diffCounts.regressed} regressed`));
  if (diffCounts.fixed > 0)     parts.push(chalk.green(`${diffCounts.fixed} fixed`));
  if (diffCounts.changed > 0)   parts.push(chalk.yellow(`${diffCounts.changed} output changed`));
  if (diffCounts.new > 0)       parts.push(chalk.cyan(`${diffCounts.new} new`));
  if (diffCounts.removed > 0)   parts.push(chalk.gray(`${diffCounts.removed} removed`));
  if (diffCounts.same > 0)      parts.push(chalk.gray(`${diffCounts.same} unchanged`));

  if (parts.length === 0) {
    console.log(chalk.green('  ✓ No changes detected'));
  } else {
    console.log(`  ${parts.join('  ·  ')}`);
  }
}

// ─── Final footer ─────────────────────────────────────────────────────────────

export function printFinalLine(summary, runnerStats) {
  console.log(chalk.bold('─'.repeat(60)));

  const passedStr = chalk.green(`${summary.passed} passed`);
  const failedStr = summary.failed > 0
    ? chalk.red(`${summary.failed} failed`)
    : chalk.green('0 failed');

  const cacheInfo = chalk.dim(
    `(${runnerStats.hits} cached, ${runnerStats.misses} live API calls)`
  );

  const status = summary.failed === 0
    ? chalk.bgGreen.black(' PASS ')
    : chalk.bgRed.white(' FAIL ');

  console.log(`${status}  ${passedStr}  ${failedStr}  ${cacheInfo}`);
  console.log();
}

// ─── Verbose output ───────────────────────────────────────────────────────────

export function printOutput(output, label = 'Output') {
  console.log(chalk.dim(`\n  ${label}:`));
  const lines = output.split('\n');
  const preview = lines.slice(0, 15).join('\n');
  const trimmed = preview
    .split('\n')
    .map((l) => chalk.italic.gray(`    ${l}`))
    .join('\n');
  console.log(trimmed);
  if (lines.length > 15) {
    console.log(chalk.dim(`    ... (${lines.length - 15} more lines)`));
  }
}

// ─── Run header ───────────────────────────────────────────────────────────────

export function printHeader(casesCount, model) {
  console.log();
  console.log(chalk.bold.cyan('  ⚡ PROMPT REGRESSION HARNESS'));
  console.log(chalk.dim(`  Running ${casesCount} test case${casesCount === 1 ? '' : 's'}`));
  if (model) console.log(chalk.dim(`  Default model: ${model}`));
  console.log(chalk.bold('─'.repeat(60)));
}
