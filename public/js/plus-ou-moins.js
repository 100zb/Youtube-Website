const leftCard = document.getElementById("left");
const rightCard = document.getElementById("right");
const choices = document.getElementById("choices");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");

let left = null;   // vidéo de gauche (vues connues)
let right = null;  // vidéo de droite (vues cachées)
let score = 0;
let seen = [];     // ids déjà tirés pendant la partie

bestEl.textContent = getBest("best-duel");

async function start() {
  score = 0;
  scoreEl.textContent = 0;
  document.getElementById("over").hidden = true;
  document.getElementById("loading").hidden = false;

  try {
    const data = await api("/api/duel/start");
    left = data.left;
    right = data.right;
    seen = [left.id, right.id];
  } catch (err) {
    document.getElementById("loading").textContent = "Impossible de charger les vidéos : " + err.message;
    return;
  }

  showRound();
  document.getElementById("loading").hidden = true;
  document.getElementById("game").hidden = false;
}

function showRound() {
  fillCard(leftCard, left);
  enableLink(leftCard);
  leftCard.querySelector(".views").textContent = formatViews(left.views);

  fillCard(rightCard, right);
  rightCard.querySelector(".views").textContent = "? vues";
  rightCard.classList.remove("good", "bad", "leaving");
  leftCard.classList.remove("leaving");
  document.getElementById("question").hidden = false;
  choices.hidden = false;
  setButtons(true);
}

function setButtons(enabled) {
  choices.querySelectorAll("button").forEach((b) => (b.disabled = !enabled));
}

choices.addEventListener("click", async (event) => {
  const guess = event.target.closest("button")?.dataset.guess;
  if (!guess) return;
  setButtons(false);

  let result;
  try {
    result = await api("/api/check", { mode: "duel", left: left.id, right: right.id, guess });
  } catch (err) {
    alert(err.message);
    setButtons(true);
    return;
  }

  // On prépare déjà la vidéo suivante pendant l'animation
  const next = result.correct
    ? api(`/api/random?count=1&near=${right.id}&exclude=${seen.join(",")}`).catch(() => ({ videos: [] }))
    : null;

  choices.hidden = true;
  document.getElementById("question").hidden = true;
  await animateCount(rightCard.querySelector(".views"), result.views);
  rightCard.classList.add(result.correct ? "good" : "bad");
  enableLink(rightCard);
  right.views = result.views;

  if (!result.correct) {
    await wait(1200);
    gameOver(false);
    return;
  }

  score++;
  scoreEl.textContent = score;
  const { videos } = await next;
  await wait(900);

  if (videos.length === 0) {
    gameOver(true);
    return;
  }

  leftCard.classList.add("leaving");
  rightCard.classList.add("leaving");
  await wait(300);
  left = right;
  right = videos[0];
  seen.push(right.id);
  showRound();
});

function gameOver(allSeen) {
  const previous = getBest("best-duel");
  const best = saveBest("best-duel", score);
  bestEl.textContent = best;
  document.getElementById("over-title").textContent = allSeen ? "Tu as vu toutes les vidéos !" : "Perdu !";
  document.getElementById("final-score").textContent = score;
  document.getElementById("best-msg").textContent =
    score > previous ? "🎉 Nouveau record !" : `Record : ${best}`;
  document.getElementById("game").hidden = true;
  document.getElementById("over").hidden = false;
}

document.getElementById("replay").addEventListener("click", start);
start();
