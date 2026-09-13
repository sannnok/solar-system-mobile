# Orrery

An interactive 3D solar system in the browser. Planets orbit on real Keplerian
elements, so the date in the corner is not decoration — what you see is roughly
where the planets actually are on that day.

No build step, no bundler, no network calls. Open it and it runs.

## Running it

```bash
npm start          # http://localhost:5173
```

Any static file server works just as well — it is plain ES modules:

```bash
python3 -m http.server 5173
```

## Testing it on a phone

There is no app to build and no Expo involved — this is a web page, so a phone
only needs to reach a URL.

**Same Wi-Fi, over your network.** The quickest way:

```bash
npm run mobile
```

That binds every interface and prints your machine's network address along with
a QR code. Point the phone's camera at it. The QR encoder lives in
`scripts/qr.mjs` and pulls in no dependencies.

```
  local    http://localhost:5173
  network  http://192.168.1.104:5173

  Scan with a phone on the same Wi-Fi:

  █▀▀▀▀▀█ ▀▄█▀▄ █▀▀▀▀▀█
  █ ███ █ █▄ ▄▀ █ ███ █
  █ ▀▀▀ █ ▀█▄▀▄ █ ▀▀▀ █
  ▀▀▀▀▀▀▀ ▀ █ ▀ ▀▀▀▀▀▀▀
  ...
```

Note that this puts the server on your local network for as long as it runs.
It only serves this directory, and refuses dotfiles so `.git` never leaks, but
plain `npm start` stays on loopback so you opt into that deliberately.

**No machine at all: GitHub Pages.** There is no build step, so the repository
can be served exactly as it sits. In *Settings → Pages*, choose "Deploy from a
branch" and pick this branch with folder `/ (root)`. The app uses only relative
paths, so it works from a project subpath such as
`https://<user>.github.io/solar-system-mobile/` without any configuration. This
is also the easiest way to get it onto a phone that is not on your Wi-Fi, or to
send someone a link.

**A tunnel,** if you want a public HTTPS URL without deploying — run the server,
then point `cloudflared tunnel --url http://localhost:5173` or `ngrok http 5173`
at it and open the address it gives you.

**Real debugging on the device.** Android: `chrome://inspect` on the desktop with
the phone on USB. iOS: enable *Settings → Safari → Advanced → Web Inspector*,
then find the tab under Safari's Develop menu on a Mac. Chrome DevTools device
emulation is useful for layout, but it will not tell you anything real about
GPU performance.

The app itself needs no HTTPS — there is no camera, geolocation or service
worker — so a plain `http://` LAN address is fine. It does use import maps, so
it wants iOS 16.4+, Chrome 89+ or Firefox 108+.

## What you can do

| | |
|---|---|
| **Click or tap a body** | The camera eases over and then follows it around its orbit. You keep full orbit and zoom control while it moves. |
| **Speed slider** | Logarithmic, from about 3 simulated minutes per second to 5.5 years per second. |
| **Pause** | Eases to a stop rather than snapping. |
| **Labels / Orbits / Trails** | Toggle each layer independently. |
| **Now** | Jump the clock back to the present moment. |
| **Reset** | Re-frame the whole system. |

Drag to orbit the camera, scroll or pinch to zoom. Moon labels and moon orbits
appear once you focus their planet, so the inner system does not turn into a
wall of text.

**Keyboard:** `Space` pause · `←` `→` cycle bodies · `Esc` back to the full
system · `L` labels · `O` orbits · `T` trails

## How it works

**Positions.** `src/core/kepler.js` implements the standard JPL "approximate
positions of the major planets" method: six orbital elements per body, each with
a linear rate per Julian century, propagated to the current time and then solved
for the eccentric anomaly by Newton-Raphson. Accuracy is on the order of
arcminutes between 1800 and 2050, and the sidereal periods that fall out of it
match the published values exactly — Earth's perihelion lands on 3 January at
0.98330 AU, where it should.

**Scale.** A true-to-scale solar system is unwatchable: at Neptune's distance
the inner planets are a single pixel. Orbital distances and body radii are each
compressed with a power curve (`src/core/scale.js`). Directions and timing stay
exact — only magnitudes are squashed — so every planet is always in its real
position as seen from above the ecliptic. Planets also carry a soft halo that
keeps them findable when they are only a few pixels across, and fades out as you
approach.

**Trails.** Rather than recording where a planet has been, each trail is solved
*backwards* from the current time (`src/render/trails.js`). That makes it exact
at any speed, immune to frame-rate hitches, and correct the instant the clock is
scrubbed or paused. Trail length follows the simulation rate, clamped so every
body always shows something and nothing ever laps its own orbit.

**Surfaces.** Every texture is painted at runtime onto a canvas
(`src/render/textures.js`) — banded gas giants, cratered rock, Earth's
continents and cloud deck, Saturn's rings with the Cassini division, the Sun's
granulation, and a faint galactic band for the sky. Nothing is downloaded, so
the whole repository stays text and the app works offline.

**Framing.** The orbits form a disc seen at an angle, so the edge nearest the
camera projects far larger than the far edge. The overview distance is found by
projecting a ring of sample points and binary-searching the closest distance
that still fits (`src/camera/focus.js`). The frustum is also skewed so the scene
centres in the space the chrome actually leaves free — which on a phone is what
stops the info sheet from covering the planet you just tapped.

## Layout

```
index.html            page shell
styles/main.css       all styling
src/
  main.js             bootstrap, render loop, input wiring
  core/               kepler.js · scale.js · simulation.js
  data/bodies.js      orbital elements, physical facts, surface recipes
  render/             system.js · textures.js · noise.js · orbits.js
                      trails.js · starfield.js · sun.js
  camera/focus.js     click-to-focus and follow
  ui/                 controls.js · infoPanel.js · labels.js · picker.js
  util/               math.js · time.js
vendor/three/         three.js r180 (MIT), vendored so there is no CDN dependency
scripts/
  dev-server.mjs      static server; `--host` exposes it and prints a QR
  qr.mjs              dependency-free QR encoder for that QR
```

## Notes

- Quality tiers (texture size, geometry detail, star count) are chosen at
  startup from screen size and core count; textures are painted one body per
  frame so the loading bar reports real progress instead of freezing.
- Distances between a planet and its moons are compressed much harder than
  everything else. The Moon really sits 60 Earth radii out, which would be
  invisible here; ordering within each system is preserved.
- Pluto is included, with the extended element set and its 17° inclination
  intact — it is the clearest reminder that these orbits are not coplanar.

## Licence

MIT. Bundled three.js is MIT, see `vendor/three/LICENSE`.
