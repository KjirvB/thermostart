import { useRef, useState } from "react";

const TAU = Math.PI * 2;
const MIN_C = 10;
const MAX_C = 30;
const ARC_START = Math.PI * 0.75;
const ARC_SWEEP = Math.PI * 1.5;

function tempToAngle(c) {
  const t = (c - MIN_C) / (MAX_C - MIN_C);
  return ARC_START + t * ARC_SWEEP;
}
function angleToTemp(a) {
  let rel = a - ARC_START;
  while (rel < 0) rel += TAU;
  while (rel > TAU) rel -= TAU;
  if (rel > ARC_SWEEP) {
    rel = rel - ARC_SWEEP < TAU - rel ? ARC_SWEEP : 0;
  }
  return MIN_C + (rel / ARC_SWEEP) * (MAX_C - MIN_C);
}
function polar(cx, cy, r, a) {
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arcPath(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`;
}

export function Dial({ targetC, roomC, onChange, onCommit, onDragStart }) {
  const SIZE = 480;
  const CX = SIZE / 2, CY = SIZE / 2;
  const R = 200;
  const R_TICK = 178;
  const R_HANDLE = 200;
  const HIT_INNER = 168;
  const HIT_OUTER = 232;
  const HANDLE_GRAB_R = 36;

  const svgRef = useRef(null);
  const [drag, setDrag] = useState(false);

  const targetA = tempToAngle(targetC);
  const roomA = tempToAngle(roomC);

  const ticks = [];
  for (let c = MIN_C; c <= MAX_C; c++) {
    const a = tempToAngle(c);
    const big = c % 5 === 0;
    const len = big ? 12 : 5;
    const [x1, y1] = polar(CX, CY, R_TICK, a);
    const [x2, y2] = polar(CX, CY, R_TICK - len, a);
    ticks.push({ c, a, x1, y1, x2, y2, big });
  }

  function svgCoords(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * SIZE;
    const py = ((e.clientY - rect.top) / rect.height) * SIZE;
    return [px, py];
  }
  function applyAngle(px, py) {
    const a = Math.atan2(py - CY, px - CX);
    const c = angleToTemp(a);
    const snapped = Math.round(c * 2) / 2;
    onChange(Math.min(MAX_C, Math.max(MIN_C, snapped)));
  }
  function isOnRing(px, py) {
    const dx = px - CX, dy = py - CY;
    const dist = Math.hypot(dx, dy);
    if (dist >= HIT_INNER && dist <= HIT_OUTER) return true;
    const [hx, hy] = polar(CX, CY, R_HANDLE, targetA);
    if (Math.hypot(px - hx, py - hy) <= HANDLE_GRAB_R) return true;
    return false;
  }

  function startDrag(e) {
    if (!svgRef.current) return;
    const [px, py] = svgCoords(e);
    if (!isOnRing(px, py)) return;
    setDrag(true);
    if (onDragStart) onDragStart();
    e.currentTarget.setPointerCapture(e.pointerId);
    applyAngle(px, py);
  }
  function moveDrag(e) {
    if (!drag) return;
    const [px, py] = svgCoords(e);
    applyAngle(px, py);
  }
  function endDrag(e) {
    if (drag && onCommit) {
      const [px, py] = svgCoords(e);
      const a = Math.atan2(py - CY, px - CX);
      const c = angleToTemp(a);
      onCommit(Math.min(MAX_C, Math.max(MIN_C, Math.round(c * 2) / 2)));
    }
    setDrag(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  const [hx, hy] = polar(CX, CY, R_HANDLE, targetA);
  const [rx, ry] = polar(CX, CY, R_HANDLE, roomA);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} className={"dial-svg" + (drag ? " dragging" : "")}
         onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <defs>
        <linearGradient id="ringGrad" gradientUnits="userSpaceOnUse" x1={CX - R} y1={CY} x2={CX + R} y2={CY}>
          <stop offset="0%"   stopColor="var(--cool)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--ember)" stopOpacity="1" />
        </linearGradient>
        <filter id="handleShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="3" stdDeviation="8" floodColor="#000" floodOpacity="0.18"/>
        </filter>
      </defs>

      <path d={arcPath(CX, CY, R, ARC_START, ARC_START + ARC_SWEEP)}
            fill="none" stroke="var(--bg-2)" strokeWidth="22" strokeLinecap="round" />

      <path d={arcPath(CX, CY, R, ARC_START, targetA)}
            fill="none" stroke="url(#ringGrad)" strokeWidth="22" strokeLinecap="round" />

      {ticks.map(t => (
        <line key={t.c} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
              stroke={t.big ? "var(--ink-2)" : "var(--ink-3)"}
              strokeWidth={t.big ? 1.4 : 1} opacity={t.big ? 0.9 : 0.5} />
      ))}

      {ticks.filter(t => t.big).map(t => {
        const [lx, ly] = polar(CX, CY, R_TICK - 26, t.a);
        return (
          <text key={"l" + t.c} x={lx} y={ly} textAnchor="middle" dominantBaseline="central"
                fontFamily="var(--font-mono)" fontSize="10" fill="var(--ink-3)" letterSpacing="0.5">
            {t.c}
          </text>
        );
      })}

      <circle cx={rx} cy={ry} r="4" fill="none" stroke="var(--ink-2)" strokeWidth="1.5" opacity="0.7" />

      <g filter="url(#handleShadow)">
        <circle cx={hx} cy={hy} r="16" fill="var(--bg-0)" stroke="var(--ember)" strokeWidth="2.5" />
        <circle cx={hx} cy={hy} r="4" fill="var(--ember)" />
      </g>
    </svg>
  );
}
