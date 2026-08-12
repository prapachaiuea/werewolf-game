import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
import { db } from "../firebase-init.js";

let serverOffset = 0;

// ".info/serverTimeOffset" is a special live-updating path Firebase uses to let
// clients compute serverNow() without a round-trip per read.
export function watchServerOffset() {
  onValue(ref(db, ".info/serverTimeOffset"), (snap) => {
    serverOffset = snap.val() || 0;
  });
}

export function serverNow() {
  return Date.now() + serverOffset;
}

export function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
