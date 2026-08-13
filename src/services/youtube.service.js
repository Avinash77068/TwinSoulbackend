const axios = require('axios');

/**
 * YouTube search service.
 *
 * TWO PROVIDERS, chosen at runtime:
 *
 *   1. Official YouTube Data API v3 — used whenever YOUTUBE_API_KEY is set.
 *      The production-safe path: sanctioned API, real pagination, and it will
 *      not break when YouTube changes internal endpoints. The key stays on the
 *      server and is never sent to the app.
 *
 *   2. youtubei.js (Innertube) — no-key fallback so the feature keeps working
 *      in development and before a key is provisioned.
 *
 * Fallback caveat, stated plainly: youtubei.js calls YouTube's PRIVATE
 * InnerTube endpoints. That is against YouTube's ToS and is subject to bot
 * detection, consent walls and datacentre-IP blocking — the classic
 * works-on-a-laptop, fails-on-a-host failure. Set YOUTUBE_API_KEY before
 * shipping to production.
 *
 * NOTE: trending is implemented as a search, NOT via `yt.getTrending()` —
 * that method does not exist in youtubei.js v17 and threw
 * "yt.getTrending is not a function", which 500'd the endpoint and left the
 * picker empty so no video could ever be chosen.
 *
 * No result cache by design: results are per-user and short-lived, so a cache
 * would add staleness and memory pressure for no real benefit.
 */

const API_URL = 'https://www.googleapis.com/youtube/v3/search';
const REQUEST_TIMEOUT_MS = 8000;

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 25;
const MAX_QUERY_LENGTH = 100;

/** Signals "upstream is broken", which the controller maps to 503 (not 500). */
class YouTubeUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'YouTubeUnavailableError';
  }
}

// ─── Input validation ─────────────────────────────────────────────────────────

/** Printable characters only; control characters cannot help a search. */
const isPrintable = (ch) => {
  const code = ch.charCodeAt(0);
  return code > 31 && code !== 127;
};

const cleanQuery = (raw) => {
  if (typeof raw !== 'string') return null;
  const stripped = Array.from(raw).filter(isPrintable).join('').trim();
  return stripped ? stripped.slice(0, MAX_QUERY_LENGTH) : null;
};

const cleanLimit = (raw) => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
};

/** Page tokens are opaque, but still constrained before being echoed upstream. */
const cleanPageToken = (raw) => {
  if (typeof raw !== 'string') return null;
  const token = raw.trim();
  if (!token || token.length > 64) return null;
  return /^[A-Za-z0-9_\-=]+$/.test(token) ? token : null;
};

// ─── Provider 1: official Data API v3 ─────────────────────────────────────────

const searchViaDataApi = async ({ query, limit, pageToken }) => {
  try {
    const { data } = await axios.get(API_URL, {
      timeout: REQUEST_TIMEOUT_MS,
      params: {
        key: process.env.YOUTUBE_API_KEY,
        q: query,
        part: 'snippet',
        type: 'video',
        maxResults: limit,
        safeSearch: 'moderate',
        // Drops anything that cannot play inside our iframe — this is how
        // deleted / private / embed-blocked videos are kept out of results.
        videoEmbeddable: 'true',
        ...(pageToken ? { pageToken } : {}),
      },
    });

    const videos = (data.items ?? [])
      .map((item) => ({
        id: item.id?.videoId ?? null,
        title: item.snippet?.title ?? 'Untitled',
        thumbnail:
          item.snippet?.thumbnails?.medium?.url ??
          item.snippet?.thumbnails?.default?.url ??
          null,
        channel: item.snippet?.channelTitle ?? null,
      }))
      .filter((v) => v.id);

    return { videos, nextPageToken: data.nextPageToken ?? null };
  } catch (err) {
    // 403 is almost always exhausted quota or a key restriction — an operator
    // problem, so make it loud in the log but generic to the client.
    if (err.response?.status === 403) {
      console.error('[YouTube] Data API rejected request (quota or key restriction)');
    } else {
      console.error('[YouTube] Data API request failed:', err.message);
    }
    throw new YouTubeUnavailableError('YouTube search is unavailable');
  }
};

// ─── Provider 2: youtubei.js fallback ─────────────────────────────────────────

let innertubePromise = null;

const getInnertube = async () => {
  if (!innertubePromise) {
    const { Innertube } = await import('youtubei.js');
    // Cached so each request skips session negotiation, but cleared on failure
    // so one bad init cannot wedge the endpoint for the process lifetime.
    innertubePromise = Innertube.create().catch((err) => {
      innertubePromise = null;
      throw err;
    });
  }
  return innertubePromise;
};

const withTimeout = (promise, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), REQUEST_TIMEOUT_MS),
    ),
  ]);

const searchViaInnertube = async ({ query, limit }) => {
  try {
    const yt = await withTimeout(getInnertube(), 'Innertube init');
    const results = await withTimeout(yt.search(query), 'Innertube search');

    const videos = (results.results ?? [])
      .map((v) => ({
        id: v.id ?? null,
        title: v.title?.text ?? 'Untitled',
        thumbnail: v.thumbnails?.[0]?.url ?? null,
        channel: v.author?.name ?? null,
      }))
      // No id means a shelf/channel/playlist row, or an unplayable video.
      .filter((v) => v.id)
      .slice(0, limit);

    // Continuations are stateful objects, not URL-safe strings, so the fallback
    // honestly reports "no more pages" instead of faking pagination.
    return { videos, nextPageToken: null };
  } catch (err) {
    console.error('[YouTube] Innertube search failed:', err.message);
    throw new YouTubeUnavailableError('YouTube search is unavailable');
  }
};

// ─── Public API ───────────────────────────────────────────────────────────────

const usingOfficialApi = () => !!process.env.YOUTUBE_API_KEY;

/**
 * @returns {Promise<{videos: Array<{id,title,thumbnail,channel}>, nextPageToken: string|null}>}
 * @throws {YouTubeUnavailableError} when the upstream provider fails.
 */
const searchVideos = async ({ query, limit, pageToken } = {}) => {
  const q = cleanQuery(query);
  if (!q) {
    const err = new Error('Search query is required');
    err.name = 'ValidationError';
    throw err;
  }

  const args = { query: q, limit: cleanLimit(limit), pageToken: cleanPageToken(pageToken) };
  return usingOfficialApi() ? searchViaDataApi(args) : searchViaInnertube(args);
};

/** Trending = a well-known search. Same path, same normalisation, same guards. */
const trendingVideos = ({ limit } = {}) =>
  searchVideos({ query: `trending music videos ${new Date().getFullYear()}`, limit });

module.exports = {
  searchVideos,
  trendingVideos,
  usingOfficialApi,
  YouTubeUnavailableError,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
