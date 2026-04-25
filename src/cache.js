/**
 * Response cache — keyed by SHA-256 hash of (promptContent + inputVariables + model).
 * Stored as individual JSON files in .cache/responses/.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const CACHE_DIR = path.resolve('.cache', 'responses');

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Compute a deterministic cache key.
 * @param {string} promptContent - Raw prompt text (system + user assembled)
 * @param {Record<string, any>} variables - Input variables substituted into the prompt
 * @param {string} model - Model identifier
 * @returns {string} hex hash
 */
export function cacheKey(promptContent, variables, model) {
  const payload = JSON.stringify({ promptContent, variables, model });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Read a cached response. Returns null if not found.
 */
export function readCache(key) {
  ensureCacheDir();
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write a response to cache.
 * @param {string} key
 * @param {object} entry - { response, usage, cachedAt, model }
 */
export function writeCache(key, entry) {
  ensureCacheDir();
  const file = path.join(CACHE_DIR, `${key}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...entry, cachedAt: new Date().toISOString() }, null, 2));
}

/**
 * Delete all cached responses.
 */
export function clearCache() {
  if (!fs.existsSync(CACHE_DIR)) return 0;
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) fs.unlinkSync(path.join(CACHE_DIR, f));
  return files.length;
}

/**
 * Count cached entries.
 */
export function cacheStats() {
  if (!fs.existsSync(CACHE_DIR)) return { count: 0, sizeKb: 0 };
  const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
  const sizeBytes = files.reduce((sum, f) => {
    try { return sum + fs.statSync(path.join(CACHE_DIR, f)).size; } catch { return sum; }
  }, 0);
  return { count: files.length, sizeKb: Math.round(sizeBytes / 1024) };
}
