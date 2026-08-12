import { getState } from "../state.js";
import { startRound, backToLobby, triggerRestartCountdown } from "../game.js";
import { serverNow } from "../utils/timer.js";
import { showToast } from "./components.js";

let initialized = false;
let restartIntervalId = null;
let restartTriggered = false;

const ROLE_LABEL = {
  werewolf: "หมาป่า 🐺",
  seer: "หมอดู 🔮",
  doctor: "หมอ 💊",
  hunter: "นายพราน 🏹",
  villager: "ชาวบ้าน 👤",
};

export function init() {
  if (initialized) return;
  initialized = true;
  document.getElementById("btn-play-again").addEventListener("click", async (e) => {
    const { roomId } = getState();
    const btn = e.target;
    btn.disabled = true;
    try {
      // Broadcasts a shared countdown (same full-screen overlay used before the day timer)
      // instead of a host-only button-text countdown — everyone gets a beat to look up from
      // the results screen, not just the host.
      await triggerRestartCountdown(roomId);
    } catch {
      showToast("เริ่มเกมใหม่ไม่สำเร็จ — เช็กการเชื่อมต่อ", true);
      btn.disabled = false;
    }
  });
  document.getElementById("btn-back-to-lobby").addEventListener("click", async () => {
    const { roomId } = getState();
    await backToLobby(roomId);
  });
}

function restartTick() {
  const state = getState();
  const overlay = document.getElementById("preround-overlay");
  const overlayNumber = document.getElementById("preround-number");
  const restartAt = state.public?.restartAt;

  if (!restartAt) {
    overlay.hidden = true;
    return;
  }

  const msRemaining = restartAt - serverNow();
  if (msRemaining > 0) {
    overlay.hidden = false;
    overlayNumber.textContent = Math.ceil(msRemaining / 1000);
    return;
  }
  overlay.hidden = true;

  if (state.isHost && !restartTriggered) {
    restartTriggered = true;
    startRound(state.roomId).catch(() => {
      showToast("เริ่มเกมใหม่ไม่สำเร็จ — เช็กการเชื่อมต่อ", true);
    });
  }
}

export function render(state) {
  if (state.phase !== "game-over") {
    if (restartIntervalId) {
      clearInterval(restartIntervalId);
      restartIntervalId = null;
    }
    restartTriggered = false;
    document.getElementById("preround-overlay").hidden = true;
    return;
  }

  if (!restartIntervalId) {
    restartTriggered = false;
    restartIntervalId = setInterval(() => restartTick(), 250);
    restartTick();
  }

  const banner = document.getElementById("results-banner");
  const rolesList = document.getElementById("results-roles");
  const btnPlayAgain = document.getElementById("btn-play-again");
  const btnBackToLobby = document.getElementById("btn-back-to-lobby");

  const winner = state.public?.gameOver?.winner;
  banner.textContent = winner === "villagers" ? "หมู่บ้านชนะ! 🎉" : "หมาป่าชนะ! 🐺";
  banner.className = `results-banner ${winner === "villagers" ? "win" : "lose"}`;

  rolesList.innerHTML = "";
  const roles = state.revealRoles || {};
  Object.entries(state.players || {}).forEach(([uid, p]) => {
    const role = roles[uid];
    const li = document.createElement("li");
    li.className = `player-chip player-chip-with-avatar${role === "werewolf" ? " is-werewolf" : ""}${p.alive === false ? " is-dead" : ""}`;

    if (role) {
      const avatar = document.createElement("img");
      avatar.className = "role-avatar";
      avatar.src = `assets/roles/role-${role}.jpg`;
      avatar.alt = "";
      li.appendChild(avatar);
    }

    const label = ROLE_LABEL[role] || "?";
    const text = document.createElement("span");
    text.textContent = `${p.name}${uid === state.uid ? " (คุณ)" : ""} — ${label}${p.alive === false ? " · เสียชีวิต" : ""}`;
    li.appendChild(text);

    rolesList.appendChild(li);
  });

  if (state.isHost) {
    btnPlayAgain.hidden = false;
    btnPlayAgain.disabled = Boolean(state.public?.restartAt);
    btnBackToLobby.hidden = false;
  } else {
    btnPlayAgain.hidden = true;
    btnBackToLobby.hidden = true;
  }
}
