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
    return cell ? String(cell.v) : '';
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
