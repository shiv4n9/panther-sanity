/**
 * SRX Branch (3XX) comparison data — static datasheet values.
 *
 * Each entry uses a regex matcher (same pattern as sanityTestCases.js)
 * to link a test case row to its branch device throughput values.
 */
export const BRANCH_DEVICES = ['SRX300', 'SRX320', 'SRX340', 'SRX345', 'SRX380'];

export const BRANCH_DATA = [
  {
    match: (tc) => /^packet mode udp throughput-\s*packet size imix/i.test(tc),
    values: { SRX300: '650 Mbps', SRX320: '650 Mbps', SRX340: '1600 Mbps', SRX345: '1700 Mbps', SRX380: '5700 Mbps' },
  },
  {
    match: (tc) => /^firewall udp throughput-\s*packet size imix/i.test(tc),
    values: { SRX300: '450 Mbps', SRX320: '450 Mbps', SRX340: '1100 Mbps', SRX345: '1150 Mbps', SRX380: '5200 Mbps' },
  },
  {
    match: (tc) => /^firewall udp throughput-\s*packet size 1518/i.test(tc),
    values: { SRX300: '1600 Mbps', SRX320: '1600 Mbps', SRX340: '4200 Mbps', SRX345: '4350 Mbps', SRX380: '20000 Mbps' },
  },
  {
    match: (tc) => /^ipsec\(site-2-site\)\s+udp throughput with.*aes-gcm256-\s*packet size imix/i.test(tc),
    values: { SRX300: '80 Mbps', SRX320: '80 Mbps', SRX340: '210 Mbps', SRX345: '215 Mbps', SRX380: '960 Mbps' },
  },
  {
    match: (tc) => /^ipsec\(site-2-site\)\s+udp throughput with.*aes-gcm256-\s*packet size 1400/i.test(tc),
    values: { SRX300: '250 Mbps', SRX320: '250 Mbps', SRX340: '700 Mbps', SRX345: '705 Mbps', SRX380: '3200 Mbps' },
  },
  {
    match: (tc) => /^appsec$/i.test(tc.trim()),
    values: { SRX300: '210 Mbps', SRX320: '210 Mbps', SRX340: '400 Mbps', SRX345: '450 Mbps', SRX380: '3.4 Gbps' },
  },
  {
    match: (tc) => /^firewall tcp cps$/i.test(tc.trim()),
    values: { SRX300: '4200', SRX320: '4200', SRX340: '9250', SRX345: '10.5K', SRX380: '64K' },
  },
  {
    match: (tc) => /^appsec \+ ssl\(tls1\.2\)/i.test(tc.trim()),
    values: { SRX300: '30', SRX320: '30', SRX340: '60', SRX345: '75', SRX380: '180' },
  },
  {
    match: (tc) => /^firewall udp throughput-\s*packet size 64\s*bytes/i.test(tc),
    values: { SRX300: '109 Mbps', SRX320: '109 Mbps', SRX340: '288 Mbps', SRX345: '287 Mbps', SRX380: '1219 Mbps' },
  },
  {
    match: (tc) => /^appsec\s*-\s*http\s*cps/i.test(tc.trim()),
    values: { SRX300: '4.33K CPS', SRX320: '4.33K CPS', SRX340: '9.5K CPS', SRX345: '11.4K CPS', SRX380: '68K CPS' },
  },
  {
    match: (tc) => /^appsec\s*-\s*http\s*throughput/i.test(tc.trim()),
    values: { SRX300: '218 Mbps', SRX320: '218 Mbps', SRX340: '414 Mbps', SRX345: '478 Mbps', SRX380: '3596 Mbps' },
  },
];

/**
 * Look up branch data for a given test case name.
 * @param {string} testCaseName
 * @returns {Object|null} e.g. { SRX300: '450 Mbps', SRX320: '450 Mbps', ... } or null
 */
export function getBranchData(testCaseName) {
  const entry = BRANCH_DATA.find(d => d.match(testCaseName));
  return entry ? entry.values : null;
}
