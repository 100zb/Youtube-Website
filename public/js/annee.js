const ROUNDS = 10;
const currentYear = new Date().getFullYear();

const slider = document.getElementById("year");
const yearValue = document.getElementById("year-value");
const card = document.getElementById("video");
const resultEl = document.getElementById("result");
const validateBtn = document.getElementById("validate");
const nextBtn = document.getElementById("next");

let videos = [];
let round = 0;
let score = 0;
let results = []; // points de chaque manche

slider.max = currentYear;
document.getElementById("max-label").textContent = currentYear;

function updateSlider() {
  yearValue.textContent = slider.value;
  const progress = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
  slider.style.setProperty("--progress", progress + "%");
}
slider.addEventListener("input", updateSlider);

async function start() {
  round = 0;
  score = 0;
  results = [];
  document.getElementById("score").textContent = 0;
  document.getElementById("over").hidden = true;
  document.getElementById("loading").hidden = false;

  try {
    const data = await api(`/api/random?count=${ROUNDS}&mode=year`);
    videos = data.videos;
    if (videos.length === 0) throw new Error("aucune vidéo en base");
  } catch (err) {
    document.getElementById("loading").textContent = "Impossible de charger les vidéos : " + err.message;
    return;
  }

  document.getElementById("total").textContent = videos.length;
  document.getElementById("loading").hidden = true;
  document.getElementById("game").hidden = false;
  showRound();
}

function showRound() {
  document.getElementById("round").textContent = round + 1;
  fillCard(card, videos[round]);
  card.classList.remove("good", "bad");
  slider.value = Math.round((2010 + currentYear) / 2);
  slider.disabled = false;
  updateSlider();
  resultEl.textContent = "";
  resultEl.className = "result";
  validateBtn.hidden = false;
  validateBtn.disabled = false;
  nextBtn.hidden = true;
}

validateBtn.addEventListener("click", async () => {
  validateBtn.disabled = true;
  slider.disabled = true;

  let result;
  try {
    result = await api("/api/check", { mode: "year", id: videos[round].id, guess: Number(slider.value) });
  } catch (err) {
    alert(err.message);
    validateBtn.disabled = false;
    slider.disabled = false;
    return;
  }

  score += result.points;
  results.push(result.points);
  document.getElementById("score").textContent = score;

  const plural = result.points > 1 ? "s" : "";
  resultEl.textContent = `${emojiFor(result.points)} Sortie en ${result.year} · +${result.points} point${plural}`;
  resultEl.className = "result " + (result.points === 5 ? "good" : result.points > 0 ? "mid" : "bad");
  card.classList.add(result.points > 0 ? "good" : "bad");
  enableLink(card);

  validateBtn.hidden = true;
  nextBtn.hidden = false;
  nextBtn.textContent = round + 1 < videos.length ? "Suivante →" : "Voir mon score";
  nextBtn.focus();
});

nextBtn.addEventListener("click", () => {
  round++;
  if (round < videos.length) showRound();
  else gameOver();
});

function emojiFor(points) {
  if (points === 5) return "🟩";
  if (points > 0) return "🟨";
  return "🟥";
}

function gameOver() {
  const previous = getBest("best-year");
  const best = saveBest("best-year", score);
  document.getElementById("final-score").textContent = score;
  document.getElementById("final-max").textContent = videos.length * 5;
  document.getElementById("emojis").textContent = results.map(emojiFor).join("");
  document.getElementById("best-msg").textContent = score > previous ? "🎉 Nouveau record !" : `Record : ${best}`;
  document.getElementById("toast").textContent = "";
  document.getElementById("game").hidden = true;
  document.getElementById("over").hidden = false;
}

document.getElementById("share").addEventListener("click", async () => {
  const text =
    `📅 Devine l'année : ${score}/${videos.length * 5}\n` +
    `${results.map(emojiFor).join("")}\n` +
    `${location.origin}/annee`;
  const toast = document.getElementById("toast");
  try {
    await navigator.clipboard.writeText(text);
    toast.textContent = "Résultat copié ! Colle-le où tu veux.";
  } catch {
    toast.textContent = text;
  }
});

document.getElementById("replay").addEventListener("click", start);
start();
