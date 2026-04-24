/**
 * assertions.js
 * Core assertion library for prompt regression testing.
 *
 * Supported assertion types:
 *   - contains        : output includes substring(s)
 *   - not_contains    : output does NOT include substring(s)
 *   - exact           : output equals string exactly
 *   - regex           : output matches regex pattern
 *   - json_valid      : output is parseable JSON
 *   - json_schema     : output JSON matches a JSON Schema
 *   - max_tokens      : output is under N tokens (rough word-based estimate)
 *   - min_tokens      : output is over N tokens
 *   - starts_with     : output starts with string
 *   - ends_with       : output ends with string
 *   - llm_judge       : LLM-as-judge fuzzy assertion
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Rough token estimate: ~4 chars per token (GPT/Claude approximation) */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function pass(message) {
  return { passed: true, message };
}

function fail(message, detail = null) {
  return { passed: false, message, detail };
}

// ─── Assertion runners ───────────────────────────────────────────────────────

const assertionHandlers = {
  /**
   * contains: value is string | string[]
   * All values must appear in the output.
   */
  contains(output, value) {
    const needles = Array.isArray(value) ? value : [value];
    const missing = needles.filter((n) => !output.includes(n));
    if (missing.length === 0) {
      return pass(`Output contains all required strings (${needles.length})`);
    }
    return fail(
      `Output missing ${missing.length}/${needles.length} expected string(s)`,
      { missing }
    );
  },

  /**
   * not_contains: value is string | string[]
   * None of the values may appear in the output.
   */
  not_contains(output, value) {
    const forbidden = Array.isArray(value) ? value : [value];
    const found = forbidden.filter((f) => output.includes(f));
    if (found.length === 0) {
      return pass(`Output correctly excludes all forbidden strings`);
    }
    return fail(
      `Output contains ${found.length} forbidden string(s)`,
      { found }
    );
  },

  /**
   * exact: value is string
   * Output must equal value after trimming.
   */
  exact(output, value) {
    const trimmedOutput = output.trim();
    const trimmedValue = String(value).trim();
    if (trimmedOutput === trimmedValue) {
      return pass(`Output exactly matches expected value`);
    }
    return fail(`Output does not exactly match expected value`, {
      expected: trimmedValue,
      actual: trimmedOutput,
    });
  },

  /**
   * regex: value is string (regex pattern) | { pattern, flags }
   * Output must match the regex.
   */
  regex(output, value) {
    let pattern, flags;
    if (typeof value === 'object' && value.pattern) {
      pattern = value.pattern;
      flags = value.flags || '';
    } else {
      pattern = String(value);
      flags = '';
    }
    try {
      const re = new RegExp(pattern, flags);
      if (re.test(output)) {
        return pass(`Output matches regex /${pattern}/${flags}`);
      }
      return fail(`Output does not match regex /${pattern}/${flags}`);
    } catch (err) {
      return fail(`Invalid regex pattern: ${err.message}`);
    }
  },

  /**
   * json_valid: value is boolean (true) or ignored
   * Output must be parseable JSON.
   */
  json_valid(output) {
    try {
      JSON.parse(output.trim());
      return pass(`Output is valid JSON`);
    } catch (err) {
      return fail(`Output is not valid JSON: ${err.message}`);
    }
  },

  /**
   * json_schema: value is a JSON Schema object
   * Output must be valid JSON AND conform to the schema.
   */
  json_schema(output, schema) {
    let parsed;
    try {
      parsed = JSON.parse(output.trim());
    } catch (err) {
      return fail(`Output is not valid JSON (required for json_schema): ${err.message}`);
    }

    try {
      const validate = ajv.compile(schema);
      const valid = validate(parsed);
      if (valid) {
        return pass(`Output JSON conforms to schema`);
      }
      return fail(`Output JSON does not conform to schema`, {
        errors: validate.errors,
      });
    } catch (err) {
      return fail(`Could not compile JSON schema: ${err.message}`);
    }
  },

  /**
   * max_tokens: value is number
   * Output's estimated token count must be ≤ value.
   */
  max_tokens(output, value) {
    const count = estimateTokens(output);
    const limit = Number(value);
    if (count <= limit) {
      return pass(`Token estimate ${count} ≤ limit ${limit}`);
    }
    return fail(`Token estimate ${count} exceeds limit ${limit}`, {
      estimated: count,
      limit,
    });
  },

  /**
   * min_tokens: value is number
   * Output's estimated token count must be ≥ value.
   */
  min_tokens(output, value) {
    const count = estimateTokens(output);
    const floor = Number(value);
    if (count >= floor) {
      return pass(`Token estimate ${count} ≥ floor ${floor}`);
    }
    return fail(`Token estimate ${count} is below floor ${floor}`, {
      estimated: count,
      floor,
    });
  },

  /**
   * starts_with: value is string
   */
  starts_with(output, value) {
    const trimmed = output.trimStart();
    if (trimmed.startsWith(String(value))) {
      return pass(`Output starts with expected prefix`);
    }
    return fail(`Output does not start with expected prefix`, {
      expected_prefix: value,
      actual_start: trimmed.slice(0, 80),
    });
  },

  /**
   * ends_with: value is string
   */
  ends_with(output, value) {
    const trimmed = output.trimEnd();
    if (trimmed.endsWith(String(value))) {
      return pass(`Output ends with expected suffix`);
    }
    return fail(`Output does not end with expected suffix`, {
      expected_suffix: value,
      actual_end: trimmed.slice(-80),
    });
  },
};

// ─── LLM-as-Judge (handled separately, needs async) ──────────────────────────

/**
 * Runs an LLM-as-judge assertion.
 * @param {string} output - The model output to evaluate
 * @param {object} value - { prompt: string, pass_if: "yes"|"no", model?: string }
 * @param {object} anthropicClient - Instantiated Anthropic client
 * @returns {Promise<AssertionResult>}
 */
export async function runLlmJudge(output, value, anthropicClient) {
  const { prompt: judgePrompt, pass_if = 'yes', model = 'claude-haiku-4-5' } = value;

  if (!judgePrompt) {
    return fail('llm_judge assertion requires a "prompt" field');
  }

  const fullPrompt = `You are a strict evaluator. Answer ONLY with "yes" or "no".

${judgePrompt}

---
OUTPUT TO EVALUATE:
${output}
---

Answer with ONLY "yes" or "no":`;

  try {
    const response = await anthropicClient.messages.create({
      model,
      max_tokens: 10,
      messages: [{ role: 'user', content: fullPrompt }],
    });

    const answer = response.content[0]?.text?.trim().toLowerCase();
    const judgment = answer?.startsWith('yes') ? 'yes' : 'no';

    if (judgment === pass_if.toLowerCase()) {
      return pass(`LLM judge answered "${judgment}" (expected "${pass_if}")`);
    }
    return fail(
      `LLM judge answered "${judgment}" but expected "${pass_if}"`,
      { judge_response: answer, judge_prompt: judgePrompt }
    );
  } catch (err) {
    return fail(`LLM judge API call failed: ${err.message}`);
  }
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Runs all assertions for a single test case output.
 * @param {string} output - The raw model output
 * @param {Array<{type: string, value: any}>} assertions - List of assertions
 * @param {object|null} anthropicClient - Needed for llm_judge assertions
 * @returns {Promise<Array<AssertionResult & {type: string}>>}
 */
export async function runAssertions(output, assertions, anthropicClient = null) {
  const results = [];

  for (const assertion of assertions) {
    const { type, value } = assertion;

    if (type === 'llm_judge') {
      if (!anthropicClient) {
        results.push({
          type,
          ...fail('llm_judge requires an Anthropic client — set ANTHROPIC_API_KEY'),
        });
        continue;
      }
      const result = await runLlmJudge(output, value, anthropicClient);
      results.push({ type, ...result });
      continue;
    }

    const handler = assertionHandlers[type];
    if (!handler) {
      results.push({
        type,
        ...fail(`Unknown assertion type: "${type}"`),
      });
      continue;
    }

    try {
      const result = handler(output, value);
      results.push({ type, ...result });
    } catch (err) {
      results.push({
        type,
        ...fail(`Assertion threw an exception: ${err.message}`),
      });
    }
  }

  return results;
}

/**
 * Summarizes assertion results for a test case.
 */
export function summarizeResults(assertionResults) {
  const total = assertionResults.length;
  const passed = assertionResults.filter((r) => r.passed).length;
  const failed = total - passed;
  return { total, passed, failed, allPassed: failed === 0 };
}
