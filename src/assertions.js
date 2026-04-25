/**
 * Assertion library for prompt regression tests.
 *
 * Assertion types:
 *   contains        — output contains a substring (case-insensitive by default)
 *   not_contains    — output does NOT contain a substring
 *   exact           — output exactly equals string
 *   regex           — output matches regex
 *   not_regex       — output does NOT match regex
 *   json_valid      — output is parseable JSON
 *   json_schema     — output is JSON matching an AJV schema
 *   max_tokens      — total token count is under N
 *   min_tokens      — total token count is at least N
 *   starts_with     — output starts with string
 *   ends_with       — output ends with string
 *   llm_judge       — fuzzy assertion evaluated by Claude
 */

import Anthropic from '@anthropic-ai/sdk';
import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });

// ─── Individual assertion evaluators ─────────────────────────────────────────

function assertContains(response, { value, case_sensitive = false }) {
  const hay = case_sensitive ? response : response.toLowerCase();
  const needle = case_sensitive ? String(value) : String(value).toLowerCase();
  const pass = hay.includes(needle);
  return {
    pass,
    message: pass
      ? `Output contains "${value}"`
      : `Output does not contain "${value}"`,
  };
}

function assertNotContains(response, { value, case_sensitive = false }) {
  const hay = case_sensitive ? response : response.toLowerCase();
  const needle = case_sensitive ? String(value) : String(value).toLowerCase();
  const pass = !hay.includes(needle);
  return {
    pass,
    message: pass
      ? `Output correctly does not contain "${value}"`
      : `Output unexpectedly contains "${value}"`,
  };
}

function assertExact(response, { value }) {
  const pass = response.trim() === String(value).trim();
  return {
    pass,
    message: pass
      ? 'Output matches exactly'
      : `Expected:\n  ${String(value).trim()}\nGot:\n  ${response.trim()}`,
  };
}

function assertRegex(response, { pattern, flags = 'i' }) {
  let re;
  try {
    re = new RegExp(pattern, flags);
  } catch (e) {
    return { pass: false, message: `Invalid regex pattern "${pattern}": ${e.message}` };
  }
  const pass = re.test(response);
  return {
    pass,
    message: pass
      ? `Output matches regex /${pattern}/${flags}`
      : `Output does not match regex /${pattern}/${flags}`,
  };
}

function assertNotRegex(response, { pattern, flags = 'i' }) {
  let re;
  try {
    re = new RegExp(pattern, flags);
  } catch (e) {
    return { pass: false, message: `Invalid regex pattern "${pattern}": ${e.message}` };
  }
  const pass = !re.test(response);
  return {
    pass,
    message: pass
      ? `Output correctly does not match regex /${pattern}/${flags}`
      : `Output unexpectedly matches regex /${pattern}/${flags}`,
  };
}

function assertJsonValid(response) {
  try {
    JSON.parse(response.trim());
    return { pass: true, message: 'Output is valid JSON' };
  } catch (e) {
    return { pass: false, message: `Output is not valid JSON: ${e.message}` };
  }
}

function assertJsonSchema(response, { schema }) {
  let parsed;
  try {
    parsed = JSON.parse(response.trim());
  } catch (e) {
    return { pass: false, message: `Output is not valid JSON: ${e.message}` };
  }
  const validate = ajv.compile(schema);
  const valid = validate(parsed);
  if (valid) {
    return { pass: true, message: 'Output matches JSON schema' };
  }
  const errors = validate.errors.map(e => `  ${e.instancePath} ${e.message}`).join('\n');
  return { pass: false, message: `JSON schema validation failed:\n${errors}` };
}

function assertMaxTokens(response, { value }, usage) {
  const total = usage?.total_tokens ?? 0;
  const pass = total <= Number(value);
  return {
    pass,
    message: pass
      ? `Token count ${total} ≤ ${value}`
      : `Token count ${total} exceeds limit of ${value}`,
  };
}

function assertMinTokens(response, { value }, usage) {
  const total = usage?.total_tokens ?? 0;
  const pass = total >= Number(value);
  return {
    pass,
    message: pass
      ? `Token count ${total} ≥ ${value}`
      : `Token count ${total} is below minimum of ${value}`,
  };
}

function assertStartsWith(response, { value, case_sensitive = false }) {
  const hay = case_sensitive ? response.trim() : response.trim().toLowerCase();
  const needle = case_sensitive ? String(value) : String(value).toLowerCase();
  const pass = hay.startsWith(needle);
  return {
    pass,
    message: pass
      ? `Output starts with "${value}"`
      : `Output does not start with "${value}"`,
  };
}

function assertEndsWith(response, { value, case_sensitive = false }) {
  const hay = case_sensitive ? response.trim() : response.trim().toLowerCase();
  const needle = case_sensitive ? String(value) : String(value).toLowerCase();
  const pass = hay.endsWith(needle);
  return {
    pass,
    message: pass
      ? `Output ends with "${value}"`
      : `Output does not end with "${value}"`,
  };
}

// ─── LLM-as-judge ────────────────────────────────────────────────────────────

const JUDGE_SYSTEM = `You are a strict automated test evaluator.
You will be given an AI-generated response and a criterion to evaluate.
You must respond with ONLY valid JSON in this format:
{"pass": true, "reason": "brief explanation"}
or
{"pass": false, "reason": "brief explanation"}

Be strict and precise. No extra text outside the JSON.`;

async function assertLlmJudge(response, { criterion, model = 'claude-3-5-haiku-20241022' }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { pass: false, message: 'ANTHROPIC_API_KEY not set — cannot run llm_judge assertion' };
  }

  const client = new Anthropic({ apiKey });
  const userMsg = `CRITERION: ${criterion}\n\nAI RESPONSE TO EVALUATE:\n${response}`;

  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 256,
      system: JUDGE_SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    });

    const raw = msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
    const parsed = JSON.parse(raw);
    return {
      pass: Boolean(parsed.pass),
      message: `[LLM Judge] ${parsed.reason}`,
    };
  } catch (e) {
    return { pass: false, message: `LLM judge failed: ${e.message}` };
  }
}

// ─── Main dispatcher ──────────────────────────────────────────────────────────

/**
 * Run all assertions for a single test case result.
 *
 * @param {string} response - The model's text response
 * @param {object} usage - { input_tokens, output_tokens, total_tokens }
 * @param {Array<object>} assertionDefs - Array of assertion definitions from YAML
 * @returns {Promise<Array<AssertionResult>>}
 */
export async function runAssertions(response, usage, assertionDefs) {
  const results = [];

  for (const def of assertionDefs) {
    const { type, label, ...opts } = def;
    let result;

    try {
      switch (type) {
        case 'contains':
          result = assertContains(response, opts);
          break;
        case 'not_contains':
          result = assertNotContains(response, opts);
          break;
        case 'exact':
          result = assertExact(response, opts);
          break;
        case 'regex':
          result = assertRegex(response, opts);
          break;
        case 'not_regex':
          result = assertNotRegex(response, opts);
          break;
        case 'json_valid':
          result = assertJsonValid(response);
          break;
        case 'json_schema':
          result = assertJsonSchema(response, opts);
          break;
        case 'max_tokens':
          result = assertMaxTokens(response, opts, usage);
          break;
        case 'min_tokens':
          result = assertMinTokens(response, opts, usage);
          break;
        case 'starts_with':
          result = assertStartsWith(response, opts);
          break;
        case 'ends_with':
          result = assertEndsWith(response, opts);
          break;
        case 'llm_judge':
          result = await assertLlmJudge(response, opts);
          break;
        default:
          result = { pass: false, message: `Unknown assertion type: "${type}"` };
      }
    } catch (e) {
      result = { pass: false, message: `Assertion threw error: ${e.message}` };
    }

    results.push({
      type,
      label: label || type,
      ...result,
    });
  }

  return results;
}
