/**
 * Daily Sanity Test Case definitions.
 *
 * Each entry maps a human-friendly label (displayed in the dashboard)
 * to a regex matcher that identifies the corresponding Excel row(s).
 *
 * To add a new daily sanity test case, add an object here.
 * The `match` function receives the trimmed test case name from the Excel sheet.
 */
export const SANITY_TEST_CASES = [
  {
    label: 'Firewall Throughput',
    match: (tc) => /^firewall udp throughput-/i.test(tc),
  },
  {
    label: 'IPSEC VPN Throughput (S2S, PSK, AES256-GCM)',
    match: (tc) => /^ipsec.*throughput.*aes-gcm256/i.test(tc),
  },
  {
    label: 'AppSec Throughput',
    match: (tc) => /^appsec$/i.test(tc.trim()),
  },
  {
    label: 'AppSec + SSL Throughput',
    match: (tc) => /^appsec \+ ssl\(tls1\.2\)/i.test(tc.trim()),
  },
  {
    label: 'AppSec CPS',
    match: (tc) => /^appsec cps$/i.test(tc.trim()),
  },
];
