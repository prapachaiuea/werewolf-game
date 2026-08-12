import { ref, get, update } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
import { db } from "./firebase-init.js";
import { getState } from "./state.js";
import { computeElimination } from "./votes.js";

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 12;
export const DAY_DURATION_MS = 3 * 60 * 1000;

// Lead-in before the day-discussion timer actually starts, so every player sees the same
// synchronized full-screen 3-2-1 countdown (day-view.js) instead of the clock just appearing
// already running.
const PREROUND_COUNTDOWN_MS = 3000;

let rolesCache = null;
async function loadRoleTiers() {
  if (rolesCache) return rolesCache;
  const res = await fetch(new URL("../roles.json", import.meta.url));
  rolesCache = await res.json();
  return rolesCache;
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function pickRoleTier(playerCount) {
  const tiers = await loadRoleTiers();
  const tier = tiers.find((t) => playerCount >= t.minPlayers && playerCount <= t.maxPlayers);
  if (!tier) {
    throw new Error(playerCount < tiers[0].minPlayers ? "NOT_ENOUGH_PLAYERS" : "TOO_MANY_PLAYERS");
  }
  return tier;
}

// Werewolves first, then the single-copy roles, whatever's left becomes villagers.
function assignRoles(uids, tier) {
  const shuffled = shuffle(uids);
  const roles = {};
  let i = 0;
  for (let w = 0; w < tier.werewolves; w++) roles[shuffled[i++]] = "werewolf";
  if (tier.seer) roles[shuffled[i++]] = "seer";
  if (tier.doctor) roles[shuffled[i++]] = "doctor";
  if (tier.hunter) roles[shuffled[i++]] = "hunter";
  while (i < shuffled.length) roles[shuffled[i++]] = "villager";
  return roles;
}

// Exported for host-engine.js — it needs to know whether a specific role's holder is still
// alive (to skip their phase entirely if not), which means finding out who holds that role in
// the first place. Only ever called from the host's own client.
export async function readRolesMap(roomId, uids) {
  const entries = await Promise.all(
    uids.map(async (uid) => {
      const snap = await get(ref(db, `rooms/${roomId}/secrets/${uid}`));
      return [uid, snap.val()?.role || null];
    })
  );
  return Object.fromEntries(entries);
}

// Villagers win once every werewolf is gone. Werewolves win the moment they're no longer
// outnumbered by everyone else still standing (equal counts favor the wolves — they only
// need one more vote to win any tie-breaking lynch).
function computeWinner(players, roles) {
  let aliveWolves = 0;
  let aliveOthers = 0;
  Object.entries(players).forEach(([uid, p]) => {
    if (p.alive === false) return;
    if (roles[uid] === "werewolf") aliveWolves += 1;
    else aliveOthers += 1;
  });
  if (aliveWolves === 0) return "villagers";
  if (aliveWolves >= aliveOthers) return "werewolves";
  return null;
}

// Host-only: shuffles roles entirely client-side (no trusted server on the free Firebase
// plan). Known trust limitation — documented in README.md. Used both for the very first round
// and for "Play Again" — roundNumber only ever increases, so every game this room ever plays
// gets its own never-reused night/{round} paths.
export async function startRound(roomId) {
  const { players, public: pub } = getState();
  const uids = Object.keys(players);
  if (uids.length < MIN_PLAYERS) throw new Error("NOT_ENOUGH_PLAYERS");
  if (uids.length > MAX_PLAYERS) throw new Error("TOO_MANY_PLAYERS");

  const tier = await pickRoleTier(uids.length);
  const roleMap = assignRoles(uids, tier);

  const updates = {};
  uids.forEach((uid) => {
    updates[`rooms/${roomId}/secrets/${uid}`] = { role: roleMap[uid] };
    updates[`rooms/${roomId}/players/${uid}/alive`] = true;
    updates[`rooms/${roomId}/votes/${uid}`] = null; // clear any stale vote from a prior game
  });

  updates[`rooms/${roomId}/reveal/roles`] = null;
  updates[`rooms/${roomId}/public/roles`] = tier;
  updates[`rooms/${roomId}/public/roundNumber`] = (pub?.roundNumber || 0) + 1;
  updates[`rooms/${roomId}/public/lastNight`] = null;
  updates[`rooms/${roomId}/public/lastVote`] = null;
  updates[`rooms/${roomId}/public/hunterRevenge`] = null;
  updates[`rooms/${roomId}/public/gameOver`] = null;
  updates[`rooms/${roomId}/public/restartAt`] = null;
  updates[`rooms/${roomId}/public/timer`] = null;
  updates[`rooms/${roomId}/public/phase`] = "role-reveal";

  await update(ref(db), updates);
}

export async function setDayDuration(roomId, durationMs) {
  await update(ref(db, `rooms/${roomId}/public`), { dayDurationMs: durationMs });
}

// role-reveal -> night-werewolf. Host-only, called once everyone has had a look at their card.
export async function startFirstNight(roomId) {
  await update(ref(db, `rooms/${roomId}/public`), { phase: "night-werewolf" });
}

// night-werewolf -> night-seer. Called by a werewolf once they've locked in a target — per
// firebase-rules.json, only a werewolf can make this specific transition, and only once
// werewolf/target actually exists.
export async function advanceFromWerewolfNight(roomId) {
  const round = getState().public.roundNumber;
  const targetSnap = await get(ref(db, `rooms/${roomId}/night/${round}/werewolf/target`));
  if (!targetSnap.exists()) throw new Error("NO_WEREWOLF_TARGET");
  await update(ref(db, `rooms/${roomId}/public`), { phase: "night-seer" });
}

// Resolves the seer's check (still inside night-seer — phase does not change here). The
// seer's own client is granted a narrow, scoped read of exactly this one target's role (see
// firebase-rules.json — only for the seer, only for their own chosen target, only during
// night-seer) so they can compute and write their own verdict without any host involvement.
export async function resolveSeerCheck(roomId) {
  const round = getState().public.roundNumber;
  const targetSnap = await get(ref(db, `rooms/${roomId}/night/${round}/seerTarget`));
  if (!targetSnap.exists()) throw new Error("NO_SEER_TARGET");
  const targetUid = targetSnap.val();
  const roleSnap = await get(ref(db, `rooms/${roomId}/secrets/${targetUid}`));
  const isWerewolf = roleSnap.val()?.role === "werewolf";

  await update(ref(db), {
    [`rooms/${roomId}/night/${round}/seerResult`]: { targetUid, isWerewolf },
  });
}

// Called by the seer once they've had a moment to actually read their result off-screen —
// this is a deliberate click, never an automatic side effect of resolveSeerCheck(), precisely
// so the seer always gets a beat to read the verdict before anything moves on.
//
// - If this game has a Doctor: advances night-seer -> night-doctor directly (the seer knows
//   exactly what comes next, no need to involve the host).
// - If not, the seer's turn is the last one for the night, and a player can't resolve that
//   themselves — instead this just flags "the seer is done", which is what host-engine.js is
//   watching for to run the night's resolution in the background.
export async function continueAfterSeerNight(roomId) {
  const round = getState().public.roundNumber;
  const resultSnap = await get(ref(db, `rooms/${roomId}/night/${round}/seerResult`));
  if (!resultSnap.exists()) throw new Error("SEER_NOT_RESOLVED");

  const hasDoctor = Boolean(getState().public.roles?.doctor);
  console.log("[game] continueAfterSeerNight: hasDoctor =", hasDoctor, "round =", round);
  if (hasDoctor) {
    await update(ref(db, `rooms/${roomId}/public`), { phase: "night-doctor" });
    console.log("[game] continueAfterSeerNight: wrote phase = night-doctor");
  } else {
    await update(ref(db), { [`rooms/${roomId}/night/${round}/seerReady`]: true });
    console.log("[game] continueAfterSeerNight: wrote seerReady = true");
  }
}

// Shared tail end of both a night and a day-vote: given the final players/roles state for
// this cycle, check the win condition and either open the next phase or end the game.
// `resume` is "day" (coming from a night) or "next-night" (coming from a day-vote).
async function finishCycle(roomId, players, roles, updates, resume) {
  const winner = computeWinner(players, roles);
  const { public: pub } = getState();

  if (winner) {
    updates[`rooms/${roomId}/reveal/roles`] = roles;
    updates[`rooms/${roomId}/public/gameOver`] = { winner };
    updates[`rooms/${roomId}/public/phase`] = "game-over";
  } else if (resume === "day") {
    updates[`rooms/${roomId}/public/phase`] = "day";
    updates[`rooms/${roomId}/public/timer`] = {
      startAt: Date.now() + PREROUND_COUNTDOWN_MS,
      durationMs: pub.dayDurationMs || DAY_DURATION_MS,
    };
  } else {
    updates[`rooms/${roomId}/public/roundNumber`] = (pub.roundNumber || 0) + 1;
    updates[`rooms/${roomId}/public/timer`] = null;
    updates[`rooms/${roomId}/public/phase`] = "night-werewolf";
  }
  await update(ref(db), updates);
}

// Interrupts the normal flow whenever the Hunter is the one who just died — win-condition
// checking (and opening the next phase) is deferred to resolveHunterRevenge() so the Hunter's
// revenge kill always gets a chance to happen and to factor into the outcome.
function isHunterDeath(deadUid, roles) {
  return Boolean(deadUid) && roles[deadUid] === "hunter";
}

// Shared tail end of every night: combine the werewolves' target with the doctor's save (if
// any), kill or spare accordingly, then either hand off to the Hunter's revenge shot or check
// the win condition and open the day. Nobody clicks a button to call this directly anymore —
// it's triggered reactively by host-engine.js the instant it sees the last night role's
// action land (doctorSave, or seerResult when this game has no Doctor). Exported so
// host-engine.js can call it; still only ever succeeds when run from the host's own client,
// since every write inside it targets host-only paths.
export async function resolveNightAndGoToDay(roomId) {
  const { public: pub, players } = getState();
  const round = pub.roundNumber;

  const targetSnap = await get(ref(db, `rooms/${roomId}/night/${round}/werewolf/target`));
  const werewolfTarget = targetSnap.val();

  let doctorSave = null;
  if (pub.roles?.doctor) {
    const saveSnap = await get(ref(db, `rooms/${roomId}/night/${round}/doctorSave`));
    doctorSave = saveSnap.val();
  }

  const killedUid = werewolfTarget && werewolfTarget !== doctorSave ? werewolfTarget : null;

  const simulatedPlayers = { ...players };
  if (killedUid && simulatedPlayers[killedUid]) {
    simulatedPlayers[killedUid] = { ...simulatedPlayers[killedUid], alive: false };
  }
  const uids = Object.keys(simulatedPlayers);
  const roles = await readRolesMap(roomId, uids);

  const updates = {};
  updates[`rooms/${roomId}/public/lastNight`] = { killedUid: killedUid || null };
  if (killedUid) updates[`rooms/${roomId}/players/${killedUid}/alive`] = false;

  if (isHunterDeath(killedUid, roles)) {
    updates[`rooms/${roomId}/public/hunterRevenge`] = { hunterUid: killedUid, resume: "day" };
    updates[`rooms/${roomId}/public/phase`] = "hunter-revenge";
    await update(ref(db), updates);
    return;
  }

  await finishCycle(roomId, simulatedPlayers, roles, updates, "day");
}

// day -> day-vote. Either the host advancing early, or (per security rules) any player once
// the discussion timer has actually run out.
export async function advanceToVote(roomId) {
  await update(ref(db, `rooms/${roomId}/public`), { phase: "day-vote" });
}

// day-vote -> next night, or -> game-over (or a Hunter revenge shot in between). Host-only:
// tallies the vote, executes the majority pick (a tie spares everyone), then either hands off
// to the Hunter or checks the win condition and opens the next night.
export async function revealVoteResults(roomId) {
  const { players, votes } = getState();
  const aliveUids = Object.entries(players)
    .filter(([, p]) => p.alive !== false)
    .map(([uid]) => uid);

  const { eliminatedUid } = computeElimination(votes, aliveUids);

  const simulatedPlayers = { ...players };
  if (eliminatedUid && simulatedPlayers[eliminatedUid]) {
    simulatedPlayers[eliminatedUid] = { ...simulatedPlayers[eliminatedUid], alive: false };
  }
  const uids = Object.keys(simulatedPlayers);
  const roles = await readRolesMap(roomId, uids);

  const updates = {};
  updates[`rooms/${roomId}/public/lastVote`] = { eliminatedUid: eliminatedUid || null };
  if (eliminatedUid) updates[`rooms/${roomId}/players/${eliminatedUid}/alive`] = false;
  Object.keys(votes || {}).forEach((uid) => {
    updates[`rooms/${roomId}/votes/${uid}`] = null;
  });

  if (isHunterDeath(eliminatedUid, roles)) {
    updates[`rooms/${roomId}/public/hunterRevenge`] = { hunterUid: eliminatedUid, resume: "next-night" };
    updates[`rooms/${roomId}/public/phase`] = "hunter-revenge";
    await update(ref(db), updates);
    return { eliminatedUid };
  }

  await finishCycle(roomId, simulatedPlayers, roles, updates, "next-night");
  return { eliminatedUid };
}

// hunter-revenge -> whatever `public/hunterRevenge.resume` says ("day" or "next-night"), or
// game-over. Host-only: reads the Hunter's choice (a target uid, or "skip"), applies it, then
// runs the same win-check/next-phase logic as the rest of the game.
export async function resolveHunterRevenge(roomId) {
  const { public: pub, players } = getState();
  const round = pub.roundNumber;
  const revengeSnap = await get(ref(db, `rooms/${roomId}/hunterRevenge/${round}/target`));
  if (!revengeSnap.exists()) throw new Error("NO_HUNTER_CHOICE");
  const choice = revengeSnap.val();

  const simulatedPlayers = { ...players };
  const updates = {};
  let revengeUid = null;
  if (choice && choice !== "skip") {
    revengeUid = choice;
    if (simulatedPlayers[revengeUid]) {
      simulatedPlayers[revengeUid] = { ...simulatedPlayers[revengeUid], alive: false };
    }
    updates[`rooms/${roomId}/players/${revengeUid}/alive`] = false;
  }

  const resume = pub.hunterRevenge?.resume || "day";
  updates[`rooms/${roomId}/public/hunterRevenge`] = { ...pub.hunterRevenge, revengeUid };
  if (resume === "day") {
    updates[`rooms/${roomId}/public/lastNight`] = { ...pub.lastNight, hunterRevengeUid: revengeUid };
  } else {
    updates[`rooms/${roomId}/public/lastVote`] = { ...pub.lastVote, hunterRevengeUid: revengeUid };
  }

  const uids = Object.keys(simulatedPlayers);
  const roles = await readRolesMap(roomId, uids);
  await finishCycle(roomId, simulatedPlayers, roles, updates, resume);

  return { revengeUid };
}

// Broadcasts the same full-screen countdown used before the day timer, but from the
// game-over screen — every client sees it before the next game's roles are dealt.
// game-over-view.js watches restartAt and has the host call startRound() once it elapses.
export async function triggerRestartCountdown(roomId) {
  await update(ref(db, `rooms/${roomId}/public`), { restartAt: Date.now() + PREROUND_COUNTDOWN_MS });
}

export async function backToLobby(roomId) {
  const { players } = getState();
  const updates = {};
  Object.keys(players).forEach((uid) => {
    updates[`rooms/${roomId}/votes/${uid}`] = null;
    updates[`rooms/${roomId}/secrets/${uid}`] = null;
  });
  updates[`rooms/${roomId}/reveal/roles`] = null;
  updates[`rooms/${roomId}/public/roles`] = null;
  updates[`rooms/${roomId}/public/lastNight`] = null;
  updates[`rooms/${roomId}/public/lastVote`] = null;
  updates[`rooms/${roomId}/public/hunterRevenge`] = null;
  updates[`rooms/${roomId}/public/gameOver`] = null;
  updates[`rooms/${roomId}/public/timer`] = null;
  updates[`rooms/${roomId}/public/restartAt`] = null;
  updates[`rooms/${roomId}/public/phase`] = "lobby";
  await update(ref(db), updates);
}
