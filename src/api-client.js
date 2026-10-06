// Shared HTTP client for the VanAuto public API.
//
// The MCP server is read-only by design: every tool funnels through `apiGet`,
// which only ever issues GET requests against the public API. There is no
// database access and no authentication, so the worst a bad tool argument can
// do is read data the website already serves to anonymous visitors.

const DEFAULT_API_URL = "https://api.vanauto.pl";
const DEFAULT_SITE_URL = "https://vanauto.pl";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_CACHE_ENTRIES = 500;
const USER_AGENT = "vanauto-mcp-campers/0.1.0";

const cache = new Map();

export function apiBaseUrl() {
  return normalizeBase(process.env.VANAUTO_API_URL || DEFAULT_API_URL);
}

export function siteBaseUrl() {
  return normalizeBase(process.env.VANAUTO_SITE_URL || DEFAULT_SITE_URL);
}

export function siteUrl(pathname) {
  return `${siteBaseUrl()}${pathname}`;
}

/**
 * GET a JSON document from the public API.
 *
 * `ttlMs` enables the in-process response cache; `retries` retries transient
 * failures (network errors, 429, 5xx) with a short backoff. Errors carry
 * `status` and `retryable` so callers can distinguish "not found" from
 * "service down".
 */
export async function apiGet(path, { params, ttlMs = 0, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1 } = {}) {
  const url = new URL(path, `${apiBaseUrl()}/`);
  for (const [key, value] of Object.entries(params ?? {})) {
    addParam(url.searchParams, key, value);
  }

  const cacheKey = url.toString();
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const data = await fetchJson(url, timeoutMs);
      if (ttlMs > 0) cacheSet(cacheKey, data, ttlMs);
      return data;
    } catch (error) {
      lastError = error;
      if (attempt === retries || !error.retryable) break;
      await sleep(250 * (attempt + 1));
    }
  }

  throw lastError;
}

export function clearCache() {
  cache.clear();
}

function normalizeBase(value) {
  return String(value).replace(/\/+$/, "");
}

function addParam(searchParams, key, value) {
  if (value === undefined || value === null || value === "") return;

  if (Array.isArray(value)) {
    for (const item of value) addParam(searchParams, `${key}[]`, item);
    return;
  }

  searchParams.append(key, String(value));
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": USER_AGENT,
      },
      signal: controller.signal,
    });
  } catch (error) {
    const reason = error.name === "AbortError" ? `timed out after ${timeoutMs}ms` : error.message;
    const wrapped = new Error(`Cannot reach the VanAuto API at ${url.origin} (${reason}). Check VANAUTO_API_URL and connectivity.`);
    wrapped.retryable = true;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(
      `VanAuto API returned ${response.status} for ${url.pathname}${url.search}: ${describeApiError(body)}`,
    );
    error.status = response.status;
    error.retryable = response.status >= 500 || response.status === 429;
    throw error;
  }

  return response.json();
}

function describeApiError(body) {
  try {
    const parsed = JSON.parse(body);
    const errors = Array.isArray(parsed?.errors) ? parsed.errors : [];
    const messages = errors.map((item) => item?.message).filter(Boolean);
    if (messages.length > 0) return messages.join("; ");
  } catch {
    // Not JSON - fall through to the raw body.
  }

  return body.slice(0, 300) || "empty response";
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key, value, ttlMs) {
  // Bound the map so a long-lived process cannot grow it without limit; Map
  // iteration order is insertion order, so the first key is the oldest entry.
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
