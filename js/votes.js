import { ref, set } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
import { db } from "./firebase-init.js";
import { getState } from "./state.js";

export async function castVote(roomId, votedFor) {
  const { uid } = getState();
  await set(ref(db, `rooms/${roomId}/votes/${uid}`), {
    votedFor,
    votedAt: Date.now(),
  });
}

// Majority elimination among currently-alive players — a tie favors nobody: the village
// argues itself into a stalemate and no one is executed that day.
export function computeElimination(votes, aliveUids) {
  const tally = {};
  aliveUids.forEach((uid) => {
    tally[uid] = 0;
  });

  const castVotes = Object.values(votes || {});
  castVotes.forEach((v) => {
    if (tally[v.votedFor] !== undefined) tally[v.votedFor] += 1;
  });

  const maxVotes = Math.max(0, ...Object.values(tally));
  if (maxVotes === 0) {
    return { eliminatedUid: null, tally, maxVotes };
  }

  const topUids = Object.entries(tally)
    .filter(([, count]) => count === maxVotes)
    .map(([uid]) => uid);

  return { eliminatedUid: topUids.length === 1 ? topUids[0] : null, tally, maxVotes };
}
