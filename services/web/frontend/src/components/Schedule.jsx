import React, { useRef, useState } from "react";
import { PROGRAMS, slotToHHMM } from "../constants.js";

function polarS(cx, cy, r, a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }
function donutSeg(cx, cy, rOut, rIn, startA, endA) {
  const [x1, y1] = polarS(cx, cy, rOut, startA);
  const [x2, y2] = polarS(cx, cy, rOut, endA);
  const [x3, y3] = polarS(cx, cy, rIn,  endA);
  const [x4, y4] = polarS(cx, cy, rIn,  startA);
  const large = endA - startA > Math.PI ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rIn} ${rIn} 0 ${large} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}
function slotToAngle(slot) { return -Math.PI / 2 + (slot / 96) * Math.PI * 2; }
function programColor(pgm) { const p = PROGRAMS[pgm]; return p ? p.color : "var(--p-pause)"; }

function fmtRange(a, b) {
  const dur = b - a;
  const h = Math.floor(dur / 4);
  const m = (dur % 4) * 15;
  const durStr = (h ? h + "h " : "") + (m ? m + "m" : (h ? "" : "0m"));
  return `${slotToHHMM(a)} – ${slotToHHMM(b)} · ${durStr.trim()}`;
}

export function DayClock({ blocks, currentSlot, exceptions = [] }) {
  const SIZE = 180;
  const CX = SIZE / 2, CY = SIZE / 2;
  const R_OUT = 84, R_IN = 56;

  return (
    <div className="dayclock">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <defs>
          <pattern id="excStripe" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="currentColor" opacity="0.25" />
            <rect width="3" height="6" fill="currentColor" />
          </pattern>
        </defs>
        <circle cx={CX} cy={CY} r={(R_OUT + R_IN) / 2} fill="none" stroke="var(--bg-2)" strokeWidth={R_OUT - R_IN} />
        {blocks.map((b, i) => {
          const a0 = slotToAngle(b.start);
          const a1 = slotToAngle(b.end === 96 ? 95.999 : b.end);
          return (
            <path key={i} d={donutSeg(CX, CY, R_OUT, R_IN, a0, a1)}
                  fill={programColor(b.pgm)} opacity="0.95" />
          );
        })}
        {exceptions.map((seg, i) => {
          const a0 = slotToAngle(seg.startSlot);
          const a1 = slotToAngle(seg.endSlot === 96 ? 95.999 : seg.endSlot);
          return (
            <path key={"x" + i} d={donutSeg(CX, CY, R_OUT, R_IN, a0, a1)}
                  fill="url(#excStripe)"
                  color={programColor(seg.pgm)}
                  stroke={seg.isActive ? "var(--ink-0)" : "none"}
                  strokeWidth={seg.isActive ? 1.5 : 0}
                  opacity={seg.isActive ? 1 : 0.7} />
          );
        })}
        {[0, 6, 12, 18].map(h => {
          const a = slotToAngle(h * 4);
          const [x1, y1] = polarS(CX, CY, R_OUT + 2, a);
          const [x2, y2] = polarS(CX, CY, R_OUT + 8, a);
          return <line key={h} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink-3)" strokeWidth="1" />;
        })}
        <text x={CX} y={CY - R_OUT - 12} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8" fill="var(--ink-3)">00</text>
        <text x={CX + R_OUT + 12} y={CY + 3} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8" fill="var(--ink-3)">06</text>
        <text x={CX} y={CY + R_OUT + 14} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8" fill="var(--ink-3)">12</text>
        <text x={CX - R_OUT - 12} y={CY + 3} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8" fill="var(--ink-3)">18</text>

        {currentSlot != null && (() => {
          const a = slotToAngle(currentSlot);
          const [x2, y2] = polarS(CX, CY, R_OUT - 2, a);
          return (
            <g>
              <line x1={CX} y1={CY} x2={x2} y2={y2} stroke="var(--ink-0)" strokeWidth="2" strokeLinecap="round" />
              <circle cx={CX} cy={CY} r="3" fill="var(--ink-0)" />
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

// Apply paint to a day's blocks: replace slots [a..b) with program p, then merge adjacent.
export function applyPaint(blocks, a, b, p) {
  if (a === b) b = a + 1;
  const out = [];
  blocks.forEach(blk => {
    if (blk.end <= a || blk.start >= b) {
      out.push(blk);
    } else {
      if (blk.start < a) out.push({ ...blk, end: a });
      if (blk.end > b)   out.push({ ...blk, start: b });
    }
  });
  out.push({ start: a, end: b, pgm: p });
  out.sort((x, y) => x.start - y.start);
  const merged = [];
  out.forEach(blk => {
    if (blk.start === blk.end) return;
    const last = merged[merged.length - 1];
    if (last && last.end === blk.start && last.pgm === blk.pgm) {
      last.end = blk.end;
    } else {
      merged.push({ ...blk });
    }
  });
  return merged;
}

export function RibbonEditor({ week, onWeekChange, onWeekCommit, currentDay, currentSlot, selectedProgram, erasing, onEditBlock, t }) {
  const trackRefs = useRef([]);
  const pendingWeekRef = useRef(week);
  const [gesture, setGesture] = useState(null);
  const [tip, setTip] = useState(null);
  pendingWeekRef.current = week;

  const slotFromX = (rect, clientX) => {
    const px = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return Math.max(0, Math.min(96, Math.round((px / rect.width) * 96)));
  };

  const armed = selectedProgram != null || erasing;

  const paintApply = (day, fromSlot, toSlot) => {
    const a = Math.min(fromSlot, toSlot);
    const b = Math.max(fromSlot, toSlot);
    const newDay = applyPaint(week[day], a, b, erasing ? "pause" : selectedProgram);
    const next = week.slice();
    next[day] = newDay;
    pendingWeekRef.current = next;
    onWeekChange(next);
  };

  const onTrackPointerDown = (day, e) => {
    if (!armed) return;
    if (e.target.classList.contains("blk-edge")) return;
    const rect = trackRefs.current[day].getBoundingClientRect();
    const s = slotFromX(rect, e.clientX);
    setGesture({ kind: "paint", day, anchor: s });
    paintApply(day, s, s + 1);
    setTip({ day, fromSlot: s, toSlot: s + 1,
             label: erasing ? t("schedule.clear") : t(PROGRAMS[selectedProgram].tk),
             color: erasing ? "var(--bad)" : PROGRAMS[selectedProgram].color,
             x: e.clientX, y: rect.top });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onTrackPointerMove = (day, e) => {
    if (!gesture || gesture.day !== day) return;
    const rect = trackRefs.current[day].getBoundingClientRect();
    const s = slotFromX(rect, e.clientX);
    if (gesture.kind === "paint") {
      paintApply(day, gesture.anchor, s);
      const a = Math.min(gesture.anchor, s);
      const b = Math.max(gesture.anchor, s);
      setTip({ day, fromSlot: a, toSlot: b,
               label: erasing ? t("schedule.clear") : t(PROGRAMS[selectedProgram].tk),
               color: erasing ? "var(--bad)" : PROGRAMS[selectedProgram].color,
               x: e.clientX, y: rect.top });
    } else if (gesture.kind === "resize-start" || gesture.kind === "resize-end") {
      const blk = week[day][gesture.idx];
      if (!blk) return;
      const next = week.slice();
      let newStart = blk.start, newEnd = blk.end;
      if (gesture.kind === "resize-start") newStart = Math.max(0, Math.min(blk.end - 1, s));
      else                                  newEnd   = Math.min(96, Math.max(blk.start + 1, s));
      let temp = applyPaint(next[day], blk.start, blk.end, "pause");
      temp = applyPaint(temp, newStart, newEnd, blk.pgm);
      next[day] = temp;
      pendingWeekRef.current = next;
      onWeekChange(next);
      setTip({ day, fromSlot: newStart, toSlot: newEnd,
               label: t(PROGRAMS[blk.pgm].tk),
               color: PROGRAMS[blk.pgm].color,
               x: e.clientX, y: rect.top });
      const newBlocks = next[day];
      const newIdx = newBlocks.findIndex(x => x.pgm === blk.pgm && x.start === newStart && x.end === newEnd);
      if (newIdx >= 0) setGesture({ ...gesture, idx: newIdx });
    }
  };

  const onTrackPointerUp = (day, e) => {
    if (gesture && gesture.day === day) {
      setGesture(null);
      if (onWeekCommit) onWeekCommit(pendingWeekRef.current);
    }
    setTip(null);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  const onBlockClick = (day, idx, e) => {
    if (gesture) return;
    if (armed) return;
    e.stopPropagation();
    onEditBlock && onEditBlock(day, idx);
  };

  const onEdgePointerDown = (day, idx, side, e) => {
    e.stopPropagation();
    setGesture({ kind: side === "start" ? "resize-start" : "resize-end", day, idx });
    const blk = week[day][idx];
    const rect = trackRefs.current[day].getBoundingClientRect();
    setTip({ day, fromSlot: blk.start, toSlot: blk.end,
             label: t(PROGRAMS[blk.pgm].tk),
             color: PROGRAMS[blk.pgm].color,
             x: e.clientX, y: rect.top });
    try { trackRefs.current[day].setPointerCapture(e.pointerId); } catch (_) {}
  };

  return (
    <>
      <div className={"ribbon" + (armed ? " painting" : "")}>
        <div></div>
        <div className="axis">
          {[0, 3, 6, 9, 12, 15, 18, 21].map(h => <span key={h}>{String(h).padStart(2, "0")}</span>)}
        </div>
        {week.map((blocks, d) => (
          <React.Fragment key={d}>
            <div className={"lbl" + (d === currentDay ? " now-day" : "")}>{t("day.short." + d)}</div>
            <div className="track"
                 ref={el => trackRefs.current[d] = el}
                 onPointerDown={(e) => onTrackPointerDown(d, e)}
                 onPointerMove={(e) => onTrackPointerMove(d, e)}
                 onPointerUp={(e) => onTrackPointerUp(d, e)}
                 onPointerCancel={(e) => onTrackPointerUp(d, e)}>
              {[6, 12, 18].map(h => (
                <div key={h} className="hl" style={{ left: `${h / 24 * 100}%` }}></div>
              ))}
              {blocks.map((b, i) => (
                <div key={i} className={"blk" + (b.pgm === "pause" ? " blk-pause" : "")}
                     onClick={(e) => onBlockClick(d, i, e)}
                     title={`${t(PROGRAMS[b.pgm].tk)} · ${slotToHHMM(b.start)}–${slotToHHMM(b.end)} — ${t("schedule.block.tooltip")}`}
                     style={{
                       left: `${b.start / 96 * 100}%`,
                       width: `${(b.end - b.start) / 96 * 100}%`,
                       background: programColor(b.pgm),
                     }}>
                  {b.pgm !== "pause" && b.end - b.start >= 2 && (
                    <>
                      <div className="blk-edge blk-edge-start"
                           onPointerDown={(e) => onEdgePointerDown(d, i, "start", e)} />
                      <div className="blk-edge blk-edge-end"
                           onPointerDown={(e) => onEdgePointerDown(d, i, "end", e)} />
                    </>
                  )}
                </div>
              ))}
              {d === currentDay && currentSlot != null && (
                <div className="now" style={{ left: `${currentSlot / 96 * 100}%` }}></div>
              )}
            </div>
          </React.Fragment>
        ))}
      </div>

      {tip && (
        <div className="ribbon-tip" style={{ left: tip.x, top: tip.y - 44 }}>
          <span className="tip-sw" style={{ background: tip.color }}></span>
          <span className="tip-label">{tip.label}</span>
          <span className="tip-range">{fmtRange(tip.fromSlot, tip.toSlot)}</span>
        </div>
      )}
    </>
  );
}

export function BlockEditDialog({ day, blockIndex, week, onWeekChange, onClose, t }) {
  const block = week[day][blockIndex];
  const [pgm, setPgm] = useState(block.pgm);
  const [start, setStart] = useState(block.start);
  const [end, setEnd] = useState(block.end);

  const adj = (which, delta) => {
    if (which === "start") setStart(Math.max(0, Math.min(end - 1, start + delta)));
    else                   setEnd  (Math.max(start + 1, Math.min(96, end + delta)));
  };

  const save = () => {
    let temp = applyPaint(week[day], block.start, block.end, "pause");
    temp = applyPaint(temp, start, end, pgm);
    const next = week.slice();
    next[day] = temp;
    onWeekChange(next);
    onClose();
  };

  const remove = () => {
    const next = week.slice();
    next[day] = applyPaint(week[day], block.start, block.end, "pause");
    onWeekChange(next);
    onClose();
  };

  const dur = end - start;
  const durH = Math.floor(dur / 4);
  const durM = (dur % 4) * 15;

  return (
    <div className="dialog-bg" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h3>{t("schedule.dialog.title", { day: t("day.long." + day) })}</h3>

        <div className="row">
          <label>{t("schedule.dialog.program")}</label>
          <div className="palette" style={{ marginBottom: 0 }}>
            {Object.values(PROGRAMS).filter(p => p.key !== "pause").map(p => (
              <button key={p.key}
                      className={"pchip" + (pgm === p.key ? " active" : "")}
                      onClick={() => setPgm(p.key)}>
                <span className="sw" style={{ background: p.color }}></span>
                {t(p.tk)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="row">
            <label>{t("schedule.dialog.start")}</label>
            <div className="stepper">
              <button onClick={() => adj("start", -1)}>−</button>
              <span className="v">{slotToHHMM(start)}</span>
              <button onClick={() => adj("start", +1)}>+</button>
            </div>
          </div>
          <div className="row">
            <label>{t("schedule.dialog.end")}</label>
            <div className="stepper">
              <button onClick={() => adj("end", -1)}>−</button>
              <span className="v">{slotToHHMM(end)}</span>
              <button onClick={() => adj("end", +1)}>+</button>
            </div>
          </div>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)", letterSpacing: "0.04em" }}>
          {t("schedule.dialog.duration")} {durH}h {durM}m {durH === 0 && durM === 0 ? t("schedule.dialog.invalid") : ""}
        </div>

        <div className="actions">
          <button className="btn ghost sq" onClick={remove}>{t("schedule.dialog.delete")}</button>
          <button className="btn ghost sq" onClick={onClose}>{t("schedule.dialog.cancel")}</button>
          <button className="btn primary sq" onClick={save}>{t("schedule.dialog.save")}</button>
        </div>
      </div>
    </div>
  );
}
