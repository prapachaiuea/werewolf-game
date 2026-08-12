import { getState } from "../state.js";
import { advanceToVote } from "../game.js";
import { serverNow, formatCountdown } from "../utils/timer.js";
import { showToast } from "./components.js";

let initialized = false;
let intervalId = null;
let timeoutTriggered = false;

export function init() {
  if (initialized) return;
  initialized = true;
  document.getElementById("btn-go-to-vote").addEventListener("click", async () => {
    const { roomId } = getState();
    try {
      await advanceToVote(roomId);
    } catch {
      showToast("เริ่มโหวตไม่สำเร็จ", true);
    }
  });
}

export function render(state) {
  if (state.phase !== "day") {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    timeoutTriggered = false;
    document.getElementById("preround-overlay").hidden = true;
    return;
  }

  const recap = document.getElementById("day-recap");
  const killedUid = state.public?.lastNight?.killedUid;
  const hunterRevengeUid = state.public?.lastNight?.hunterRevengeUid;
  let text;
  if (killedUid) {
    const name = state.players?.[killedUid]?.name || "ผู้เล่นคนหนึ่ง";
    text = `เมื่อคืน ${name} ถูกหมาป่าฆ่า 🩸`;
  } else {
    text = "เมื่อคืนไม่มีใครตาย — หมอช่วยไว้ทัน หรือหมาป่ายังไม่ได้ตัดสินใจ";
  }
  if (hunterRevengeUid) {
    const revengeName = state.players?.[hunterRevengeUid]?.name || "ผู้เล่นคนหนึ่ง";
    text += ` (เผยว่าเป็นนายพราน และยิง ${revengeName} ตายไปด้วย! 🏹)`;
  }
  recap.textContent = text;

  const btn = document.getElementById("btn-go-to-vote");
  btn.hidden = !state.isHost;

  if (!intervalId) {
    timeoutTriggered = false;
    intervalId = setInterval(() => tick(), 250);
    tick();
  }
}

function tick() {
  const state = getState();
  const timer = state.public?.timer;
  const countdownEl = document.getElementById("countdown");
  const overlay = document.getElementById("preround-overlay");
  const overlayNumber = document.getElementById("preround-number");

  if (!timer) {
    countdownEl.textContent = "--:--";
    overlay.hidden = true;
    return;
  }

  // Lead-in: every client shows the same big full-screen number before the real
  // countdown starts, counting down from the shared startAt timestamp.
  const msUntilStart = timer.startAt - serverNow();
  if (msUntilStart > 0) {
    overlay.hidden = false;
    overlayNumber.textContent = Math.ceil(msUntilStart / 1000);
    countdownEl.textContent = formatCountdown(timer.durationMs);
    return;
  }
  overlay.hidden = true;

  const remaining = timer.startAt + timer.durationMs - serverNow();
  countdownEl.textContent = formatCountdown(remaining);

  if (remaining <= 0 && !timeoutTriggered) {
    timeoutTriggered = true;
    advanceToVote(state.roomId).catch(() => {
      // Another client may have already flipped the phase — harmless.
    });
  }
}
