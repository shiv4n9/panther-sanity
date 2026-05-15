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
