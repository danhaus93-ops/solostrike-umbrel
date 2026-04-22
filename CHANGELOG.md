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

- **v1.5.3** — TLS stratum on port 4333 via stunnel sidecar (Umbrel App Store blocker)
- **v1.6.x** — Profitability calculator (power cost → break-even math)
- **v1.7.x** — Smart alerts (worker-offline push notifications)
- **v1.8.x** — AxeOS temperature integration
- **v2.0.0** — DATUM protocol, Stratum V2 translator, official Umbrel App Store submission

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
