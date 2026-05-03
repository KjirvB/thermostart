import { useMemo, useState } from "react";
import { Dial } from "./Dial.jsx";
import { DayClock, RibbonEditor, BlockEditDialog } from "./Schedule.jsx";
import { PROGRAMS, slotToHHMM, nowDayIdx, nowSlot } from "../constants.js";
import { SRC_MANUAL, SRC_PAUSE, SRC_SERVER, SRC_STD_WEEK, SRC_EXCEPTION } from "../store.js";
import { downloadFirmware } from "../api.js";

// ── History graph (placeholder data — real history wiring is a follow-up) ──

function HistoryGraph({ data, height = 180 }) {
  const w = 800, h = height, pad = { l: 30, r: 14, t: 14, b: 22 };
  const ihw = w - pad.l - pad.r;
  const ihh = h - pad.t - pad.b;
  const min = Math.min(...data.target, ...data.room) - 1;
  const max = Math.max(...data.target, ...data.room) + 1;
  const range = max - min || 1;

  const N = data.target.length;
  const xAt = (i) => pad.l + (i / (N - 1)) * ihw;
  const yAt = (v) => pad.t + (1 - (v - min) / range) * ihh;

  const pathFor = (arr) => arr.map((v, i) => i === 0 ? `M ${xAt(i)} ${yAt(v)}` : `L ${xAt(i)} ${yAt(v)}`).join(" ");
  const fillFor = (arr) => `${pathFor(arr)} L ${xAt(N - 1)} ${pad.t + ihh} L ${xAt(0)} ${pad.t + ihh} Z`;

  const yTicks = [];
  for (let v = Math.ceil(min); v <= Math.floor(max); v++) {
    if (Math.floor(max) - Math.ceil(min) > 6 && v % 2 !== 0) continue;
    yTicks.push(v);
  }
  const xTicks = [0, 6, 12, 18, 24];

  return (
    <svg className="history" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="histFillTarget" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ember)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--ember)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {yTicks.map((v) => (
        <g key={v}>
          <line className="grid-line" x1={pad.l} y1={yAt(v)} x2={w - pad.r} y2={yAt(v)} />
          <text className="axis" x={pad.l - 6} y={yAt(v) + 3} textAnchor="end">{v}°</text>
        </g>
      ))}
      {xTicks.map((hh) => (
        <text key={hh} className="axis" x={pad.l + (hh / 24) * ihw} y={height - 4} textAnchor="middle">{String(hh).padStart(2, "0")}</text>
      ))}
      <path d={fillFor(data.target)} fill="url(#histFillTarget)" />
      <path d={pathFor(data.target)} fill="none" stroke="var(--ember)" strokeWidth="1.8" />
      <path d={pathFor(data.room)} fill="none" stroke="var(--ink-1)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.7" />
    </svg>
  );
}

function makePlaceholderHistory() {
  const target = [], room = [];
  for (let i = 0; i < 96; i++) {
    const frac = i / 96;
    let tg;
    if (frac < 0.25) tg = 18;
    else if (frac < 0.33) tg = 21;
    else if (frac < 0.70) tg = 16.5;
    else if (frac < 0.92) tg = 21;
    else tg = 18;
    target.push(tg);
    room.push(tg + Math.sin(frac * Math.PI * 6) * 0.4 - 0.3);
  }
  return { target, room };
}

// ── Program Defaults ──

const IcoDroplet = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2c2 2.5 3 4.4 3 6a3 3 0 11-6 0c0-1.6 1-3.5 3-6z" />
  </svg>
);

const IcoPot = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 2v3M8 2v3M11 2v3M3.5 6h9l-.6 7a1.5 1.5 0 01-1.5 1.4H5.6A1.5 1.5 0 014.1 13L3.5 6z" />
  </svg>
);

function ProgramDefaults({ state, actions, t }) {
  const showDhw = state.oo === 1 && (state.fw >= 20140825 || state.hw === 3);
  const programs = Object.values(PROGRAMS).filter((p) => p.key !== "pause");
  const pause = PROGRAMS.pause;
  const rowCls = "pgm-row" + (showDhw ? " pgm-has-dhw" : "");

  function PgmRow({ p }) {
    const tenths = state.predefinedTemperatures[p.key] ?? p.temp;
    const dhwOn = state.dhwPrograms[p.key] === 1;
    const bump = (d) => actions.setPredefinedTemperature(p.key, Math.max(50, Math.min(300, tenths + d)));

    return (
      <div className={rowCls}>
        <div className="pgm-name">
          <span className="sw" style={{ background: p.color }}></span>
          {t(p.tk)}
        </div>
        <div className="pgm-temp">
          <div className="stepper">
            <button onClick={() => bump(-5)}>−</button>
            <span className="v">{(tenths / 10).toFixed(1)}°</span>
            <button onClick={() => bump(+5)}>+</button>
          </div>
        </div>
        {showDhw && (
          <div className="pgm-dhw">
            <div className="seg dhw-seg">
              <button className={!dhwOn ? "on" : ""}
                      onClick={() => actions.setDhwPrograms({ ...state.dhwPrograms, [p.key]: 0 })}>
                <span className="pgm-btn-inner"><IcoDroplet />{t("schedule.dhw.saving")}</span>
              </button>
              <button className={dhwOn ? "on" : ""}
                      onClick={() => actions.setDhwPrograms({ ...state.dhwPrograms, [p.key]: 1 })}>
                <span className="pgm-btn-inner"><IcoPot />{t("schedule.dhw.maintain")}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const pauseTenths = state.predefinedTemperatures[pause.key] ?? pause.temp;
  const bumpPause = (d) => actions.setPredefinedTemperature(pause.key, Math.max(50, Math.min(300, pauseTenths + d)));

  return (
    <div>
      <div className="section-h">
        <h2>{t("schedule.programs.heading")} <em>{t("schedule.programs.heading_em")}</em></h2>
        <span className="right">{t("schedule.programs.subtitle")}</span>
      </div>
      <div className="card">
        <div className="pgm-table">
          {programs.map((p) => <PgmRow key={p.key} p={p} />)}
        </div>

        <div className="pgm-base">
          <div className="pgm-base-row">
            <div className="pgm-name">
              <span className="sw" style={{ background: pause.color }}></span>
              {t(pause.tk)}
            </div>
            <div className="pgm-temp">
              <div className="stepper">
                <button onClick={() => bumpPause(-5)}>−</button>
                <span className="v">{(pauseTenths / 10).toFixed(1)}°</span>
                <button onClick={() => bumpPause(+5)}>+</button>
              </div>
            </div>
          </div>
          <p className="pgm-base-note">{t("schedule.base_temp.note")}</p>
        </div>

        {showDhw && (
          <div className="pgm-foot">
            <p><strong><IcoDroplet />{t("schedule.dhw.saving")}</strong> — {t("schedule.dhw.note.saving")}</p>
            <p><strong><IcoPot />{t("schedule.dhw.maintain")}</strong> — {t("schedule.dhw.note.maintain")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Overview ──

export function Overview({ state, actions, t, onGoSchedule }) {
  const today = nowDayIdx();
  const slot = nowSlot();
  const todayBlocks = state.week[today] || [];
  const active = todayBlocks.find((b) => slot >= b.start && slot < b.end);
  const next = todayBlocks.find((b) => b.start > slot);
  const paused = state.source === SRC_PAUSE;
  const manual = state.source === SRC_MANUAL || state.source === SRC_SERVER;
  const [dragTarget, setDragTarget] = useState(null);
  const activePgm = paused ? "pause" : active ? active.pgm : "home";
  const pgm = PROGRAMS[activePgm] || PROGRAMS.home;

  const history = useMemo(() => makePlaceholderHistory(), []);
  const [range, setRange] = useState("24h");

  return (
    <div>
      <div className="head">
        <div className="eyebrow">{new Date().toLocaleString(state.locale || "en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>
        <h1>{t("overview.heading")} <em>{state.roomC.toFixed(1)}°</em></h1>
      </div>

      <div className="hero">
        <div className="context-line">
          <span className="pill">
            <span className="sw" style={{ background: manual ? "var(--ink-2)" : pgm.color }}></span>
            {manual ? t("overview.mode.manual") : t(pgm.tk)}
          </span>
          {!paused && next && (
            <span>{t("overview.next_at")} <strong style={{ color: "var(--ink-1)" }}>{slotToHHMM(next.start)}</strong></span>
          )}
        </div>

        <div className="dial-stack">
          <Dial
            targetC={dragTarget ?? state.targetC}
            roomC={state.roomC}
            onChange={(c) => setDragTarget(c)}
            onCommit={(c) => { setDragTarget(null); actions.setTargetC(c); }}
            onDragStart={() => {}} />

          <div className="dial-center">
            <div>
              <div className="dial-readout">
                {(() => {
                  const tv = dragTarget ?? state.targetC;
                  return <>{Math.floor(tv)}<span className="frac">.{Math.round((tv % 1) * 10)}</span><span className="deg">°</span></>;
                })()}
              </div>
              <div className="dial-sub"><strong>{t("overview.target")}</strong> · {t("overview.room")} {state.roomC.toFixed(1)}°</div>
            </div>
          </div>
        </div>

        <div className="dial-mode-wrap">
          <div className="dial-mode">
            <button className={!paused && !manual ? "on" : ""} onClick={() => actions.unpause()} style={{ fontFamily: "Inter" }}>{t("overview.btn.schedule")}</button>
            <button className={manual ? "on" : ""} onClick={() => actions.setTargetC(state.targetC)}>{t("overview.btn.manual")}</button>
            <button className={paused ? "on" : ""} onClick={() => actions.pause()}>{t("overview.btn.pause")}</button>
          </div>
        </div>

        <div className="dial-hint">
          {paused ? (
            <>{t("overview.hint.paused")} <button className="link" onClick={() => actions.unpause()}>{t("overview.hint.paused_link")}</button>.</>
          ) : manual ? (
            <>{t("overview.hint.manual")} <button className="link" onClick={() => actions.unpause()}>{t("overview.hint.manual_link")}</button>.</>
          ) : (
            <>{t("overview.mode.schedule")}. {t("overview.hint.schedule")}</>
          )}
        </div>
      </div>

      <div className="section-h">
        <h2>{t("overview.history")}</h2>
        <span className="right">
          <span className="range-tabs">
            {["24h", "7d", "30d"].map((r) => (
              <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r)}>{r}</button>
            ))}
          </span>
        </span>
      </div>
      <div className="card">
        <div style={{
          display: "inline-block",
          fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase",
          color: "var(--ink-3)", border: "1px dashed var(--line)", padding: "2px 8px", borderRadius: 4, marginBottom: 8,
        }}>{t("overview.history.sample")}</div>
        <HistoryGraph data={history} />
        <div style={{ marginTop: 10, display: "flex", gap: 16, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)", letterSpacing: "0.04em" }}>
          <span><span style={{ display: "inline-block", width: 10, height: 2, background: "var(--ember)", verticalAlign: "middle", marginRight: 6 }}></span>{t("overview.legend.target")}</span>
          <span><span style={{ display: "inline-block", width: 10, height: 1, borderTop: "1px dashed var(--ink-1)", verticalAlign: "middle", marginRight: 6 }}></span>{t("overview.legend.room")}</span>
        </div>
      </div>

      <div className="section-h">
        <h2>{t("overview.today")}</h2>
        <span className="right"><button className="btn ghost sq" onClick={onGoSchedule}>{t("overview.edit_schedule")}</button></span>
      </div>
      <div className="card">
        <div className="today-glance">
          <DayClock blocks={todayBlocks} currentSlot={slot} />
          <div className="today-list">
            {todayBlocks.map((b, i) => {
              const isNow = slot >= b.start && slot < b.end;
              return (
                <div key={i} className={"row" + (isNow ? " now" : "")}>
                  <span className="sw" style={{ background: PROGRAMS[b.pgm].color }}></span>
                  <span className="name">{t(PROGRAMS[b.pgm].tk)}</span>
                  <span className="time">{slotToHHMM(b.start)}–{slotToHHMM(b.end)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Schedule ──

export function Schedule({ state, actions, t }) {
  const [selected, setSelected] = useState(null);
  const [erasing, setErasing] = useState(false);
  const [editing, setEditing] = useState(null);
  const today = nowDayIdx();
  const slot = nowSlot();

  const helpText = erasing
    ? t("schedule.help.erasing")
    : selected
      ? t("schedule.help.selected", { program: t(PROGRAMS[selected].tk) })
      : t("schedule.help.default");

  return (
    <div>
      <div className="head">
        <div className="eyebrow">{t("schedule.eyebrow")}</div>
        <h1>{t("schedule.heading")} <em>{t("schedule.heading_em")}</em></h1>
      </div>

      <div className="editor-help">{helpText}</div>

      <div className="palette">
        <button className={"pchip" + (selected == null && !erasing ? " active" : "")}
                onClick={() => { setSelected(null); setErasing(false); }}>
          {t("schedule.chip.select")}
        </button>
        {Object.values(PROGRAMS).filter((p) => p.key !== "pause").map((p) => {
          const tenths = state.predefinedTemperatures[p.key] ?? p.temp;
          return (
            <button key={p.key}
                    className={"pchip" + (selected === p.key && !erasing ? " active" : "")}
                    onClick={() => { setSelected(p.key); setErasing(false); }}>
              <span className="sw" style={{ background: p.color }}></span>
              {t(p.tk)} <span style={{ opacity: 0.65 }}>{(tenths / 10).toFixed(1)}°</span>
            </button>
          );
        })}
        <button className={"pchip erase" + (erasing ? " active" : "")}
                onClick={() => { setErasing(!erasing); setSelected(null); }}>
          {t("schedule.chip.clear")}
        </button>
      </div>

      <div className="card editor">
        <RibbonEditor
          week={state.week}
          onWeekChange={(w) => actions.setWeekLocal(w)}
          onWeekCommit={(w) => actions.commitWeek(w)}
          currentDay={today}
          currentSlot={slot}
          selectedProgram={erasing ? null : selected}
          erasing={erasing}
          t={t}
          onEditBlock={(day, idx) => setEditing({ day, idx })} />
      </div>

      {editing && (
        <BlockEditDialog
          day={editing.day}
          blockIndex={editing.idx}
          week={state.week}
          onWeekChange={(w) => actions.setWeek(w)}
          t={t}
          onClose={() => setEditing(null)} />
      )}

      <ProgramDefaults state={state} actions={actions} t={t} />
    </div>
  );
}

// ── Exceptions ──
// Backend shape: { start: [Y, M0, D, h, m], end: [Y, M0, D, h, m], temperature: pgmKey }
// M0 is 0-indexed (Jan=0). We convert to/from <input type="datetime-local"> values.

const pad2 = (n) => String(n).padStart(2, "0");

function excArrToLocal(arr) {
  if (!Array.isArray(arr) || arr.length < 5) return "";
  const [Y, M0, D, h, m] = arr;
  return `${Y}-${pad2(M0 + 1)}-${pad2(D)}T${pad2(h)}:${pad2(m)}`;
}

function localToExcArr(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || "");
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), parseInt(m[4], 10), parseInt(m[5], 10)];
}

function excArrToDate(arr) {
  const [Y, M0, D, h, m] = arr;
  return new Date(Y, M0, D, h, m);
}

function formatExceptionWhen(exc, locale) {
  if (!Array.isArray(exc.start)) return "—";
  const fmt = (a) => excArrToDate(a).toLocaleString(locale || "en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
  return `${fmt(exc.start)} → ${fmt(exc.end)}`;
}

function defaultNewException() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 18, 0);
  const toArr = (d) => [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()];
  return { start: toArr(start), end: toArr(end), temperature: "home" };
}

function ExceptionEditor({ initial, onSave, onCancel, onDelete, t }) {
  const [pgm, setPgm] = useState(initial.temperature || "home");
  const [startStr, setStartStr] = useState(excArrToLocal(initial.start));
  const [endStr, setEndStr] = useState(excArrToLocal(initial.end));
  const startArr = localToExcArr(startStr);
  const endArr = localToExcArr(endStr);
  const valid = startArr && endArr && excArrToDate(startArr) < excArrToDate(endArr);

  const save = () => {
    if (!valid) return;
    onSave({ ...initial, start: startArr, end: endArr, temperature: pgm });
  };

  return (
    <div className="dialog-bg" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{onDelete ? t("exceptions.dialog.edit") : t("exceptions.dialog.new")}</h3>

        <div className="row">
          <label>{t("exceptions.dialog.program")}</label>
          <div className="palette" style={{ marginBottom: 0 }}>
            {Object.values(PROGRAMS).map((p) => (
              <button key={p.key}
                      className={"pchip" + (pgm === p.key ? " active" : "")}
                      onClick={() => setPgm(p.key)}>
                <span className="sw" style={{ background: p.color }}></span>
                {t(p.tk)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginTop: 14 }}>
          <label style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>{t("exceptions.dialog.start")}</div>
            <input type="datetime-local" value={startStr} onChange={(e) => setStartStr(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>{t("exceptions.dialog.end")}</div>
            <input type="datetime-local" value={endStr} onChange={(e) => setEndStr(e.target.value)} style={{ width: "100%" }} />
          </label>
        </div>

        {!valid && (
          <div style={{ marginTop: 8, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--bad)" }}>
            {t("exceptions.dialog.error")}
          </div>
        )}

        <div className="actions">
          {onDelete && <button className="btn ghost sq" onClick={onDelete}>{t("exceptions.dialog.delete")}</button>}
          <button className="btn ghost sq" onClick={onCancel}>{t("exceptions.dialog.cancel")}</button>
          <button className="btn primary sq" onClick={save} disabled={!valid}>{t("exceptions.dialog.save")}</button>
        </div>
      </div>
    </div>
  );
}

export function Exceptions({ state, actions, t }) {
  const [editing, setEditing] = useState(null);
  // Sort upcoming first; past last.
  const sorted = useMemo(() => {
    const list = (state.exceptions || []).map((e, i) => ({ ...e, _i: i }));
    list.sort((a, b) => excArrToDate(a.start) - excArrToDate(b.start));
    return list;
  }, [state.exceptions]);

  const now = new Date();
  const upcoming = sorted.filter((e) => excArrToDate(e.end) >= now);
  const past = sorted.filter((e) => excArrToDate(e.end) < now);

  const saveException = (exc) => {
    const list = (state.exceptions || []).slice();
    if (typeof exc._i === "number") {
      const { _i, ...clean } = exc;
      list[_i] = clean;
    } else {
      list.push(exc);
    }
    actions.setExceptions(list);
    setEditing(null);
  };

  const deleteException = (i) => {
    const list = (state.exceptions || []).slice();
    list.splice(i, 1);
    actions.setExceptions(list);
    setEditing(null);
  };

  const Row = ({ e }) => {
    const p = PROGRAMS[e.temperature] || PROGRAMS.home;
    return (
      <div className="except" onClick={() => setEditing(e)} style={{ cursor: "pointer" }}>
        <div className="when">{formatExceptionWhen(e, state.locale)}</div>
        <div className="what">
          <span className="swatch" style={{ background: p.color }}></span>
          <span className="pname">{t(p.tk)}</span>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="head">
        <div className="eyebrow">{t("exceptions.eyebrow")}</div>
        <h1>{t("exceptions.heading")} <em>{t("exceptions.heading_em")}</em></h1>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="btn primary sq" onClick={() => setEditing(defaultNewException())}>
          {t("exceptions.new")}
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="except-empty">
          <div className="em-mark">∅</div>
          <h3>{t("exceptions.empty.title")}</h3>
          <p>{t("exceptions.empty.desc")}</p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <>
              <div className="section-h"><h2>{t("exceptions.upcoming")}</h2></div>
              <div className="except-list">
                {upcoming.map((e) => <Row key={e._i} e={e} />)}
              </div>
            </>
          )}
          {past.length > 0 && (
            <>
              <div className="section-h"><h2>{t("exceptions.past")}</h2></div>
              <div className="except-list" style={{ opacity: 0.6 }}>
                {past.map((e) => <Row key={e._i} e={e} />)}
              </div>
            </>
          )}
        </>
      )}

      {editing && (
        <ExceptionEditor
          initial={editing}
          onSave={saveException}
          onCancel={() => setEditing(null)}
          onDelete={typeof editing._i === "number" ? () => deleteException(editing._i) : null}
          t={t}
        />
      )}
    </div>
  );
}

// ── Boiler ──

// Backend already decodes f8.8 OpenTherm values into `parsed_otXX` Float columns
// (see thermostart/ts/utils.py:parse_f8_8) and ships them in the v2 payload.
const OT_NUMERIC = [
  { key: "parsed_ot25", tk: "boiler.ot25", unit: "°C",  decimals: 1 },
  { key: "parsed_ot28", tk: "boiler.ot28", unit: "°C",  decimals: 1 },
  { key: "parsed_ot26", tk: "boiler.ot26", unit: "°C",  decimals: 1 },
  { key: "parsed_ot56", tk: "boiler.ot56", unit: "°C",  decimals: 1 },
  { key: "parsed_ot17", tk: "boiler.ot17", unit: "%",   decimals: 0 },
  { key: "parsed_ot18", tk: "boiler.ot18", unit: "bar", decimals: 2 },
  { key: "parsed_ot27", tk: "boiler.ot27", unit: "°C",  decimals: 1 },
];

export function Boiler({ state, t }) {
  const ot = state.ot || {};
  const enabled = state.oo === 1;

  if (!enabled) {
    return (
      <div>
        <div className="head">
          <div className="eyebrow">{t("boiler.eyebrow")}</div>
          <h1>{t("boiler.heading")} <em>{t("boiler.heading_em")}</em></h1>
        </div>
        <div className="card">
          <p>{t("boiler.disabled")}</p>
        </div>
      </div>
    );
  }

  // parsed_ot0 is { master_status: {...}, slave_status: {...} } per ts/utils.py:interpret_status.
  const slave = (ot.parsed_ot0 && ot.parsed_ot0.slave_status) || {};
  const flag = (name) => Boolean(slave[name]);

  return (
    <div>
      <div className="head">
        <div className="eyebrow">{t("boiler.eyebrow.live")}</div>
        <h1>{t("boiler.heading")} <em>{t("boiler.heading_em")}</em></h1>
      </div>
      <div className="ot-grid">
        {OT_NUMERIC.map((c) => {
          const v = ot[c.key];
          const val = v == null ? "—" : Number(v).toFixed(c.decimals);
          return (
            <div key={c.key} className="ot-cell">
              <div className="lab">{t(c.tk)}</div>
              <div className="val">{val}<em>{c.unit}</em></div>
            </div>
          );
        })}
        {[
          { tk: "boiler.flag.fault",   flag: "Fault indication" },
          { tk: "boiler.flag.ch",      flag: "CH mode" },
          { tk: "boiler.flag.dhw",     flag: "DHW mode" },
          { tk: "boiler.flag.flame",   flag: "Flame status" },
          { tk: "boiler.flag.cooling", flag: "Cooling status" },
        ].map((c) => (
          <div key={c.tk} className="ot-cell bool">
            <div className="lab">{t(c.tk)}</div>
            <div className={"val " + (flag(c.flag) ? "on" : "off")}>{flag(c.flag) ? t("boiler.status.active") : t("boiler.status.idle")}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Settings ──

export function Settings({ state, actions, t, themeMode, setThemeMode }) {
  const [hostInput, setHostInput] = useState("");
  const [portInput, setPortInput] = useState("");
  const [retentionInput, setRetentionInput] = useState("0");
  // Initialize inputs once state loads
  useMemo(() => {
    setHostInput(state.host || "");
    setPortInput(String(state.port || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.host, state.port]);
  useMemo(() => {
    setRetentionInput(String(state.log_retention_days ?? 0));
  }, [state.log_retention_days]);

  const saveRetentionDays = () => {
    const parsed = Number.parseInt(retentionInput, 10);
    if (Number.isNaN(parsed)) {
      setRetentionInput(String(state.log_retention_days ?? 0));
      return;
    }
    const next = Math.max(0, parsed);
    setRetentionInput(String(next));
    actions.setSetting("log_retention_days", next);
  };

  return (
    <div>
      <div className="head">
        <div className="eyebrow">{t("settings.eyebrow")}</div>
        <h1>{t("settings.heading")}</h1>
      </div>
      <div className="card">
        <div className="setting">
          <div>
            <div className="label">{t("settings.appearance")}</div>
            <div className="desc">{t("settings.appearance.desc")}</div>
          </div>
          <div className="seg">
            {[{ v: "light", tk: "settings.theme.light" }, { v: "dark", tk: "settings.theme.dark" }, { v: "system", tk: "settings.theme.system" }].map((o) => (
              <button key={o.v} className={themeMode === o.v ? "on" : ""} onClick={() => setThemeMode(o.v)}>{t(o.tk)}</button>
            ))}
          </div>
        </div>

        <div className="setting">
          <div>
            <div className="label">{t("settings.calibration")}</div>
            <div className="desc">{t("settings.calibration.desc")}</div>
          </div>
          <div className="stepper">
            <button onClick={() => actions.bumpCalib(-5)}>−</button>
            <span className="v">{state.ta >= 0 ? "+" : ""}{(state.ta / 10).toFixed(1)}°</span>
            <button onClick={() => actions.bumpCalib(5)}>+</button>
          </div>
        </div>

        <div className="setting">
          <div>
            <div className="label">{t("settings.brightness")}</div>
            <div className="desc">{t("settings.brightness.desc")}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="bar"><div style={{ width: `${state.dim}%` }}></div></div>
            <div className="stepper">
              <button onClick={() => actions.bumpDim(-25)}>−</button>
              <span className="v">{state.dim}%</span>
              <button onClick={() => actions.bumpDim(25)}>+</button>
            </div>
          </div>
        </div>

        <div className="setting">
          <div>
            <div className="label">{t("settings.led")}</div>
            <div className="desc">{t("settings.led.desc")}</div>
          </div>
          <div className="seg">
            {[{ v: 2, tk: "settings.led.on" }, { v: 1, tk: "settings.led.errors" }, { v: 0, tk: "settings.led.off" }].map((o) => (
              <button key={o.v} className={state.sl === o.v ? "on" : ""}
                      onClick={() => actions.setSetting("sl", o.v)}>{t(o.tk)}</button>
            ))}
          </div>
        </div>

        <div className="setting">
          <div>
            <div className="label">{t("settings.display")}</div>
            <div className="desc">{t("settings.display.desc")}</div>
          </div>
          <div className="seg">
            {[{ v: 0, tk: "settings.display.temp" }, { v: 1, tk: "settings.display.clock" }].map((o) => (
              <button key={o.v} className={state.sd === o.v ? "on" : ""}
                      onClick={() => actions.setSetting("sd", o.v)}>{t(o.tk)}</button>
            ))}
          </div>
        </div>

        <div className="setting">
          <div>
            <div className="label">{t("settings.language")}</div>
            <div className="desc">{t("settings.language.desc")}</div>
          </div>
          <div className="seg">
            {[{ v: "en-GB", l: "EN" }, { v: "nl-NL", l: "NL" }, { v: "de-DE", l: "DE" }].map((o) => (
              <button key={o.v} className={state.locale === o.v ? "on" : ""}
                      onClick={() => actions.setSetting("locale", o.v)}>{o.l}</button>
            ))}
          </div>
        </div>

        <div className="setting">
          <div>
            <div className="label">{t("settings.ot_logging")}</div>
            <div className="desc">{t("settings.ot_logging.desc")}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="seg">
              <button className={state.log_opentherm ? "on" : ""} onClick={() => actions.setSetting("log_opentherm", true)}>{t("settings.ot_logging.on")}</button>
              <button className={!state.log_opentherm ? "on" : ""} onClick={() => actions.setSetting("log_opentherm", false)}>{t("settings.ot_logging.off")}</button>
            </div>
            {state.log_opentherm && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={retentionInput}
                  onChange={(e) => setRetentionInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveRetentionDays();
                  }}
                  style={{ width: 96 }}
                />
                <button className="btn ghost sq" onClick={saveRetentionDays}>{t("settings.save")}</button>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-2)" }}>
                  {state.log_retention_days === 0 ? t("settings.ot_logging.forever") : `${state.log_retention_days}d`}
                </span>
              </div>
            )}
            {false && state.log_opentherm && (
              <div className="stepper">
                <button onClick={() => actions.setSetting("log_retention_days", Math.max(0, (state.log_retention_days || 0) - 1))}>−</button>
                <span className="v">{state.log_retention_days === 0 ? t("settings.ot_logging.forever") : `${state.log_retention_days}d`}</span>
                <button onClick={() => actions.setSetting("log_retention_days", (state.log_retention_days || 0) + 1)}>+</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: "var(--gap)" }}>
        <div className="card-h"><h3>{t("settings.connection")}</h3></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 10, alignItems: "end" }}>
          <label>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>{t("settings.host")}</div>
            <input type="text" value={hostInput} onChange={(e) => setHostInput(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>{t("settings.port")}</div>
            <input type="text" value={portInput} onChange={(e) => setPortInput(e.target.value)} style={{ width: "100%" }} />
          </label>
          <button className="btn primary sq" onClick={() => {
            actions.setSetting("host", hostInput);
            const p = parseInt(portInput, 10);
            if (!Number.isNaN(p)) actions.setSetting("port", p);
          }}>{t("settings.save")}</button>
        </div>
        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[3, 4, 5].map((r) => (
            <button key={r} className="btn ghost sq" onClick={() => downloadFirmware(r)}>{t("settings.firmware", { hw: r })}</button>
          ))}
        </div>
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>{t("settings.device_info")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 16px", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-1)" }}>
            <span style={{ color: "var(--ink-3)" }}>{t("settings.hardware")}</span><span>HW {state.hw}</span>
            <span style={{ color: "var(--ink-3)" }}>{t("settings.fw")}</span><span>v{state.fw}</span>
          </div>
        </div>
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--line)", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", letterSpacing: "0.04em" }}>
          {t("settings.classic")} <a href="/ui/switch?to=classic" style={{ color: "var(--ember)" }}>{t("settings.classic_link")}</a>
        </div>
      </div>
    </div>
  );
}
