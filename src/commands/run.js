/**
 * `promptreg run` command.
 * Orchestrates: load cases → run prompts → evaluate assertions → save run → print results → diff.
 */

import path from 'path';
import ora from 'ora';
import { loadAllCases } from '../loader.js';
import { runCase } from '../runner.js';
import { runAssertions } from '../assertions.js';
import { generateRunId, saveRun, getPreviousRun, loadRun } from '../store.js';
import {
  printHeader,
  printCaseResult,
  printSummary,
  printDiff,
  printJson,
  printCi,
} from '../reporter.js';
import { compareRuns } from '../diff.js';

export async function runCommand(opts) {
  const {
    cases: casesDir,
    prompts: promptsDir,
    filter,
    cache: useCache,
    model,
    output,
  } = opts;

  const runId = generateRunId();
  const startedAt = new Date().toISOString();

  // ── Print header ──────────────────────────────────────────────────────────
  if (output === 'pretty') {
    printHeader({ model, cases: casesDir, cache: useCache });
  }

  // ── Load cases ────────────────────────────────────────────────────────────
  let allCases;
  try {
    allCases = await loadAllCases(casesDir, filter);
  } catch (e) {
    console.error(`Error loading cases: ${e.message}`);
    return 1;
  }

  if (allCases.length === 0) {
    console.error(`No test cases found in "${casesDir}"`);
    return 1;
  }

  if (output === 'pretty') {
    console.log(`  Found ${allCases.length} test case(s)\n`);
  }

  // ── Run each case ─────────────────────────────────────────────────────────
  const results = [];
  let passed = 0;
  let failed = 0;
  let errors = 0;
  let cacheHits = 0;

  for (const caseDef of allCases) {
    const spinner = output === 'pretty'
      ? ora({ text: `Running: ${caseDef.name}`, prefixText: '  ' }).start()
      : null;

    const caseModel = caseDef.model || model;
    const promptPath = path.resolve(caseDef.prompt);

    let runResult;
    let assertionResults = [];
    let caseError = null;
    let casePassed = false;

    try {
      runResult = await runCase({
        promptPath,
        variables: caseDef.variables,
        model: caseModel,
        useCache,
        maxTokens: caseDef.max_tokens || 1024,
      });

      if (runResult.cacheHit) cacheHits++;

      assertionResults = await runAssertions(
        runResult.response,
        runResult.usage,
        caseDef.assertions
      );

      casePassed = assertionResults.every(r => r.pass);
      if (casePassed) passed++; else failed++;

    } catch (e) {
      caseError = e.message;
      errors++;
      if (spinner) spinner.fail(`Error: ${caseDef.name}`);
      results.push({
        caseName: caseDef.name,
        sourceFile: caseDef.sourceFile,
        passed: false,
        error: caseError,
        assertionResults: [],
        response: null,
        usage: null,
        latencyMs: null,
        cacheHit: false,
        model: caseModel,
      });
      if (output === 'pretty') printCaseResult(results[results.length - 1]);
      continue;
    }

    const caseResult = {
      caseName: caseDef.name,
      sourceFile: caseDef.sourceFile,
      passed: casePassed,
      error: null,
      assertionResults,
      response: runResult.response,
      usage: runResult.usage,
      latencyMs: runResult.latencyMs,
      cacheHit: runResult.cacheHit,
      cacheKey: runResult.cacheKey,
      model: runResult.model,
    };

    results.push(caseResult);

    if (spinner) {
      if (casePassed) spinner.succeed(`${caseDef.name}`);
      else spinner.fail(`${caseDef.name}`);
    }

    if (output === 'pretty') {
      printCaseResult(caseResult);
    }
  }

  // ── Build run data ────────────────────────────────────────────────────────
  const finishedAt = new Date().toISOString();
  const summary = { total: allCases.length, passed, failed, errors, cacheHits };

  const runData = {
    runId,
    startedAt,
    finishedAt,
    model,
    casesDir,
    summary,
    results,
  };

  saveRun(runId, runData);

  // ── Output ────────────────────────────────────────────────────────────────
  if (output === 'json') {
    printJson(runData);
  } else if (output === 'ci') {
    printCi(runData);
  } else {
    printSummary(runId, summary, runData);

    // Auto-diff against previous run
    const prevRunMeta = getPreviousRun(runId);
    if (prevRunMeta) {
      const prevRun = loadRun(prevRunMeta.runId);
      if (prevRun) {
        const diffReport = compareRuns(prevRun, runData);
        const hasChanges = diffReport.summary.regressions > 0
          || diffReport.summary.improvements > 0
          || diffReport.summary.added > 0
          || diffReport.summary.removed > 0;
        if (hasChanges) {
          printDiff(diffReport);
        }
      }
    }
  }

  // Exit 1 if any failures (for CI)
  return failed > 0 || errors > 0 ? 1 : 0;
}
