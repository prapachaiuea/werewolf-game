import { ref, set, onValue } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
import { db } from "../firebase-init.js";
import { getState } from "../state.js";
import { resolveSeerCheck, continueAfterSeerNight } from "../game.js";
import { showToast } from "./components.js";

let initialized = false;
let unsubTarget = null;
let unsubResult = null;
let subscribedKey = null;
let currentTarget = null;
let currentResult = null;
// Local-only: has the seer already clicked "ไปต่อ" on this result? In games with no Doctor,
// that click is what tells host-engine.js it's safe to resolve the night — without this gate,
// the moment resolveSeerCheck() writes seerResult, the host's background watcher could react
// and jump straight to morning before the seer's own screen even finishes showing them the
// verdict. Requiring an explicit "ไปต่อ" (which also exists, unchanged, for the has-Doctor
// case) guarantees the seer always gets a beat to actually read their result first.
let seerConfirmedDone = false;

export function init() {
  if (initialized) return;
  initialized = true;

  document.getElementById("btn-reveal-seer-check").addEventListener("click", async (e) => {
    const { roomId } = getState();
    const btn = e.target;
    btn.disabled = true;
    try {
      await resolveSeerCheck(roomId);
    } catch (err) {
      showToast(err.message === "NO_SEER_TARGET" ? "หมอดูยังไม่ได้เลือกเป้าหมาย" : "เปิดผลตรวจไม่สำเร็จ", true);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById("btn-continue-after-seer").addEventListener("click", async (e) => {
    const { roomId } = getState();
    const btn = e.target;
    btn.disabled = true;
    try {
      await continueAfterSeerNight(roomId);
      seerConfirmedDone = true;
    } catch {
      showToast("ไปต่อไม่สำเร็จ", true);
    } finally {
      btn.disabled = false;
    }
  });
}

function teardown() {
  if (unsubTarget) unsubTarget();
  if (unsubResult) unsubResult();
  unsubTarget = null;
  unsubResult = null;
  subscribedKey = null;
  currentTarget = null;
  currentResult = null;
  seerConfirmedDone = false;
}

export function render(state) {
  if (state.phase !== "night-seer") {
    teardown();
    return;
  }

  const { roomId } = state;
  const round = state.public?.roundNumber;
  const isSeer = state.mySecret?.role === "seer";
  const key = `${roomId}:${round}`;

  if (isSeer && subscribedKey !== key) {
    teardown();
    subscribedKey = key;
    const ignoreDenied = () => {};
    unsubTarget = onValue(ref(db, `rooms/${roomId}/night/${round}/seerTarget`), (snap) => {
      currentTarget = snap.val();
      renderContent(state);
    }, ignoreDenied);
    unsubResult = onValue(ref(db, `rooms/${roomId}/night/${round}/seerResult`), (snap) => {
      currentResult = snap.val();
      renderContent(state);
    }, ignoreDenied);
  }

  renderContent(state);
}

function renderContent(state) {
  const content = document.getElementById("night-seer-content");
  const btnReveal = document.getElementById("btn-reveal-seer-check");
  const btnContinue = document.getElementById("btn-continue-after-seer");
  const hint = document.getElementById("night-seer-hint");
  const isAlive = state.players?.[state.uid]?.alive !== false;
  const isSeer = state.mySecret?.role === "seer";

  if (!isAlive) {
    content.innerHTML = `<p class="spectate-note">คุณถูกกำจัดไปแล้ว — เฝ้าดูเกมต่อได้เงียบ ๆ</p>`;
  } else if (isSeer && currentResult && seerConfirmedDone) {
    content.innerHTML = `<p class="spectate-note">รอสักครู่...</p>`;
  } else if (isSeer && currentResult) {
    const targetName = state.players?.[currentResult.targetUid]?.name || "ผู้เล่น";
    const verdict = currentResult.isWerewolf ? "เป็นหมาป่า 🐺" : "ไม่ใช่หมาป่า";
    content.innerHTML = `<p class="spectate-note"><strong>${targetName}</strong> ${verdict}</p>`;
  } else if (isSeer) {
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
      b.className = `vote-btn${selected ? " selected" : ""}`;
      b.textContent = p.name;
      b.addEventListener("click", async () => {
        try {
          await set(ref(db, `rooms/${state.roomId}/night/${state.public.roundNumber}/seerTarget`), uid);
        } catch {
          showToast("เลือกเป้าหมายไม่สำเร็จ", true);
        }
      });
      li.appendChild(b);
      list.appendChild(li);
    });
    content.innerHTML = "";
    content.appendChild(list);
  } else {
    content.innerHTML = `<p class="spectate-note">🔮 หมอดูกำลังตรวจสอบ...</p>`;
  }

  if (isSeer && isAlive) {
    if (!currentResult) {
      btnReveal.hidden = false;
      btnReveal.disabled = !currentTarget;
      btnContinue.hidden = true;
    } else if (!seerConfirmedDone) {
      // Shown for both the has-Doctor and no-Doctor case now — either way this is the seer's
      // own deliberate "I've read it, move on" action, not something that fires on its own.
      btnReveal.hidden = true;
      btnContinue.hidden = false;
    } else {
      btnReveal.hidden = true;
      btnContinue.hidden = true;
    }
  } else {
    btnReveal.hidden = true;
    btnContinue.hidden = true;
  }
  hint.textContent = isSeer && isAlive && !currentResult ? "แตะชื่อผู้เล่นที่จะตรวจสอบคืนนี้" : "";
}
