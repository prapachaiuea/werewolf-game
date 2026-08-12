import {
  ref, set, get, update, remove, onValue, onDisconnect,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
import { db } from "./firebase-init.js";
import { getState, setState } from "./state.js";
import { generateRoomCode } from "./utils/id.js";
import { saveLastRoom, saveLastName, clearLastRoom } from "./utils/storage.js";
import { DAY_DURATION_MS } from "./game.js";
import { showToast } from "./ui/components.js";

const MAX_CODE_ATTEMPTS = 5;
// No Cloud Functions on the free Spark plan, so there's no server-side cron to sweep abandoned
// rooms — instead, any room older than this is treated as gone the next time someone tries to
// join it (opportunistic/lazy expiry, not a guaranteed immediate sweep of every dead room).
const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
let subscribedRoomId = null;
let unsubscribers = [];
let hadRealPublicData = false;

export function getRoomIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  return room ? room.toUpperCase() : null;
}

export function setRoomInUrl(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  window.history.replaceState({}, "", url);
}

export function clearRoomFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  window.history.replaceState({}, "", url);
}

export async function createRoom(name) {
  const { uid } = getState();

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const roomId = generateRoomCode();
    try {
      // First-writer-wins per security rules: claims the room code, or fails on collision.
      await set(ref(db, `rooms/${roomId}/public/host`), uid);
    } catch {
      continue;
    }
    await update(ref(db, `rooms/${roomId}/public`), {
      createdAt: Date.now(),
      phase: "lobby",
      roundNumber: 0,
      dayDurationMs: DAY_DURATION_MS,
    });
    await joinRoom(roomId, name);
    return roomId;
  }
  throw new Error("COULD_NOT_CREATE_ROOM");
}

export async function joinRoom(roomId, name) {
  const { uid } = getState();
  saveLastName(name);

  const publicSnap = await get(ref(db, `rooms/${roomId}/public`));
  if (!publicSnap.exists()) {
    throw new Error("ROOM_NOT_FOUND");
  }
  const publicData = publicSnap.val();

  if (publicData.createdAt && Date.now() - publicData.createdAt > ROOM_TTL_MS) {
    // Expired — treat exactly like a room that was never there, and take the opportunity to
    // actually reclaim the space (rules permit anyone to delete a room once it's past TTL).
    // Fire-and-forget: whether the delete itself succeeds doesn't change the outcome for this
    // join attempt, and racing with someone else's cleanup of the same room is harmless.
    remove(ref(db, `rooms/${roomId}`)).catch(() => {});
    throw new Error("ROOM_NOT_FOUND");
  }

  const playerRef = ref(db, `rooms/${roomId}/players/${uid}`);
  const existingSnap = await get(playerRef);
  if (!existingSnap.exists() && publicData.phase !== "lobby") {
    throw new Error("ROOM_IN_PROGRESS");
  }

  await set(playerRef, {
    name,
    joinedAt: existingSnap.exists() ? existingSnap.val().joinedAt : Date.now(),
    online: true,
    alive: existingSnap.exists() ? (existingSnap.val().alive ?? true) : true,
  });

  saveLastRoom(roomId);
  setRoomInUrl(roomId);
  setState({ roomId, name, isHost: publicData.host === uid });
  subscribeToRoom(roomId);
  return roomId;
}

export async function leaveRoom() {
  const { roomId, uid, isHost } = getState();
  if (!roomId) return;

  try {
    await onDisconnect(ref(db, `rooms/${roomId}/players/${uid}/online`)).cancel();
    if (isHost) {
      // Rooms are one-time use — the host leaving closes it for everyone still inside,
      // rather than leaving a headless room that other players are stuck in.
      await remove(ref(db, `rooms/${roomId}`));
    } else {
      await remove(ref(db, `rooms/${roomId}/players/${uid}`));
    }
  } catch {
    // Best-effort — still reset the local view even if the write fails (e.g. offline).
  }

  unsubscribeFromRoom();
  clearLastRoom();
  clearRoomFromUrl();

  setState({
    roomId: null,
    isHost: false,
    phase: "landing",
    public: null,
    players: {},
    mySecret: null,
    seerResult: null,
    votes: {},
    revealRoles: null,
  });
}

function unsubscribeFromRoom() {
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers = [];
  subscribedRoomId = null;
}

export function subscribeToRoom(roomId) {
  if (subscribedRoomId === roomId) return; // already listening to this room
  if (subscribedRoomId !== null) unsubscribeFromRoom(); // switched rooms in the same tab
  subscribedRoomId = roomId;
  hadRealPublicData = false;

  const { uid } = getState();
  const ignoreDenied = () => {};

  // Presence: re-armed every time the client (re)connects, not just once at join time. A
  // one-shot onDisconnect() call made only when joinRoom() runs correctly flips "online:false"
  // on that specific connection dropping, but does nothing to flip it back to "online:true"
  // once the Firebase SDK auto-reconnects after a transient network drop — a very real scenario
  // on mobile data. Listening to .info/connected and redoing this on every reconnect keeps the
  // flag accurate for the whole session, not just at the moment of joining.
  unsubscribers.push(onValue(ref(db, ".info/connected"), (snap) => {
    if (snap.val() !== true) return;
    const onlineRef = ref(db, `rooms/${roomId}/players/${uid}/online`);
    onDisconnect(onlineRef).set(false).then(() => set(onlineRef, true));
  }));

  unsubscribers.push(onValue(ref(db, `rooms/${roomId}/public`), (snap) => {
    const publicData = snap.val();
    if (!publicData) {
      // The room itself is gone (e.g. swept by another client's TTL cleanup while this tab
      // sat idle) — don't render a blank/broken lobby, just back out gracefully.
      if (hadRealPublicData) {
        showToast("ห้องนี้ไม่มีอยู่แล้ว", true);
        leaveRoom();
      }
      return;
    }
    hadRealPublicData = true;
    setState({
      public: publicData,
      phase: publicData.phase || "lobby",
      isHost: publicData.host === uid,
    });
  }));

  unsubscribers.push(onValue(ref(db, `rooms/${roomId}/players`), (snap) => {
    setState({ players: snap.val() || {} });
  }));

  unsubscribers.push(onValue(ref(db, `rooms/${roomId}/secrets/${uid}`), (snap) => {
    setState({ mySecret: snap.val() || null });
  }, ignoreDenied));

  // Denied by rules until phase === 'game-over' — expected, not an error.
  unsubscribers.push(onValue(ref(db, `rooms/${roomId}/reveal/roles`), (snap) => {
    setState({ revealRoles: snap.val() || null });
  }, ignoreDenied));

  unsubscribers.push(onValue(ref(db, `rooms/${roomId}/votes`), (snap) => {
    setState({ votes: snap.val() || {} });
  }, ignoreDenied));
}
