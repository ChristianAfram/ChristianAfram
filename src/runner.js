/**
 * Runner — loads prompts, substitutes variables, calls the Anthropic API (or cache),
 * and returns raw results for assertion evaluation.
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { cacheKey, readCache, writeCache } from './cache.js';

let _client = null;
function getClient() {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY environment variable is not set.\n' +
        'Export it before running: export ANTHROPIC_API_KEY=sk-ant-...'
      );
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

/**
 * Load a prompt file. Supports .md, .txt, .prompt files.
 * Returns { system, user } — system is optional (extracted from front-matter).
 *
 * Front-matter format (optional):
 * ---system
 * You are a helpful assistant.
 * ---
 * User prompt content here with {{variables}}.
 */
export function loadPromptFile(promptPath) {
  const raw = fs.readFileSync(promptPath, 'utf8');

  // Extract optional system block
  const systemMatch = raw.match(/^---system\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (systemMatch) {
    return { system: systemMatch[1].trim(), user: systemMatch[2].trim() };
  }

  // No system block — entire file is user prompt
  return { system: null, user: raw.trim() };
}

/**
 * Substitute {{variable}} placeholders in a template string.
 */
export function substituteVariables(template, variables = {}) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key in variables) return String(variables[key]);
    return `{{${key}}`;  // leave unresolved placeholders as-is
  });
}

/**
 * Build the assembled prompt text used for cache-key hashing.
 */
function assemblePromptText(promptDef, variables) {
  const system = promptDef.system ? substituteVariables(promptDef.system, variables) : '';
  const user = substituteVariables(promptDef.user, variables);
  return `SYSTEM:\n${system}\n\nUSER:\n${user}`;
}

/**
 * Run a single test case against the API (or cache).
 *
 * @param {object} opts
 * @param {string} opts.promptPath - Absolute path to the prompt file
 * @param {object} opts.variables - Variables to substitute
 * @param {string} opts.model - Claude model ID
 * @param {boolean} opts.useCache - Whether to use cached responses
 * @param {number} opts.maxTokens - Max output tokens
 * @returns {Promise<RunResult>}
 */
export async function runCase({ promptPath, variables = {}, model, useCache = true, maxTokens = 1024 }) {
  const promptDef = loadPromptFile(promptPath);
  const system = promptDef.system ? substituteVariables(promptDef.system, variables) : null;
  const userMessage = substituteVariables(promptDef.user, variables);
  const assembledText = assemblePromptText(promptDef, variables);

  const key = cacheKey(assembledText, variables, model);

  // Check cache first
  if (useCache) {
    const cached = readCache(key);
    if (cached) {
      return {
        ...cached,
        cacheHit: true,
        cacheKey: key,
      };
    }
  }

  // Call the API
  const startTime = Date.now();
  const client = getClient();

  const messageParams = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userMessage }],
  };
  if (system) messageParams.system = system;

  const message = await client.messages.create(messageParams);

  const response = message.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  const result = {
    response,
    usage: {
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      total_tokens: message.usage.input_tokens + message.usage.output_tokens,
    },
    model: message.model,
    latencyMs: Date.now() - startTime,
    cacheHit: false,
    cacheKey: key,
  };

  if (useCache) {
    writeCache(key, result);
  }

  return result;
}
