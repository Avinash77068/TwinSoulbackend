const axios = require('axios');

/**
 * YouTube search.
 *
 * TWO BACKENDS, chosen at runtime:
 *
 *   1. Official YouTube Data API v3 — used whenever YOUTUBE_API_KEY is set.
 *      This is the only production-safe option: it is the sanctioned API, it
 *      supports real pagination, and it will not break when YouTube changes
 *      its internal endpoints. The key stays here on the server and is never
 *      sent to the app.
 *
 *   2. youtubei.js (Innertube) — the existing implementation, kept as a
 *      no-key fallback so the feature keeps working in development and for
 *      anyone who has not provisioned a key yet.
 *
 * Fallback caveat (deliberately not hidden): youtubei.js talks to YouTube's
 * PRIVATE InnerTube endpoints. That is against YouTube's Terms of Service, and
 * in production it is subject to bot detection, consent walls and datacentre-IP
 * blocking — which is exactly the sort of thing that works on a laptop and then
 * fails on a hosted server. Set YOUTUBE_API_KEY before shipping.
 *
 * No result caching here by design — search results are per-user and short
 * lived, and a cache would add staleness and memory pressure for no real gain.
 */

const API_URL = 'https://www.googleapis.com/youtube/v3/search';
const REQUEST_TIMEOUT_MS = 8000;

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 25;
const MAX_QUERY_LENGTH = 100;

/** Error the controller maps to a 502 rather than a generic 500. */
class YouTubeUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'YouTubeUnavailableError';
  }
}

// ─── Input validation ─────────────────────────────────────────────────────────

/**
 * Normalise and bound a search query.
 * @returns {string|null} the cleaned query, or null if unusable.
 */
const cleanQuery = (raw) => {
  if (typeof raw !== 'string') return null;
  // Strip control characters — they cannot help a search and only muddy logs.
  const trimmed = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_QUERY_LENGTH);
};

const cleanLimit = (raw) => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
};

/** Page tokens are opaque, but must still be constrained before we echo them. */
const cleanPageToken = (raw) => {
  if (typeof raw !== 'string') return null;
  const token = raw.trim();
  if (!token || token.length > 64) return null;
  return /^[A-Za-z0-9_\-=]+$/.test(token) ? token : null;
};

// ─── Official Data API v3 ─────────────────────────────────────────────────────

const searchViaDataApi = async ({ query, limit, pageToken }) => {
  try {
    const { data } = await axios.get(API_URL, {
      timeout: REQUEST_TIMEOUT_MS,
      params: {
        key: process.env.YOUTUBE_API_KEY || "AIzaSyAw6RXQkcmOTFr-JU4yzFQR6fCi3nKEzpI",
        q: query,
        part: 'snippet',
        type: 'video',
        maxResults: limit,
        safeSearch: 'moderate',
        // Excludes videos that cannot be played inside our iframe player,
        // which is how deleted/private/embed-blocked results are avoided.
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
    const status = err.response?.status;
    // 403 here is almost always quota exhausted or a key restriction; both are
    // operator problems, so make them loud in the log but generic to the client.
    if (status === 403) {
      console.error('[YouTube] Data API rejected the request (quota or key restriction)');
    } else {
      console.error('[YouTube] Data API request failed:', err.message);
    }
    throw new YouTubeUnavailableError('YouTube search is unavailable');
  }
};

// ─── youtubei.js fallback ─────────────────────────────────────────────────────

let innertubePromise = null;

const getInnertube = async () => {
  if (!innertubePromise) {
    const { Innertube } = await import('youtubei.js');
    // Cached so every request does not re-run session negotiation. Reset on
    // failure so a broken session cannot wedge the endpoint permanently.
    innertubePromise = Innertube.create().catch((err) => {
      innertubePromise = null;
      throw err;
    });
  }
  return innertubePromise;
};

const searchViaInnertube = async ({ query, limit }) => {
  try {
    const yt = await Promise.race([
      getInnertube(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Innertube init timed out')), REQUEST_TIMEOUT_MS),
      ),
    ]);

    const results = await Promise.race([
      yt.search(query),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Innertube search timed out')), REQUEST_TIMEOUT_MS),
      ),
    ]);

    const videos = (results.results ?? [])
      .map((v) => ({
        id: v.id ?? null,
        title: v.title?.text ?? 'Untitled',
        thumbnail: v.thumbnails?.[0]?.url ?? null,
        channel: v.author?.name ?? null,
      }))
      // No id means it was a shelf/channel/playlist row, or an unplayable video.
      .filter((v) => v.id)
      .slice(0, limit);

    // Continuation tokens are stateful objects, not URL-safe strings, so the
    // fallback honestly reports "no more pages" rather than faking pagination.
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

/** Trending is just a well-known query — same path, same normalisation. */
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
