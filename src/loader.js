/**
 * YAML test case loader.
 *
 * Case file schema:
 * ─────────────────
 * name: "Summarization — short article"
 * prompt: prompts/summarize.md         # relative to cwd
 * model: claude-3-5-haiku-20241022     # optional override
 * max_tokens: 512                      # optional override
 * variables:
 *   article: "The quick brown fox..."
 * assertions:
 *   - type: contains
 *     value: "fox"
 *   - type: max_tokens
 *     value: 300
 *   - type: llm_judge
 *     criterion: "The summary is concise and captures the main point."
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { glob } from 'glob';

/**
 * Load a single YAML case file.
 * @param {string} filePath
 * @returns {Array<CaseDef>} — a single file may define multiple cases (as a list)
 */
export function loadCaseFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = yaml.load(raw);

  // Support both single case (object) and list of cases
  const cases = Array.isArray(parsed) ? parsed : [parsed];

  return cases.map((c, i) => {
    if (!c.prompt) {
      throw new Error(`Case ${i + 1} in ${filePath} is missing required "prompt" field`);
    }
    if (!c.assertions || !Array.isArray(c.assertions)) {
      throw new Error(`Case ${i + 1} in ${filePath} is missing "assertions" array`);
    }
    return {
      name: c.name || path.basename(filePath, path.extname(filePath)),
      prompt: c.prompt,
      model: c.model || null,  // falls back to CLI --model flag
      max_tokens: c.max_tokens || null,
      variables: c.variables || {},
      assertions: c.assertions,
      sourceFile: filePath,
    };
  });
}

/**
 * Load all case files from a directory (or a single file path).
 * @param {string} casesPath - directory or single .yaml/.yml file
 * @param {string} [filter] - optional glob filter pattern
 * @returns {Promise<Array<CaseDef>>}
 */
export async function loadAllCases(casesPath, filter = null) {
  const resolved = path.resolve(casesPath);
  const stat = fs.statSync(resolved);

  let files;
  if (stat.isFile()) {
    files = [resolved];
  } else {
    const pattern = filter
      ? path.join(resolved, `**/${filter}`)
      : path.join(resolved, '**/*.{yaml,yml}');
    files = await glob(pattern, { absolute: true });
    files.sort();
  }

  const allCases = [];
  for (const f of files) {
    const cases = loadCaseFile(f);
    allCases.push(...cases);
  }

  return allCases;
}
