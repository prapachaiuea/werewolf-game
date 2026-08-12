// Procedural background music generated entirely with the Web Audio API — no external
// audio files to source, license, or host. Keeps the game a pure static site while still
// giving each phase its own mood. Volumes are deliberately quiet: this plays under real
// conversation at a game table, never over it.

const MUTE_KEY = "werewolf:musicMuted";

let ctx = null;
let masterGain = null;
let unlocked = false;
let muted = localStorage.getItem(MUTE_KEY) === "1";

let activeScene = null; // { stop(fadeMs) }
let currentSceneKey = null;
let lastPhase = null;
let tensionTimerId = null;
let currentTimerSnapshot = null; // { startAt, durationMs, serverNow } while the day timer runs
let speechPrimed = false;
let narrationTimeouts = [];

function ensureContext() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = ctx.createGain();
  masterGain.gain.value = muted ? 0 : 0.35;
  masterGain.connect(ctx.destination);
}

// Must be called synchronously from inside a real user-gesture handler (click/submit) —
// browsers block audio until one fires. Safe to call repeatedly; only does real work once.
export function unlockAudio() {
  ensureContext();
  if (ctx.state === "suspended") ctx.resume();
  unlocked = true;
  primeSpeech();
}

// Some mobile browsers (notably iOS Safari) only ever let speechSynthesis actually produce
// sound if the very first utterance is spoken synchronously inside a real user gesture — every
// later call to speak() happens from a Firebase state-change callback, not a click, so it would
// otherwise be silently swallowed. Speaking one near-silent utterance right here, inside the
// same click handler that calls unlockAudio(), "unlocks" every subsequent call for the rest of
// the session.
function primeSpeech() {
  if (speechPrimed || !("speechSynthesis" in window)) return;
  speechPrimed = true;
  const warmup = new SpeechSynthesisUtterance(" ");
  warmup.volume = 0;
  window.speechSynthesis.speak(warmup);
}

export function isMuted() {
  return muted;
}

export function setMuted(next) {
  muted = next;
  localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  if (masterGain) {
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(muted ? 0 : 0.35, ctx.currentTime + 0.3);
  }
  if (muted) clearNarration();
}

function noteEnvelope(freq, { start, duration, peak = 0.18, type = "sine", destination }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + duration * 0.15);
  gain.gain.linearRampToValueAtTime(0, start + duration);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

// A slow-breathing pad: detuned oscillators under a shared gain that gently swells via an
// LFO — used for the calm screens (lobby, role-reveal, results).
function startPad(freqs, { type = "sine", swell = 4 } = {}) {
  const sceneGain = ctx.createGain();
  sceneGain.gain.value = 0;
  sceneGain.connect(masterGain);

  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 1 / swell;
  lfoGain.gain.value = 0.06;
  lfo.connect(lfoGain);
  lfoGain.connect(sceneGain.gain);
  lfo.start();

  const oscs = freqs.map((f) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f;
    osc.connect(sceneGain);
    osc.start();
    return osc;
  });

  sceneGain.gain.setTargetAtTime(0.14, ctx.currentTime, 0.6);

  return {
    stop(fadeMs = 800) {
      const t = ctx.currentTime;
      sceneGain.gain.cancelScheduledValues(t);
      sceneGain.gain.setTargetAtTime(0, t, fadeMs / 3000);
      lfo.stop(t + fadeMs / 1000 + 0.5);
      oscs.forEach((o) => o.stop(t + fadeMs / 1000 + 0.5));
    },
  };
}

// A rhythmic pulse cycling through a short note pattern — used for the day-vote countdown.
// `getBpm` is re-read on every beat so tempo can climb as the clock runs down.
function startPulse(freqs, { getBpm, type = "triangle" } = {}) {
  const sceneGain = ctx.createGain();
  sceneGain.gain.value = 0;
  sceneGain.connect(masterGain);
  sceneGain.gain.setTargetAtTime(0.16, ctx.currentTime, 0.4);

  let stopped = false;
  let i = 0;
  function beat() {
    if (stopped) return;
    const bpm = getBpm();
    const noteDur = 60 / bpm;
    noteEnvelope(freqs[i % freqs.length], {
      start: ctx.currentTime,
      duration: noteDur * 0.85,
      peak: 0.22,
      type,
      destination: sceneGain,
    });
    i += 1;
    tensionTimerId = setTimeout(beat, noteDur * 1000);
  }
  beat();

  return {
    stop(fadeMs = 500) {
      stopped = true;
      clearTimeout(tensionTimerId);
      const t = ctx.currentTime;
      sceneGain.gain.cancelScheduledValues(t);
      sceneGain.gain.setTargetAtTime(0, t, fadeMs / 3000);
    },
  };
}

// A single resolving chord, not looped — for role-reveal and the game-over screen.
function playSting(freqs, { type = "sine", duration = 1.6 } = {}) {
  const stingGain = ctx.createGain();
  stingGain.connect(masterGain);
  const t = ctx.currentTime;
  freqs.forEach((f, idx) => {
    noteEnvelope(f, { start: t + idx * 0.04, duration, peak: 0.2, type, destination: stingGain });
  });
}

// Short one-shot UI feedback, separate from the looping ambient bed. playClick() is meant
// to be wired to a single delegated listener covering every button in the app.
export function playClick() {
  if (!unlocked) return;
  ensureContext();
  noteEnvelope(720, { start: ctx.currentTime, duration: 0.06, peak: 0.12, type: "square", destination: masterGain });
}

export function playHowl() {
  if (!unlocked) return;
  ensureContext();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(220, t);
  osc.frequency.exponentialRampToValueAtTime(440, t + 0.5);
  osc.frequency.exponentialRampToValueAtTime(180, t + 1.1);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.14, t + 0.15);
  gain.gain.linearRampToValueAtTime(0, t + 1.2);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(t);
  osc.stop(t + 1.3);
}

// Spoken narration cues (English, per design) that stand in for a human moderator telling the
// table when to open/close their eyes. Plays on every connected device at once — deliberately,
// since one phone's speaker rarely reaches everyone sitting around a real table. A bit of
// overlap/echo between devices is an accepted trade-off for that reliability.
//
// MUST NEVER be used to speak anything secret (a role, a Seer result, who died) — only the
// generic phase-timing lines below. Secret results stay text-only, on the one screen that's
// allowed to see them.
function speak(text) {
  if (!unlocked || muted || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

function clearNarration() {
  narrationTimeouts.forEach((id) => clearTimeout(id));
  narrationTimeouts = [];
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

// `steps` is a list of { text, delay } — delay is milliseconds from when this sequence starts,
// not from the previous line, so each entry stands on its own.
function playNarrationSequence(steps) {
  clearNarration();
  steps.forEach(({ text, delay }) => {
    narrationTimeouts.push(setTimeout(() => speak(text), delay));
  });
}

// Works out what to say purely from the phase transition just observed — no secret data
// involved. `hasDoctor` disambiguates the one case where leaving night-seer could mean two
// different things (this game has a Doctor night left, or it doesn't and morning has come).
function narrationForTransition(prevPhase, nextPhase, hasDoctor) {
  if (nextPhase === "night-werewolf") {
    return [
      { text: "Night falls. Everyone, close your eyes.", delay: 0 },
      { text: "Werewolves, open your eyes.", delay: 4000 },
    ];
  }
  if (nextPhase === "night-seer") {
    return [
      { text: "Werewolves, close your eyes.", delay: 0 },
      { text: "Seer, open your eyes.", delay: 2000 },
    ];
  }
  if (nextPhase === "night-doctor") {
    return [
      { text: "Seer, close your eyes.", delay: 0 },
      { text: "Doctor, open your eyes.", delay: 2000 },
    ];
  }
  if (nextPhase === "day" && (prevPhase === "night-doctor" || prevPhase === "night-seer")) {
    const closeLine = prevPhase === "night-doctor" ? "Doctor, close your eyes." : "Seer, close your eyes.";
    return [
      { text: closeLine, delay: 0 },
      { text: "Morning has come.", delay: 4000 },
    ];
  }
  return null;
}

function tensionBpm() {
  if (!currentTimerSnapshot) return 100;
  const { startAt, durationMs, serverNow } = currentTimerSnapshot;
  const remaining = startAt + durationMs - serverNow();
  if (remaining < 15000) return 168;
  if (remaining < 30000) return 136;
  return 100;
}

const SCENES = {
  ambient: () => startPad([130.81, 164.81, 196.0], { type: "sine", swell: 5 }), // C3-E3-G3, a quiet village
  suspense: () => startPad([98.0, 116.54, 146.83], { type: "triangle", swell: 3 }), // G2-Bb2-D3, hushed night
  tension: () => startPulse([261.63, 293.66, 311.13, 392.0], { type: "triangle", getBpm: tensionBpm }), // the clock ticking down to a vote
};

function sceneKeyForPhase(phase) {
  if (phase.startsWith("night-")) return "suspense";
  if (phase === "day-vote") return "tension";
  return "ambient"; // landing, lobby, role-reveal, day, game-over
}

// Called from the same state-subscription that already drives routing/rendering. Only acts
// on an actual phase change (not every Firebase snapshot) so it never restarts mid-loop.
export function updateForState(state, { serverNow } = {}) {
  if (!unlocked) return;
  ensureContext();

  const activePhase = state.roomId ? state.phase : "landing";

  currentTimerSnapshot =
    activePhase === "day-vote" && state.public?.timer && serverNow
      ? { ...state.public.timer, serverNow }
      : null;

  if (activePhase === lastPhase) return;
  const previousPhase = lastPhase;
  lastPhase = activePhase;

  if (activePhase === "night-werewolf") playHowl();
  if (activePhase === "role-reveal") playSting([392.0, 493.88, 587.33], { duration: 1.2 }); // bright, curious
  if (activePhase === "game-over") playSting([261.63, 329.63, 392.0, 523.25], { duration: 2.0 }); // resolving chord

  const hasDoctor = Boolean(state.public?.roles?.doctor);
  const narration = narrationForTransition(previousPhase, activePhase, hasDoctor);
  if (narration) playNarrationSequence(narration);

  const sceneKey = sceneKeyForPhase(activePhase);
  if (sceneKey !== currentSceneKey) {
    if (activeScene) activeScene.stop();
    activeScene = SCENES[sceneKey]();
    currentSceneKey = sceneKey;
  }
}
