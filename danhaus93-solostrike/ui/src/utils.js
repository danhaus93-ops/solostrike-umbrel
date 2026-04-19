export function fmtHr(hps) {
  if(!hps)return'0 H/s';
  const u=['H/s','KH/s','MH/s','GH/s','TH/s','PH/s','EH/s'];
  let v=hps,i=0;while(v>=1000&&i<u.length-1){v/=1000;i++;}
  return`${v<10?v.toFixed(2):v<100?v.toFixed(1):v.toFixed(0)} ${u[i]}`;
}

// GoBrrr-style compact difficulty: "2.79 G", "1.60 T", "52.20 M"
export function fmtDiff(d){
  if(!d)return'0';
  if(d>=1e15)return`${(d/1e15).toFixed(2)} P`;
  if(d>=1e12)return`${(d/1e12).toFixed(2)} T`;
  if(d>=1e9)return`${(d/1e9).toFixed(2)} G`;
  if(d>=1e6)return`${(d/1e6).toFixed(2)} M`;
  if(d>=1e3)return`${(d/1e3).toFixed(2)} K`;
  return d.toFixed(0);
}
// Alias for contexts where we want to be explicit
export const fmtDiffCompact = fmtDiff;

export function fmtNum(n){return new Intl.NumberFormat().format(Math.round(n||0));}
export function fmtUptime(ts){
  const s=Math.floor((Date.now()-ts)/1000),d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);
  return d>0?`${d}d ${h}h ${m}m`:h>0?`${h}h ${m}m`:`${m}m`;
}
export function fmtOdds(days){
  if(!days)return'—';
  if(days<1)return`${(days*24).toFixed(1)} hrs`;
  if(days<30)return`${days.toFixed(1)} days`;
  if(days<365)return`${(days/30).toFixed(1)} mo`;
  return`${(days/365).toFixed(1)} yrs`;
}
export function timeAgo(ts){
  const s=Math.floor((Date.now()-ts)/1000);
  if(s<60)return`${s}s ago`;if(s<3600)return`${Math.floor(s/60)}m ago`;
  if(s<86400)return`${Math.floor(s/3600)}h ago`;return`${Math.floor(s/86400)}d ago`;
}
export function fmtPct(x, digits=2){
  if(x==null||isNaN(x))return'—';
  if(Math.abs(x)<0.0001)return '0%';
  return `${x.toFixed(digits)}%`;
}
export function fmtDurationMs(ms){
  if(!ms||ms<0)return'—';
  const s=Math.floor(ms/1000);
  const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);
  if(d>0)return`${d}d ${h}h`;
  if(h>0)return`${h}h ${m}m`;
  return`${m}m`;
}
export function fmtSats(sats){
  if(sats==null)return'—';
  const btc=sats/1e8;
  if(btc>=1)return`${btc.toFixed(3)} BTC`;
  return`${Math.round(sats).toLocaleString()} sat`;
}
export function fmtBtc(btc, digits=4){
  if(btc==null||isNaN(btc))return'—';
  return`${btc.toFixed(digits)} BTC`;
}
export function blockTimeAgo(unixTs){
  if(!unixTs)return'—';
  return timeAgo(unixTs*1000);
}

// Currency formatter for BTC price display
const CURRENCY_SYMBOLS = { USD:'$', EUR:'€', GBP:'£', CAD:'C$', CHF:'Fr', AUD:'A$', JPY:'¥' };
export function fmtFiat(amount, currency='USD'){
  if(amount==null||isNaN(amount))return'—';
  const sym=CURRENCY_SYMBOLS[currency]||'$';
  const digits=currency==='JPY'?0:2;
  return`${sym}${amount.toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits})}`;
}
export const CURRENCIES = ['USD','EUR','GBP','CAD','CHF','AUD','JPY'];
