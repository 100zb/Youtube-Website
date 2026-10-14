// Mise à jour des vidéos depuis l'API YouTube Data v3.
// Chaque exécution a un "budget" d'appels (MAX_API_CALLS) pour respecter
// la limite de sous-requêtes des Workers. Le travail non fini reprend au run suivant.

const API = "https://www.googleapis.com/youtube/v3";
const MIN_VIEWS = 500000;
const MIN_SECONDS = 180;
// Les rediffusions de live sont souvent longues. L'API ne distingue pas un live
// d'une "première", donc on n'exclut que les vidéos live de plus d'une heure.
const MAX_LIVE_SECONDS = 3600;

const VIDEO_FIELDS =
  "items(id,snippet(title,channelTitle,publishedAt,liveBroadcastContent,thumbnails(high/url,maxres/url))," +
  "contentDetails/duration,statistics/viewCount,liveStreamingDetails/actualStartTime)";

export async function runSync(env) {
  if (!env.YOUTUBE_API_KEY) throw new Error("Secret YOUTUBE_API_KEY manquant");

  const budget = Number(env.MAX_API_CALLS) || 45;
  const yt = { calls: 0, budget, key: env.YOUTUBE_API_KEY };
  const now = new Date().toISOString();
  const report = { resolved: 0, imported: 0, checked: 0, refreshed: 0, deleted: 0 };

  // 1. Résoudre les handles @ en ID de chaîne
  const { results: toResolve } = await env.DB.prepare(
    "SELECT handle FROM channels WHERE channel_id IS NULL AND not_found = 0"
  ).all();
  for (const ch of toResolve) {
    if (!hasBudget(yt, 1)) break;
    const data = await callApi(yt, "channels", { part: "id", forHandle: ch.handle, fields: "items/id" });
    const id = data.items?.[0]?.id;
    if (id) {
      await env.DB.prepare("UPDATE channels SET channel_id = ? WHERE handle = ?").bind(id, ch.handle).run();
      report.resolved++;
    } else {
      await env.DB.prepare("UPDATE channels SET not_found = 1 WHERE handle = ?").bind(ch.handle).run();
    }
  }

  // 2. Import complet des chaînes pas encore importées (page par page)
  const { results: toImport } = await env.DB.prepare(
    "SELECT handle, channel_id, import_page_token FROM channels WHERE channel_id IS NOT NULL AND import_done = 0"
  ).all();
  for (const ch of toImport) {
    let token = ch.import_page_token;
    while (hasBudget(yt, 2)) {
      const page = await fetchUploadsPage(yt, ch.channel_id, token);
      report.imported += await saveVideos(env, yt, page.ids, now);
      token = page.nextPageToken || null;
      await env.DB.prepare(
        "UPDATE channels SET import_page_token = ?, import_done = ?, last_check_at = ? WHERE handle = ?"
      ).bind(token, token ? 0 : 1, now, ch.handle).run();
      if (!token) break;
    }
    if (token) break; // budget épuisé au milieu d'une chaîne
  }

  // 3. Vérification quotidienne : les 50 dernières vidéos de chaque chaîne
  const today = now.slice(0, 10);
  const { results: toCheck } = await env.DB.prepare(
    "SELECT handle, channel_id FROM channels WHERE import_done = 1 AND channel_id IS NOT NULL " +
      "AND (last_check_at IS NULL OR last_check_at < ?) ORDER BY last_check_at"
  ).bind(today).all();
  for (const ch of toCheck) {
    if (!hasBudget(yt, 2)) break;
    const page = await fetchUploadsPage(yt, ch.channel_id, null);
    report.checked += await saveVideos(env, yt, page.ids, now);
    await env.DB.prepare("UPDATE channels SET last_check_at = ? WHERE handle = ?").bind(now, ch.handle).run();
  }

  // 4. Avec le budget restant, rafraîchir les vues des vidéos les plus anciennes en base
  while (hasBudget(yt, 1)) {
    const { results } = await env.DB.prepare(
      "SELECT id FROM videos WHERE updated_at < ? ORDER BY updated_at LIMIT 50"
    ).bind(today).all();
    if (results.length === 0) break;
    const ids = results.map((r) => r.id);
    const saved = await saveVideos(env, yt, ids, now, true);
    report.refreshed += saved.kept;
    report.deleted += saved.removed;
  }

  const pending = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM channels WHERE not_found = 0 AND import_done = 0"
  ).first();
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM videos").first();

  return { ...report, apiCalls: yt.calls, channelsLeftToImport: pending.n, done: pending.n === 0, totalVideos: total.n };
}

function hasBudget(yt, n) {
  return yt.calls + n <= yt.budget;
}

async function callApi(yt, endpoint, params) {
  yt.calls++;
  const url = new URL(`${API}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", yt.key);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube ${endpoint} : HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchUploadsPage(yt, channelId, pageToken) {
  const params = {
    part: "contentDetails",
    playlistId: "UU" + channelId.slice(2),
    maxResults: 50,
    fields: "nextPageToken,items/contentDetails/videoId",
  };
  if (pageToken) params.pageToken = pageToken;
  const data = await callApi(yt, "playlistItems", params);
  return {
    ids: (data.items || []).map((it) => it.contentDetails.videoId),
    nextPageToken: data.nextPageToken,
  };
}

// Récupère les stats de max 50 vidéos et les enregistre si elles passent les filtres.
// Avec removeMissing, les vidéos qui ne passent plus (supprimées, privées) sont effacées.
async function saveVideos(env, yt, ids, now, removeMissing = false) {
  if (ids.length === 0) return removeMissing ? { kept: 0, removed: 0 } : 0;

  const data = await callApi(yt, "videos", {
    part: "snippet,contentDetails,statistics,liveStreamingDetails",
    id: ids.join(","),
    maxResults: 50,
    fields: VIDEO_FIELDS,
  });

  const upsert = env.DB.prepare(
    `INSERT INTO videos (id, title, channel, views, published_at, thumbnail, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET title = excluded.title, views = excluded.views,
       thumbnail = excluded.thumbnail, updated_at = excluded.updated_at`
  );
  const statements = [];
  const keptIds = new Set();

  for (const v of data.items || []) {
    if (!isValidVideo(v)) continue;
    const thumbs = v.snippet.thumbnails || {};
    const thumbnail = thumbs.maxres?.url || thumbs.high?.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
    statements.push(
      upsert.bind(v.id, v.snippet.title, v.snippet.channelTitle, Number(v.statistics.viewCount),
        v.snippet.publishedAt, thumbnail, now)
    );
    keptIds.add(v.id);
  }

  let removed = 0;
  if (removeMissing) {
    for (const id of ids) {
      if (!keptIds.has(id)) {
        statements.push(env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(id));
        removed++;
      }
    }
  }

  if (statements.length > 0) await env.DB.batch(statements);
  return removeMissing ? { kept: keptIds.size, removed } : keptIds.size;
}

function isValidVideo(v) {
  if (!v.snippet || !v.statistics || !v.contentDetails) return false;
  if (v.snippet.liveBroadcastContent !== "none") return false; // live en cours ou à venir
  const seconds = parseDuration(v.contentDetails.duration);
  if (seconds <= MIN_SECONDS) return false;
  if (v.liveStreamingDetails && seconds > MAX_LIVE_SECONDS) return false;
  return Number(v.statistics.viewCount) >= MIN_VIEWS;
}

// "PT1H2M3S" -> 3723
export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  if (!m) return 0;
  const [, d, h, min, s] = m.map((x) => Number(x) || 0);
  return d * 86400 + h * 3600 + min * 60 + s;
}
