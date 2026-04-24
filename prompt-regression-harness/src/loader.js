/**
 * loader.js
 * Loads and validates test case YAML files.
 *
 * Expected YAML shape:
 *
 *   name: "My test case"
 *   description: "Optional description"
 *   prompt_file: "prompts/summarizer.txt"   # path to system prompt file
 *   model: "claude-haiku-4-5"              # optional, default used if omitted
 *   max_tokens: 512                         # optional
 *   temperature: 1                          # optional
 *
 *   input: |
 *     The user message to send
 *
 *   assertions:
 *     - type: contains
 *       value: "summary"
 *     - type: max_tokens
 *       value: 300
 *     - type: json_valid
 *     - type: llm_judge
 *       value:
 *         prompt: "Is the output a helpful summary?"
 *         pass_if: "yes"
 *
 * Multiple cases per file are supported using YAML multi-document (---).
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname, resolve, extname } from 'path';
import yaml from 'js-yaml';

// ─── Validation ───────────────────────────────────────────────────────────────

const VALID_ASSERTION_TYPES = new Set([
  'contains',
  'not_contains',
  'exact',
  'regex',
  'json_valid',
  'json_schema',
  'max_tokens',
  'min_tokens',
  'starts_with',
  'ends_with',
  'llm_judge',
]);

function validateCase(tc, filePath, index) {
  const errors = [];
  const location = `${filePath}[${index}]`;

  if (!tc.name || typeof tc.name !== 'string') {
    errors.push(`${location}: "name" is required and must be a string`);
  }

  if (!tc.input && typeof tc.input !== 'string') {
    errors.push(`${location}: "input" is required`);
  }

  if (!Array.isArray(tc.assertions) || tc.assertions.length === 0) {
    errors.push(`${location}: "assertions" must be a non-empty array`);
  } else {
    tc.assertions.forEach((a, i) => {
      if (!a.type) {
        errors.push(`${location}.assertions[${i}]: "type" is required`);
      } else if (!VALID_ASSERTION_TYPES.has(a.type)) {
        errors.push(
          `${location}.assertions[${i}]: unknown type "${a.type}". Valid: ${[...VALID_ASSERTION_TYPES].join(', ')}`
        );
      }

      // Type-specific validation
      if (a.type === 'llm_judge') {
        if (!a.value || typeof a.value !== 'object') {
          errors.push(
            `${location}.assertions[${i}]: llm_judge requires value: { prompt, pass_if }`
          );
        } else if (!a.value.prompt) {
          errors.push(
            `${location}.assertions[${i}]: llm_judge.value.prompt is required`
          );
        }
      }

      if (['contains', 'not_contains', 'exact', 'starts_with', 'ends_with'].includes(a.type)) {
        if (a.value === undefined || a.value === null) {
          errors.push(`${location}.assertions[${i}]: "${a.type}" requires a value`);
        }
      }

      if (['max_tokens', 'min_tokens'].includes(a.type)) {
        if (typeof a.value !== 'number' || isNaN(a.value)) {
          errors.push(`${location}.assertions[${i}]: "${a.type}" requires a numeric value`);
        }
      }

      if (a.type === 'json_schema' && typeof a.value !== 'object') {
        errors.push(`${location}.assertions[${i}]: "json_schema" requires a schema object as value`);
      }
    });
  }

  return errors;
}

// ─── Prompt file resolution ───────────────────────────────────────────────────

function resolvePromptFile(promptFile, caseFilePath, baseDirs = []) {
  if (!promptFile) return null;

  // Try absolute
  if (existsSync(promptFile)) return readFileSync(promptFile, 'utf-8');

  // Try relative to the YAML file
  const relToCase = resolve(dirname(caseFilePath), promptFile);
  if (existsSync(relToCase)) return readFileSync(relToCase, 'utf-8');

  // Try relative to each base dir
  for (const base of baseDirs) {
    const relToBase = resolve(base, promptFile);
    if (existsSync(relToBase)) return readFileSync(relToBase, 'utf-8');
  }

  throw new Error(
    `Could not resolve prompt_file "${promptFile}" from "${caseFilePath}"`
  );
}

// ─── Loader ───────────────────────────────────────────────────────────────────

/**
 * Loads all test cases from a directory of YAML files (or a single file).
 *
 * @param {string} casesPath  - Path to a directory or a single .yaml file
 * @param {object} [options]
 * @param {string[]} [options.promptBaseDirs] - Extra dirs to search for prompt files
 * @param {boolean} [options.strict]          - Throw on validation errors (default true)
 *
 * @returns {{ cases: TestCase[], errors: string[] }}
 */
export function loadCases(casesPath, { promptBaseDirs = [], strict = true } = {}) {
  const allErrors = [];
  const allCases = [];

  // Collect YAML files
  let yamlFiles = [];
  const absPath = resolve(casesPath);

  if (!existsSync(absPath)) {
    throw new Error(`Cases path does not exist: ${absPath}`);
  }

  const stat = statSync(absPath);
  if (stat.isDirectory()) {
    yamlFiles = readdirSync(absPath)
      .filter((f) => ['.yaml', '.yml'].includes(extname(f)))
      .map((f) => join(absPath, f))
      .sort();
  } else {
    yamlFiles = [absPath];
  }

  if (yamlFiles.length === 0) {
    throw new Error(`No .yaml files found in: ${absPath}`);
  }

  // Parse each file
  for (const filePath of yamlFiles) {
    const raw = readFileSync(filePath, 'utf-8');

    let docs;
    try {
      docs = yaml.loadAll(raw);
    } catch (err) {
      allErrors.push(`Failed to parse YAML at ${filePath}: ${err.message}`);
      continue;
    }

    // Filter out null/empty documents (YAML multi-doc can have trailing ---)
    const validDocs = docs.filter((d) => d !== null && typeof d === 'object');

    validDocs.forEach((doc, idx) => {
      const errors = validateCase(doc, filePath, idx);
      if (errors.length > 0) {
        allErrors.push(...errors);
        return;
      }

      // Resolve prompt file
      let systemPrompt = null;
      if (doc.prompt_file) {
        try {
          systemPrompt = resolvePromptFile(doc.prompt_file, filePath, promptBaseDirs);
        } catch (err) {
          allErrors.push(err.message);
          return;
        }
      } else if (doc.system) {
        systemPrompt = doc.system;
      }

      allCases.push({
        id: `${filePath}::${idx}`,
        name: doc.name,
        description: doc.description || '',
        file: filePath,
        model: doc.model || null,
        max_tokens: doc.max_tokens || null,
        temperature: doc.temperature ?? undefined,
        systemPrompt,
        input: String(doc.input),
        assertions: doc.assertions,
        tags: doc.tags || [],
      });
    });
  }

  if (strict && allErrors.length > 0) {
    throw new Error(`Test case validation failed:\n  ${allErrors.join('\n  ')}`);
  }

  return { cases: allCases, errors: allErrors };
}
