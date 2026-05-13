/**
 * Daily Sanity Test Case definitions — grouped by Excel section heading.
 *
 * Each entry defines a dashboard section with a label (heading) and
 * an array of matchers. Tests matching any matcher in the array are
 * collected under that section.
 *
 * Optional `category` regex restricts matching to tests under a
 * specific Excel section (for test names that appear in multiple sections).
 */
export const SANITY_TEST_CASES = [
  {
    label: 'HTTP Throughput via CPS Method (Payload: 64KB)',
    matchers: [
      { match: (tc) => /^appsec$/i.test(tc.trim()) },
    ],
  },
  {
    label: 'CPS Performance (Payload: 64B)',
    matchers: [
      { match: (tc) => /^firewall tcp cps$/i.test(tc.trim()) },
      { match: (tc) => /^appsec \+ ssl\(tls1\.2\)\s*$/i.test(tc.trim()), category: /cps performance/i },
    ],
  },
  {
    label: 'UDP/IPSec Throughput',
    matchers: [
      { match: (tc) => /^firewall udp throughput-\s*packet size imix/i.test(tc) },
      { match: (tc) => /^firewall udp throughput-\s*packet size 1518/i.test(tc) },
      { match: (tc) => /^packet mode udp throughput-\s*packet size imix/i.test(tc) },
      { match: (tc) => /^ipsec\(site-2-site\)\s+udp throughput with.*aes-gcm256-\s*packet size imix/i.test(tc) },
      { match: (tc) => /^ipsec\(site-2-site\)\s+udp throughput with.*aes-gcm256-\s*packet size 1400/i.test(tc) },
    ],
  },
];
