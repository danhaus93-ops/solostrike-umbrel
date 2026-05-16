# Changelog

All notable changes to SoloStrike will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Changelog begins at **v1.3.0 — the Private Mode release**. Earlier pre-release
history (v1.0.x, v1.1.x, v1.2.x) was shipped before formal release notes were
tracked and is omitted here intentionally. The full commit history is
available at
[github.com/danhaus93-ops/solostrike-umbrel/commits/main](https://github.com/danhaus93-ops/solostrike-umbrel/commits/main).

## [Unreleased](https://github.com/danhaus93-ops/solostrike-umbrel/compare/v1.11.10...HEAD)

### Planned

- **v1.12.x** — Performance pass: lazy-load Settings/Pulse/Reckoning modals, pause WebGL when offscreen
- **v1.13.x** — Galaxy topology visualization for Pulse network (deferred, gated on peer count)
- **v2.0.0** — DATUM protocol, Stratum V2 translator, official Umbrel App Store submission

-----

## [1.11.11](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.11.11) — 2026-05-16

Version-bump cleanup + trademark policy. v1.11.10's relicensing release
missed two version strings in the server backend, causing the Pulse
Strikers roster and the System Health card to keep displaying v1.11.7
even though the rest of the dashboard correctly showed v1.11.10. This
release fixes that and formalizes the SoloStrike brand protection policy.

### Fixed

- **`state.version` in `api/src/server.js`** was hardcoded to `'1.11.7'`
  and was never picked up by the release scripts because nothing matches
  that string outside this one line. This value is what gets broadcast
  to the Pulse network as your peer's version AND what the
  `/api/health/detailed` endpoint returns to the System Health card.
  Now correctly reads `'1.11.11'` and follows future release bumps.

- **Pulse Strikers roster** now displays your correct app version next
  to your peer entry (was stuck on v1.11.7 across previous releases).

- **System Health card** now displays the correct app version in its
  "v{X}" indicator (was stuck on v1.11.7 across previous releases).

### Added

- **`TRADEMARK.md`** — formal policy documenting that "SoloStrike", the
  pickaxe-and-Bitcoin icon, the LAVA visual identity, and the brand
  vocabulary ("Strikers", "The Hunt", "The Vein", etc.) are protected
  trademarks separate from the AGPL-3.0 source license. Models on
  Docker, Mozilla, and WordPress Foundation policies. Permits all the
  freedoms AGPL grants on the code while protecting users from
  malicious lookalike apps shipping under the SoloStrike name.

### Changed

- **README License section** updated to reference the AGPL-3.0
  effective-version cutoff at v1.11.11 (was v1.11.10) and link to
  the new TRADEMARK.md.

-----

## [1.11.10](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.11.10) — 2026-05-16

Relicensing release + small UI consistency fix. Pure code behavior is
unchanged for end users; this release primarily updates licensing terms
and brand protection.

### Changed

- **Relicensed from MIT to AGPL-3.0.** Starting with v1.11.10, SoloStrike is
  licensed under the [GNU Affero General Public License v3.0](LICENSE). This
  is a stricter copyleft license that ensures:

  - Personal use remains free (run SoloStrike on your own Umbrel, mine, keep
    100% of blocks — no obligations)
  - Forks must remain AGPL-3.0 with source code published
  - Hosted services running modified SoloStrike must disclose their source
    to users (AGPL Section 13 — closes the SaaS loophole that plain GPL
    leaves open)
  - Proprietary closed-source derivatives are no longer permitted

  Code in versions v1.0.0 through v1.11.9 remains MIT-licensed for those
  specific releases. New code from v1.11.10 forward is AGPL-3.0.

- **Added TRADEMARK.md trademark policy.** The SoloStrike name,
  pickaxe-and-Bitcoin logo, and LAVA visual identity are now explicitly
  documented as trademarks. AGPL gives you the right to fork the code; the
  trademark policy preserves the brand. Forks must use a clearly distinct
  name and replace the visual identity. See [TRADEMARK.md](TRADEMARK.md)
  for details.

### Fixed

- **Retarget color consistency.** The header `RETARGET` indicator was using
  inverted color semantics vs the Difficulty Retarget card. Both showed the
  same number but with opposite colors. Now matches the card across the
  entire dashboard: positive % (difficulty UP, harder for miners) is RED,
  negative % (difficulty DOWN, easier for miners) is GREEN.

### Why the license change

The MIT license is permissive — under MIT, any commercial mining-pool service
could legally take SoloStrike's code, change one line, and offer it as a
paid hosted service against the original project without giving anything back.

The AGPL-3.0 + trademark combination addresses both:

- **AGPL** ensures that anyone running modified SoloStrike as a service
  must release their source to users — drastically reducing the commercial
  moat for forked services
- **Trademark** ensures that even legitimate forks can't trade on the
  SoloStrike name — they must rename and rebrand

This is the same protection strategy used by Mastodon, Nextcloud, and Grafana.
The combination preserves open-source freedom while preventing extractive
commercial copying.

-----

## [1.11.9](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.11.9) — 2026-05-16

iOS reconnect hang fix. Fixes the 10-30 second hang when returning to
SoloStrike on iPhone/iPad after using another app for several minutes.

### Fixed

- **iOS Safari WebSocket zombie reconnect.** When iOS suspends Safari, it
  freezes JavaScript execution entirely. iOS then kills TCP connections
  silently — but because JS is frozen, the WebSocket `onclose` handler
  never fires. On resume, `readyState` still reports OPEN even though the
  TCP is dead. The previous visibility-resume logic checked `readyState`
  and bailed early thinking the socket was healthy, leaving users stuck
  on a zombie connection for 20-30 seconds.

  Fix: on every transition to visible, ALWAYS force-close the existing
  socket and reconnect fresh. Closing a zombie is a no-op; closing a
  healthy socket and reopening costs ~50ms on local network. Net effect:
  reconnect is near-instant when you return to the app.

- **Stale REST fetches blocking new requests.** Dashboard REST endpoints
  (`/api/state`, `/api/stratum-health`, `/api/health/detailed`) that were
  in-flight when iOS suspended remained stuck on dead TCP for 20+ seconds
  after resume, blocking new requests. All affected fetches now use
  `AbortController` with an 8-second timeout. Zombie post-suspend
  fetches abort fast so new ones proceed immediately.

  Debug log from a user's iPhone confirmed 20976ms and 21094ms hangs on
  these endpoints in v1.11.8; v1.11.9 caps them at 8s.

-----

## [1.11.8](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.11.8) — 2026-05-15

Snappier dashboard updates. Decouples poll cadence from broadcast cadence so
the dashboard feels meaningfully more alive without a proportional WebSocket
bandwidth cost.

### Performance

- **Status poller cadence reduced from 5s → 2s.** Internal state stays fresh
  for the HTTP `/api/state` endpoint and for the next eligible broadcast.
  File-cache reads only — no extra disk or network load on the host.

- **WebSocket broadcasts throttled to ≥3s minimum** (was 5s). Dashboard
  updates feel ~1.7× snappier without a proportional bandwidth increase
  (~1.7× the prior cadence vs the 2.5× a 2s rate would have cost). Pool
  hashrate, worker counts, and live tiles visibly tick faster.

- **Decoupled poll cadence from broadcast cadence**. Internal state refreshes
  every 2s; clients are notified every 3s minimum. Best of both worlds.

### Notes

- Entire v1.11.7 was a versioning misfire — the build pipeline produced
  pinned `:v1.11.7@sha256:` digests in `docker-compose.yml` before the
  cadence patch landed in the source, so the digests pointed to old code.
  v1.11.8 ships the same payload with a fresh tag and re-pinned digests.

-----

## [1.10.1](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.10.1) — 2026-05-08

Security release. Closes a data-leak in the public state endpoint, adds
SSRF protection on webhooks, and adds defense-in-depth response headers.
No user-visible UI changes; existing webhooks continue working unchanged.

### Security

- **Payout address no longer leaks via `/api/state`**. The public state
  endpoint (whitelisted in Umbrel's app_proxy for unauthenticated read
  access) was returning the user's Bitcoin payout address through a
  rest-spread in `transformState`. Now explicitly stripped. The address
  travels only over the authenticated `/api/config` endpoint and the
  auth-gated WebSocket. UI fetches both on mount; behavior unchanged.

- **Webhooks gain SSRF protection**. The webhook add handler now blocks
  URLs targeting private/loopback/link-local IP ranges and `.local`
  hostnames by default. Users with self-hosted services on their LAN
  (Home Assistant, internal ntfy.sh) can opt in per-webhook via a new
  "Allow internal/LAN URL" toggle in the form. Existing webhooks in
  `webhooks.json` continue firing unchanged.

- **Helmet middleware added** with Umbrel-safe configuration. Adds
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Permitted-Cross-Domain-Policies: none`, and others. Explicitly
  disables `frameguard` (Umbrel iframes the app), `contentSecurityPolicy`
  (inline styles everywhere), `crossOriginEmbedderPolicy` (WebGL CDN
  textures), and `hsts` (UI is HTTP-only via app_proxy; HSTS would lock
  browsers into HTTPS-only if Umbrel ever flips on TLS).

-----

## [1.10.0](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.10.0) — 2026-05-08

Visual polish pass. Three CSS-only refinements + one component change.
~150 lines of CSS, zero new JS dependencies, zero functional changes.

### Added

- **Card chrome refinement** — every card now has a faint ambient amber
  glow at its bottom edge via `.ss-card-chrome` class. Reads as physical
  hardware sitting on a soft light source.

- **Living status dots** — `.ss-status-dot-{green|amber|red}` replaces
  the static health dots in worker rows. Green: layered breathing core
  (1 → 0.92 → 1 over 2.5s) + outward-pinging ring. Amber: breath only,
  no ping (less alarming). Red: static dead-dot (truly disconnected).

- **Gradient section headers** — every `cardTitle` and `secTitle` now
  has a fading amber-to-transparent underline drawn via background-image
  instead of a flat 1px gray border. Auto-applies to ~20 section titles
  site-wide.

### Fixed

- **CSS class collision with carousel page-indicator dots**. The new
  `.ss-dot` was originally renamed to `.ss-status-dot` mid-iteration
  to avoid clashing with the existing carousel `.ss-dot` (used for the
  page-position indicators below the card stack). Carousel dots remain
  amber as designed.

-----

## [1.9.7](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.9.7) — 2026-05-08

Worker row layout refinement. Temperature now displays as its own third
line in the right column of each worker row (below hashrate and best
share), color-coded by tier:

- **<70°C** green
- **70–75°C** cyan
- **75–80°C** amber
- **≥80°C** red 🔥

Hides cleanly when no live polling data is available for that worker.

-----

## [1.9.4](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.9.4) — 2026-05-08

Avalon Nano 3S firmware compatibility. The Nano 3S firmware drops
everything after the first cgminer command on a single TCP connection,
which was causing pool/summary/stats to come back partial. Switched to
three parallel TCP connections (one per command) and added a parser for
their unusual "MM ID" string format (extracts Temp, TMax, Fan, FanR,
GHSmm, Ver, ELAPSED).

-----

## [1.9.3](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.9.3) — 2026-05-08

Pool Alignment section title now reads as the status itself:

- **✓ ALIGNED WITH SOLOSTRIKE** (green)
- **✗ NOT ON SOLOSTRIKE** (red)
- **? CAN'T VERIFY POOL** (amber, for firmware that redacts user field)

Removes the redundant small status pill that previously sat next to a
generic "Pool Alignment" heading.

-----

## [1.9.2](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.9.2) — 2026-05-07

Avalon Nano 3S false-positive fix. Some Avalon firmware redacts the user
field in the cgminer pools response. Previously this was rendering as
"WRONG POOL" (red). Now correctly shown as "unverifiable" (amber) with
case-insensitive comparison and trimmed whitespace. Empty pools array
on a miner is treated as "unknown" rather than misaligned.

-----

## [1.9.1](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.9.1) — 2026-05-07

Hotfix for blank worker-detail modal. The new `LiveStatsBlock` and
`PoolAlignmentBlock` referenced style consts (`section`, `secTitle`,
`kvRow`, `kvLabel`, `kvVal`) that lived inside `ShareStatsModal`'s
function scope. When React 18 tried to render the new modal sub-components
they threw `ReferenceError`, and React 18 silently unmounts the entire
tree on render errors (no `window.onerror`, no console output, just a
blank screen). Style consts now hoisted to module scope where any
sub-component can reach them.

-----

## [1.9.0](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.9.0) — 2026-05-07

Pool alignment + live telemetry. SoloStrike now connects to each miner's
local API every 60s to verify pool config and pull live data.

### Added

- **Pool alignment verification** for every worker. Two adapters cover
  the practical fleet: cgminer-JSON (TCP 4028) for LuxOS, BraiinsOS,
  Vnish, Whatsminer, Avalon Nano 3S, Avalon Q, Innosilicon, Goldshell,
  iPollo, and Bitmain stock; ESP-Miner HTTP (port 80) for BitAxe,
  NerdQaxe, NerdQaxe++, NerdMiner, Lucky, and PiAxe. Default-on,
  read-only (never sends write commands), no UI toggle. Power users
  can disable with `"minerPolling": false` in `config.json`.

- **Live telemetry** pulled from the same poll cycle: chip temperature,
  fan speeds, voltage, hardware error counter. Cached per-worker with
  5s timeout, persisted to `miner-records.json`.

- **`PoolAlignmentBlock`** + **`LiveStatsBlock`** in worker detail modal.

- **Pool alignment badges** in worker rows on main view.

- **`HotMinerBanner`** at the top of the dashboard when any worker
  exceeds 80°C, with a one-tap link to that worker's detail modal.

### Changed

- Worker rows show alignment status next to worker name with green
  check, red X, or amber question mark.

-----

## [1.8.x] — 2026-04-29 to 2026-05-06

Minor patch series between 1.8.0 (The Hunt) and 1.9.0. Highlights:

- WebGL background canvas refinements (rev55–rev70+): metallic-gold
  hashrate gradient, animated-bg layer behind `#root`, splash sequence
  retiming so the pickaxe-impact pose is visible before unmount.
- Carousel page-indicator dots gain proper hit-targets (~35×32 effective
  even though visually 7×7) and a fade-out-on-idle behavior.
- iframe-only top-of-app spacing fix for Umbrel webview.
- Footer-version cosmetic, persist file write hardening, minor copy
  changes throughout the dashboard.

-----

## [1.8.0](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.8.0) — 2026-04-29

The Hunt release. Vein redesigned as the Nonce Field, gold-mining vocabulary
purged in favor of Bitcoin-native naming, two new chart visualizations
(Hashrate Averages strip and Strike Velocity histogram), real ckpool data
replacing several estimates, and five bugs squashed.

### Added

- **The Hunt** card (renamed from "The Vein") with new **Nonce Field**
  visualization. Replaces the gold-bearing-quartz SVG with a 32×6 grid of
  dim points representing the 2³² nonce space. Cells flicker amber as the
  fleet hashes, a vertical scan line sweeps L→R representing nonce
  iteration order, and periodic strike flashes mark "winner" cells.
  Mining-accurate, distinct from anything else on the dashboard.
- **Strike Velocity** card — new chart sibling to Firepower, but renders as
  a vertical-bar histogram instead of a line. Each bar represents one
  minute of share submissions, color-coded green (normal), amber
  (anomalous high or low — vardiff bump or partial outage), red (zero —
  full downtime). 1H / 6H / 24H range buttons. Consumes the spsHistory
  ring buffer that has been silently collecting since v1.7.x.
- **Hashrate Averages strip** below the Firepower chart — seven rolling
  windows displayed as horizontal bars: 1M / 5M / 15M / 1H / 6H / 24H / 7D.
  Each label is also a clickable button that switches the chart range
  (replacing the old top-right range buttons). All seven windows now
  available where only four were before.
- **Bitcoin-native vocabulary throughout.**
  - "The Vein" → **The Hunt**
  - "The Goldfields" → **The Ledger**
  - "Gold Strikes" → **Solo Strikes**
  - "STRIKE!" alert → **BLOCK STRUCK!**
  - Card list now includes three "The X" thematic siblings:
    The Crew · The Hunt · The Ledger
- **Real shares-per-minute** in Share Stats card from ckpool's `sps1m`
  field. Falls back to hashrate-derived estimate only when the API hasn't
  populated yet.
- **Reject Rate** top-line tile in Share Stats (green &lt; 0.5%, amber &lt; 2%,
  red otherwise). Standard share-quality at-a-glance display.
- **Lifetime Shares** counter tile in Share Stats — raw share count,
  distinct from the difficulty-weighted "Accepted Work" tile above it.
- **Bitcoin Core subversion string** displayed under the parsed Client
  name on the Bitcoin Node card (e.g., "Satoshi:29.2.0").
- **Block Weight + Tx count** of the latest block on the Bitcoin Network
  card (from mempool.space's `extras.totalWeight` and `tx_count`).
- **Pool Uptime + Started date** tiles at the bottom of the Stratum
  Connection card.
- **Last epoch comparison** on the Difficulty Retarget card (e.g.,
  "+2.67% / Last epoch: -2.43%"). Cached per-epoch, recomputed when a
  new epoch begins.
- **YEARLY tile** in The Hunt's bottom stats grid (replaces a redundant
  SHARE tile that duplicated the per-block-odds figure already shown at
  the top of the card). Uses the new `state.odds.perYear` field.
- **Per-block odds** displayed as "1 in 10.4M" via new `fmtOddsInverse`
  helper instead of the unreadable "7.7e-6%" scientific notation.
- **Subsidy + Fees breakdown** displayed correctly on The Hunt card.
  Previously fees always read +0.0000 because two writers fought over
  `state.blockReward`.
- **Four new diagnostic lines** in the Share Diagnostics modal:
  - Avg Share Difficulty (`acceptedDiff / acceptedCount`)
  - Last Share (pool-level), color-coded green/amber/red by recency
  - Implied Hashrate from share submissions, with ✓/⚠ vs live hashrate
  - Session Started timestamp + duration
- **API foundations** (collecting now, future UI consumers):
  - `state.zmq.events[]` — last 30 hashblock notifications
  - `state.workers[].statusHistory[]` — 96-point per-worker online/offline
    history for future sparklines
  - 15M and 6H windows in the rolling averages

### Changed

- **Stratum Connection card** condensed to fit one screen on iPhone:
  - Three "tap to edit" italic labels removed (inputs are obviously
    editable)
  - Verbose helper lines folded into input `placeholder` attributes
  - Tighter padding throughout (row, label, input, helper)
  - Trailing "Connect any Stratum V1 miner..." paragraph removed
- **The Crew** worker filter search bar removed. For solo mining (~12-15
  workers) the filter was visual noise. Workers still sorted online-first,
  descending hashrate.
- **100% SOLO stamp** repositioned (`right:0.5rem, bottom:0.6rem` from
  `0.2/0.2`) so it's no longer clipped at the card's bottom edge on mobile.
- **Firepower chart range buttons** moved from top-right of card to the
  Hashrate Averages strip below it — cleaner header, click-target on the
  same labels showing the data.
- **"WORK ACCEPTED" label** in Share Stats renamed to **"ACCEPTED WORK"**
  to clarify it's difficulty-units, not a share count (the count is now
  shown separately in the Lifetime Shares tile).
- **Pulse canvas** now fills its full container (160px standalone) instead
  of being locked to 96px — fixes the empty band at the bottom of the
  Pulse card across all five animations (Sluice, Glimmers, Ticker,
  Conveyor, Embers).
- **Hash Ticker animation density** scales with canvas height — taller
  canvases stay visually full instead of having a sparse bottom band.

### Fixed

- **Vein/Hunt "Fees" always showed +0.0000** — `state.blockReward` had two
  writers fighting over it. `pollBitcoind` correctly computed fees from
  `getblocktemplate.coinbasevalue`, then `transformState` overwrote it
  using a never-populated field. `computeBlockReward` now uses the
  pre-computed value as source of truth and emits both key shapes for
  back-compat.
- **Worker rejected counter never decreased** — `wk.rejected = w.rejected
  || wk.rejected || 0` used falsy fallback, so a stable miner that started
  reporting 0 rejects kept the previous non-zero count forever. Changed
  `||` to `??`.
- **`state.blockReward` init shape** aligned with the writer (was declared
  with `{ totalBtc, base, fees }` but written with `{ subsidyBtc, feesBtc,
  totalBtc, totalSats }`).
- **`parseHashrate` was case-sensitive** — `endsWith('K')` would silently
  parse `"1.2t"` as `1.2` (off by 1e12). ckpool emits uppercase in
  practice but defensive fix is cheap.
- **CSV exports broke on commas/quotes/newlines.** Worker names, miner
  subversion strings, or pool names containing commas would shift every
  following column. New `csvEscape` helper applies proper RFC-4180 quoting
  to both `/api/export/blocks.csv` and `/api/export/workers.csv`.

### Removed

- Three "tap to edit" italic labels from the Stratum Connection card
- The Crew worker filter search bar
- Top-right `1H · 6H · 24H · 7D` button row above the Firepower chart
  (replaced by clickable labels in the Averages strip below)
- Redundant "Priority Fee" line on the Bitcoin Network card (the same
  `mempool.feeRate` was already shown as the Vein/Hunt's "Fast" tier)
- Redundant SHARE tile in The Hunt's bottom stats grid (was identical to
  the PER-BLOCK ODDS at top of the card)
- Inline "X.XX% accept" text in Share Stats (the Reject Rate tile shows
  the same info inverted, more prominently)

-----

## [1.5.2](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.5.2) — 2026-04-22

### Added

- **5-step onboarding wizard** for first-time setup. Walks new installers
  through welcome, payout address, miner connection (with scannable QR codes
  for both stratum ports), auto-detection of first connection, and a feature
  tour.
- **Scannable stratum QR codes** — point a BitAxe or NerdQaxe web UI’s camera
  at the wizard and the stratum URL auto-fills.
- **Auto-detect first worker connection** — wizard polls the pool API every
  three seconds and celebrates with a green checkmark the moment your first
  miner submits shares.
- `qrcode.react` added to UI dependencies.
- `isValidBtcAddress()` now exported from `utils.js` for component reuse.

### Changed

- New `OnboardingWizard` component replaces the bare `SetupScreen` for
  first-time installs. Existing installs with a payout address saved are
  unaffected and never see the wizard.

### Security

- Wizard is `localStorage`-gated via key `ss_wizard_completed_v1` — appears
  only once per browser, even across re-setup.

-----

## [1.5.1](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.5.1) — 2026-04-22

### Added

- **Progressive Web App support** — “Add to Home Screen” on iOS and Android
  installs SoloStrike as a standalone app with a real icon, splash screen,
  and full-screen chrome. Ships with four PWA icon sizes
  (512×512, 192×192, 180×180 Apple Touch, 32×32 favicon) plus a
  `manifest.webmanifest`.
- **Branded coinbase tag** — every block your pool finds is now tagged
  `/SoloStrike on Umbrel/` in the coinbase transaction, inscribing your
  Umbrel node’s contribution onto the Bitcoin blockchain forever.
- iOS status-bar and Android theme-color meta tags for native-feeling
  integration.
- Viewport `viewport-fit=cover` respects iPhone notch / Dynamic Island.

### Changed

- ckpool `POOL_SIGNATURE` environment variable upgraded from `SoloStrike/`
  to `SoloStrike on Umbrel/`.

-----

## [1.5.0](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.5.0) — 2026-04-21

### Added

- **umbrelOS home-screen widget** — native 4-stat widget showing Pool
  Hashrate, Connected Workers, Blocks Found, and Best Difficulty, refreshing
  every 10 seconds. First Umbrel mining pool with a fully custom widget
  alongside Public Pool.
- New `widget-server` container — tiny Bun + distroless service serving the
  widget JSON endpoint. Multi-arch (amd64 + arm64). Isolated from the main
  API so widget failures never affect the dashboard.
- CI migrated to **native arm64 GitHub runners** (`ubuntu-24.04-arm`) —
  eliminates qemu emulation bugs on V8/npm builds, reduces CI time to ~5 min.

### Fixed

- Orange Bitcoin ₿ glyph in the Latest Block strip is now properly centered.
  v1.4.0 overshot the correction; the offset has been halved for true
  optical centering.

-----

## [1.4.0](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.4.0) — 2026-04-21

### Added

- **Multi-arch Docker images** — all three services (ui, api, widget-server)
  now build for `linux/amd64` and `linux/arm64`. Runs natively on Raspberry
  Pi 4/5, Umbrel Home, and x86-64 hardware.
- `--btc-orange` and `--btc-orange-glow` CSS variables for consistent
  Bitcoin-accent theming across components.

### Changed

- Scrolling ticker now refreshes values every 30 seconds while scrolling.

-----

## [1.3.9](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.3.9) — 2026-04-21

### Added

- **Fully customizable scrolling ticker** — choose from 29 metrics across 6
  categories (network stats, pool stats, node health, prices, mempool, own
  fleet). Selections persist per-device.
- **“Match Top Strip” one-tap button** — mirrors your top-strip metric
  selection into the ticker in one click.
- Orange-on-black Bitcoin ₿ badge on the Latest Block strip.

### Changed

- Ticker rebuilds when metric selection changes — no manual refresh needed.

-----

## [1.3.8](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.3.8)

### Added

- Latest Block strip leads with the Bitcoin ₿ symbol for visual anchor.
- GitHub icon link in the footer.

-----

## [1.3.7](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.3.7)

### Changed

- Clock time and date in the header render in amber for consistent accent
  use.
- Card drag handle (≡) renders in amber.

-----

## [1.3.4](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.3.4)

### Added

- **Closest Calls leaderboard** — pool-wide historical leaderboard of the
  top 10 highest-difficulty shares ever submitted across your fleet.
- **Daily hashrate snapshots** — automatic UTC midnight rollup, 90 days of
  per-day average and peak history retained.
- **Miner IP capture** — each worker’s source IP is logged and displayed as
  a clickable link that opens the miner’s web UI in a new tab.

-----

## [1.3.3](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.3.3)

### Added

- **ZMQ status badge** in the header — green (🟢 active) / yellow (🟡 idle) /
  gray (⚪ off). Shows at a glance whether Bitcoin Core’s block broadcasts
  are reaching the pool.
- **Dual stratum ports** — 3333 for ASICs (S19/S21, Whatsminer), 3334 for
  hobby miners (BitAxe, NerdQaxe, NerdMiner) with lower starting difficulty.

-----

## [1.3.0](https://github.com/danhaus93-ops/solostrike-umbrel/releases/tag/v1.3.0) — The Private Mode release

### Added

- **🔒 Private Mode** — one toggle, fully airgapped operation. Blocks all
  outbound API calls including mempool.space, BTC price APIs (7 currencies),
  and network difficulty lookups. The dashboard runs entirely on local
  Bitcoin Core data. Ideal for users on airgapped or Tor-only networks.
- Top-strip metric selection, customizable from Settings → Display.
- Prometheus `/metrics` endpoint for scraping into Grafana or Home
  Assistant.
- Webhooks — POST block and worker events to Discord, ntfy.sh, Home
  Assistant, Telegram, or any custom HTTP endpoint.
- Public read-only API for exposing pool stats externally.

### Changed

- Major dashboard restyling to the current “Deep Mine” aesthetic:
  industrial dark, molten amber accents, electric cyan network stats.

-----
