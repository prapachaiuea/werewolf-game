import { ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
import { db } from "../firebase-init.js";
import { getState } from "../state.js";
import { resolveHunterRevenge } from "../game.js";
import { showToast } from "./components.js";

let initialized = false;
let unsub = null;
let subscribedKey = null;
let currentChoice = null;

export function init() {
  if (initialized) return;
  initialized = true;
  document.getElementById("btn-continue-after-hunter").addEventListener("click", async (e) => {
    const { roomId } = getState();
    const btn = e.target;
    btn.disabled = true;
    try {
      const { revengeUid } = await resolveHunterRevenge(roomId);
      const { players } = getState();
      showToast(
        revengeUid
          ? `นายพรานยิง ${players[revengeUid]?.name || "ผู้เล่นคนหนึ่ง"} ตายไปด้วย!`
          : "นายพรานเลือกไม่ยิงใคร"
      );
    } catch (err) {
      showToast(err.message === "NO_HUNTER_CHOICE" ? "นายพรานยังไม่ได้ตัดสินใจ" : "ไปต่อไม่สำเร็จ", true);
    } finally {
      btn.disabled = false;
    }
  });
}

function teardown() {
  if (unsub) unsub();
  unsub = null;
  subscribedKey = null;
  currentChoice = null;
}

export function render(state) {
  if (state.phase !== "hunter-revenge") {
    teardown();
    return;
  }

  const { roomId } = state;
  const round = state.public?.roundNumber;
  const hunterUid = state.public?.hunterRevenge?.hunterUid;
  const isHunter = state.uid === hunterUid;
  const canSee = isHunter || state.isHost;
  const key = `${roomId}:${round}`;

  if (canSee && subscribedKey !== key) {
    teardown();
    subscribedKey = key;
    unsub = onValue(
      ref(db, `rooms/${roomId}/hunterRevenge/${round}/target`),
      (snap) => {
        currentChoice = snap.val();
        renderContent(state);
      },
      () => {}
    );
  }

  renderContent(state);
}

function renderContent(state) {
  const content = document.getElementById("hunter-revenge-content");
  const btn = document.getElementById("btn-continue-after-hunter");
  const hint = document.getElementById("hunter-revenge-hint");
  const hunterUid = state.public?.hunterRevenge?.hunterUid;
  const isHunter = state.uid === hunterUid;
  const hunterName = state.players?.[hunterUid]?.name || "นายพราน";

  if (isHunter) {
    const players = Object.entries(state.players || {}).filter(([, p]) => p.alive !== false);
    const list = document.createElement("ul");
    list.className = "player-list";
    players.forEach(([uid, p]) => {
      const li = document.createElement("li");
      li.className = "vote-option";
      const b = document.createElement("button");
      b.type = "button";
      const selected = currentChoice === uid;
      b.className = `vote-btn danger${selected ? " selected danger" : ""}`;
      b.textContent = p.name;
      b.addEventListener("click", async () => {
        try {
          await set(ref(db, `rooms/${state.roomId}/hunterRevenge/${state.public.roundNumber}/target`), uid);
        } catch {
          showToast("เลือกเป้าหมายไม่สำเร็จ", true);
        }
      });
      li.appendChild(b);
      list.appendChild(li);
    });

    const skipLi = document.createElement("li");
    skipLi.className = "vote-option";
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    const skipSelected = currentChoice === "skip";
    skipBtn.className = `vote-btn${skipSelected ? " selected" : ""}`;
    skipBtn.textContent = "ไม่ยิงใคร";
    skipBtn.addEventListener("click", async () => {
      try {
        await set(ref(db, `rooms/${state.roomId}/hunterRevenge/${state.public.roundNumber}/target`), "skip");
      } catch {
        showToast("บันทึกตัวเลือกไม่สำเร็จ", true);
      }
    });
    skipLi.appendChild(skipBtn);

    content.innerHTML = "";
    content.appendChild(list);
    content.appendChild(skipLi);
  } else {
    content.innerHTML = `<p class="spectate-note">🏹 <strong>${hunterName}</strong> คือนายพราน! กำลังเลือกว่าจะยิงใครไปด้วยก่อนตาย...</p>`;
  }

  if (state.isHost) {
    btn.hidden = false;
    btn.disabled = !currentChoice;
  } else {
    btn.hidden = true;
  }
  hint.textContent = isHunter ? "คุณตายแล้ว แต่ยังเลือกยิงใครสักคนไปด้วยได้ 1 คน (หรือไม่ยิงเลยก็ได้)" : "";
}
