/**
 * SRX Branch (3XX) comparison data.
 *
 * Values are sourced from Compare3XX.xlsx. Columns B and C are intentionally
 * ignored; only the displayed SRX300/SRX320/SRX340/SRX345/SRX380 values are used.
 */
export const BRANCH_DEVICES = ['SRX300', 'SRX320', 'SRX340', 'SRX345', 'SRX380'];

export const BRANCH_DATA = [
  {
    match: (tc) => /^(?:appsec|appcontrol)\s*-\s*http\s*throughput/i.test(tc.trim()),
    sourceTest: 'AppControl',
    sourceMetric: 'HTTP Throughput via CPS Method with UDP Stream Logging (64KB Payload) [in KPPS / Mbps]',
    values: { SRX300: '29 / 218', SRX320: '29 / 218', SRX340: '57 / 414', SRX345: '64 / 478', SRX380: '477 / 3596' },
  },
  {
    match: (tc) => /^(?:appsec|appcontrol)\s*-\s*http\s*cps/i.test(tc.trim()),
    sourceTest: 'AppControl CPS',
    sourceMetric: 'New Connections/Second (64B Payload) [in KCPS]',
    values: { SRX300: '0.6', SRX320: '0.6', SRX340: '1', SRX345: '1.2', SRX380: '10.8' },
  },
  {
    match: (tc) => /^(?:appsec|appcontrol)\s*\+\s*ssl\(tls1\.2\)\s*-\s*https\s*throughput/i.test(tc.trim()),
    sourceTest: 'SSL + AppControl',
    sourceMetric: 'HTTPS Throughput via CPS Method with UDP Stream Logging (64KB Payload) [in KPPS / Mbps]',
    values: { SRX300: '10', SRX320: '10', SRX340: '18', SRX345: '23', SRX380: '106' },
  },
  {
    match: (tc) => /^(?:appsec|appcontrol)\s*\+\s*ssl\(tls1\.2\)\s*-\s*https\s*cps/i.test(tc.trim()),
    sourceTest: 'SSL + AppControl',
    sourceMetric: 'New Connections/Second (64B Payload) [in KCPS]',
    values: { SRX300: '0.03', SRX320: '0.03', SRX340: '0.06', SRX345: '0.08', SRX380: '0.19' },
  },
  {
    match: (tc) => /^firewall udp throughput-\s*packet size 64\s*bytes/i.test(tc),
    sourceTest: 'Firewall Throughput - 64B',
    sourceMetric: 'UDP Throughput [in KPPS / Mbps]',
    values: { SRX300: '161 / 109', SRX320: '161 / 109', SRX340: '428.5 / 288', SRX345: '427 / 287', SRX380: '1813 / 1219' },
  },
  {
    match: (tc) => /^firewall udp throughput-\s*packet size imix/i.test(tc),
    sourceTest: 'Firewall Throughput - IMIX',
    sourceMetric: 'UDP Throughput [in KPPS / Mbps]',
    values: { SRX300: '160 / 478', SRX320: '160 / 478', SRX340: '408 / 1221', SRX345: '412 / 1233', SRX380: '1749 / 5229' },
  },
  {
    match: (tc) => /^firewall udp throughput-\s*packet size 1518/i.test(tc),
    sourceTest: 'Firewall Throughput - 1518B',
    sourceMetric: 'UDP Throughput [in KPPS / Mbps]',
    values: { SRX300: '135 / 1654', SRX320: '135 / 1654', SRX340: '362 / 4437', SRX345: '364 / 4464', SRX380: '1608 / 19728' },
  },
  {
    match: (tc) => /^ipsec\(site-2-site\)\s+udp throughput with.*aes-gcm256-\s*packet size imix/i.test(tc),
    sourceTest: 'IPSec Throughput (S2S, IKEv2, PSK, AES-256-GCM) - IMIX',
    sourceMetric: 'UDP Throughput [in KPPS / Mbps]',
    values: { SRX300: '28 / 84', SRX320: '28 / 84', SRX340: '75 / 225', SRX345: '75 / 225', SRX380: '331 / 991' },
  },
];

export function getBranchComparison(testCaseName) {
  return BRANCH_DATA.find(entry => entry.match(testCaseName)) || null;
}

/**
 * Look up branch data for a given test case name.
 * @param {string} testCaseName
 * @returns {Object|null} e.g. { SRX300: '450 Mbps', SRX320: '450 Mbps', ... } or null
 */
export function getBranchData(testCaseName) {
  const entry = getBranchComparison(testCaseName);
  return entry ? entry.values : null;
}
