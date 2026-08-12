const state = {
  uid: null,
  name: "",
  roomId: null,
  isHost: false,
  phase: "landing", // landing | lobby | role-reveal | night-werewolf | night-seer | night-doctor | day | day-vote | game-over
  public: null,
  players: {},
  mySecret: null, // { role }
  seerResult: null, // { targetUid, isWerewolf } — only ever populated for the seer's own uid
  votes: {},
  revealRoles: null, // { [uid]: role } — only readable once phase === 'game-over'
};

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
