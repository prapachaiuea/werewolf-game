import { getState } from "../state.js";
import { startRound, setDayDuration, MIN_PLAYERS, MAX_PLAYERS, DAY_DURATION_MS } from "../game.js";
import { showToast } from "./components.js";

let initialized = false;

export function init() {
  if (initialized) return;
  initialized = true;

  const btnStart = document.getElementById("btn-start-game");
  const btnCopy = document.getElementById("btn-copy-link");
  const selectDuration = document.getElementById("select-day-duration");

  btnStart.addEventListener("click", async () => {
    const { roomId } = getState();
    btnStart.disabled = true;
    try {
      await startRound(roomId);
    } catch (err) {
      const messages = {
        NOT_ENOUGH_PLAYERS: `ต้องมีผู้เล่นอย่างน้อย ${MIN_PLAYERS} คนถึงจะเริ่มได้`,
        TOO_MANY_PLAYERS: `ห้องนึงเล่นได้สูงสุด ${MAX_PLAYERS} คน`,
      };
      showToast(messages[err.message] || "เริ่มเกมไม่สำเร็จ", true);
    } finally {
      btnStart.disabled = false;
    }
  });

  btnCopy.addEventListener("click", async () => {
    const shareLink = document.getElementById("share-link");
    try {
      await navigator.clipboard.writeText(shareLink.value);
      showToast("คัดลอกลิงก์แล้ว!");
    } catch {
      shareLink.select();
      showToast("เลือกแล้วคัดลอกลิงก์ได้เลย");
    }
  });

  selectDuration.addEventListener("change", async () => {
    const { roomId, isHost } = getState();
    if (!isHost) return;
    try {
      await setDayDuration(roomId, Number(selectDuration.value));
    } catch {
      showToast("แก้เวลาพูดคุยไม่สำเร็จ", true);
    }
  });
}

export function render(state) {
  if (!state.roomId) return;

  const shareLink = document.getElementById("share-link");
  shareLink.value = `${window.location.origin}${window.location.pathname}?room=${state.roomId}`;

  const playerList = document.getElementById("player-list");
  const players = Object.entries(state.players || {});
  playerList.innerHTML = "";
  players.forEach(([uid, p]) => {
    const li = document.createElement("li");
    li.className = `player-chip${p.online === false ? " offline" : ""}`;
    const tags = [uid === state.public?.host ? "หัวห้อง" : null, uid === state.uid ? "คุณ" : null]
      .filter(Boolean)
      .join(", ");
    li.textContent = tags ? `${p.name} (${tags})` : p.name;
    playerList.appendChild(li);
  });

  const selectDuration = document.getElementById("select-day-duration");
  selectDuration.value = String(state.public?.dayDurationMs || DAY_DURATION_MS);
  selectDuration.disabled = !state.isHost;

  const btnStart = document.getElementById("btn-start-game");
  const hint = document.getElementById("lobby-hint");
  const count = players.length;

  if (state.isHost) {
    btnStart.hidden = false;
    if (count < MIN_PLAYERS) {
      btnStart.disabled = true;
      hint.textContent = `รอผู้เล่นอีก... (${count}/${MIN_PLAYERS} คนขั้นต่ำ)`;
    } else if (count > MAX_PLAYERS) {
      btnStart.disabled = true;
      hint.textContent = `ผู้เล่นเยอะเกินไป — สูงสุด ${MAX_PLAYERS} คน`;
    } else {
      btnStart.disabled = false;
      hint.textContent = `พร้อมแล้ว! มีผู้เล่น ${count} คนในห้อง`;
    }
  } else {
    btnStart.hidden = true;
    hint.textContent = "รอหัวห้องเริ่มเกม...";
  }
}
