/**
 * runner.js
 * Handles calling the Anthropic API and caching responses by content hash.
 *
 * Cache key = SHA-256 of (model + system_prompt + user_input + max_tokens)
 * so identical inputs never re-hit the API.
 *
 * Cache lives in .cache/ as JSON files named by hash.
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';

// ─── Cache helpers ────────────────────────────────────────────────────────────

function buildCacheKey(params) {
  const canonical = JSON.stringify({
    model: params.model,
    system: params.system || '',
    user: params.user,
    max_tokens: params.max_tokens,
    temperature: params.temperature ?? 1,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function getCachePath(cacheDir, hash) {
  return join(cacheDir, `${hash}.json`);
}

function readCache(cacheDir, hash) {
  const path = getCachePath(cacheDir, hash);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(cacheDir, hash, entry) {
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const path = getCachePath(cacheDir, hash);
  writeFileSync(path, JSON.stringify(entry, null, 2), 'utf-8');
}

// ─── Runner ──────────────────────────────────────────────────────────────────

export class Runner {
  constructor({ cacheDir = '.cache', apiKey = null } = {}) {
    this.cacheDir = cacheDir;
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this._stats = { hits: 0, misses: 0 };
  }

  get client() {
    return this._client;
  }

  set client(c) {
    this._client = c;
  }

  get stats() {
    return { ...this._stats };
  }

  /**
   * Runs a prompt against Claude, returning the text output.
   *
   * @param {object} params
   * @param {string} params.model          - Claude model ID
   * @param {string} [params.system]       - System prompt text
   * @param {string} params.user           - User message text
   * @param {number} [params.max_tokens]   - Max output tokens (default 1024)
   * @param {number} [params.temperature]  - Sampling temperature
   * @param {boolean} [params.noCache]     - Force skip cache
   *
   * @returns {Promise<RunResult>}
   */
  async run(params) {
    const {
      model = 'claude-haiku-4-5',
      system,
      user,
      max_tokens = 1024,
      temperature = 1,
      noCache = false,
    } = params;

    if (!user) throw new Error('runner.run() requires a "user" message');

    const cacheKey = buildCacheKey({ model, system, user, max_tokens, temperature });

    // Try cache first
    if (!noCache) {
      const cached = readCache(this.cacheDir, cacheKey);
      if (cached) {
        this._stats.hits++;
        return {
          output: cached.output,
          model: cached.model,
          usage: cached.usage,
          cacheHit: true,
          cacheKey,
          timestamp: cached.timestamp,
        };
      }
    }

    // Live API call
    this._stats.misses++;
    const messages = [{ role: 'user', content: user }];

    const apiParams = {
      model,
      max_tokens,
      messages,
    };

    if (system) apiParams.system = system;
    if (temperature !== undefined) apiParams.temperature = temperature;

    const started = Date.now();
    const response = await this._client.messages.create(apiParams);
    const elapsed = Date.now() - started;

    const output = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const result = {
      output,
      model: response.model,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      elapsed_ms: elapsed,
      cacheHit: false,
      cacheKey,
      timestamp: new Date().toISOString(),
    };

    // Persist to cache
    if (!noCache) {
      writeCache(this.cacheDir, cacheKey, result);
    }

    return result;
  }

  /**
   * Clears cached entry for specific params (or all if no params given).
   */
  clearCache(params = null) {
    if (!params) {
      // Would need fs.readdirSync — left as a CLI-level action
      return;
    }
    const cacheKey = buildCacheKey(params);
    const path = getCachePath(this.cacheDir, cacheKey);
    if (existsSync(path)) {
      require('fs').unlinkSync(path);
    }
  }
}
