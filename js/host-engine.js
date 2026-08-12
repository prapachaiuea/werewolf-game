// The last step of every night still needs someone who can see every player's role — combining
// the werewolves' kill with the doctor's save, and checking the win condition, is impossible to
// do without that (see README "Known limitation: host trust"). Rather than making the host tap
// a button to trigger it, this module watches reactively and runs it automatically the instant
// the last night role finishes their turn, so the host's own device never needs to be touched.
//
// It also solves a related problem: if the Seer or Doctor died on an earlier night or day-vote,
// nobody is left who's allowed to act (or even to advance) during their phase on a later night —
// the only client with permission for that phase's action is dead. Regular players can't check
// "is the Seer alive" themselves without knowing who the Seer even is, which would leak their
// role — so this, too, has to be the host's job.
//
// This runs on every player's client (called from main.js's central state subscription like
// everything else), but only ever does real work when `state.isHost` — on every other device
// it's a cheap no-op check.
import { ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
import { db } from "./firebase-init.js";
import { resolveNightAndGoToDay, readRolesMap } from "./game.js";

let watchedKey = null;
let unsub = null;
let resolving = false;
let checkedDeathKey = null; // have we already checked this exact phase-instance for a dead actor?

function teardownWatcher() {
  if (unsub) unsub();
  unsub = null;
  watchedKey = null;
}

function armWatcher(roomId, round, path) {
  const key = `${roomId}:${round}:${path}`;
  if (watchedKey === key) return; // already watching the right thing
  teardownWatcher();
  watchedKey = key;
  unsub = onValue(
    ref(db, `rooms/${roomId}/night/${round}/${path}`),
    (snap) => {
      console.log("[host-engine] watcher fired for", path, "exists:", snap.exists(), snap.val());
      if (snap.exists()) attemptResolve(roomId);
    },
    (err) => {
      console.log("[host-engine] watcher on", path, "was denied/errored:", err.message);
    }
  );
}

async function attemptResolve(roomId) {
  if (resolving) {
    console.log("[host-engine] attemptResolve called while already resolving — ignored");
    return;
  }
  resolving = true;
  console.log("[host-engine] resolving night now...");
  try {
    await resolveNightAndGoToDay(roomId);
    console.log("[host-engine] resolveNightAndGoToDay succeeded");
  } catch (err) {
    // Phase already moved on (another snapshot already triggered this) — harmless no-op.
    console.log("[host-engine] resolveNightAndGoToDay threw (often harmless — already resolved):", err.message);
  } finally {
    resolving = false;
  }
}

// Skips straight past a phase whose role-holder is dead — for the Doctor (always the last
// night phase, when present) that just means resolving now, with no doctorSave; for the Seer
// it means either handing off to the Doctor (if this game has one) or resolving now.
async function skipDeadPhase(roomId, isSeerPhase, hasDoctor) {
  if (resolving) return;
  resolving = true;
  try {
    if (isSeerPhase && hasDoctor) {
      await update(ref(db, `rooms/${roomId}/public`), { phase: "night-doctor" });
    } else {
      await resolveNightAndGoToDay(roomId);
    }
  } catch {
    // Already handled by another trigger — harmless no-op.
  } finally {
    resolving = false;
  }
}

async function findRoleHolder(roomId, uids, roleName) {
  const roles = await readRolesMap(roomId, uids);
  return uids.find((uid) => roles[uid] === roleName) || null;
}

// Temporary, deliberately noisy diagnostic trail — this module has caused more than one
// silent stuck-game report that was impossible to diagnose after the fact. Only the host's
// own browser ever prints these (this whole module is a no-op on every other device).
function log(...args) {
  console.log("[host-engine]", ...args);
}

export function watchForAutoResolve(state) {
  if (!state.isHost || !state.roomId || !state.public?.roundNumber) {
    teardownWatcher();
    checkedDeathKey = null;
    return;
  }

  const { roomId, players } = state;
  const round = state.public.roundNumber;
  const phase = state.phase;
  const hasDoctor = Boolean(state.public.roles?.doctor);
  const uids = Object.keys(players || {});

  if (phase === "night-doctor") {
    const deathKey = `${roomId}:${round}:night-doctor`;
    if (checkedDeathKey === deathKey) return;
    checkedDeathKey = deathKey;
    log("checking Doctor aliveness", { roomId, round, uids });
    findRoleHolder(roomId, uids, "doctor")
      .then((doctorUid) => {
        if (!doctorUid) {
          log("Doctor not found among current players — retrying next render", { uids });
          checkedDeathKey = null;
          return;
        }
        const doctorAlive = players[doctorUid]?.alive !== false;
        log("Doctor found", { doctorUid, doctorAlive });
        if (!doctorAlive) {
          log("Doctor is dead — skipping straight to resolution");
          skipDeadPhase(roomId, false, hasDoctor);
        } else {
          log("arming watcher on doctorSave");
          armWatcher(roomId, round, "doctorSave");
        }
      })
      .catch((err) => {
        log("findRoleHolder(doctor) threw — retrying next render", err);
        checkedDeathKey = null;
      });
  } else if (phase === "night-seer") {
    const deathKey = `${roomId}:${round}:night-seer`;
    if (checkedDeathKey === deathKey) return;
    checkedDeathKey = deathKey;
    log("checking Seer aliveness", { roomId, round, hasDoctor, uids });
    findRoleHolder(roomId, uids, "seer")
      .then((seerUid) => {
        if (!seerUid) {
          log("Seer not found among current players — retrying next render", { uids });
          checkedDeathKey = null;
          return;
        }
        const seerAlive = players[seerUid]?.alive !== false;
        log("Seer found", { seerUid, seerAlive });
        if (!seerAlive) {
          log("Seer is dead — skipping their turn", { hasDoctor });
          skipDeadPhase(roomId, true, hasDoctor);
        } else if (!hasDoctor) {
          // Alive Seer, no Doctor this game — the Seer's own "ไปต่อ" click writes seerReady;
          // this is what tells host-engine it's safe to resolve.
          log("arming watcher on seerReady (no Doctor this game)");
          armWatcher(roomId, round, "seerReady");
        } else {
          // Alive Seer, Doctor exists — the Seer advances night-seer -> night-doctor
          // themselves (self-write permission in firebase-rules.json), nothing to watch here.
          log("Seer alive + Doctor exists — Seer self-advances, nothing to watch");
          teardownWatcher();
        }
      })
      .catch((err) => {
        log("findRoleHolder(seer) threw — retrying next render", err);
        checkedDeathKey = null;
      });
  } else {
    teardownWatcher();
  }
}
