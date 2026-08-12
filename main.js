import { initAuth } from "./js/auth.js";
import { getState, setState, subscribe } from "./js/state.js";
import { createRoom, joinRoom, leaveRoom, getRoomIdFromUrl, clearRoomFromUrl } from "./js/room.js";
import { renderRoute } from "./js/router.js";
import { watchServerOffset, serverNow } from "./js/utils/timer.js";
import { getLastName, getLastRoom, clearLastRoom } from "./js/utils/storage.js";
import { showToast } from "./js/ui/components.js";
import { unlockAudio, updateForState, isMuted, setMuted, playClick } from "./js/audio.js";
import { watchForAutoResolve } from "./js/host-engine.js";

import * as lobbyView from "./js/ui/lobby-view.js";
import * as roleRevealView from "./js/ui/role-reveal-view.js";
import * as nightWerewolfView from "./js/ui/night-werewolf-view.js";
import * as nightSeerView from "./js/ui/night-seer-view.js";
import * as nightDoctorView from "./js/ui/night-doctor-view.js";
import * as hunterRevengeView from "./js/ui/hunter-revenge-view.js";
import * as dayView from "./js/ui/day-view.js";
import * as dayVoteView from "./js/ui/day-vote-view.js";
import * as gameOverView from "./js/ui/game-over-view.js";

const views = [
  lobbyView,
  roleRevealView,
  nightWerewolfView,
  nightSeerView,
  nightDoctorView,
  hunterRevengeView,
  dayView,
  dayVoteView,
  gameOverView,
];

async function boot() {
  // Wire up the UI immediately so the landing page renders even if Firebase
  // isn't reachable yet (e.g. firebase-config.js still has placeholder values) —
  // only room creation/joining actually needs a signed-in uid.
  views.forEach((v) => v.init());
  subscribe((state) => {
    renderRoute(state);
    views.forEach((v) => v.render(state));
    updateForState(state, { serverNow });
    watchForAutoResolve(state);
  });
  setupLandingForm();
  setupMusicToggle();
  setupClickSfx();
  document.getElementById("btn-leave-room").addEventListener("click", async () => {
    try {
      await leaveRoom();
    } catch {
      showToast("ออกจากห้องไม่สำเร็จ — เช็กการเชื่อมต่อ", true);
    }
  });
  renderRoute(getState());
  views.forEach((v) => v.render(getState()));

  watchServerOffset();

  try {
    const uid = await initAuth();
    setState({ uid });
    await prefillLanding();
  } catch (err) {
    console.error(err);
    showToast("เชื่อมต่อ Firebase ไม่สำเร็จ — เช็ก firebase-config.js", true);
  }
}

// Resets the landing form to a clean "Create Room" state — used whenever a stale room
// reference (dead link, finished game) needs to stop pinning the UI in "Join Room" mode.
function resetLandingToCreateMode() {
  clearLastRoom();
  clearRoomFromUrl();
  document.getElementById("btn-primary-action").textContent = "สร้างห้อง";
  document.getElementById("landing-join-row").hidden = true;
  document.getElementById("landing-join-alt").hidden = false;
  document.getElementById("input-room-code").value = "";
}

async function prefillLanding() {
  const roomFromUrl = getRoomIdFromUrl();
  const savedRoom = getLastRoom();
  const lastName = getLastName();

  if (lastName) {
    document.getElementById("input-name").value = lastName;
  }

  // Case 1: the URL itself already carries a room code (a share link, or a refresh of a page
  // that had ?room= set). Reflect Join-Room mode immediately, and if it matches the room we
  // were last known to be in, attempt a silent rejoin — this is the normal "network dropped,
  // page reloaded" reconnect path.
  if (roomFromUrl) {
    document.getElementById("btn-primary-action").textContent = "เข้าร่วมห้อง";
    document.getElementById("landing-join-row").hidden = false;
    document.getElementById("landing-room-code").textContent = roomFromUrl;
    document.getElementById("landing-join-alt").hidden = true;

    if (savedRoom === roomFromUrl && lastName) {
      try {
        await joinRoom(roomFromUrl, lastName);
      } catch {
        // Room may no longer exist (expired/finished) — reset to a clean form instead of
        // leaving the UI stuck pointed at a dead room code.
        resetLandingToCreateMode();
      }
    }
    return;
  }

  // Case 2: no room in the URL at all, but this browser remembers being in one — e.g. the tab
  // was closed (or the app backgrounded and killed) mid-game instead of using Leave Room, then
  // reopened via a plain bookmark/new tab with no ?room= param. Try a silent rejoin using ONLY
  // the remembered room, and NEVER mutate the URL/UI until that attempt has actually succeeded
  // — a dead saved room here leaves no visible trace at all if it fails, so there's nothing to
  // get stuck in.
  if (savedRoom && lastName) {
    try {
      await joinRoom(savedRoom, lastName);
    } catch {
      clearLastRoom();
    }
  }
}

// One delegated listener covers every button in the app — including ones views build later
// via render() — with a soft click tick. Keeps every future button "just working" without
// having to remember to instrument each new handler individually.
function setupClickSfx() {
  document.addEventListener("click", (e) => {
    const control = e.target.closest("button");
    if (!control || control.disabled) return;
    unlockAudio();
    playClick();
  });
}

// Reflects the persisted mute preference on the header button and wires its toggle.
// unlockAudio() lives here rather than in this handler because it must fire from the very
// first user gesture on the page — the landing form's submit/join clicks are that gesture.
function setupMusicToggle() {
  const btn = document.getElementById("btn-mute-music");
  function render() {
    const muted = isMuted();
    btn.textContent = muted ? "🔇" : "🔊";
    btn.setAttribute("aria-pressed", String(muted));
  }
  btn.addEventListener("click", () => {
    unlockAudio();
    setMuted(!isMuted());
    render();
  });
  render();
}

function setupLandingForm() {
  const form = document.getElementById("form-landing");
  const btnJoinAlt = document.getElementById("btn-join-room");
  const errorEl = document.getElementById("landing-error");

  form.addEventListener("submit", async (e) => {
    unlockAudio();
    e.preventDefault();
    const name = document.getElementById("input-name").value.trim();
    if (!name) return;
    errorEl.hidden = true;
    const roomFromUrl = getRoomIdFromUrl();
    try {
      if (roomFromUrl) {
        await joinRoom(roomFromUrl, name);
      } else {
        await createRoom(name);
      }
    } catch (err) {
      showError(err);
      // A dead room reached via ?room= (an old share link, a finished game) has no other way
      // back to "Create Room" — the alt-join section is hidden whenever this mode is active —
      // so clear it and hand the user back a working form instead of leaving them stuck.
      if (roomFromUrl && err.message === "ROOM_NOT_FOUND") {
        resetLandingToCreateMode();
      }
    }
  });

  btnJoinAlt.addEventListener("click", async () => {
    unlockAudio();
    const name = document.getElementById("input-name").value.trim();
    const code = document.getElementById("input-room-code").value.trim().toUpperCase();
    if (!name || !code) return;
    errorEl.hidden = true;
    try {
      await joinRoom(code, name);
    } catch (err) {
      showError(err);
    }
  });

  function showError(err) {
    const messages = {
      ROOM_NOT_FOUND: "ไม่พบรหัสห้องนี้",
      ROOM_IN_PROGRESS: "เกมนี้เริ่มไปแล้ว — รอให้จบก่อน",
      COULD_NOT_CREATE_ROOM: "สร้างห้องไม่สำเร็จ ลองใหม่อีกครั้ง",
    };
    errorEl.textContent = messages[err.message] || "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
    errorEl.hidden = false;
  }
}

boot().catch((err) => {
  console.error(err);
  showToast("เชื่อมต่อไม่สำเร็จ — เช็ก firebase-config.js และการเชื่อมต่อของคุณ", true);
});
