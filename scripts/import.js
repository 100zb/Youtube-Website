// Lance l'import initial en boucle jusqu'à ce que toutes les chaînes soient importées.
// Usage : node scripts/import.js <url-du-site> <ADMIN_TOKEN>

const [url, token] = process.argv.slice(2);
if (!url || !token) {
  console.log("Usage : node scripts/import.js https://ton-site.workers.dev TON_ADMIN_TOKEN");
  process.exit(1);
}

while (true) {
  const res = await fetch(`${url.replace(/\/$/, "")}/admin/sync`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Erreur :", data.error);
    process.exit(1);
  }
  console.log(`${data.totalVideos} vidéos en base, ${data.channelsLeftToImport} chaînes restantes`);
  if (data.done) break;
  await new Promise((r) => setTimeout(r, 2000));
}
console.log("Import terminé !");
