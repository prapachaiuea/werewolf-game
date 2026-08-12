import { ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
import { db } from "../firebase-init.js";
import { getState } from "../state.js";
import { advanceFromDoctorNight } from "../game.js";
import { showToast } from "./components.js";

let initialized = false;
let unsub = null;
let subscribedKey = null;
let currentSave = null;

export function init() {
  if (initialized) return;
  initialized = true;
  document.getElementById("btn-advance-doctor-night").addEventListener("click", async (e) => {
    const { roomId } = getState();
    const btn = e.target;
    btn.disabled = true;
    try {
      await advanceFromDoctorNight(roomId);
    } catch (err) {
      showToast(err.message === "NO_DOCTOR_SAVE" ? "หมอยังไม่ได้เลือกคนที่จะปกป้อง" : "ไปต่อไม่สำเร็จ", true);
    } finally {
      btn.disabled = false;
    }
  });
}

function teardown() {
  if (unsub) unsub();
  unsub = null;
  subscribedKey = null;
  currentSave = null;
}

export function render(state) {
  if (state.phase !== "night-doctor") {
    teardown();
    return;
  }

  const { roomId } = state;
  const round = state.public?.roundNumber;
  const isDoctor = state.mySecret?.role === "doctor";
  const canSee = isDoctor || state.isHost;
  const key = `${roomId}:${round}`;

  if (canSee && subscribedKey !== key) {
    teardown();
    subscribedKey = key;
    unsub = onValue(
      ref(db, `rooms/${roomId}/night/${round}/doctorSave`),
      (snap) => {
        currentSave = snap.val();
        renderContent(state);
      },
      () => {}
    );
  }

  renderContent(state);
}

function renderContent(state) {
  const content = document.getElementById("night-doctor-content");
  const btn = document.getElementById("btn-advance-doctor-night");
  const hint = document.getElementById("night-doctor-hint");
  const isAlive = state.players?.[state.uid]?.alive !== false;
  const isDoctor = state.mySecret?.role === "doctor";

  if (!isAlive) {
    content.innerHTML = `<p class="spectate-note">คุณถูกกำจัดไปแล้ว — เฝ้าดูเกมต่อได้เงียบ ๆ</p>`;
  } else if (isDoctor) {
    // The doctor may protect themselves too, so — unlike the werewolf/seer target lists —
    // this one is not filtered to exclude the doctor's own uid.
    const players = Object.entries(state.players || {}).filter(([, p]) => p.alive !== false);
    const list = document.createElement("ul");
    list.className = "player-list";
    players.forEach(([uid, p]) => {
      const li = document.createElement("li");
      li.className = "vote-option";
      const b = document.createElement("button");
      b.type = "button";
      const selected = currentSave === uid;
      b.className = `vote-btn${selected ? " selected" : ""}`;
      b.textContent = p.name + (uid === state.uid ? " (คุณ)" : "");
      b.addEventListener("click", async () => {
        try {
          await set(ref(db, `rooms/${state.roomId}/night/${state.public.roundNumber}/doctorSave`), uid);
        } catch {
          showToast("เลือกคนที่จะปกป้องไม่สำเร็จ", true);
        }
      });
      li.appendChild(b);
      list.appendChild(li);
    });
    content.innerHTML = "";
    content.appendChild(list);
  } else {
    content.innerHTML = `<p class="spectate-note">💊 หมอกำลังเลือกคนที่จะปกป้อง...</p>`;
  }

  if (state.isHost) {
    btn.hidden = false;
    btn.textContent = currentSave ? "ไปยังกลางวัน" : "รอหมอเลือกคนที่จะปกป้อง...";
    btn.disabled = !currentSave;
  } else {
    btn.hidden = true;
  }
  hint.textContent = isDoctor && isAlive ? "แตะชื่อผู้เล่นที่จะปกป้องคืนนี้ (เลือกตัวเองได้)" : "";
}
