import React, { useMemo } from 'react';

/**
 * Reusable SVG line chart component.
 * Renders a responsive line chart with grid, data points, area fill,
 * and loading/error/empty states.
 *
 * @param {Object} props
 * @param {Array}  props.data         - Array of data points
 * @param {string} props.dataKey      - Key in each data point for the Y value
 * @param {string} props.color        - Primary color (hex, e.g., '#10b981')
 * @param {string} props.title        - Chart section title
 * @param {string} props.subtitle     - Small text under title
 * @param {string} props.badgeColor   - Badge background class (e.g., 'emerald', 'orange', 'blue')
 * @param {string} props.yAxisSuffix  - Suffix for Y axis labels (e.g., '%', '')
 * @param {Object} props.yScale       - Optional { min, max } for fixed Y axis scale
 * @param {boolean} props.loading     - Show loading spinner
 * @param {string|null} props.error   - Error message (null = no error)
 * @param {Function} props.onPointHover  - (point, index, event) => void
 * @param {Function} props.onPointLeave  - () => void
 * @param {boolean} props.showAreaFill   - Whether to show the gradient area fill
 * @param {string} props.animationDelay  - CSS animation delay
 */
const LineChart = ({
  data = [],
  dataKey = 'throughput',
  color = '#10b981',
  title = 'Chart',
  subtitle = '',
  badgeColor = 'emerald',
  yAxisSuffix = '',
  yScale = null,
  loading = false,
  error = null,
  onPointHover,
  onPointLeave,
  showAreaFill = false,
  animationDelay = '200ms',
}) => {
  const chartWidth = 1000;
  const chartHeight = 240;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  // Unique gradient ID to avoid SVG ID collisions when multiple charts render
  const gradientId = useMemo(() => `gradient-${dataKey}-${Math.random().toString(36).slice(2, 8)}`, [dataKey]);

  // Extract numeric values
  const getNum = (v) => {
    const parsed = parseFloat(v);
    return isNaN(parsed) ? 0 : parsed;
  };

  // Compute scaling
  const { yMin, yMax, yRange, yPad } = useMemo(() => {
    if (data.length === 0) return { yMin: 0, yMax: 100, yRange: 100, yPad: 10 };

    if (yScale) {
      const range = yScale.max - yScale.min;
      return { yMin: yScale.min, yMax: yScale.max, yRange: range, yPad: 0 };
    }

    const values = data.map(d => getNum(d[dataKey]));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const pad = range === 0 ? Math.max(max * 0.2, 10) : range * 0.1;
    return { yMin: min, yMax: max, yRange: range, yPad: pad };
  }, [data, dataKey, yScale]);

  const scaleY = (value) => {
    const num = getNum(value);
    const normalized = (num - (yMin - yPad)) / (yRange + 2 * yPad);
    return innerHeight - (normalized * innerHeight);
  };

  const scaleX = (index) => {
    if (data.length === 1) return innerWidth / 2;
    return (index / (data.length - 1)) * innerWidth;
  };

  // Generate paths (memoized)
  const { linePath, areaPath } = useMemo(() => {
    if (data.length <= 1) return { linePath: '', areaPath: '' };

    const line = data
      .map((point, index) => {
        const x = scaleX(index) + padding.left;
        const y = scaleY(point[dataKey]) + padding.top;
        return `${index === 0 ? 'M' : 'L'} ${x},${y}`;
      })
      .join(' ');

    const area = `${line} L ${scaleX(data.length - 1) + padding.left},${innerHeight + padding.top} L ${padding.left},${innerHeight + padding.top} Z`;

    return { linePath: line, areaPath: area };
  }, [data, dataKey, yMin, yMax, yRange, yPad]);

  // Y-axis labels
  const yLabels = useMemo(() => {
    return [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
      const value = (yMax + yPad) - ratio * (yRange + 2 * yPad);
      return { ratio, value };
    });
  }, [yMax, yRange, yPad]);

  const badgeClasses = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
  };

  const dotClasses = {
    emerald: 'bg-emerald-500',
    orange: 'bg-orange-500',
    blue: 'bg-blue-500',
  };

  return (
    <div
      className="bg-white/95 backdrop-blur-xl rounded-xl border border-slate-300 shadow-lg overflow-hidden animate-fade-in-up"
      style={{ animationDelay }}
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800 tracking-tight">{title}</h2>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 border rounded-lg ${badgeClasses[badgeColor] || badgeClasses.emerald}`}>
            <div className={`w-2 h-2 rounded-full ${dotClasses[badgeColor] || dotClasses.emerald}`}></div>
            <span className="text-xs font-bold">
              {data.length} {data.length === 1 ? 'Record' : 'Records'}
            </span>
          </div>
        </div>
      </div>

      {/* Chart body */}
      <div className="p-6">
        {loading ? (
          <div className="h-[240px] flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-600"></div>
          </div>
        ) : error ? (
          <div className="h-[240px] flex items-center justify-center text-center">
            <div className="max-w-md">
              <p className="text-slate-600 font-medium mb-2">No Data Available</p>
              <p className="text-slate-400 text-sm">{error}</p>
            </div>
          </div>
        ) : data.length === 0 ? (
          <div className="h-[240px] flex items-center justify-center text-center">
            <div>
              <p className="text-slate-400 text-sm">No historical data found</p>
              <p className="text-slate-300 text-xs mt-1">Click "Ingest Latest" on the dashboard</p>
            </div>
          </div>
        ) : (
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-auto" style={{ maxHeight: '240px' }}>
            {/* Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = padding.top + innerHeight * ratio;
              return (
                <line
                  key={ratio}
                  x1={padding.left}
                  y1={y}
                  x2={chartWidth - padding.right}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeWidth="1"
                  strokeDasharray={ratio === 0 || ratio === 1 ? "0" : "4 4"}
                />
              );
            })}

            {/* Area fill */}
            {showAreaFill && data.length > 1 && (
              <path d={areaPath} fill={`url(#${gradientId})`} opacity="0.2" />
            )}

            {/* Line path */}
            {data.length > 1 && (
              <path
                d={linePath}
                fill="none"
                stroke={color}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Data points */}
            {data.map((point, index) => {
              const x = scaleX(index) + padding.left;
              const y = scaleY(point[dataKey]) + padding.top;
              return (
                <g key={index}>
                  <circle
                    cx={x}
                    cy={y}
                    r="6"
                    fill="white"
                    stroke={color}
                    strokeWidth="2.5"
                    className="cursor-pointer transition-all"
                    onMouseEnter={(e) => onPointHover?.(point, index, e)}
                    onMouseLeave={() => onPointLeave?.()}
                  />
                  <circle cx={x} cy={y} r="3" fill={color} className="pointer-events-none" />
                </g>
              );
            })}

            {/* Single data point indicator */}
            {data.length === 1 && (
              <text
                x={chartWidth / 2}
                y={padding.top + innerHeight + 15}
                textAnchor="middle"
                fontSize="11"
                fill="#94a3b8"
                fontWeight="500"
                fontStyle="italic"
              >
                Single data point available • Trend will appear as more data is collected
              </text>
            )}

            {/* Y-axis labels */}
            {yLabels.map(({ ratio, value }) => {
              const y = padding.top + innerHeight * ratio;
              return (
                <text
                  key={ratio}
                  x={padding.left - 10}
                  y={y}
                  textAnchor="end"
                  alignmentBaseline="middle"
                  fontSize="11"
                  fill="#64748b"
                  fontWeight="600"
                  fontFamily="'JetBrains Mono', monospace"
                >
                  {value.toFixed(0)}{yAxisSuffix}
                </text>
              );
            })}

            {/* X-axis labels (first, middle, last) */}
            {data.length > 0 && [0, Math.floor(data.length / 2), data.length - 1].map((index) => {
              if (index >= data.length) return null;
              const x = scaleX(index) + padding.left;
              return (
                <text
                  key={index}
                  x={x}
                  y={chartHeight - padding.bottom + 20}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#94a3b8"
                  fontWeight="600"
                >
                  {data[index].date}
                </text>
              );
            })}

            {/* Gradient definition */}
            {showAreaFill && (
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.5" />
                  <stop offset="100%" stopColor={color} stopOpacity="0.05" />
                </linearGradient>
              </defs>
            )}
          </svg>
        )}
      </div>
    </div>
  );
};

export default LineChart;
