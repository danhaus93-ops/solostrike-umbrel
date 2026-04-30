#!/bin/bash
#
# solostrike-health.sh — comprehensive health report
#
# Usage:
#   ./solostrike-health.sh        full report (default)
#   ./solostrike-health.sh -q     quick snapshot only
#   ./solostrike-health.sh -v     verbose — everything including BTC node, ZMQ, ckpool internals
#   ./solostrike-health.sh -w     watch mode (refresh every 10s)
#   ./solostrike-health.sh -h     help
#
# Read-only. Does not modify any state. Safe to run anytime.

set -u

# ── colors ──────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'
  RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'; CYAN='\033[36m'; BLUE='\033[34m'
else
  BOLD=''; DIM=''; RESET=''; RED=''; GREEN=''; YELLOW=''; CYAN=''; BLUE=''
fi

# ── flags ───────────────────────────────────────────────────────────────
QUIET=0; WATCH=0; VERBOSE=0
for arg in "$@"; do
  case "$arg" in
    -q|--quiet) QUIET=1 ;;
    -v|--verbose|--all) VERBOSE=1 ;;
    -w|--watch) WATCH=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//;1d' | head -12
      exit 0 ;;
  esac
done

# ── constants & detection ───────────────────────────────────────────────
API="danhaus93-solostrike_api_1"
UI="danhaus93-solostrike_ui_1"
CK="danhaus93-solostrike_ckpool_1"
PROXY="danhaus93-solostrike_app_proxy_1"
STUNNEL="danhaus93-solostrike_stunnel_1"

# ckpool logs are mounted from host into the ckpool container at /var/log/ckpool
# On the host they live in the Umbrel app-data tree
CKPOOL_LOGS="/home/umbrel/umbrel/app-data/danhaus93-solostrike/data/ckpool/logs"

# Auto-detect Bitcoin Core container (different across Umbrel versions)
# - bitcoin_app_1     (current Umbrel, e.g. v1.x)
# - bitcoin_bitcoind_1 (older Umbrel)
# - bitcoin_server_1  (legacy)
# Exclude sidecars: app_proxy, tor, i2pd_daemon
BTC_CTR=$(sudo docker ps --format '{{.Names}}' 2>/dev/null | grep -E '^bitcoin_(app|bitcoind|server|node)_1$' | grep -vE 'proxy|tor|i2pd' | head -1)

STATE_FILE=$(mktemp /tmp/solostrike-state.XXXXXX.json)
trap 'rm -f "$STATE_FILE"' EXIT

# ── helpers ─────────────────────────────────────────────────────────────
hdr() { printf "\n${BOLD}${CYAN}━━━ %s ━━━${RESET}\n" "$1"; }
ok()  { printf "${GREEN}✓${RESET} %s\n" "$1"; }
warn(){ printf "${YELLOW}!${RESET} %s\n" "$1"; }
bad() { printf "${RED}✗${RESET} %s\n" "$1"; }
info(){ printf "${BLUE}ℹ${RESET} %s\n" "$1"; }

api_state() {
  sudo docker exec "$API" wget -qO- http://localhost:3001/api/state 2>/dev/null
}

# ── prereqs ─────────────────────────────────────────────────────────────
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 required but not found — install with: sudo apt install python3"
  exit 1
fi

# ════════════════════════════════════════════════════════════════════════
# SECTION FUNCTIONS
# ════════════════════════════════════════════════════════════════════════

section_containers() {
  hdr "Containers"
  for c in "$API" "$UI" "$CK" "$PROXY" "$STUNNEL"; do
    info=$(sudo docker inspect "$c" --format '{{.State.Status}} restarts={{.RestartCount}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' 2>/dev/null)
    if [[ -z "$info" ]]; then
      bad "$c — not found"
    elif [[ "$info" == running* ]]; then
      ok "$c — $info"
    else
      warn "$c — $info"
    fi
  done
  if [[ -n "$BTC_CTR" ]]; then
    info=$(sudo docker inspect "$BTC_CTR" --format '{{.State.Status}} restarts={{.RestartCount}}' 2>/dev/null)
    ok "$BTC_CTR — $info  ${DIM}(detected)${RESET}"
  else
    warn "Bitcoin Core container not detected — some checks will be skipped"
  fi
}

section_snapshot() {
  api_state > "$STATE_FILE"
  if [[ ! -s "$STATE_FILE" ]]; then
    bad "Could not reach API at http://localhost:3001/api/state"
    return 1
  fi

  hdr "Snapshot"
  python3 - "$STATE_FILE" << 'PYEOF'
import sys, json
with open(sys.argv[1]) as f:
    d = json.load(f)
hr = d.get('hashrate', {})
sh = d.get('shares', {})
zmq = d.get('zmq', {})
node = d.get('nodeInfo', {})
workers = d.get('workers', [])
on = [w for w in workers if w.get('status') != 'offline']
off = [w for w in workers if w.get('status') == 'offline']
cur = hr.get('current', 0)/1e12
av = hr.get('averages', {})
print(f'Hashrate now : {cur:6.2f} TH/s')
print(f'  1m / 1h    : {av.get("hr1m",0)/1e12:5.2f} / {av.get("hr1h",0)/1e12:5.2f} TH/s')
print(f'  6h / 24h   : {av.get("hr6h",0)/1e12:5.2f} / {av.get("hr24h",0)/1e12:5.2f} TH/s')
status = '\033[32m✓\033[0m' if not off else f'\033[33m! {len(off)} offline\033[0m'
print(f'Workers      : {len(on)}/{len(workers)} online {status}')
if off:
    def _short(n):
        n = n or '?'
        return n.split('.', 1)[1] if '.' in n else n
    print(f'  OFFLINE    : {", ".join(_short(w.get("name","?")) for w in off)}')
total = sh.get('acceptedCount',0) + sh.get('rejectedCount',0) + sh.get('stale',0)
acc_pct = (sh.get('acceptedCount',0) / total * 100) if total else 100
print(f'Shares accpt : {sh.get("acceptedCount",0):,}  rej {sh.get("rejectedCount",0)}  stale {sh.get("stale",0)}')
print(f'  accept rate: {acc_pct:.3f}%')
zmq_str = '\033[32m✓ connected\033[0m' if zmq.get('connected') else '\033[31m✗ DISCONNECTED\033[0m'
print(f'ZMQ          : {zmq_str}')
blocks = node.get('blocks')
peers = node.get('peers')
height_str = f'{blocks:,}' if isinstance(blocks, int) else (str(blocks) if blocks else '?')
peers_str = str(peers) if peers is not None else '?'
print(f'Node         : height {height_str}  sync {node.get("verificationProgress",0)*100:.2f}%  peers {peers_str}')
mp = node.get('mempoolSize')
if mp is not None:
    print(f'Mempool      : {mp:,} tx')
PYEOF
}

section_app_internals() {
  hdr "App Internals"
  python3 - "$STATE_FILE" << 'PYEOF'
import sys, json, time
with open(sys.argv[1]) as f:
    d = json.load(f)
import datetime as dt
print(f'Pool name    : {d.get("poolName","?")}')
print(f'Payout addr  : {d.get("payoutAddress","?")}')
print(f'Status       : {d.get("status","?")}')
print(f'Private mode : {d.get("privateMode", False)}')
started = d.get('startedAt')
if started:
    age = (time.time()*1000 - started) / 3600000
    print(f'API started  : {dt.datetime.fromtimestamp(started/1000).strftime("%Y-%m-%d %H:%M")}  ({age:.1f}h ago)')
sa = d.get('shareStatsStartedAt')
if sa:
    age = (time.time()*1000 - sa) / 3600000
    print(f'Tracking from: {dt.datetime.fromtimestamp(sa/1000).strftime("%Y-%m-%d %H:%M")}  ({age:.1f}h ago)')
bs = d.get('bestshare') or 0
if bs:
    if bs >= 1e9:
        bs_str = f'{bs/1e9:.2f} G'
    elif bs >= 1e6:
        bs_str = f'{bs/1e6:.2f} M'
    elif bs >= 1e3:
        bs_str = f'{bs/1e3:.2f} K'
    else:
        bs_str = f'{bs:.0f}'
    print(f'Best share   : {bs_str} (all-time)')
blocks_found = d.get('blocks', [])
print(f'Blocks found : {len(blocks_found)}')
if blocks_found:
    last = blocks_found[-1]
    print(f'  last block : #{last.get("height","?")} on {dt.datetime.fromtimestamp(last.get("ts",0)/1000).strftime("%Y-%m-%d %H:%M") if last.get("ts") else "?"}')
strikes = d.get('closestCalls', [])
print(f'Strikes (close calls): {len(strikes)}')
if strikes:
    s = max(strikes, key=lambda x: x.get('sdiff') or 0)
    print(f'  closest    : sdiff {s.get("sdiff",0):.2e} @ block {s.get("height","?")}')
odds = d.get('odds', {})
if odds:
    pd = odds.get('perDay', 0)
    pm = odds.get('perMonth', 0)
    py = odds.get('perYear', 0)
    ed = odds.get('expectedDays')
    print(f'Odds         : per-day {pd*100:.4f}%  per-month {pm*100:.3f}%  per-year {py*100:.2f}%')
    if ed:
        print(f'  expected   : 1 block every {ed:.1f} days')
luck = d.get('luck', {})
if luck and luck.get('luck') is not None:
    print(f'Luck         : {luck.get("luck",0)*100:.1f}%  ({luck.get("blocksFound",0)} found / {luck.get("blocksExpected",0):.2f} expected)')
hooks = d.get('webhooks', [])
print(f'Webhooks     : {len(hooks)} configured')
for h in hooks[:3]:
    events = ','.join(h.get('events', []))
    print(f'  - {h.get("name","?"):<20} → {h.get("url","?")[:50]} [{events}]')
PYEOF
}

section_workers() {
  hdr "Per-Worker Health"
  python3 - "$STATE_FILE" << 'PYEOF'
import sys, json, time
with open(sys.argv[1]) as f:
    d = json.load(f)
now = time.time() * 1000
ws = sorted(d.get('workers', []), key=lambda x: -(x.get('hashrate') or 0))
if not ws:
    print('  (no workers reporting)')
    sys.exit()
print(f'  {"WORKER":<22} {"HASHRATE":>12} {"LAST":>8} {"ACCPT":>8} {"STALE":>6} {"BEST":>10} {"STATUS":>9}')
for w in ws:
    age_s = (now - (w.get('lastSeen') or 0)) / 1000
    if age_s < 90:
        age_str = f'{age_s:.0f}s'
    elif age_s < 3600:
        age_str = f'{age_s/60:.1f}m'
    else:
        age_str = f'{age_s/3600:.1f}h'
    hr = (w.get('hashrate') or 0) / 1e12
    full_name = w.get('name') or '?'
    # ckpool stores usernames as "<address>.<workername>". The dashboard shows
    # only the workername part. Strip the address prefix if present.
    if '.' in full_name:
        full_name = full_name.split('.', 1)[1]
    name = full_name[:22]
    accpt = w.get('sharesCount', 0)
    stale = w.get('stale', 0)
    best = w.get('bestshare', 0) or 0
    if best >= 1e9:
        best_str = f'{best/1e9:.1f}G'
    elif best >= 1e6:
        best_str = f'{best/1e6:.1f}M'
    elif best >= 1e3:
        best_str = f'{best/1e3:.1f}K'
    else:
        best_str = f'{best:.0f}'
    status = w.get('status', '?')
    if status == 'offline':
        s_col = f'\033[31m{status:>9}\033[0m'
    else:
        s_col = f'\033[32m{status:>9}\033[0m'
    print(f'  {name:<22} {hr:>9.2f} TH/s {age_str:>8} {accpt:>8} {stale:>6} {best_str:>10} {s_col}')
PYEOF
}

section_btc_node() {
  hdr "Bitcoin Core Node"
  if [[ -z "$BTC_CTR" ]]; then
    warn "Bitcoin Core container not found — skipping"
    return
  fi

  # Sync state
  bci=$(sudo docker exec "$BTC_CTR" bitcoin-cli getblockchaininfo 2>/dev/null)
  if [[ -z "$bci" ]]; then
    warn "bitcoin-cli not responding"
    return
  fi
  echo "$bci" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
print(f'Chain        : {d.get(\"chain\",\"?\")}')
print(f'Blocks       : {d.get(\"blocks\",0):,}')
print(f'Headers      : {d.get(\"headers\",0):,}')
print(f'Sync         : {d.get(\"verificationprogress\",0)*100:.4f}%')
print(f'IBD          : {d.get(\"initialblockdownload\", False)}')
print(f'Difficulty   : {d.get(\"difficulty\",0):.4e}')
print(f'Chain size   : {d.get(\"size_on_disk\",0)/1e9:.1f} GB')
"
  # Network state
  ni=$(sudo docker exec "$BTC_CTR" bitcoin-cli getnetworkinfo 2>/dev/null)
  if [[ -n "$ni" ]]; then
    echo "$ni" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
print(f'BTC version  : {d.get(\"subversion\",\"?\")}')
print(f'Peers        : {d.get(\"connections\",0)} ({d.get(\"connections_in\",0)} in / {d.get(\"connections_out\",0)} out)')
print(f'Network active: {d.get(\"networkactive\", False)}')
"
  fi
  # Mempool
  mp=$(sudo docker exec "$BTC_CTR" bitcoin-cli getmempoolinfo 2>/dev/null)
  if [[ -n "$mp" ]]; then
    echo "$mp" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
print(f'Mempool      : {d.get(\"size\",0):,} tx, {d.get(\"bytes\",0)/1e6:.1f} MB, min fee {d.get(\"mempoolminfee\",0)*1e8:.1f} sat/kvB')
"
  fi
}

section_zmq() {
  hdr "ZMQ Configuration"
  if [[ -z "$BTC_CTR" ]]; then
    warn "Bitcoin Core container not found — skipping"
    return
  fi
  zmq=$(sudo docker exec "$BTC_CTR" bitcoin-cli getzmqnotifications 2>/dev/null)
  if [[ -z "$zmq" ]]; then
    warn "Could not query ZMQ config"
    return
  fi
  echo "$zmq" | python3 -c "
import sys, json
d = json.loads(sys.stdin.read())
if not d:
    print('  \033[31m✗ No ZMQ notifications configured in Bitcoin Core\033[0m')
    print('  Bitcoin Core needs zmqpub* settings in bitcoin.conf')
    print('  e.g. zmqpubrawblock=tcp://0.0.0.0:28332')
    sys.exit()
for n in d:
    t = n.get('type','?')
    addr = n.get('address','?')
    msgs = n.get('hwm','?')
    print(f'  {t:<20} → {addr}   (hwm={msgs})')
"
  # Try to detect what address SoloStrike thinks ZMQ is at
  echo ""
  python3 - "$STATE_FILE" << 'PYEOF'
import sys, json
with open(sys.argv[1]) as f:
    d = json.load(f)
zmq = d.get('zmq', {})
if zmq:
    print('  SoloStrike-side ZMQ state:')
    for k, v in zmq.items():
        print(f'    {k}: {v}')
PYEOF
}

section_pool_activity() {
  hdr "Pool / ckpool Activity"
  # pool.status freshness
  ps_path="$CKPOOL_LOGS/pool/pool.status"
  ps_mtime=$(sudo stat "$ps_path" --format='%Y' 2>/dev/null)
  if [[ -n "$ps_mtime" ]]; then
    now=$(date +%s)
    age=$((now - ps_mtime))
    if [[ $age -lt 30 ]]; then
      ok "pool.status is fresh (updated ${age}s ago)"
    else
      warn "pool.status is stale (updated ${age}s ago — ckpool may be hung)"
    fi
    # Show pool stats from inside pool.status
    ps_content=$(sudo cat "$ps_path" 2>/dev/null)
    if [[ -n "$ps_content" ]]; then
      echo "$ps_content" | python3 -c "
import sys, json
lines = [l for l in sys.stdin.read().split('\n') if l.strip()]
if len(lines) >= 3:
    try:
        rates = json.loads(lines[1])
        shares = json.loads(lines[2])
        print(f'  ckpool hashrate1m  : {rates.get(\"hashrate1m\",\"?\")}')
        print(f'  ckpool hashrate1hr : {rates.get(\"hashrate1hr\",\"?\")}')
        print(f'  ckpool best share  : {shares.get(\"bestshare\",\"?\")}')
        print(f'  ckpool SPS 1m      : {shares.get(\"SPS1m\",\"?\")}')
    except Exception as e:
        print(f'  (couldn\\'t parse pool.status: {e})')
" 2>/dev/null
    fi
  else
    warn "pool.status not found at $ps_path"
  fi

  # Sharelog activity (host-side path)
  recent_shares=$(sudo find "$CKPOOL_LOGS" -name "*.sharelog" -mmin -5 2>/dev/null | wc -l)
  total_shares=$(sudo find "$CKPOOL_LOGS" -name "*.sharelog" 2>/dev/null | wc -l)
  printf "  Sharelog files: %s active in last 5min / %s total\n" "$recent_shares" "$total_shares"

  # Recent block dirs (each ckpool block height gets its own dir)
  block_dirs=$(sudo ls -1d "$CKPOOL_LOGS"/[0-9a-f]*/ 2>/dev/null | wc -l)
  printf "  Block-height directories: %s\n" "$block_dirs"

  # ckpool log errors
  ck_errs=$(sudo docker logs --tail 200 "$CK" 2>&1 | grep -iE "error|fail|disconnect" | grep -v "client.*disconnect" | tail -5)
  if [[ -z "$ck_errs" ]]; then
    ok "No recent ckpool errors"
  else
    echo "  Recent ckpool errors/disconnects:"
    echo "$ck_errs" | sed 's/^/    /'
  fi
}

section_stratum_ports() {
  hdr "Stratum Ports"
  for port in 3333 3334 4333; do
    listening=$(sudo ss -tln 2>/dev/null | awk -v p=":$port" '$4 ~ p {print "yes"; exit}')
    if [[ "$listening" == "yes" ]]; then
      conns=$(sudo ss -tn state established "( sport = :$port )" 2>/dev/null | tail -n +2 | wc -l)
      ok "Port $port listening — $conns active connection(s)"
    else
      warn "Port $port NOT listening"
    fi
  done
}

section_logs() {
  hdr "Recent Log Errors (API, last 200 lines)"
  errs=$(sudo docker logs --tail 200 "$API" 2>&1 | grep -iE "error|warn|fail|crash|exception" | grep -v "ECONNREFUSED.*tcp4" | tail -10)
  if [[ -z "$errs" ]]; then
    ok "No errors or warnings"
  else
    echo "$errs" | sed 's/^/  /'
  fi
}

section_share_watcher() {
  hdr "Share-Watcher (last boot)"
  sw=$(sudo docker logs "$API" 2>&1 | grep -iE "share-watcher|drift" | tail -5)
  if [[ -z "$sw" ]]; then
    warn "No share-watcher log lines found"
  else
    echo "$sw" | sed 's/^/  /'
  fi
}

section_resources() {
  hdr "Resource Usage"
  sudo docker stats --no-stream --format "  {{.Name}}: CPU {{.CPUPerc}} MEM {{.MemUsage}}" "$API" "$UI" "$CK" 2>/dev/null
}

section_system() {
  hdr "System"
  # Uptime + load
  uptime_str=$(uptime 2>/dev/null | sed 's/^[ \t]*//')
  printf "  uptime: %s\n" "$uptime_str"

  # Memory
  mem=$(free -h 2>/dev/null | awk '/^Mem:/ {printf "  memory: total %s, used %s, free %s, available %s\n", $2, $3, $4, $7}')
  echo "$mem"
  swap=$(free -h 2>/dev/null | awk '/^Swap:/ {printf "  swap:   total %s, used %s\n", $2, $3}')
  echo "$swap"

  # Time sync
  if command -v timedatectl >/dev/null 2>&1; then
    sync=$(timedatectl status 2>/dev/null | grep -E "synchronized|Time zone" | sed 's/^[ \t]*/  /')
    echo "$sync"
  fi
}

section_disk() {
  hdr "Disk"
  df -h / 2>/dev/null | awk 'NR==1 || NR==2 {printf "  %-20s %-8s %-8s %-8s %s\n", $1, $2, $3, $4, $5}'
  ck_size=$(sudo du -sh /var/log/ckpool/ 2>/dev/null | awk '{print $1}')
  if [[ -n "$ck_size" ]]; then
    printf "  ckpool logs: %s\n" "$ck_size"
  fi
  cfg_size=$(sudo docker exec "$API" du -sh /app/config 2>/dev/null | awk '{print $1}')
  if [[ -n "$cfg_size" ]]; then
    printf "  api config:  %s\n" "$cfg_size"
  fi
}

# ════════════════════════════════════════════════════════════════════════
# MAIN REPORT
# ════════════════════════════════════════════════════════════════════════

run_report() {
  printf "${BOLD}SoloStrike Health Report${RESET} ${DIM}— $(date '+%Y-%m-%d %H:%M:%S %Z')${RESET}\n"

  section_containers || true
  section_snapshot   || return 1

  if [[ $QUIET -eq 1 ]]; then
    return 0
  fi

  section_app_internals || true
  section_workers       || true

  if [[ $VERBOSE -eq 1 ]]; then
    section_btc_node       || true
    section_zmq            || true
    section_pool_activity  || true
    section_stratum_ports  || true
  fi

  section_logs          || true
  section_share_watcher || true
  section_resources     || true

  if [[ $VERBOSE -eq 1 ]]; then
    section_system || true
  fi

  section_disk || true

  if [[ $VERBOSE -eq 0 ]]; then
    printf "\n${DIM}Run with -v for full diagnostics (BTC node, ZMQ, ckpool, stratum, system).${RESET}\n"
  fi
}

# ── execute ─────────────────────────────────────────────────────────────
if [[ $WATCH -eq 1 ]]; then
  while true; do
    clear
    run_report
    sleep 10
  done
else
  run_report
fi
