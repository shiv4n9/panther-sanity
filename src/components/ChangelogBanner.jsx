import React, { useState, useEffect } from 'react';
import { API_BASE } from '../config/api';

/**
 * ChangelogBanner — Collapsible banner showing what changed in the latest ingestion.
 * Displays count of updated/new tests with expandable diff details.
 */
const ChangelogBanner = ({ refreshKey = 0 }) => {
  const [changelog, setChangelog] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchChangelog = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/api/changelog?limit=1`);
        if (!res.ok) return;
        const json = await res.json();
        if (json.changelog && json.changelog.length > 0) {
          setChangelog(json.changelog[0]);
        }
      } catch {
        // Silently fail — banner is optional
      } finally {
        setLoading(false);
      }
    };
    fetchChangelog();
  }, [refreshKey]);

  if (loading || !changelog) return null;

  const { tests_updated, tests_added, diff, ingested_at } = changelog;
  const hasChanges = tests_updated > 0 || tests_added > 0;
  if (!hasChanges) return null;

  const updated = diff?.updated || [];
  const added = diff?.added || [];
  const ingestDate = ingested_at ? new Date(ingested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  // Parse numeric value from throughput string for % calculation
  const parseNum = (s) => {
    if (!s) return 0;
    const m = s.match(/[\d.]+/);
    return m ? parseFloat(m[0]) : 0;
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 overflow-hidden shadow-sm">
      {/* Summary bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-amber-100/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div className="w-8 h-8 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>

          {/* Summary text */}
          <div className="flex items-center gap-2 text-sm">
            <span className="font-bold text-amber-800">Latest Update</span>
            <span className="text-amber-400">•</span>
            <span className="text-xs text-amber-600 font-medium">{ingestDate}</span>
          </div>

          {/* Badges */}
          <div className="flex items-center gap-2 ml-2">
            {tests_updated > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {tests_updated} updated
              </span>
            )}
            {tests_added > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 4v16m8-8H4" />
                </svg>
                {tests_added} new
              </span>
            )}
          </div>
        </div>

        {/* Expand arrow */}
        <svg className={`w-4 h-4 text-amber-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-amber-200 bg-white/60">
          {/* Updated tests */}
          {updated.length > 0 && (
            <div className="px-5 py-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Updated Values</span>
              </div>
              <div className="space-y-1.5">
                {updated.map((item, i) => {
                  const oldNum = parseNum(item.old_value);
                  const newNum = parseNum(item.new_value);
                  let pct = null;
                  if (oldNum > 0 && newNum > 0) {
                    pct = ((newNum - oldNum) / oldNum * 100).toFixed(1);
                  }
                  const isUp = pct !== null && parseFloat(pct) >= 0;

                  return (
                    <div key={i} className="flex items-center gap-3 py-1.5 px-3 rounded-lg bg-white border border-slate-100 text-xs">
                      <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                        item.platform === 'SRX400' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                      }`}>{item.platform}</span>
                      <span className="font-medium text-slate-700 truncate flex-1">{item.test_case}</span>
                      <span className="font-jetbrains text-slate-400 line-through flex-shrink-0">{item.old_value}</span>
                      <svg className="w-3 h-3 text-slate-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                      <span className="font-jetbrains font-bold text-slate-800 flex-shrink-0">{item.new_value}</span>
                      {pct !== null && (
                        <span className={`font-jetbrains font-bold flex-shrink-0 ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>
                          {isUp ? '▲' : '▼'}{Math.abs(pct)}%
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* New tests */}
          {added.length > 0 && (
            <div className={`px-5 py-3 ${updated.length > 0 ? 'border-t border-amber-100' : ''}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">New Tests</span>
              </div>
              <div className="space-y-1.5">
                {added.map((item, i) => (
                  <div key={i} className="flex items-center gap-3 py-1.5 px-3 rounded-lg bg-emerald-50/50 border border-emerald-100 text-xs">
                    <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                      item.platform === 'SRX400' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                    }`}>{item.platform}</span>
                    <span className="font-medium text-slate-700 truncate flex-1">
                      <span className="text-emerald-600 font-bold mr-1">+</span>
                      {item.test_case}
                    </span>
                    <span className="font-jetbrains font-bold text-slate-800 flex-shrink-0">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ChangelogBanner;
