# Notes for Claude: ArmLab

ArmLab is a Telegram Mini App on armwrestling biomechanics. It lives in `armwrestling/`;
the rest of the repository is a separate solar-system app, so leave it alone. The
UI text is in Russian, and so is the conversation with the user.

## Run, check, deploy

- `npm start` serves http://localhost:5173/armwrestling/; `?debug` exposes `window.armlab`.
- `npm run check:armlab` is the physics lint: exercises by virtual work plus the
  match invariants. It must pass before every commit.
- `npm run build:armlab` builds `dist/`, which holds only `armwrestling/` and `vendor/three`.
- Work branch: `ccr-15aa77c8-v3nco9`. It has no PR yet; open one only when asked.
- Render static site `armlab` (`srv-dc4solp7lnhs739nnik0`): https://armlab.onrender.com/armwrestling/.
  Autodeploy does not fire, because Render's GitHub app has no access to this repo.
  Deploy by hand with `POST https://api.render.com/v1/services/<id>/deploys`. The
  API key is a network secret that the proxy injects, so it never goes in a file
  or the chat. After a deploy, Cloudflare serves stale modules for a minute or
  two. Wait until a live file contains the new code, then test with Playwright.

## How it is built

- No build step: ES modules, an import map, and three.js r180 vendored in `vendor/three`.
- `render/rig.js` is authored mirrored. Its parent group has `scale.x = -1`, which
  makes it a right arm. Muscles and overlays are computed in world space.
- `data/mechanics.js` uses virtual work: `Q = F·∂P/∂q` by finite differences. The
  hand's angular velocity comes from spoke velocities, which is safe under the mirror.
- `data/match.js`. The opponent is the same rig turned 180° about the vertical,
  not mirrored.
  - The grip is a lock: grip points meet, palms face, and all 10 joints of both
    arms are solved by Levenberg–Marquardt.
  - Grip settings: depth, height (cm), the lock's rotation (mean forearm rotation;
    `null` = halfway between the techniques) and straps.
  - The contested wrench is `W = (E_opp − E_me)/2`. Each athlete's links are
    joint torques plus the finger link (separation, slide-out and peel, against
    a dynamometer grip × a hold factor by contact depth).
  - `sweep()` drives the slider curves; `breakdown()` makes the break keyframes.
- `strength.js` holds the action maxima. Grip is an action in kg, not N·m.

## Rules learned the hard way

- Do not tune coefficients towards the answer practitioners expect. Report the
  disagreement and propose calibration instead.
- Every new physical claim gets an invariant in `scripts/check-armlab.mjs`.
- Phone layout: the sheet must leave both elbows in frame. Check with Playwright
  at 390×844.

## What the model says, and what is open

- Hook beats top by about 45% at equal maxima, because the top's radial deviation
  limits it. Against a toproller profile, top wins by about 9%.
- Height is worth about 20% per cm.
- The grip slips only with strong arms, on a shallow grip, for the lower hand.
- Open, needs video: turning the lock into deep supination hurts the hook. This
  is unconfirmed. The finger hold shares (100/50/30%) and the contact width are
  estimates.

## Next, as agreed with the user

1. The user tests the app on a phone inside Telegram.
2. Bot server, recommended in TypeScript with grammY:
   - `/start`, a Menu Button that opens the Mini App, and `initData` validated on
     the server;
   - athlete profiles;
   - a Telegram Stars payment for a program built around the weak link;
   - reminders.
   The bot token goes into the Render environment, never into chat.
3. Calibration from 3–5 videos of real matches, filmed from above and the side.
4. Small items: versioned asset paths against stale cache, Render autodeploy
   access, and merging to the default branch.
