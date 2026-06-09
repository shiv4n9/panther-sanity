import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * AnimatedMetric — count-up animation for metric strings.
 *
 * Metric values look like "654.7 KPPS / 440 Mbps" or "1650 CPS / 920 Mbps".
 * This component animates every numeric token in the string from 0 → target
 * on mount (and whenever the value changes), preserving units, separators and
 * decimal precision. Non-numeric parts (units, slashes, spaces) are rendered
 * verbatim. Respects prefers-reduced-motion.
 */

const NUM_RE = /(\d+(?:\.\d+)?)/g;

// Split "654.7 KPPS / 440 Mbps" into tokens, marking which are numbers.
function tokenize(str) {
  const tokens = [];
  let lastIndex = 0;
  let m;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(str)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ num: false, text: str.slice(lastIndex, m.index) });
    }
    const raw = m[1];
    const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
    tokens.push({ num: true, value: parseFloat(raw), decimals });
    lastIndex = m.index + raw.length;
  }
  if (lastIndex < str.length) {
    tokens.push({ num: false, text: str.slice(lastIndex) });
  }
  return tokens;
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export default function AnimatedMetric({ value, duration = 900, className }) {
  const str = value == null ? '' : String(value);
  const prefersReduced = useReducedMotion();
  const [display, setDisplay] = useState(str);
  const rafRef = useRef(null);

  useEffect(() => {
    if (prefersReduced || !str) {
      setDisplay(str);
      return;
    }
    const tokens = tokenize(str);
    const hasNumber = tokens.some((t) => t.num);
    if (!hasNumber) {
      setDisplay(str);
      return;
    }

    let start = null;
    const render = (now) => {
      if (start === null) start = now;
      const progress = Math.min((now - start) / duration, 1);
      const eased = easeOutCubic(progress);
      const out = tokens
        .map((t) =>
          t.num ? (t.value * eased).toFixed(t.decimals) : t.text
        )
        .join('');
      setDisplay(out);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(render);
      }
    };
    rafRef.current = requestAnimationFrame(render);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [str, duration, prefersReduced]);

  return <span className={className}>{display}</span>;
}
