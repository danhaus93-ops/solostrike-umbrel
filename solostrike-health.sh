#!/bin/bash
#
# solostrike-health.sh
#
# One-page health report for the SoloStrike app on Umbrel.
# Run with:  ./solostrike-health.sh         (full report)
#            ./solostrike-health.sh -q      (quiet — top summary only)
#            ./solostrike-health.sh -w      (watch — refresh every 10s)
#
# Saves you from remembering individual docker/wget commands.
# Read-only. Does not modify any state. Safe to run anytime.

set -u  # don't die on errors — we want to continue even if a section fails

# ── colors (skip if not a tty) ──────────────────────────────────────────
if [[ -t 1 ]]; then
  BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'
  RED='\033[31m'; GREEN='\033[32m'; YELLOW='\033[33m'; CYAN='\033[36m'
else
  BOLD=''; DIM=''; RESET=''; RED=''; GREEN=''; YELLOW=''; CYAN=''
fi

# ── flags ───────────────────────────────────────────────────────────────
QUIET=0; WATCH=0
for arg in "$@"; do
  case "$arg" in
    -q|--quiet) QUIET=1 ;;
    -w|--watch) WATCH=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//;1d' | head -10
      exit 0 ;;
  esac
done

# ── constants ───────────────────────────────────────────────────────────
API="danhaus93-solostrike_api_1"
UI="danhaus93-solostrike_ui_1"
CK="danhaus93-solostrike_ckpool_1"

# ── helpers ─────────────────────────────────────────────────────────────
hdr() { printf "\n${BOLD}${CYAN}━━━ %s ━━━${RESET}\n" "$1"; }
ok()  { printf "${GREEN}✓${RESET} %s\n" "$1"; }
warn(){ printf "${YELLOW}!${RESET} %s\n" "$1"; }
bad() { printf "${RED}✗${RESET} %s\n" "$1"; }

api_state() {
  sudo docker exec "$API" wget -qO- http://localhost:3001/api/state 2>/dev/null
}

# ── prereqs ─────────────────────────────────────────────────────────────
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 required but not found — install with: sudo apt install python3"
  exit 1
fi

# ── main report ─────────────────────────────────────────────────────────
run_report() {
  printf "${BOLD}SoloStrike Health Report${RESET} ${DIM}— $(date '+%Y-%m-%d %H:%M:%S %Z')${RESET}\n"

  # ── Containers ────────────────────────────────────────────────────────
  hdr "Containers"
  for c in "$API" "$UI" "$CK"; do
    info=$(sudo docker inspect "$c" --format '{{.State.Status}} restarts={{.RestartCount}}' 2>/dev/null)
    if [[ -z "$info" ]]; then
      bad "$c — not found"
    elif [[ "$info" == running* ]]; then
      ok "$c — $info"
    else
      warn "$c — $info"
    fi
  done

  # ── Quick state snapshot via API ──────────────────────────────────────
  state=$(api_state)
  if [[ -z "$state" ]]; then
    bad "Could not reach API at http://localhost:3001/api/state — skipping rest"
    return 1
  fi

  hdr "Snapshot"
  echo "$state" | python3 -c "
import sys, json
d = json.load(sys.stdin)
hr = d.get('hashrate', {})
sh = d.get('shares', {})
zmq = d.get('zmq', {})
node = d.get('nodeInfo', {})
workers = d.get('workers', [])
on = [w for w in workers if w.get('status') != 'offline']
off = [w for w in workers if w.get('status') == 'offline']
cur = hr.get('current', 0)/1e12
avg1m = hr.get('averages',{}).get('hr1m', 0)/1e12
avg1h = hr.get('averages',{}).get('hr1h', 0)/1e12
avg24h = hr.get('averages',{}).get('hr24h', 0)/1e12
print(f'Hashrate now : {cur:6.2f} TH/s')
print(f'  1m / 1h    : {avg1m:5.2f} / {avg1h:5.2f} TH/s')
print(f'  24h avg    : {avg24h:5.2f} TH/s')
status = '\033[32m✓\033[0m' if not off else f'\033[33m! {len(off)} offline\033[0m'
print(f'Workers      : {len(on)}/{len(workers)} online {status}')
if off:
    names = ', '.join(w.get('name','?') for w in off)
    print(f'  OFFLINE    : {names}')
print(f'Shares accpt : {sh.get(\"acceptedCount\", 0):,}  rej {sh.get(\"rejectedCount\",0)}  stale {sh.get(\"stale\",0)}')
total = sh.get('acceptedCount',0) + sh.get('rejectedCount',0) + sh.get('stale',0)
acc_pct = (sh.get('acceptedCount',0) / total * 100) if total else 100
zmq_str = '\033[32m✓ connected\033[0m' if zmq.get('connected') else '\033[31m✗ DISCONNECTED\033[0m'
print(f'  accept rate: {acc_pct:.3f}%')
print(f'ZMQ          : {zmq_str}')
print(f'Node         : height {node.get(\"blocks\", \"?\"):,}  sync {node.get(\"verificationProgress\", 0)*100:.2f}%  peers {node.get(\"peers\", \"?\")}')
mp = node.get('mempoolSize', None)
if mp is not None:
    print(f'Mempool      : {mp:,} tx')
"

  # Quiet mode stops here
  [[ $QUIET -eq 1 ]] && return 0

  # ── Per-worker table ──────────────────────────────────────────────────
  hdr "Per-Worker Health"
  echo "$state" | python3 -c "
import sys, json, time
d = json.load(sys.stdin)
now = time.time() * 1000
ws = sorted(d.get('workers', []), key=lambda x: -(x.get('hashrate') or 0))
if not ws:
    print('  (no workers reporting)')
    sys.exit()
print(f'  {\"WORKER\":<22} {\"HASHRATE\":>12} {\"LAST\":>8} {\"ACCPT\":>8} {\"STALE\":>6} {\"STATUS\":>9}')
for w in ws:
    age_s = (now - (w.get('lastSeen') or 0)) / 1000
    if age_s < 90:
        age_str = f'{age_s:.0f}s'
    elif age_s < 3600:
        age_str = f'{age_s/60:.1f}m'
    else:
        age_str = f'{age_s/3600:.1f}h'
    hr = (w.get('hashrate') or 0) / 1e12
    name = (w.get('name') or '?')[:22]
    accpt = w.get('sharesCount', 0)
    stale = w.get('stale', 0)
    status = w.get('status', '?')
    if status == 'offline':
        s_col = f'\033[31m{status:>9}\033[0m'
    else:
        s_col = f'\033[32m{status:>9}\033[0m'
    print(f'  {name:<22} {hr:>9.2f} TH/s {age_str:>8} {accpt:>8} {stale:>6} {s_col}')
"

  # ── Recent errors / warnings in logs ──────────────────────────────────
  hdr "Recent Log Errors (API, last 200 lines)"
  errs=$(sudo docker logs --tail 200 "$API" 2>&1 | grep -iE "error|warn|fail|crash|exception" | grep -v "ECONNREFUSED.*tcp4" | tail -10)
  if [[ -z "$errs" ]]; then
    ok "No errors or warnings"
  else
    echo "$errs" | sed 's/^/  /'
  fi

  # ── Drift guard / share-watcher state ────────────────────────────────
  hdr "Share-Watcher (last boot)"
  sw=$(sudo docker logs "$API" 2>&1 | grep -i "share-watcher\|drift" | tail -5)
  if [[ -z "$sw" ]]; then
    warn "No share-watcher log lines found"
  else
    echo "$sw" | sed 's/^/  /'
  fi

  # ── Resource usage ────────────────────────────────────────────────────
  hdr "Resource Usage"
  sudo docker stats --no-stream --format "  {{.Name}}: CPU {{.CPUPerc}} MEM {{.MemUsage}}" "$API" "$UI" 2>/dev/null

  # ── Disk space ────────────────────────────────────────────────────────
  hdr "Disk"
  df -h / 2>/dev/null | awk 'NR==1 || NR==2 {printf "  %-20s %-8s %-8s %-8s %s\n", $1, $2, $3, $4, $5}'
  ck_size=$(sudo du -sh /var/log/ckpool/ 2>/dev/null | awk '{print $1}')
  if [[ -n "$ck_size" ]]; then
    printf "  ckpool logs: %s\n" "$ck_size"
  fi

  printf "\n${DIM}Run with -q for quick snapshot, -w to live-watch.${RESET}\n"
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
