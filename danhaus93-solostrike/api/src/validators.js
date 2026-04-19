// Bitcoin address validation.
// Covers: P2PKH (1...), P2SH (3...), Bech32 mainnet (bc1...), testnet (tb1...).
// Not a full checksum validator — that's what ckpool does. This just blocks
// obviously-wrong input before we write it to ckpool.conf and crash it.
const ADDRESS_RE = /^(bc1[a-z0-9]{6,87}|tb1[a-z0-9]{6,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;

function isValidBtcAddress(addr) {
  if (!addr || typeof addr !== 'string') return false;
  const a = addr.trim();
  if (a.length < 26 || a.length > 90) return false;
  return ADDRESS_RE.test(a);
}

// CSV-injection guard: if a field starts with =, +, -, @, or tab,
// Excel/Sheets can interpret it as a formula. Prefix a single quote
// to neutralize the formula while keeping the value human-readable.
// See https://owasp.org/www-community/attacks/CSV_Injection
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function rowsToCsv(rows) {
  return rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

module.exports = { isValidBtcAddress, csvEscape, rowsToCsv };
