// The last step of every night still needs someone who can see every player's role — combining
// the werewolves' kill with the doctor's save, and checking the win condition, is impossible to
// do without that (see README "Known limitation: host trust"). Rather than making the host tap
// a button to trigger it, this module watches reactively and runs it automatically the instant
// the last night role finishes their turn, so the host's own device never needs to be touched.
//
// This runs on every player's client (called from main.js's central state subscription like
// everything else), but arms an actual Firebase listener only when `state.isHost` — on every
// other device it's a cheap no-op check.
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
import { db } from "./firebase-init.js";
import { resolveNightAndGoToDay } from "./game.js";

let watchedKey = null;
let unsub = null;
let resolving = false;

function teardown() {
  if (unsub) unsub();
  unsub = null;
  watchedKey = null;
}

function armWatcher(roomId, round, path) {
  const key = `${roomId}:${round}:${path}`;
  if (watchedKey === key) return; // already watching the right thing
  teardown();
  watchedKey = key;
  unsub = onValue(ref(db, `rooms/${roomId}/night/${round}/${path}`), (snap) => {
    if (snap.exists()) attemptResolve(roomId);
  });
}

async function attemptResolve(roomId) {
  if (resolving) return;
  resolving = true;
  try {
    await resolveNightAndGoToDay(roomId);
  } catch {
    // Phase already moved on (another snapshot already triggered this) — harmless no-op.
  } finally {
    resolving = false;
  }
}

export function watchForAutoResolve(state) {
  if (!state.isHost || !state.roomId || !state.public?.roundNumber) {
    teardown();
    return;
  }

  const round = state.public.roundNumber;
  const phase = state.phase;
  const hasDoctor = Boolean(state.public.roles?.doctor);

  if (phase === "night-doctor") {
    armWatcher(state.roomId, round, "doctorSave");
  } else if (phase === "night-seer" && !hasDoctor) {
    armWatcher(state.roomId, round, "seerResult");
  } else {
    teardown();
  }
}
