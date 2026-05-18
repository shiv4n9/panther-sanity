/**
 * Scaling/capacity sections (session limits, RIB routes, etc.) are not
 * throughput metrics and must never be CPU-normalized.
 */
export function isScalingCategory(category) {
  if (!category) return false;
  return category.toLowerCase().includes('scaling');
}

/**
 * CPU Normalization Utility
 *
 * Scales throughput metrics to a 90% CPU baseline.
 * If CPU > 90%, linearly extrapolates down: (value / actualCpu) * 90
 * If CPU <= 90% or missing, returns the metric unchanged.
 *
 * Handles compound strings like "1700 CPS / 940 Mbps" by using regex
 * to find and scale all numeric values while preserving the string format.
 *
 * @param {string} metric     - The throughput string, e.g. "1700 CPS /940 Mbps"
 * @param {string} cpuStr     - CPU value as string, e.g. "82%" or "95%"
 * @returns {{ value: string, wasNormalized: boolean }}
 */
export function normalizeTo90Cpu(metric, cpuStr) {
  // Guard: no metric or no CPU → pass through
  if (!metric || !cpuStr) {
    return { value: metric, wasNormalized: false };
  }

  // Parse CPU number from string like "82%", "95", "90%"
  const cpuMatch = cpuStr.match(/(\d+)/);
  if (!cpuMatch) {
    return { value: metric, wasNormalized: false };
  }

  const cpu = parseInt(cpuMatch[1], 10);

  // Condition 1: CPU <= 90 or invalid → pass through
  if (isNaN(cpu) || cpu <= 90) {
    return { value: metric, wasNormalized: false };
  }

  // Condition 2: CPU > 90 → scale down
  const factor = 90 / cpu;

  const normalized = metric.replace(/[\d]+\.?\d*/g, (match) => {
    const original = parseFloat(match);
    if (isNaN(original)) return match;

    const scaled = (original / cpu) * 90;

    // Rounding: integer → integer, decimal → 1 decimal place
    if (match.includes('.')) {
      return scaled.toFixed(1);
    }
    return Math.round(scaled).toString();
  });

  return { value: normalized, wasNormalized: true };
}

/**
 * Extract the comparable numeric value from a throughput string.
 * - Compound: "1700 CPS / 940 Mbps" → 940
 * - Compound: "655.3 KPPS / 1956 Mbps" → 1956
 * - Single:   "28009" → 28009
 * - Empty/dash: null
 *
 * @param {string} str - Throughput string
 * @returns {number|null}
 */
export function extractMbpsValue(str) {
  if (!str || str.trim() === '' || str.trim() === '—' || str.trim() === '-') return null;

  // If contains "/" or "Mbps", extract the Mbps portion
  if (str.includes('/') || /mbps/i.test(str)) {
    // Split on "/" and find the part with "Mbps"
    const parts = str.split('/');
    for (const part of parts) {
      if (/mbps/i.test(part)) {
        const m = part.match(/([\d.]+)/);
        return m ? parseFloat(m[1]) : null;
      }
    }
    // If no "Mbps" found but has "/", take the last numeric value
    const lastPart = parts[parts.length - 1];
    const m = lastPart.match(/([\d.]+)/);
    return m ? parseFloat(m[1]) : null;
  }

  // Single value — extract first number
  const m = str.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Calculate percentage difference between SRX400 and SRX440 throughput.
 * Returns { pct, val400, val440 } or null if comparison isn't possible.
 *
 * @param {string} raw400 - SRX400 throughput string
 * @param {string} raw440 - SRX440 throughput string
 * @returns {{ pct: number, val400: number, val440: number } | null}
 */
export function calculatePercentageDiff(raw400, raw440) {
  const val400 = extractMbpsValue(raw400);
  const val440 = extractMbpsValue(raw440);

  if (val400 === null || val440 === null || val400 === 0) return null;

  const pct = ((val440 - val400) / val400) * 100;
  return { pct: parseFloat(pct.toFixed(1)), val400, val440 };
}
