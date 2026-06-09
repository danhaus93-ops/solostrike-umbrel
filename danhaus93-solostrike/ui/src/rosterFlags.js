// rosterFlags.js — self-declared Roster flag data + render helpers (v1)
// Render model (matches App.jsx supportsFlagEmoji/FlagGlyph):
//   • bare country ("US") and GB nations w/ emoji  -> emoji on Apple, bundled
//     SVG on Windows/everything else (/flags/<CC>.svg)
//   • all other subdivisions ("US-TX") and NIR     -> bundled PNG every platform
//     (/flags/<CC>-<SUB>.png) — no flag emoji exists for them
// Broadcast value is a region code: "US" or "US-TX". Never coordinates.
import { FLAG_DATA } from './flagAssets.js';

export const COUNTRIES = [["US", "United States", "🇺🇸"], ["CA", "Canada", "🇨🇦"], ["MX", "Mexico", "🇲🇽"], ["GB", "United Kingdom", "🇬🇧"], ["IE", "Ireland", "🇮🇪"], ["DE", "Germany", "🇩🇪"], ["FR", "France", "🇫🇷"], ["ES", "Spain", "🇪🇸"], ["PT", "Portugal", "🇵🇹"], ["IT", "Italy", "🇮🇹"], ["NL", "Netherlands", "🇳🇱"], ["BE", "Belgium", "🇧🇪"], ["CH", "Switzerland", "🇨🇭"], ["AT", "Austria", "🇦🇹"], ["SE", "Sweden", "🇸🇪"], ["NO", "Norway", "🇳🇴"], ["FI", "Finland", "🇫🇮"], ["DK", "Denmark", "🇩🇰"], ["PL", "Poland", "🇵🇱"], ["CZ", "Czechia", "🇨🇿"], ["UA", "Ukraine", "🇺🇦"], ["RU", "Russia", "🇷🇺"], ["GR", "Greece", "🇬🇷"], ["TR", "Turkey", "🇹🇷"], ["BR", "Brazil", "🇧🇷"], ["AR", "Argentina", "🇦🇷"], ["CL", "Chile", "🇨🇱"], ["CO", "Colombia", "🇨🇴"], ["ZA", "South Africa", "🇿🇦"], ["EG", "Egypt", "🇪🇬"], ["NG", "Nigeria", "🇳🇬"], ["KE", "Kenya", "🇰🇪"], ["SA", "Saudi Arabia", "🇸🇦"], ["AE", "UAE", "🇦🇪"], ["IR", "Iran", "🇮🇷"], ["IN", "India", "🇮🇳"], ["PK", "Pakistan", "🇵🇰"], ["BD", "Bangladesh", "🇧🇩"], ["CN", "China", "🇨🇳"], ["JP", "Japan", "🇯🇵"], ["KR", "South Korea", "🇰🇷"], ["ID", "Indonesia", "🇮🇩"], ["TH", "Thailand", "🇹🇭"], ["VN", "Vietnam", "🇻🇳"], ["PH", "Philippines", "🇵🇭"], ["MY", "Malaysia", "🇲🇾"], ["SG", "Singapore", "🇸🇬"], ["AU", "Australia", "🇦🇺"], ["NZ", "New Zealand", "🇳🇿"]];
export const SUB_KINDS = { US:'state', CA:'province', DE:'state', AU:'state/territory', GB:'nation' };
export const SUBDIVISIONS = {"US": [["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"]], "CA": [["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"], ["NL", "Newfoundland & Lab."], ["NT", "Northwest Terr."], ["NS", "Nova Scotia"], ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Is."], ["QC", "Quebec"], ["SK", "Saskatchewan"], ["YT", "Yukon"]], "DE": [["BW", "Baden-Württemberg"], ["BY", "Bavaria"], ["BE", "Berlin"], ["BB", "Brandenburg"], ["HB", "Bremen"], ["HH", "Hamburg"], ["HE", "Hesse"], ["NI", "Lower Saxony"], ["MV", "Meck.-Vorp."], ["NW", "N. Rhine-Westph."], ["RP", "Rhineland-Pal."], ["SL", "Saarland"], ["SN", "Saxony"], ["ST", "Saxony-Anhalt"], ["SH", "Schleswig-H."], ["TH", "Thuringia"]], "AU": [["ACT", "Capital Terr."], ["NSW", "New South Wales"], ["NT", "Northern Terr."], ["QLD", "Queensland"], ["SA", "S. Australia"], ["TAS", "Tasmania"], ["VIC", "Victoria"], ["WA", "W. Australia"]], "GB": [["ENG", "England"], ["NIR", "Northern Ireland"], ["SCT", "Scotland"], ["WLS", "Wales"]]};
const GB_EMOJI = {"ENG": "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "SCT": "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "WLS": "🏴󠁧󠁢󠁷󠁬󠁳󠁿"};

const _emoji = Object.fromEntries(COUNTRIES.map(c => [c[0], c[2]]));
const _cname = Object.fromEntries(COUNTRIES.map(c => [c[0], c[1]]));

export function hasSubs(cc) { return !!SUBDIVISIONS[cc]; }
export function countryName(cc) { return _cname[cc] || cc; }

// Canvas feature-test: do flag emoji render in color on this platform?
// iPhone/Mac -> true (use emoji). Windows -> false (use bundled image).
let _flagEmojiOK = null;
export function supportsFlagEmoji() {
  if (_flagEmojiOK !== null) return _flagEmojiOK;
  try {
    if (typeof document === 'undefined') { _flagEmojiOK = true; return true; }
    const c = document.createElement('canvas'); c.width = 24; c.height = 16;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) { _flagEmojiOK = true; return true; }
    ctx.textBaseline = 'top'; ctx.font = '16px sans-serif'; ctx.fillStyle = '#000';
    ctx.fillText('\uD83C\uDDFA\uD83C\uDDF8', 0, 0); // US flag
    const d = ctx.getImageData(0, 0, 24, 16).data; let colored = false;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i+3] > 16 && (Math.max(d[i],d[i+1],d[i+2]) - Math.min(d[i],d[i+1],d[i+2])) > 40) { colored = true; break; }
    }
    _flagEmojiOK = colored;
  } catch (e) { _flagEmojiOK = true; }
  return _flagEmojiOK;
}

// Emoji for a roster code, or null if none exists (-> use image).
export function emojiForCode(code) {
  if (!code || code === 'auto') return '🌐';
  const [cc, sub] = String(code).split('-');
  if (!sub) return _emoji[cc] || null;          // bare country
  if (cc === 'GB') return GB_EMOJI[sub] || null; // GB nations (NIR -> null)
  return null;                                   // US/CA/DE/AU states: no emoji
}

// Embedded data URI for a roster code (country .svg, subdivision .png), or null.
export function imgPathForCode(code) {
  if (!code || code === 'auto') return null;
  const [cc, sub] = String(code).split('-');
  const key = sub ? cc + '-' + sub : cc;
  return FLAG_DATA[key] || null;
}

export function labelFor(code) {
  if (!code || code === 'auto') return 'Auto';
  const [cc, sub] = String(code).split('-');
  if (!sub) return countryName(cc);
  const row = (SUBDIVISIONS[cc] || []).find(r => r[0] === sub);
  return row ? row[1] : code;
}

// Validate a code coming off the wire / from config. Accepts "auto",
// a known country, or a known "CC-SUB". Returns clean code or 'auto'.
export function normalizeCode(code) {
  if (!code || typeof code !== 'string') return 'auto';
  if (code === 'auto') return 'auto';
  const [cc, sub] = code.split('-');
  if (!_cname[cc]) return 'auto';
  if (!sub) return cc;
  return (SUBDIVISIONS[cc] || []).some(r => r[0] === sub) ? code : cc;
}
