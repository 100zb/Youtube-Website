import { handleApi, json } from "./api.js";
import { runSync } from "./sync.js";

export default {
  // Les fichiers de public/ sont servis automatiquement par Cloudflare.
  // Le Worker ne reçoit que les requêtes qui ne correspondent à aucun fichier.
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, url);
      }

      // Lance une tranche d'import à la main (import initial).
      // À appeler plusieurs fois jusqu'à obtenir "done": true.
      if (url.pathname === "/admin/sync" && request.method === "POST") {
        const auth = request.headers.get("authorization");
        if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
          return json({ error: "Non autorisé" }, 401);
        }
        return json(await runSync(env));
      }
    } catch (err) {
      console.error(err);
      return json({ error: err.message }, 500);
    }

    return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
  },

  // Cron Trigger quotidien
  async scheduled(controller, env) {
    const report = await runSync(env);
    console.log("Sync YouTube :", JSON.stringify(report));
  },
};
