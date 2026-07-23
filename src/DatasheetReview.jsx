import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from './config/api';

// Fixed reviewers for the datasheet sign-off workflow.
const APPROVERS = ['Anand Thulasiram', 'Jagadeesh Rajashekharaiah Yaliyur', 'Geetha BK', 'Antony Ruban Alexis', 'Ramasubramaniam Ganesan'];

const LS_KEY = 'panther:datasheet-approvals';

// Deterministic avatar palette — a name always maps to the same swatch.
const AVATAR_PALETTE = [
  'from-blue-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-violet-500 to-purple-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-sky-600',
];

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function avatarGradient(name) {
  return AVATAR_PALETTE[hashString(name) % AVATAR_PALETTE.length];
}

function initialsOf(name) {
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function emptyApprovals() {
  const out = {};
  APPROVERS.forEach((name) => {
    out[name] = { status: 'pending', comment: '', updated_at: null };
  });
  return out;
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const merged = emptyApprovals();
    APPROVERS.forEach((name) => {
      if (parsed[name]) merged[name] = { ...merged[name], ...parsed[name] };
    });
    return merged;
  } catch {
    return null;
  }
}

function saveLocal(approvals) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(approvals));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export default function DatasheetReview({ data, releases }) {
  const rawSections = (data && data.sections) || [];
  // Show UDP/IPSec Throughput first, then the remaining sections in original order.
  const sections = [...rawSections].sort((a, b) => {
    const isUdp = (s) => /udp|ipsec/i.test(s.category);
    return (isUdp(b) ? 1 : 0) - (isUdp(a) ? 1 : 0);
  });

  const [approvals, setApprovals] = useState(emptyApprovals);
  const [drafts, setDrafts] = useState({}); // per-approver in-progress comment
  const [savingName, setSavingName] = useState(null);
  const [savedName, setSavedName] = useState(null);
  const [collapsedSections, setCollapsedSections] = useState({});
  const [panelOpen, setPanelOpen] = useState(true);

  const toggleSection = (cat) =>
    setCollapsedSections((c) => ({ ...c, [cat]: !c[cat] }));

  // Load persisted approvals — backend first, localStorage fallback.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/datasheet-approvals`);
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (cancelled) return;
        const merged = emptyApprovals();
        (json.approvals || []).forEach((a) => {
          if (merged[a.approver]) {
            merged[a.approver] = {
              status: a.status || 'pending',
              comment: a.comment || '',
              updated_at: a.updated_at || null,
            };
          }
        });
        setApprovals(merged);
      } catch {
        if (cancelled) return;
        const local = loadLocal();
        if (local) setApprovals(local);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const commentFor = useCallback(
    (name) => (drafts[name] !== undefined ? drafts[name] : approvals[name].comment),
    [drafts, approvals]
  );

  const setDraft = (name, value) =>
    setDrafts((d) => ({ ...d, [name]: value }));

  const save = async (name, status) => {
    const comment = commentFor(name);
    const next = {
      ...approvals,
      [name]: { status, comment, updated_at: new Date().toISOString() },
    };
    setApprovals(next);
    setDrafts((d) => { const c = { ...d }; delete c[name]; return c; });
    saveLocal(next);
    setSavingName(name);
    try {
      const res = await fetch(`${API_BASE}/api/datasheet-approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approver: name, status, comment }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      /* offline / no backend — localStorage already holds the value */
    } finally {
      setSavingName(null);
      setSavedName(name);
      setTimeout(() => setSavedName((cur) => (cur === name ? null : cur)), 2500);
    }
  };

  const approvedCount = APPROVERS.filter((n) => approvals[n].status === 'approved').length;
  const totalRows = sections.reduce((n, s) => n + s.rows.length, 0);

  return (
    <div className="space-y-5">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/60 bg-white/60 backdrop-blur-xl px-6 py-4 shadow-[0_8px_32px_rgba(2,131,143,0.08)]">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-juniper to-juniper-dark text-black shadow-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-[15px] font-bold tracking-tight text-slate-800">Datasheet Publish Review</span>
            <span className="text-[11px] font-semibold text-slate-400">
              {totalRows} test cases
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border transition-colors ${approvedCount === APPROVERS.length ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
            {approvedCount}/{APPROVERS.length} Approved
          </span>
        </div>
      </div>

      {/* Review Table */}
      <div className="rounded-3xl border border-white/60 bg-white/70 backdrop-blur-xl shadow-[0_10px_40px_rgba(2,131,143,0.10)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <thead>
              {/* Group header row */}
              <tr className="bg-gradient-to-r from-juniper via-juniper to-juniper-dark text-black">
                <th rowSpan={2} className="text-left px-6 py-3 text-xs font-extrabold uppercase tracking-[0.12em] align-bottom">
                  Test Case
                </th>
                <th colSpan={2} className="px-4 py-2 text-center text-[13px] font-extrabold tracking-wide border-l border-black/15">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-juniper-darker/70" />
                    SRX 400
                  </span>
                </th>
                <th colSpan={2} className="px-4 py-2 text-center text-[13px] font-extrabold tracking-wide border-l-2 border-black/25">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-blue-700/70" />
                    SRX 440
                  </span>
                </th>
              </tr>
              {/* Sub header row */}
              <tr className="bg-juniper-dark/90 text-black/80">
                <th className="px-4 py-1.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] border-l border-black/15">Actual</th>
                <th className="px-4 py-1.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] border-l border-black/10">Datasheet Publish</th>
                <th className="px-4 py-1.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] border-l-2 border-black/25">Actual</th>
                <th className="px-4 py-1.5 text-right text-[10px] font-bold uppercase tracking-[0.1em] border-l border-black/10">Datasheet Publish</th>
              </tr>
            </thead>
            <tbody>
              {sections.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center text-slate-500 font-medium">
                    No “Datasheet Publish” data found in the workbook.
                  </td>
                </tr>
              ) : (
                sections.map((section, sIdx) => (
                  <FragmentSection
                    key={`${section.category}-${sIdx}`}
                    section={section}
                    open={!collapsedSections[section.category]}
                    onToggle={() => toggleSection(section.category)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Approval Panel */}
      <div className="rounded-3xl border border-white/60 bg-white/70 backdrop-blur-xl shadow-[0_10px_40px_rgba(2,131,143,0.08)] overflow-hidden">
        <button
          type="button"
          onClick={() => setPanelOpen((o) => !o)}
          className="w-full px-6 py-4 bg-gradient-to-r from-juniper-light/60 via-white/40 to-transparent border-b border-white/60 flex items-center justify-between text-left hover:from-juniper-light/80 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/80 border border-juniper/20 shadow-sm text-juniper-dark">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </span>
            <h3 className="text-[15px] font-bold tracking-tight text-slate-800">Review Sign-off</h3>
            <span className="text-[11px] font-semibold text-slate-400">{approvedCount}/{APPROVERS.length} approved</span>
          </div>
          <span className={`inline-flex h-6 w-6 items-center justify-center rounded-lg bg-white/70 border border-juniper/20 text-juniper-dark transition-transform duration-300 ${panelOpen ? 'rotate-180' : ''}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
          </span>
        </button>

        {panelOpen && (
        <div className="divide-y divide-slate-100/80">
          {APPROVERS.map((name) => {
            const a = approvals[name];
            const isApproved = a.status === 'approved';
            const isRejected = a.status === 'not_approved';
            return (
              <div
                key={name}
                className={`px-6 py-4 flex flex-col md:flex-row md:items-center gap-3 transition-colors duration-200 ${isApproved ? 'bg-green-50/40' : isRejected ? 'bg-rose-50/40' : 'hover:bg-slate-50/50'}`}
              >
                <div className="flex items-center gap-3 md:w-60 shrink-0">
                  <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-medium text-[13px] text-white shadow-sm ring-2 ring-white/50 bg-gradient-to-br ${avatarGradient(name)}`}>
                    {initialsOf(name)}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-slate-800">{name}</span>
                    {isApproved && (
                      <span className="text-[11px] font-semibold text-green-600 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                        Approved by {name}
                      </span>
                    )}
                    {isRejected && (
                      <span className="text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                        Changes requested
                      </span>
                    )}
                    {a.status === 'pending' && (
                      <span className="text-[11px] font-semibold text-slate-400">Pending review</span>
                    )}
                  </div>
                </div>

                <textarea
                  rows={1}
                  value={commentFor(name)}
                  onChange={(e) => setDraft(name, e.target.value)}
                  onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px`; }}
                  placeholder="Add a review comment…"
                  className="flex-1 min-h-[42px] resize-none px-4 py-2.5 rounded-xl border border-white/70 bg-white/70 backdrop-blur focus:outline-none focus:ring-2 focus:ring-juniper/40 focus:border-juniper/50 text-sm text-slate-700 placeholder-slate-400 shadow-inner transition"
                />

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => save(name, 'approved')}
                    disabled={savingName === name}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all duration-200 hover:-translate-y-0.5 ${isApproved ? 'bg-gradient-to-br from-green-500 to-emerald-600 text-white border-green-600 shadow-md shadow-green-500/25' : 'bg-white/80 text-green-700 border-green-300 hover:bg-green-50 hover:shadow-sm'}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    Approve
                  </button>
                  <button
                    onClick={() => save(name, 'not_approved')}
                    disabled={savingName === name}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border transition-all duration-200 hover:-translate-y-0.5 ${isRejected ? 'bg-gradient-to-br from-rose-500 to-rose-600 text-white border-rose-600 shadow-md shadow-rose-500/25' : 'bg-white/80 text-rose-700 border-rose-300 hover:bg-rose-50 hover:shadow-sm'}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                    Reject
                  </button>
                  {savedName === name && (
                    <span className="text-[11px] font-bold text-juniper-dark animate-pulse">Saved</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>
    </div>
  );
}

// A category banner row followed by its data rows.
function FragmentSection({ section, open, onToggle }) {
  const unit = section.unit ? section.unit : '';
  return (
    <>
      <tr>
        <td
          colSpan={5}
          onClick={onToggle}
          className="px-6 py-2.5 bg-gradient-to-r from-[#eaf5df] via-[#f2f9ea]/70 to-transparent border-l-[3px] border-juniper/60 border-y border-juniper/10 cursor-pointer select-none hover:from-[#e2f1d2] transition-colors"
        >
          <span className="inline-flex items-center gap-2.5">
            <span className={`inline-flex h-4 w-4 items-center justify-center rounded-md bg-white/80 border border-juniper/30 shadow-sm text-juniper-dark transition-transform duration-300 ${open ? 'rotate-90' : ''}`}>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" /></svg>
            </span>
            <span className="text-[13px] font-bold tracking-tight text-slate-800">{section.category}</span>
            {unit && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-2 py-0.5">
                {unit}
              </span>
            )}
            <span className="text-[10px] font-bold text-white bg-slate-600 rounded-full px-2 py-0.5">{section.rows.length}</span>
          </span>
        </td>
      </tr>
      {open && section.rows.map((row, i) => {
        const isYellow = row.highlight === 'yellow';
        return (
          <tr
            key={i}
            className={`transition-colors ${isYellow ? 'bg-yellow-100 hover:bg-yellow-200/70' : 'hover:bg-slate-50'}`}
          >
            <td className={`px-6 py-2.5 border-b border-slate-100/80 ${isYellow ? 'border-l-4 border-l-yellow-400 text-slate-900 font-semibold' : 'text-slate-700'}`}>
              {row.testCase}
            </td>
            <td className="px-4 py-2.5 text-right font-jetbrains border-b border-l border-slate-100/80 text-slate-400">
              {row.srx400Actual}
            </td>
            <td className={`px-4 py-2.5 text-right font-jetbrains border-b border-l border-slate-100/60 border-r border-r-slate-300 ${isYellow ? 'text-slate-900 font-bold' : 'text-slate-800 font-semibold'}`}>
              {row.srx400Publish}
            </td>
            <td className="px-4 py-2.5 text-right font-jetbrains border-b border-l border-slate-100/60 text-slate-400">
              {row.srx440Actual}
            </td>
            <td className={`px-4 py-2.5 text-right font-jetbrains border-b border-l border-slate-100/60 ${isYellow ? 'text-slate-900 font-bold' : 'text-slate-800 font-semibold'}`}>
              {row.srx440Publish}
            </td>
          </tr>
        );
      })}
    </>
  );
}

