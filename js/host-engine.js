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
    findRoleHolder(roomId, uids, "doctor").then((doctorUid) => {
      const doctorAlive = doctorUid && players[doctorUid]?.alive !== false;
      if (!doctorAlive) {
        skipDeadPhase(roomId, false, hasDoctor);
      } else {
        armWatcher(roomId, round, "doctorSave");
      }
    });
  } else if (phase === "night-seer") {
    const deathKey = `${roomId}:${round}:night-seer`;
    if (checkedDeathKey === deathKey) return;
    checkedDeathKey = deathKey;
    findRoleHolder(roomId, uids, "seer").then((seerUid) => {
      const seerAlive = seerUid && players[seerUid]?.alive !== false;
      if (!seerAlive) {
        skipDeadPhase(roomId, true, hasDoctor);
      } else if (!hasDoctor) {
        // Alive Seer, no Doctor this game — the Seer's own "ไปต่อ" click writes seerReady;
        // this is what tells host-engine it's safe to resolve.
        armWatcher(roomId, round, "seerReady");
      } else {
        // Alive Seer, Doctor exists — the Seer advances night-seer -> night-doctor themselves
        // (self-write permission in firebase-rules.json), nothing for the host to watch here.
        teardownWatcher();
      }
    });
  } else {
    teardownWatcher();
  }
}
