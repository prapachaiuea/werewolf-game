import { ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
import { db } from "../firebase-init.js";
import { getState } from "../state.js";
import { showToast } from "./components.js";

let initialized = false;
let unsub = null;
let subscribedKey = null;
let currentSave = null; // the confirmed value written to Firebase (null until confirmed)
let pendingChoice = null; // local-only preview pick, not written until "ยืนยัน" is pressed

export function init() {
  if (initialized) return;
  initialized = true;
  document.getElementById("btn-doctor-confirm").addEventListener("click", async (e) => {
    if (!pendingChoice) return;
    const { roomId, public: pub } = getState();
    const btn = e.target;
    btn.disabled = true;
    try {
      // Writing doctorSave is itself the trigger the host's background watcher is listening
      // for (host-engine.js) — there's no separate "advance" step for the doctor to press.
      // That's exactly why this is a deliberate two-step pick-then-confirm flow instead of
      // writing on every tap like the werewolf/seer lists do: an accidental early tap here
      // would resolve the whole night before the doctor finished deciding.
      await set(ref(db, `rooms/${roomId}/night/${pub.roundNumber}/doctorSave`), pendingChoice);
    } catch {
      showToast("ยืนยันไม่สำเร็จ — เช็กการเชื่อมต่อ", true);
      btn.disabled = false;
    }
  });
}

function teardown() {
  if (unsub) unsub();
  unsub = null;
  subscribedKey = null;
  currentSave = null;
  pendingChoice = null;
}

export function render(state) {
  if (state.phase !== "night-doctor") {
    teardown();
    return;
  }

  const { roomId } = state;
  const round = state.public?.roundNumber;
  const isDoctor = state.mySecret?.role === "doctor";
  const key = `${roomId}:${round}`;

  if (isDoctor && subscribedKey !== key) {
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
  const btn = document.getElementById("btn-doctor-confirm");
  const hint = document.getElementById("night-doctor-hint");
  const isAlive = state.players?.[state.uid]?.alive !== false;
  const isDoctor = state.mySecret?.role === "doctor";

  if (!isAlive) {
    content.innerHTML = `<p class="spectate-note">คุณถูกกำจัดไปแล้ว — เฝ้าดูเกมต่อได้เงียบ ๆ</p>`;
    btn.hidden = true;
  } else if (isDoctor && currentSave) {
    // Already confirmed and sent — the host's background watcher will move things along on
    // its own, nothing left to do here but wait.
    const name = state.players?.[currentSave]?.name || "ผู้เล่นคนหนึ่ง";
    content.innerHTML = `<p class="spectate-note">คุณปกป้อง <strong>${name}</strong> ไว้แล้ว รอสักครู่...</p>`;
    btn.hidden = true;
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
      const selected = pendingChoice === uid;
      b.className = `vote-btn${selected ? " selected" : ""}`;
      b.textContent = p.name + (uid === state.uid ? " (คุณ)" : "");
      b.addEventListener("click", () => {
        pendingChoice = uid;
        renderContent(state);
      });
      li.appendChild(b);
      list.appendChild(li);
    });
    content.innerHTML = "";
    content.appendChild(list);

    btn.hidden = false;
    btn.disabled = !pendingChoice;
  } else {
    content.innerHTML = `<p class="spectate-note">💊 หมอกำลังเลือกคนที่จะปกป้อง...</p>`;
    btn.hidden = true;
  }

  hint.textContent = isDoctor && isAlive && !currentSave
    ? "แตะชื่อผู้เล่นที่จะปกป้องคืนนี้ (เลือกตัวเองได้) แล้วกดยืนยันเมื่อพร้อม"
    : "";
}
