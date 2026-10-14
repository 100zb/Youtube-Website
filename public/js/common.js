// Fonctions partagées par les deux modes de jeu

async function api(path, body) {
  const options = body
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    : {};
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Erreur serveur");
  return data;
}

// 45200000 -> "45,2 M de vues"
function formatViews(n) {
  const fr = (x) => x.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  if (n >= 1e9) return `${fr(n / 1e9)} Md de vues`;
  if (n >= 1e6) return `${fr(n / 1e6)} M de vues`;
  return `${Math.round(n).toLocaleString("fr-FR")} vues`;
}

// Compteur qui défile de 0 jusqu'à la valeur finale
function animateCount(el, to, duration = 1200) {
  return new Promise((resolve) => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = formatViews(to);
      return resolve();
    }
    const start = performance.now();
    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = formatViews(to * eased);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
}

function getBest(key) {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}

function saveBest(key, score) {
  const best = Math.max(getBest(key), score);
  try { localStorage.setItem(key, best); } catch {}
  return best;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Remplit une carte vidéo (miniature, titre, chaîne)
function fillCard(card, video) {
  const link = card.querySelector(".thumb");
  link.href = `https://www.youtube.com/watch?v=${video.id}`;
  link.classList.remove("clickable");
  link.setAttribute("tabindex", "-1");
  const img = card.querySelector("img");
  img.src = video.thumbnail;
  img.alt = video.title;
  card.querySelector(".card-title").textContent = video.title;
  card.querySelector(".card-channel").textContent = video.channel;
}

// Après la révélation, la miniature ouvre la vidéo dans un nouvel onglet
function enableLink(card) {
  const link = card.querySelector(".thumb");
  link.classList.add("clickable");
  link.removeAttribute("tabindex");
}
