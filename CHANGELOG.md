# Changelog

All notable changes to SoloStrike will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Changelog begins at **v1.3.0 — the Private Mode release**. Earlier pre-release
history (v1.0.x, v1.1.x, v1.2.x) was shipped before formal release notes were
tracked and is omitted here intentionally. The full commit history is
available at
[github.com/danhaus93-ops/solostrike-umbrel/commits/main](https://github.com/danhaus93-ops/solostrike-umbrel/commits/main).

## [Unreleased](https://github.com/danhaus93-ops/solostrike-umbrel/compare/v1.5.2...HEAD)

### Planned

- **v1.9.x** — Smart alerts (worker-offline push notifications)
- **v1.10.x** — AxeOS temperature integration
- **v2.0.0** — DATUM protocol, Stratum V2 translator, official Umbrel App Store submission

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
