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
| Antminer (S9, S19, S21, L9) | Stratum V1 |
