# ⛏ SoloStrike — Solo Bitcoin Mining Pool for Umbrel

Zero-fee solo Bitcoin mining pool. Connect your ASICs directly to your own node.

## Supported Miners
Antminer · BitAxe · NerdMiner · NerdQaxe++ · Avalon Nano 3S · Any Stratum V1 miner

## Miner Setup
```
URL:      stratum+tcp://umbrel.local:3333
Username: worker_name
Password: x
```

## Installation
Add this repo to Umbrel Community App Stores:
`https://github.com/danhaus93-ops/solostrike-umbrel`

Then install SoloStrike from your community store.

On first launch, enter your Bitcoin payout address — that's it.

## Architecture
- **ckpool-solo** — battle-tested solo pool backend
- **Node.js API** — real-time log parser, REST + WebSocket
- **React UI** — live dashboard, Deep Mine dark theme

## Ports
| Port | Service |
|------|---------|
| 1234 | Dashboard |
| 3333 | Stratum (miners connect here) |
