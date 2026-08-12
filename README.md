# Werewolf — หมาป่าอยู่ในหมู่บ้าน (web)

A browser version of the party/social-deduction game **Werewolf** (a.k.a. Mafia), for playing with friends who don't own a physical card set. Static site + Firebase Realtime Database, deployable on GitHub Pages for free. UI is in Thai throughout, matching the tone of the other games in this collection.

## How it works

1. One player creates a room and shares the link.
2. Everyone else opens the link and joins the lobby (5–12 players).
3. The host starts the game — roles are dealt based on player count:
   - **5–6 players:** 1 Werewolf, 1 Seer, the rest Villagers
   - **7–9 players:** + 1 Doctor
   - **10–12 players:** + 1 Hunter, Werewolves become 2
4. Everyone looks at their own role card, then the host opens the first night.
5. **No moderator needed.** Every phone plays the same spoken cues (in English) telling the table when to open/close their eyes — "Night falls, everyone close your eyes... Werewolves, open your eyes." — the same way a human narrator would in the physical game. Each role acts and moves things along on their own screen: the Werewolves (secretly) pick a victim and confirm it themselves, the Seer checks one player's true role and confirms it themselves. Nobody — including the host — needs to look at or tap their phone during someone else's turn.
6. Each morning: the app announces who (if anyone) died overnight. The group discusses out loud (voice call or in person — this site doesn't handle chat/voice), then votes to eliminate a suspect. A tie eliminates no one.
7. **Whenever the Hunter dies** — killed by the Werewolves at night, or voted out by the village — the game pauses and hands them one immediate revenge kill: they pick any other living player to eliminate too (or no one), before anything else continues.
8. The game checks the win condition after every death (including a Hunter's revenge kill): Villagers win once every Werewolf is gone; Werewolves win once they're no longer outnumbered by everyone else still alive.
9. When the game ends, everyone's role is revealed. The host can start a new game in the same room without re-sharing the link.

## Who can advance what

Every phase transition is deliberately handed to whoever should naturally be the one moving it forward, so the eyes-closed illusion holds up in person:

| Transition | Who triggers it |
|---|---|
| Werewolves pick a victim → Seer's turn | A Werewolf, once their target is locked in |
| Seer checks a role → Doctor's turn (or waits, if no Doctor) | The Seer, once they've read their own result |
| Doctor protects someone → morning | Nobody clicks this — see below |
| Day discussion → day vote | Any player, once the timer runs out (or the host, early) |
| Day vote → next night / game over | The host |
| Hunter's revenge shot → resume | The host |

The one step nobody can trigger themselves is the actual **resolution of a night** (comparing the Werewolves' target against the Doctor's save, and checking the win condition) — that requires knowing every player's role at once, which only the host's browser is allowed to read (see below). Rather than making the host tap a button for it, the Doctor's own confirm (or the Seer's, in games with no Doctor) is itself the signal: the host's browser is silently listening in the background and runs the resolution the instant it sees that data land, with zero interaction from the host. From the table's perspective, the game just... moves on to morning on its own.

## Known limitation: host trust

This app runs on Firebase's free plan with no server-side code (no Cloud Functions). The **host's own browser** shuffles roles at the start of each game and, every night, silently resolves the kill (combining the Werewolves' target with the Doctor's save) and checks the win condition — all client-side, reacting automatically rather than through any button, then writing only what each player is allowed to see to a database path that Firebase Security Rules restrict accordingly. The host's own screen never displays anyone else's role — same views as everyone else, only their own role ever appears on it.

This means a technically savvy host could inspect their own browser's network traffic and see information before it's revealed (e.g. who's about to die, or the outcome of the game). For a casual game with friends this is an acceptable trade-off — it's no different from trusting whoever deals a physical deck — but it's not a cryptographically secure implementation, so don't use it for anything with real stakes. This is the same trade-off documented in this collection's [Insider](https://github.com/prapachaiuea/insider-game) game. The Seer gets one narrow exception to the "can only read your own role" rule: their own client is allowed to read the *specific* player they chose to check, and only during their own turn, so they can resolve their own result without the host being involved either.

## Other deliberate simplifications

- **Voice narration is English, and plays on every device at once.** Rather than routing every phase-timing cue through the host's one phone (whose speaker may not reach everyone around a real table), each connected phone speaks its own copy of the same line at the same moment. Expect a little overlap/echo between devices sitting close together — an accepted trade-off for reliability. The narration only ever announces generic phase timing ("Werewolves, open your eyes") — it never speaks anyone's role or the Seer's result out loud; those stay on-screen, visible only to the player they belong to.
- **The Hunter's revenge shot has no countdown.** The game just waits for the Hunter to pick a target or explicitly skip — if their tab is gone, the game stalls here the same way it stalls whenever the host disappears (see Limitations below).
- **Votes are visible live, not staged.** Unlike a hidden-then-revealed ballot, everyone watching the day vote sees the running tally update in real time as people vote. The host still explicitly clicks "เปิดเผยผลโหวต" (Reveal Results) to lock in the outcome and advance the game — that button controls *timing*, not *visibility*.

## Setup

### 1. Create a Firebase project

1. Go to the [Firebase Console](https://console.firebase.google.com) and create a new project (free **Spark** plan is enough).
2. **Build → Authentication → Sign-in method** → enable **Anonymous**.
3. **Build → Realtime Database → Create Database** → pick a region → start in **locked mode**.
4. **Realtime Database → Rules** tab → paste the contents of [`firebase-rules.json`](firebase-rules.json) → **Publish**.
5. **Project settings → Add app → Web app (`</>`)** → copy the generated config object into [`firebase-config.js`](firebase-config.js), replacing the `REPLACE_ME` placeholders.
6. **Authentication → Settings → Authorized domains** → add `<your-github-username>.github.io` (needed once you deploy to Pages).

### 2. Run locally

No build step — just serve the folder statically (opening `index.html` directly via `file://` won't work because ES modules and fetch require an HTTP origin):

```bash
npx serve .
# or: python -m http.server 8080
```

Then open the printed URL. To actually test a full game you need 5+ **distinct** players — opening multiple tabs in the same browser profile is not enough, since they all share the same signed-in anonymous user and localStorage. Use separate browser profiles, incognito windows, or real devices.

### 3. Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Repo **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main` / `(root)` → Save.
3. Visit `https://<username>.github.io/<repo>/` after a minute or two.

## Verifying role secrecy

Before relying on this for game night, open the browser devtools **Network** (or Application → IndexedDB) tab on a non-host player's tab and confirm:

- You cannot read another player's `secrets/{uid}` node (role) — permission-denied for any uid other than your own or the host's, **except** if you're the Seer during your own night-seer turn, in which case you can read exactly the one uid you chose as your target (and no one else's).
- If you're not a Werewolf, you cannot read `night/{round}/werewolf/target`.
- If you're not the Seer, you cannot read `night/{round}/seerTarget` or `night/{round}/seerResult`.
- A Werewolf can write `public/phase` from `night-werewolf` to `night-seer` (and nothing else); a Seer can write it from `night-seer` to `night-doctor` (and nothing else) — confirm no other phase value or role can push those specific writes through.
- If you're not the Doctor, you cannot read `night/{round}/doctorSave`.
- If you're not the Hunter, you cannot read `hunterRevenge/{round}/target`.
- `reveal/roles` (everyone's role, shown on the game-over screen) is only readable once `public/phase === 'game-over'`.

## Project structure

```
index.html              single-page shell, one <section> per game phase
styles.css               all styling
firebase-config.js       your Firebase web app config (fill in after setup)
firebase-rules.json      Realtime Database security rules (paste into Firebase console)
roles.json               role counts by player-count tier (5–6 / 7–9 / 10–12)
main.js                  entry point
assets/roles/            role portrait art (role-<role>.jpg), used in role-reveal + the
                         game-over reveal list
js/
  firebase-init.js       Firebase app/auth/db init
  auth.js                 anonymous sign-in
  room.js                 create/join/leave a room, live sync
  game.js                 role shuffle, night resolution, win check, phase transitions
  host-engine.js          host-only background watcher — auto-resolves the night the instant
                           the last role's action lands, with zero clicks from the host
  votes.js                cast a vote, day-vote tally + elimination logic
  audio.js                procedural ambient music (Web Audio API) + spoken phase-timing
                           narration (Web Speech API) — no audio files
  state.js                tiny local pub/sub store
  router.js               shows/hides the active phase's <section>
  ui/                      one render module per phase (lobby, role-reveal, the three
                           night phases, hunter-revenge, day, day-vote, game-over)
  utils/                   room code generator, localStorage helpers, countdown timer
```

## Limitations / known edge cases

- No migration for any required actor: if the host closes their tab mid-game, whatever still requires the host (the background night resolution, revealing the vote, starting the next round) stalls until they return. The same is now also true of whichever role is mid-turn — if the Werewolf, Seer, or Doctor's tab disappears during their own night phase, the game waits for them, the same way it always waited for the host before. The Hunter's revenge shot has the same no-timeout behavior.
- Speech-synthesis voice quality and even availability vary by device/OS/browser — some phones may have a robotic-sounding or oddly-accented English voice, and a small minority may have no English voice installed at all (narration silently does nothing in that case; the game itself is unaffected).
- Min/max player count (5–12) is enforced in the UI only, not by the database rules.
- Duplicate display names are allowed (players are identified by an anonymous auth ID, not their name).
- The Werewolves share a single "target" value — with 2 Werewolves (10–12 players), whoever writes last wins; coordinating who to pick is a voice/in-person conversation, same as the rest of this game's design.
