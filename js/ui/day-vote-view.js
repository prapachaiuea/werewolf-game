import { getState } from "../state.js";
import { castVote } from "../votes.js";
import { revealVoteResults } from "../game.js";
import { showToast } from "./components.js";

let initialized = false;

export function init() {
  if (initialized) return;
  initialized = true;
  document.getElementById("btn-reveal-vote").addEventListener("click", async (e) => {
    const { roomId } = getState();
    const btn = e.target;
    btn.disabled = true;
    try {
      const { eliminatedUid } = await revealVoteResults(roomId);
      const { players } = getState();
      showToast(
        eliminatedUid
          ? `หมู่บ้านกำจัด ${players[eliminatedUid]?.name || "ผู้เล่นคนหนึ่ง"} แล้ว`
          : "คะแนนเสมอ — ไม่มีใครถูกกำจัดวันนี้"
      );
    } catch {
      showToast("เปิดเผยผลโหวตไม่สำเร็จ", true);
    } finally {
      btn.disabled = false;
    }
  });
}

export function render(state) {
  if (state.phase !== "day-vote") return;

  const list = document.getElementById("vote-list");
  const hint = document.getElementById("voting-hint");
  const btnReveal = document.getElementById("btn-reveal-vote");

  const isAlive = state.players?.[state.uid]?.alive !== false;
  const myVote = state.votes?.[state.uid]?.votedFor || null;

  hint.textContent = !isAlive
    ? "คุณถูกกำจัดไปแล้ว — เฝ้าดูโหวตต่อได้เงียบ ๆ"
    : myVote
      ? "โหวตแล้ว — เปลี่ยนใจได้จนกว่าจะเปิดผล"
      : "คุณคิดว่าใครคือหมาป่า?";

  const alivePlayers = Object.entries(state.players || {}).filter(([, p]) => p.alive !== false);
  const votesCast = Object.keys(state.votes || {}).length;

  list.innerHTML = "";
  alivePlayers.forEach(([uid, p]) => {
    const li = document.createElement("li");
    li.className = "player-chip vote-option";
    const selected = myVote === uid;
    const voteCount = Object.values(state.votes || {}).filter((v) => v.votedFor === uid).length;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `vote-btn${selected ? " selected danger" : ""}`;
    const label = p.name + (uid === state.uid ? " (คุณ)" : "");
    btn.textContent = voteCount > 0 ? `${label} — ${voteCount} คะแนน` : label;
    btn.disabled = !isAlive;
    btn.addEventListener("click", async () => {
      const { roomId } = getState();
      btn.disabled = true;
      try {
        await castVote(roomId, uid);
        showToast(`โหวต ${label} แล้ว`);
      } catch {
        showToast("โหวตไม่สำเร็จ — เช็กการเชื่อมต่อ", true);
      } finally {
        btn.disabled = !isAlive;
      }
    });
    li.appendChild(btn);
    list.appendChild(li);
  });

  if (state.isHost) {
    btnReveal.hidden = false;
    btnReveal.textContent = `เปิดเผยผลโหวต (${votesCast}/${alivePlayers.length} โหวตแล้ว)`;
  } else {
    btnReveal.hidden = true;
  }
}
