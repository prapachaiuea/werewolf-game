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
5. Each night: the Werewolves (secretly) pick a victim, the Seer checks one player's true role, the Doctor picks one player to protect — each role only ever sees their own action.
6. Each morning: the app announces who (if anyone) died overnight. The group discusses out loud (voice call or in person — this site doesn't handle chat/voice), then votes to eliminate a suspect. A tie eliminates no one.
7. **Whenever the Hunter dies** — killed by the Werewolves at night, or voted out by the village — the game pauses and hands them one immediate revenge kill: they pick any other living player to eliminate too (or no one), before anything else continues.
8. The game checks the win condition after every death (including a Hunter's revenge kill): Villagers win once every Werewolf is gone; Werewolves win once they're no longer outnumbered by everyone else still alive.
9. When the game ends, everyone's role is revealed. The host can start a new game in the same room without re-sharing the link.

## Known limitation: host trust

This app runs on Firebase's free plan with no server-side code (no Cloud Functions). The **host's own browser** shuffles roles, resolves each night's kill (combining the Werewolves' target with the Doctor's save), and reads back the Seer's check result — all client-side, then writes only what each player is allowed to see to a database path that Firebase Security Rules restrict accordingly.

This means a technically savvy host could inspect their own browser's network traffic and see information before it's revealed (e.g. the Seer's result, or who the Werewolves are about to kill). For a casual game with friends this is an acceptable trade-off — it's no different from trusting whoever deals a physical deck — but it's not a cryptographically secure implementation, so don't use it for anything with real stakes. This is the same trade-off documented in this collection's [Insider](https://github.com/prapachaiuea/insider-game) game.

## Other deliberate simplifications

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

- You cannot read another player's `secrets/{uid}` node (role) — permission-denied for any uid other than your own or the host's.
- If you're not a Werewolf, you cannot read `night/{round}/werewolf/target`.
- If you're not the Seer, you cannot read `night/{round}/seerTarget` or `night/{round}/seerResult`.
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
  votes.js                cast a vote, day-vote tally + elimination logic
  audio.js                procedural ambient music per phase (Web Audio API, no audio files)
  state.js                tiny local pub/sub store
  router.js               shows/hides the active phase's <section>
  ui/                      one render module per phase (lobby, role-reveal, the three
                           night phases, hunter-revenge, day, day-vote, game-over)
  utils/                   room code generator, localStorage helpers, countdown timer
```

## Limitations / known edge cases

- No host migration: if the host closes their tab mid-game, any transition that requires the host (advancing a night phase, revealing the vote, starting the next round) stalls until they return. The same applies if the Hunter's tab disappears right after they die — their revenge shot has no timeout, so the game waits.
- Min/max player count (5–12) is enforced in the UI only, not by the database rules.
- Duplicate display names are allowed (players are identified by an anonymous auth ID, not their name).
- The Werewolves share a single "target" value — with 2 Werewolves (10–12 players), whoever writes last wins; coordinating who to pick is a voice/in-person conversation, same as the rest of this game's design.
