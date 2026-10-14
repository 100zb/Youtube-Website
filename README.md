# Devine la Vidéo

Jeu web sur les vidéos des gros YouTubeurs français, hébergé entièrement sur Cloudflare
(Worker + static assets, base D1, Cron Trigger quotidien).

- **Plus ou moins** : la vidéo de droite a-t-elle plus ou moins de vues que celle de gauche ?
- **Devine l'année** : 10 manches, 5 / 3 / 1 / 0 point selon l'écart.

```
migrations/   schéma D1, liste des chaînes, vidéos d'exemple
src/          Worker : index.js (routes + cron), api.js (jeu), sync.js (import YouTube)
public/       front HTML / CSS / JS vanilla
```

## 1. Obtenir une clé API YouTube

1. Va sur <https://console.cloud.google.com/>, crée un projet.
2. « API et services » → « Bibliothèque » → active **YouTube Data API v3**.
3. « Identifiants » → « Créer des identifiants » → **Clé API**. Copie-la.

## 2. Installer et créer la base D1

```bash
npm install
npx wrangler login
npx wrangler d1 create youtube-game
```

Copie le `database_id` affiché dans `wrangler.jsonc` (à la place de `REMPLACE_PAR_TON_DATABASE_ID`), puis :

```bash
npm run db:migrate:local    # base locale
npm run db:migrate:remote   # base en ligne
```

Les migrations créent les tables, ajoutent ~25 chaînes et 11 vidéos d'exemple :
le site est jouable tout de suite, même sans clé API.

## 3. Ajouter les secrets

```bash
npx wrangler secret put YOUTUBE_API_KEY   # la clé YouTube
npx wrangler secret put ADMIN_TOKEN       # un mot de passe de ton choix pour /admin/sync
```

En local, crée un fichier `.dev.vars` (ignoré par git) :

```
YOUTUBE_API_KEY=ta_cle
ADMIN_TOKEN=un_mot_de_passe
```

## 4. Lancer en local

```bash
npx wrangler dev
```

Ouvre <http://localhost:8787>. Pour simuler le cron : `curl "http://localhost:8787/__scheduled"` (lancer `wrangler dev --test-scheduled`).

## 5. Import initial

Le plan gratuit des Workers limite chaque exécution à 50 requêtes externes. L'import est donc
découpé : chaque appel fait au plus `MAX_API_CALLS` (45) requêtes YouTube et reprend là où le précédent
s'est arrêté. Répète jusqu'à `"done": true` :

```bash
node scripts/import.js https://devine-la-video.<ton-compte>.workers.dev TON_ADMIN_TOKEN
```

Avec le plan payant Workers, tu peux mettre `MAX_API_CALLS` à `2000` dans `wrangler.jsonc` pour tout faire en un appel.

Ensuite, le cron (tous les jours à 4h17 UTC) récupère les 50 dernières vidéos de chaque chaîne et
rafraîchit les vues des vidéos les plus anciennes avec le budget restant.

**Quota YouTube** : 1 unité par appel (`playlistItems`, `videos`, `channels`), soit environ 2 unités
par tranche de 50 vidéos. L'import complet de 25 chaînes coûte quelques centaines d'unités sur 10 000/jour.

**Filtres** : vidéos > 3 min, ≥ 500 000 vues, pas de live en cours/à venir. L'API ne distingue pas une
rediffusion de live d'une « première » : on exclut donc les vidéos issues d'un live qui durent plus d'1 h.

## 6. Déployer

```bash
npx wrangler deploy
```

## API

| Route | Rôle |
| --- | --- |
| `GET /api/random?count=N&exclude=id1,id2&mode=year&near=id` | N vidéos au hasard, sans vues ni date. `near` choisit une vidéo aux vues proches ; `streak` (la série en cours) resserre l'écart : x2,5 max, puis x1,8 dès 5, puis x1,4 dès 10. |
| `GET /api/duel/start` | Première paire de « Plus ou moins » (seules les vues de gauche sont envoyées). |
| `POST /api/check` | Vérifie une réponse et renvoie seulement alors la vraie valeur. |
| `POST /admin/sync` | Lance une tranche d'import (header `Authorization: Bearer ADMIN_TOKEN`). |

Pour ajouter une chaîne : `npx wrangler d1 execute youtube-game --remote --command "INSERT INTO channels (handle, name) VALUES ('@handle', 'Nom')"`.
