<div align="center">

## ⚡ Support Development

If SoloStrike helps you solo mine, a tip keeps the dev caffeine flowing:

**`bc1q6k0j7w77xftasgwx7v5nra06rs3v5txk60wgsk`**

*Lightning address coming soon ⚡*

</div>

---

<div align="center">

# ⛏ SoloStrike

**Zero-fee solo Bitcoin mining pool for your Umbrel node**

*Self-hosted. Self-custodied. Battle-tested.*

[![License](https://img.shields.io/badge/license-MIT-F5A623.svg)](LICENSE)
[![Umbrel](https://img.shields.io/badge/umbrel-community%20app-00FFD1.svg)](https://umbrel.com)
[![ckpool](https://img.shields.io/badge/powered%20by-ckpool--solo-39FF6A.svg)](https://bitbucket.org/ckolivas/ckpool-solo/)

</div>

---

## What is SoloStrike?

SoloStrike is a **self-hosted solo Bitcoin mining pool** that runs directly on your Umbrel node. It wraps the legendary `ckpool-solo` mining engine inside a modern real-time dashboard with a distinct **Deep Mine** aesthetic — industrial dark, molten amber, electric cyan.

Connect your ASICs, BitAxes, NerdMiners, or anything that speaks Stratum, and **keep 100% of every block you find**. No pool operator. No fees. No custody risk. No middleman rolling your rewards into someone else's payout table.

Just you, your node, and a lottery ticket that pays 3.125 BTC + fees if your hash lands.

---

## Why Solo?

In a pooled setup, thousands of miners split every block evenly. Tiny miners (BitAxes, NerdMiners, even single ASICs) receive microscopic daily payouts and hand a percentage to the pool operator.

In **solo mining**, you don't share. Every block your miners find pays **the entire reward to your wallet** — subsidy plus every satoshi of fees. The tradeoff is variance: you may mine for months and find nothing, or strike a block next week.

For hobbyists with a BitAxe, solo is a $300 lottery ticket that pays $200K+ if it hits. For serious miners running multiple machines pointed at their own node, solo eliminates the operator skim and keeps every sat in-house.

---

## Features

### ⚡ Real-Time Dashboard
- **Live hashrate waveform** with 60-minute rolling history
- **Pool hashrate** and network hashrate side-by-side
- **Auto-refreshing every 5 seconds** via WebSocket (no polling delays)

### 👷 Per-Worker Monitoring
- Live hashrate per miner
- Share acceptance rate visualization
- Online / offline status tracking
- Automatic worker discovery — just connect and they appear

### 🎰 Block Probability Engine
- Circular probability ring showing your share of network hashrate
- Expected time-to-find-a-block calculation
- Per-day / per-week / per-year probability estimates

### 💎 Block Found Celebration
- Confetti explosion animation
- Direct `mempool.space` link to view the block
- Block history feed with full hash and height

### 📊 Share Statistics
- Accepted / Rejected / Stale counters
- Visual acceptance-rate bar
- Color-coded health indicators

### 🔐 Zero Configuration, One-Time Setup
- Enter your Bitcoin payout address once on first launch
- Change it anytime from the Settings modal
- No pool accounts, no API keys, no middleware

### 🎨 Deep Mine Aesthetic
Industrial dark theme with molten amber accents, electric cyan network stats, and animated pulses. Built with Chakra Petch + JetBrains Mono typography. Every component is hand-tuned.

---

## Supported Miners

Anything that speaks Stratum V1 works out of the box:

| Miner | Protocol | Status |
|-------|----------|--------|
| Antminer (S9, S19, S21, L9) | Stratum V1 | ✅ |
| BitAxe (all variants) | Stratum V1 | ✅ Tested |
| BitAxe Ultra / Supra / Gamma | Stratum V1 | ✅ Tested |
| NerdMiner v2 | Stratum V1 | ✅ |
| NerdQaxe++ | Stratum V1 | ✅ |
| Avalon Nano 3 / 3S | Stratum V1 | ✅ |
| Whatsminer | Stratum V1 | ✅ |
| cgminer / bfgminer | Stratum V1 | ✅ |

---

## Installation

### 1. Add the Community App Store to Umbrel

On your Umbrel dashboard:

1. Go to **App Store** → tap the **⋯** menu (top right)
2. Select **Community App Stores**
3. Add this URL:
   ```
   https://github.com/danhaus93-ops/solostrike-umbrel
   ```
4. Tap **Add**

### 2. Install SoloStrike

1. Open the **SoloStrike Apps** community store
2. Tap **SoloStrike** → **Install**
3. Wait ~1 minute for Umbrel to pull the Docker images

### 3. First-Time Setup

1. Open SoloStrike from your Umbrel dashboard
2. Enter your **Bitcoin payout address** (`bc1q…`, `1…`, or `3…`)
3. Tap **Start Mining**
4. The dashboard goes live

### 4. Find Your Umbrel's LAN IP

You'll need your Umbrel's local network IP address to point miners at it. Find it one of these ways:

**From Umbrel:**
- Go to Settings → the local IP is shown at the top (usually `192.168.x.x`)

**From your router:**
- Log in to your router's admin page and look for "umbrel" in the connected devices list

**From terminal (if you have SSH access):**
```bash
ssh umbrel@umbrel.local
hostname -I
```

### 5. Point Your Miners

Configure each miner with these settings:

| Setting | Value |
|---------|-------|
| **Pool URL / Host** | `stratum+tcp://<YOUR-UMBREL-IP>` or just `<YOUR-UMBREL-IP>` |
| **Port** | `3333` |
| **Username** | Your Bitcoin payout address, optionally `.workername` appended |
| **Password** | `x` |

**Example for a BitAxe (AxeOS):**
```
Stratum URL:  192.168.50.228
Stratum Port: 3333
Stratum User: bc1q6k0j7w77xftasgwx7v5nra06rs3v5txk60wgsk.bitaxe1
Password:     x
```

> 💡 **Why the Bitcoin address as username?** ckpool-solo uses the username as the payout address when running in "any incoming valid BTC address" mode. This lets multiple wallets mine to the same pool if you want. The `.workername` suffix is optional but helpful if you have multiple miners — it shows up as a separate worker in the dashboard.

> ⚠️ **Don't use `umbrel.local` in miner configs.** Most ASICs don't resolve mDNS hostnames reliably. Always use the raw LAN IP.

Within 30–60 seconds your workers appear on the dashboard and shares start flowing.

---

## Architecture

```
┌────────────────────┐
│   Your ASICs /     │
│   BitAxes / etc    │
└─────────┬──────────┘
          │ Stratum V1
          ▼ port 3333
┌────────────────────┐
│    ckpool-solo     │  ← ghcr.io/getumbrel/docker-ckpool-solo
│  (mining engine)   │     Official Umbrel image, multi-arch
└──┬─────────────┬───┘
   │ status      │ RPC
   │ files       │
   ▼             ▼
┌──────────┐  ┌────────────────┐
│ API      │  │ Bitcoin Core   │
│ (Node)   │  │ (Umbrel app)   │
│ poller   │  │ Block template │
│ + WS     │  │ submission     │
└────┬─────┘  └────────────────┘
     │ WebSocket + REST
     ▼
┌────────────────────┐
│  Dashboard UI      │
│  (React + Vite)    │
│  nginx on :80      │
└────────────────────┘
     │
     ▼ via Umbrel app_proxy
   Port 1234
```

Three containers orchestrated by Umbrel:

- **`ckpool`** — Umbrel's official multi-arch ckpool-solo image handles all stratum connections and writes live stats to `/var/log/ckpool/pool/pool.status` and per-user files in `/var/log/ckpool/users/`
- **`api`** — Node.js status-file poller exposing REST + WebSocket endpoints on `:3001`. Reads ckpool's status files every 5 seconds and broadcasts to the UI
- **`ui`** — React SPA served by nginx, reverse-proxied through Umbrel's `app_proxy`

Plus Umbrel's injected `app_proxy` service handling auth and port routing.

---

## Ports

| Port | Service | Exposure |
|------|---------|----------|
| **1234** | Dashboard UI | Via Umbrel app_proxy (auth required) |
| **3333** | Stratum (miners connect here) | Open on LAN |
| 3001 | API server | Internal only |

---

## Bitcoin Core Connection

SoloStrike auto-connects to your Umbrel Bitcoin Core node using Umbrel's injected environment variables:

- `APP_BITCOIN_NODE_IP` — typically `10.21.21.8`
- `APP_BITCOIN_RPC_PORT` — `8332`
- `APP_BITCOIN_RPC_USER` — typically `umbrel`
- `APP_BITCOIN_RPC_PASS` — auto-generated secure password

**No manual RPC configuration required.** Your Bitcoin Core must be fully synced before ckpool can issue valid work to miners.

---

## FAQ

**Q: What's the catch?**
No catch. Solo mining is a game of variance. With 1 TH/s you find a block roughly once every 800 years statistically — but the distribution is random, so it could be tomorrow or never. This is 100% non-custodial, zero-fee, your-keys-your-coins mining.

**Q: Can I mine to any address?**
Any valid Bitcoin address — bech32 (`bc1q…`, `bc1p…`), legacy (`1…`), or P2SH (`3…`).

**Q: What happens when I find a block?**
ckpool constructs a coinbase transaction paying 100% of the subsidy (3.125 BTC currently) plus all fees directly to the address you entered in setup. It's confirmed on-chain the same as any other block.

**Q: Is this Stratum V2?**
No — SoloStrike runs Stratum V1, which is what 100% of existing ASICs and hobby miners speak out of the box. Stratum V2 support would require either miner firmware changes or an SRI translator proxy, which adds complexity without meaningful benefit for solo mining.

**Q: Why does the dashboard show high share counts compared to my miner's display?**
ckpool reports difficulty-weighted share values, not raw share counts. Your miner shows "115 shares submitted" while the dashboard may show "455,000+ accepted" — both are correct, just different metrics. The dashboard is showing total proof-of-work done.

**Q: Can I change my payout address later?**
Yes. Tap the ⚙ gear in the dashboard header → enter new address → save. ckpool automatically picks up the new config and miners reconnect within a few seconds.

**Q: How do I monitor logs?**

```bash
ssh umbrel@<YOUR-UMBREL-IP>
sudo docker logs -f danhaus93-solostrike_ckpool_1   # Mining engine
sudo docker logs -f danhaus93-solostrike_api_1      # API & status poller
sudo docker logs -f danhaus93-solostrike_ui_1       # Dashboard nginx
```

---

## Troubleshooting

### Miners won't connect / fall back to secondary pool

**Check port 3333 is reachable** from the miner's network:
```bash
ssh umbrel@<YOUR-UMBREL-IP>
timeout 2 bash -c '</dev/tcp/<YOUR-UMBREL-IP>/3333' && echo "PORT OPEN" || echo "PORT CLOSED"
```

If PORT CLOSED:
- Make sure your miner is on the same LAN as Umbrel (not a guest network)
- Some routers block inter-device traffic — check "AP Isolation" or "Client Isolation" settings

### Dashboard shows "Mining" but 0/0 workers online

The API may need to be restarted to pick up ckpool's status files:
```bash
sudo docker restart danhaus93-solostrike_api_1
```

Wait 15 seconds, refresh the dashboard. Workers should appear if shares are being submitted.

### ckpool fails with "No bitcoinds active"

ckpool can't reach Bitcoin Core. Verify:
```bash
sudo docker logs danhaus93-solostrike_ckpool_1 --tail 20
```

If you see `Failed to connect socket to localhost:8332` — the ckpool config is stale. Restart the app from the Umbrel UI or:
```bash
sudo docker restart danhaus93-solostrike_ckpool_1
```

### ckpool stuck in "Process main pid 1 still exists" loop

Stale lockfile issue. Fix:
```bash
sudo docker rm -f danhaus93-solostrike_ckpool_1
sudo umbreld client apps.restart.mutate --appId danhaus93-solostrike
```

### Shares showing as rejected

Usually means Bitcoin Core isn't fully synced yet — ckpool won't issue valid work until the node is at chain tip. Wait for initial sync to complete, then restart ckpool.

---

## Updates

When new versions ship, Umbrel will prompt you to update from the App Store. Your settings (payout address, pool name) persist across updates — they're stored in `${APP_DATA_DIR}/data/config`.

---

## Credits

- **[ckpool-solo](https://bitbucket.org/ckolivas/ckpool-solo/)** by Con Kolivas — the mining engine that makes this possible
- **[docker-ckpool-solo](https://github.com/getumbrel/docker-ckpool-solo)** by Umbrel — multi-arch prebuilt image
- **[mempool.space](https://mempool.space)** — block explorer integration

---

## License

MIT — use it, fork it, remix it. Just don't roll it into a custodial pool and charge fees. That's the opposite of the point.

---

## Disclaimer

Solo mining is a statistical game. You may mine for months or years without finding a block. You may find one tomorrow. Only mine with equipment and electricity you can afford to run without a guaranteed return.

SoloStrike provides the infrastructure. The lottery ticket is yours.

---

<div align="center">

**⛏ Solo mine responsibly. Keep your keys. Stack your sats. 💎**

*Find a block? Send a sat.*
**`bc1q6k0j7w77xftasgwx7v5nra06rs3v5txk60wgsk`**

</div>
