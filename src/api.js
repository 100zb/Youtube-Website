// Routes /api/* du jeu.
// Les vues et dates des vidéos à deviner ne sont jamais envoyées avant
// que le joueur ait répondu : il faut passer par POST /api/check.

const PUBLIC_FIELDS = "id, title, channel, thumbnail";
// Pour "Plus ou moins" : écart de vues maximum entre les deux vidéos.
// Plus la série est longue, plus l'écart est petit (donc plus c'est dur).
// Au moins x1,05 pour éviter deux vidéos presque à égalité.
const MIN_RATIO = 1.05;
function maxRatioFor(streak) {
  if (streak < 5) return 2.5;
  if (streak < 10) return 1.8;
  return 1.4;
}
const FIRST_YEAR = 2010;

export async function handleApi(request, env, url) {
  const db = env.DB;
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /api/random") {
    const count = Math.min(Math.max(Number(url.searchParams.get("count")) || 1, 1), 10);
    const exclude = parseIds(url.searchParams.get("exclude"));
    const mode = url.searchParams.get("mode");
    const near = url.searchParams.get("near");
    const streak = Number(url.searchParams.get("streak")) || 0;

    const videos = [];
    for (let i = 0; i < count; i++) {
      let video = null;
      if (near) video = await pickNear(db, near, exclude, streak);
      if (!video) video = await pickRandom(db, exclude, mode === "year" ? yearFilter() : null);
      if (!video) break;
      videos.push(video);
      exclude.push(video.id);
    }
    return json({ videos });
  }

  if (route === "GET /api/duel/start") {
    const exclude = parseIds(url.searchParams.get("exclude"));
    const left = await pickRandom(db, exclude, null, true);
    if (!left) return json({ error: "Pas assez de vidéos en base" }, 503);
    exclude.push(left.id);
    const right = (await pickNear(db, left.id, exclude, 0)) || (await pickRandom(db, exclude));
    if (!right) return json({ error: "Pas assez de vidéos en base" }, 503);
    return json({ left, right });
  }

  if (route === "POST /api/check") {
    const body = await request.json().catch(() => ({}));

    if (body.mode === "duel") {
      if (body.guess !== "plus" && body.guess !== "moins") return json({ error: "guess invalide" }, 400);
      const left = await getVideo(db, body.left);
      const right = await getVideo(db, body.right);
      if (!left || !right) return json({ error: "Vidéo inconnue" }, 404);
      const correct = body.guess === "plus" ? right.views >= left.views : right.views <= left.views;
      return json({ correct, views: right.views });
    }

    if (body.mode === "year") {
      const video = await getVideo(db, body.id);
      if (!video) return json({ error: "Vidéo inconnue" }, 404);
      const year = Number(video.published_at.slice(0, 4));
      const diff = Math.abs(year - Number(body.guess));
      const points = diff === 0 ? 5 : diff === 1 ? 3 : diff === 2 ? 1 : 0;
      return json({ year, points, publishedAt: video.published_at, views: video.views });
    }

    return json({ error: "mode invalide" }, 400);
  }

  return json({ error: "Route inconnue" }, 404);
}

// Tirage aléatoire via la colonne indexée rnd : on part d'un point au hasard
// et on prend la première vidéo qui suit. Lit très peu de lignes dans D1.
async function pickRandom(db, exclude, filter = null, withViews = false) {
  const fields = withViews ? PUBLIC_FIELDS + ", views" : PUBLIC_FIELDS;
  const where = filter ? `AND ${filter.sql}` : "";
  const params = filter ? filter.params : [];
  const sql = `SELECT ${fields} FROM videos
    WHERE rnd >= ? AND id NOT IN (SELECT value FROM json_each(?)) ${where}
    ORDER BY rnd LIMIT 1`;
  const excluded = JSON.stringify(exclude);
  return (
    (await db.prepare(sql).bind(Math.random(), excluded, ...params).first()) ||
    (await db.prepare(sql).bind(0, excluded, ...params).first())
  );
}

// Une vidéo dont les vues sont proches de celles de refId.
// Si aucune vidéo ne correspond, on élargit petit à petit l'écart autorisé.
async function pickNear(db, refId, exclude, streak) {
  const ref = await getVideo(db, refId);
  if (!ref) return null;
  const v = ref.views;
  for (const max of [maxRatioFor(streak), 3, 6]) {
    const video = await pickRandom(db, exclude, {
      sql: "(views BETWEEN ? AND ? OR views BETWEEN ? AND ?)",
      params: [Math.round(v * MIN_RATIO), Math.round(v * max), Math.round(v / max), Math.round(v / MIN_RATIO)],
    });
    if (video) return video;
  }
  return null;
}

function yearFilter() {
  return { sql: "published_at >= ?", params: [`${FIRST_YEAR}-01-01`] };
}

function getVideo(db, id) {
  if (typeof id !== "string") return null;
  return db.prepare("SELECT id, views, published_at FROM videos WHERE id = ?").bind(id).first();
}

function parseIds(text) {
  if (!text) return [];
  return text.split(",").filter((id) => /^[\w-]{11}$/.test(id)).slice(0, 300);
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
