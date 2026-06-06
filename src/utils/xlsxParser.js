/**
 * XLSX Parser for SRX4XX_Datasheet.xlsx
 *
 * Sheet layout (per platform tab):
 *   Row 0 — "Release: <version>\r\n\r\nTestcase Description" | "<Platform>\r\nTested Numbers" | "" | "Comments"
 *   Row 1+  — Alternating section-header rows and data rows.
 *
 * Section-header rows are detected when col B contains a known keyword
 * like "Throughput", "CPS", "Scale" — these rows define a new test
 * category and reset the column-mapping for subsequent data rows.
 *
 * Data rows: col A = test name, col B = result, col C = CPU (usually),
 * col D = Global data shm (or a Comments-like field depending on section).
 * col E (SRX440) or col E (SRX400 some sections) = extra comments.
 */
import * as XLSX from 'xlsx';

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Detect whether a row is a "section header" — the row that introduces
 * a new test category (e.g. "HTTP Throughput via CPS Method ...").
 * These rows always have col B containing one of the known header keywords.
 */
/**
 * Section-header col B values are short column labels like:
 *   "Throughput\nCPS/MBPS", "CPS", "Scale", "Throughput\nTPS/MBPS"
 *
 * Data col B values are result strings like:
 *   "1700 CPS /940 Mbps", "654.7 KPPS / 440 Mbps", "20000", ""
 *
 * Key differentiator: data values start with a digit; header labels do not.
 */
function isSectionHeaderRow(colB) {
  if (!colB) return false;
  const clean = colB.replace(/[\r\n]/g, ' ').trim();
  // If col B starts with a digit, it's data (e.g. "1700 CPS", "654.7 KPPS")
  if (/^\d/.test(clean)) return false;
  const lower = clean.toLowerCase();
  return ['throughput', 'cps', 'scale', 'tps'].some(kw => lower.includes(kw));
}

/**
 * Extract the release version string from the Row 0 / Col A cell value.
 * Typical format: "Release: 25.4X300-202605050112.0-EVO\r\n\r\nTestcase Description"
 */
function extractRelease(cellValue) {
  if (!cellValue) return 'Unknown';
  const match = cellValue.match(/Release:\s*(.+?)(?:\r?\n|$)/);
  return match ? match[1].trim() : 'Unknown';
}

/**
 * Determine column semantics from a section-header row.
 * Returns an object describing what cols B, C, D mean.
 */
function parseSectionColumns(cells) {
  // cells = [colA, colB, colC, colD, colE?]
  const colD = (cells[3] || '').toLowerCase().replace(/[\r\n]/g, ' ').trim();

  // The UDP/IPSec section on SRX400 uses col D as "Comments" (session info)
  // instead of "Global data shm". Detect this.
  const dIsComments = colD.includes('comment') || colD.includes('session');

  return {
    throughputCol: 1,
    cpuCol: 2,
    shmCol: dIsComments ? -1 : 3,        // -1 = not present
    sessionCol: dIsComments ? 3 : -1,     // session/comments in col D
  };
}

// ─── Main Parser ──────────────────────────────────────────────

/**
 * Parse a single sheet into an array of section objects.
 * @param {Object} ws - XLSX worksheet object
 * @returns {{ release: string, sections: Array }}
 */
function parseSheet(ws) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const maxCol = Math.min(range.e.c, 9); // cap at col J

  const getCell = (r, c) => {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (!cell) return '';
    // Prefer formatted text (.w) for display-accurate values, fall back to raw (.v)
    return cell.w != null ? String(cell.w) : String(cell.v);
  };

  // Row 0: release info
  const release = extractRelease(getCell(0, 0));

  const sections = [];
  let currentSection = null;
  let colMapping = null;

  for (let r = 1; r <= range.e.r; r++) {
    const cells = [];
    for (let c = 0; c <= maxCol; c++) {
      cells.push(getCell(r, c).trim());
    }

    const colA = cells[0];
    const colB = cells[1];

    // Skip completely empty rows
    if (!colA && !colB) continue;

    // Check if this is a section header
    if (isSectionHeaderRow(colB)) {
      currentSection = {
        category: colA,
        tests: [],
      };
      sections.push(currentSection);
      colMapping = parseSectionColumns(cells);
      continue;
    }

    // Data row — belongs to current section
    if (!currentSection) {
      // Rows before the first section header (shouldn't happen after row 0, but be safe)
      currentSection = { category: 'General', tests: [] };
      sections.push(currentSection);
      colMapping = { throughputCol: 1, cpuCol: 2, shmCol: 3, sessionCol: -1 };
    }

    const throughput = cells[colMapping.throughputCol] || '';
    const cpu = cells[colMapping.cpuCol] || '';
    const shm = colMapping.shmCol >= 0 ? (cells[colMapping.shmCol] || '') : '';

    // Comments: look for non-empty content in columns after the metrics columns
    // SRX440 has comments in col E (index 4), SRX400 in some sections col E (index 4) too
    // If col D was detected as "sessionCol", then col D holds session info, and col E holds comments
    let comments = '';
    if (colMapping.sessionCol >= 0) {
      // col D = session info (e.g. "*400 Sessions"), col E = extra comments
      comments = cells[colMapping.sessionCol];
      const extraComment = cells[4] || '';
      if (extraComment) {
        comments = comments ? `${comments} — ${extraComment}` : extraComment;
      }
    } else {
      // Normal mode: col E (index 4) is comments
      comments = cells[4] || '';
    }

    currentSection.tests.push({
      testCase: colA,
      throughput,
      cpu: cpu ? `${cpu}%` : '',
      shm: shm ? `${shm}%` : '',
      comments: comments,
    });
  }

  return { release, sections };
}

// ─── DS-1 Sheet Parser ───────────────────────────────────────

/**
 * Parse the DS-1 sheet which stacks multiple releases vertically.
 *
 * Layout per release block:
 *   Row N   — "Release: <version>" in col A, "SRX400" header in col B, "SRX440" header in col E
 *   Row N+1 — Column labels: "Testcase Description" | "Throughput" | "CPU" | "Comments" | "Throughput" | "CPU" | "SHM"
 *   Row N+2…— Data rows until the next Release row or end of sheet.
 *
 * Returns a Map-like array: [{ release, merged }] where merged is the same
 * format as mergeSheets output.
 *
 * @param {Object} ws - XLSX worksheet for DS-1
 * @returns {Array<{ release: string, merged: Array }>}
 */
function parseDSSheet(ws) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const maxCol = Math.min(range.e.c, 9);

  const getCell = (r, c) => {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (!cell) return '';
    return cell.w != null ? String(cell.w) : String(cell.v);
  };

  const releases = [];
  let currentRelease = null;
  let skipNextRow = false; // skip the column-label row after a Release row

  for (let r = 0; r <= range.e.r; r++) {
    const colA = getCell(r, 0).trim();

    // Detect release header row
    if (/^Release:/i.test(colA.replace(/[\r\n]/g, ' '))) {
      const releaseMatch = colA.replace(/[\r\n]/g, ' ').match(/Release:\s*(.+?)(?:\s*$)/);
      const releaseStr = releaseMatch ? releaseMatch[1].trim() : 'Unknown';
      currentRelease = { release: releaseStr, tests: [] };
      releases.push(currentRelease);
      skipNextRow = true;
      continue;
    }

    // Skip the column-label row ("Testcase Description", "Throughput", …)
    if (skipNextRow) {
      skipNextRow = false;
      continue;
    }

    // Skip empty rows
    if (!colA || /^\s*$/.test(colA)) continue;

    if (!currentRelease) continue;

    // Data row — cols B(1),C(2),D(3) = SRX400; cols E(4),F(5),G(6) = SRX440
    const t400  = getCell(r, 1).trim();
    const cpu400 = getCell(r, 2).trim();
    const shm400 = getCell(r, 3).trim();
    const t440  = getCell(r, 4).trim();
    const cpu440 = getCell(r, 5).trim();
    const shm440 = getCell(r, 6).trim();

    currentRelease.tests.push({
      testCase: colA,
      srx400: {
        throughput: t400,
        cpu: cpu400 ? `${cpu400}%` : '',
        shm: shm400 ? (/^\*|session|pr\s/i.test(shm400) ? '' : `${shm400}%`) : '',
        comments: /^\*|session|pr\s/i.test(shm400) ? shm400 : '',
      },
      srx440: {
        throughput: t440,
        cpu: cpu440 ? `${cpu440}%` : '',
        shm: shm440 ? (/^\*|session|pr\s/i.test(shm440) ? '' : `${shm440}%`) : '',
        comments: /^\*|session|pr\s/i.test(shm440) ? shm440 : '',
      },
    });
  }

  // Categorize each release's tests into proper groups matching SANITY_TEST_CASES labels
  const categorizeTests = (tests) => {
    const groups = {
      'HTTP Throughput via CPS Method (Payload: 64KB)': [],
      'CPS Performance (Payload: 64B)': [],
      'UDP/IPSec Throughput': [],
    };
    const uncategorized = [];
    const seen = new Set();

    for (const test of tests) {
      const tc = test.testCase.trim();
      const tcKey = tc.toLowerCase();
      // Skip duplicates (same test name from different Excel sections)
      if (seen.has(tcKey)) continue;
      seen.add(tcKey);
      if (/^(?:appsec|appcontrol)\s*-\s*http\s*throughput/i.test(tc) || /^(?:appsec|appcontrol)\s*\+\s*ssl.*https\s*throughput/i.test(tc)) {
        groups['HTTP Throughput via CPS Method (Payload: 64KB)'].push(test);
      } else if (/^(?:appsec|appcontrol)\s*-\s*http\s*cps/i.test(tc) || /^(?:appsec|appcontrol)\s*\+\s*ssl/i.test(tc) || /firewall\s*tcp\s*cps/i.test(tc)) {
        groups['CPS Performance (Payload: 64B)'].push(test);
      } else if (/udp\s*throughput/i.test(tc) || /ipsec/i.test(tc) || /packet\s*mode.*udp/i.test(tc)) {
        groups['UDP/IPSec Throughput'].push(test);
      } else {
        uncategorized.push(test);
      }
    }

    const merged = [];
    // Add in display order: UDP first, then HTTP, then CPS
    if (groups['UDP/IPSec Throughput'].length > 0) {
      merged.push({ category: 'UDP/IPSec Throughput', tests: groups['UDP/IPSec Throughput'] });
    }
    if (groups['HTTP Throughput via CPS Method (Payload: 64KB)'].length > 0) {
      merged.push({ category: 'HTTP Throughput via CPS Method (Payload: 64KB)', tests: groups['HTTP Throughput via CPS Method (Payload: 64KB)'] });
    }
    if (groups['CPS Performance (Payload: 64B)'].length > 0) {
      merged.push({ category: 'CPS Performance (Payload: 64B)', tests: groups['CPS Performance (Payload: 64B)'] });
    }
    if (uncategorized.length > 0) {
      merged.push({ category: 'Other', tests: uncategorized });
    }
    return merged;
  };

  return releases.map(rel => ({
    release: rel.release,
    merged: categorizeTests(rel.tests),
  }));
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Fetch and parse the SRX4XX_Datasheet.xlsx file.
 * @param {string} url - Path to the XLSX file (default: /data/SRX4XX_Datasheet.xlsx)
 * @returns {Promise<{ srx400: { release, sections }, srx440: { release, sections } }>}
 */
export async function loadDatasheet(url) {
  if (!url) {
    url = `${import.meta.env.BASE_URL}data/SRX4XX_Datasheet.xlsx`;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch datasheet: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  const result = {};
  for (const sheetName of ['SRX400', 'SRX440']) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) {
      console.warn(`Sheet "${sheetName}" not found in workbook`);
      result[sheetName.toLowerCase()] = { release: 'N/A', sections: [] };
      continue;
    }
    result[sheetName.toLowerCase()] = parseSheet(ws);
  }

  // Parse DS-1 sheet for Daily Sanity release-stacked data
  const dsWs = workbook.Sheets['DS-1'];
  result.ds1 = dsWs ? parseDSSheet(dsWs) : [];

  return result;
}

/**
 * Merge SRX400 and SRX440 data into a unified structure for the dashboard.
 *
 * Returns an array of section objects, each containing tests with side-by-side
 * data for both platforms:
 *
 *   { category, tests: [{ testCase, srx400: {...}, srx440: {...} }] }
 *
 * Matching is done by normalized test case name within the same section/category.
 */
export function mergeSheets(srx400Data, srx440Data) {
  const merged = [];

  // Build lookup from SRX440 sections by category name
  const srx440Map = {};
  for (const section of srx440Data.sections) {
    const key = section.category.trim().toLowerCase();
    if (!srx440Map[key]) srx440Map[key] = {};
    for (const test of section.tests) {
      const tKey = test.testCase.trim().toLowerCase();
      srx440Map[key][tKey] = test;
    }
  }

  // Walk SRX400 sections as the canonical ordering
  for (const section of srx400Data.sections) {
    const catKey = section.category.trim().toLowerCase();
    const mergedSection = {
      category: section.category.trim(),
      tests: [],
    };

    const seen440 = new Set();

    for (const test400 of section.tests) {
      const tKey = test400.testCase.trim().toLowerCase();
      const test440 = srx440Map[catKey]?.[tKey] || null;
      if (test440) seen440.add(tKey);

      mergedSection.tests.push({
        testCase: test400.testCase.trim(),
        srx400: test400,
        srx440: test440 || { throughput: '', cpu: '', shm: '', comments: '' },
      });
    }

    // Add any SRX440-only tests not in SRX400
    if (srx440Map[catKey]) {
      for (const [tKey, test440] of Object.entries(srx440Map[catKey])) {
        if (!seen440.has(tKey)) {
          mergedSection.tests.push({
            testCase: test440.testCase.trim(),
            srx400: { throughput: '', cpu: '', shm: '', comments: '' },
            srx440: test440,
          });
        }
      }
    }

    merged.push(mergedSection);
  }

  // Add any SRX440-only sections not in SRX400
  const srx400CatKeys = new Set(srx400Data.sections.map(s => s.category.trim().toLowerCase()));
  for (const section of srx440Data.sections) {
    const catKey = section.category.trim().toLowerCase();
    if (!srx400CatKeys.has(catKey)) {
      merged.push({
        category: section.category.trim(),
        tests: section.tests.map(t => ({
          testCase: t.testCase.trim(),
          srx400: { throughput: '', cpu: '', shm: '', comments: '' },
          srx440: t,
        })),
      });
    }
  }

  return merged;
}
