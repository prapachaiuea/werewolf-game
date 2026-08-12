import { ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
import { db } from "../firebase-init.js";
import { getState } from "../state.js";
import { advanceFromWerewolfNight } from "../game.js";
import { showToast } from "./components.js";

let initialized = false;
let unsub = null;
let subscribedKey = null;
let currentTarget = null;

export function init() {
  if (initialized) return;
  initialized = true;
  document.getElementById("btn-advance-werewolf-night").addEventListener("click", async (e) => {
    const { roomId } = getState();
    const btn = e.target;
    btn.disabled = true;
    try {
      await advanceFromWerewolfNight(roomId);
    } catch (err) {
      showToast(err.message === "NO_WEREWOLF_TARGET" ? "หมาป่ายังไม่ได้เลือกเป้าหมาย" : "ไปต่อไม่สำเร็จ", true);
    } finally {
      btn.disabled = false;
    }
  });
}

function teardown() {
  if (unsub) unsub();
  unsub = null;
  subscribedKey = null;
  currentTarget = null;
}

export function render(state) {
  if (state.phase !== "night-werewolf") {
    teardown();
    return;
  }

  const { roomId } = state;
  const round = state.public?.roundNumber;
  const isWerewolf = state.mySecret?.role === "werewolf";
  const key = `${roomId}:${round}`;

  if (isWerewolf && subscribedKey !== key) {
    teardown();
    subscribedKey = key;
    unsub = onValue(
      ref(db, `rooms/${roomId}/night/${round}/werewolf/target`),
      (snap) => {
        currentTarget = snap.val();
        renderContent(state);
      },
      () => {} // permission denied — expected for non-werewolves
    );
  }

  renderContent(state);
}

function renderContent(state) {
  const content = document.getElementById("night-werewolf-content");
  const btn = document.getElementById("btn-advance-werewolf-night");
  const hint = document.getElementById("night-werewolf-hint");
  const recap = document.getElementById("night-recap");
  const isAlive = state.players?.[state.uid]?.alive !== false;
  const isWerewolf = state.mySecret?.role === "werewolf";

  // Only relevant right after a day-vote (round > 1) — the very first night of a game has
  // no prior vote to recap, so leave it blank.
  const eliminatedUid = state.public?.lastVote?.eliminatedUid;
  const hunterRevengeUid = state.public?.lastVote?.hunterRevengeUid;
  if (eliminatedUid) {
    const name = state.players?.[eliminatedUid]?.name || "ผู้เล่นคนหนึ่ง";
    let text = `เมื่อวานหมู่บ้านโหวตกำจัด ${name} ออกจากหมู่บ้าน`;
    if (hunterRevengeUid) {
      const revengeName = state.players?.[hunterRevengeUid]?.name || "ผู้เล่นคนหนึ่ง";
      text += ` (เผยว่าเป็นนายพราน และยิง ${revengeName} ตายไปด้วย! 🏹)`;
    }
    recap.textContent = text;
  } else {
    recap.textContent = "";
  }

  if (!isAlive) {
    content.innerHTML = `<p class="spectate-note">คุณถูกกำจัดไปแล้ว — เฝ้าดูเกมต่อได้เงียบ ๆ</p>`;
  } else if (isWerewolf) {
    const players = Object.entries(state.players || {}).filter(
      ([uid, p]) => uid !== state.uid && p.alive !== false
    );
    const list = document.createElement("ul");
    list.className = "player-list";
    players.forEach(([uid, p]) => {
      const li = document.createElement("li");
      li.className = "vote-option";
      const b = document.createElement("button");
      b.type = "button";
      const selected = currentTarget === uid;
      b.className = `vote-btn danger${selected ? " selected danger" : ""}`;
      b.textContent = p.name;
      b.addEventListener("click", async () => {
        try {
          await set(ref(db, `rooms/${state.roomId}/night/${state.public.roundNumber}/werewolf/target`), uid);
        } catch {
          showToast("เลือกเหยื่อไม่สำเร็จ", true);
        }
      });
      li.appendChild(b);
      list.appendChild(li);
    });
    content.innerHTML = "";
    content.appendChild(list);
  } else {
    content.innerHTML = `<p class="spectate-note">🌙 หมาป่ากำลังเลือกเหยื่อ... หลับตาไว้</p>`;
  }

  if (isWerewolf && isAlive) {
    btn.hidden = false;
    btn.textContent = "ยืนยันและไปต่อ";
    btn.disabled = !currentTarget;
  } else {
    btn.hidden = true;
  }
  hint.textContent = isWerewolf && isAlive
    ? "แตะชื่อผู้เล่นที่จะเลือกเป็นเหยื่อคืนนี้ แล้วกดยืนยันเมื่อพร้อม"
    : "";
}
