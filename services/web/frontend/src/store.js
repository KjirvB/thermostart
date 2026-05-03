// Single source of truth for the v2 UI.
// - On mount: read window.__INITIAL_STATE__ if present (server-injected); else fetch /thermostatmodel
// - Subscribes to Socket.IO events (room/outside/target/source) for live updates
// - Exposes mutators that PUT to backend and optimistically update local state.

import { useEffect, useReducer, useRef } from "react";
import { onSocketEvents } from "./socket.js";
import {
  fetchModel,
  putThermostat,
  pauseDevice,
  unpauseDevice,
  putSettings,
} from "./api.js";
import { BOOTSTRAP } from "./bootstrap.js";
import { nowDayIdx, nowSlot } from "./constants.js";

// Source enum mirrors thermostart.ts.utils.Source (ts/utils.py).
export const SRC_CRASH = 0;
export const SRC_MANUAL = 1;
export const SRC_SERVER = 2;
export const SRC_STD_WEEK = 3;
export const SRC_EXCEPTION = 4;
export const SRC_PAUSE = 5;

// ── conversion: standard_week (transitions) ⇄ week (per-day blocks of 15-min slots)

function slotFromHM(h, m) {
  return Math.max(0, Math.min(96, Math.round((h * 60 + m) / 15)));
}

function hmFromSlot(slot) {
  const total = slot * 15;
  return [Math.floor(total / 60), total % 60];
}

export function transitionsToWeek(transitions) {
  const week = [[], [], [], [], [], [], []];
  for (let d = 0; d < 7; d++) {
    const trans = (transitions || [])
      .filter((t) => Array.isArray(t.start) && t.start[0] === d)
      .map((t) => ({ slot: slotFromHM(t.start[1], t.start[2]), pgm: t.temperature }))
      .sort((a, b) => a.slot - b.slot);
    let prevSlot = 0;
    let prevPgm = "pause"; // default before first transition (mirrors models.py:get_std_week_predefined_label)
    for (const t of trans) {
      if (t.slot > prevSlot) week[d].push({ start: prevSlot, end: t.slot, pgm: prevPgm });
      prevSlot = t.slot;
      prevPgm = t.pgm;
    }
    if (prevSlot < 96) week[d].push({ start: prevSlot, end: 96, pgm: prevPgm });
  }
  return week;
}

export function weekToTransitions(week) {
  const out = [];
  for (let d = 0; d < 7; d++) {
    const blocks = (week[d] || []).slice().sort((a, b) => a.start - b.start);
    let prevPgm = null;
    for (const b of blocks) {
      if (b.pgm === prevPgm) continue;
      const [h, m] = hmFromSlot(b.start);
      // first transition of the day at slot 0 with default "pause" is implied; skip emitting if it just confirms the default
      if (prevPgm === null && b.start === 0 && b.pgm === "pause") {
        prevPgm = "pause";
        continue;
      }
      out.push({ start: [d, h, m], temperature: b.pgm });
      prevPgm = b.pgm;
    }
  }
  return out;
}

// Computes the targetC implied by a source change, when the broadcast did not carry an explicit
// target_temperature. PAUSE → predefined "pause" temp; STD_WEEK → current schedule block's preset.
// Returns null when the caller should keep whatever targetC already is (e.g. MANUAL/SERVER).
function computePresetTargetC(state, source) {
  const preds = state.predefinedTemperatures || {};
  if (source === SRC_PAUSE) {
    const t = preds.pause;
    return t != null ? t / 10 : null;
  }
  if (source === SRC_STD_WEEK) {
    const todayBlocks = state.week[nowDayIdx()] || [];
    const sl = nowSlot();
    const active = todayBlocks.find((b) => sl >= b.start && sl < b.end);
    const t = active ? preds[active.pgm] : null;
    return t != null ? t / 10 : null;
  }
  return null;
}

// ── reducer

const initialState = {
  loaded: false,
  // Live readings (°C)
  targetC: 21.0,
  roomC: 20.0,
  outsideC: 0.0,
  // Mode
  source: SRC_STD_WEEK,
  // Domain data
  week: transitionsToWeek([]),
  exceptions: [],
  predefinedTemperatures: {},
  predefinedLabels: {},
  // Settings
  ta: 0,
  dim: 100,
  sl: 2,
  sd: 0,
  locale: "en-GB",
  host: "",
  port: 0,
  fw: 0,
  hw: 0,
  oo: 0,
  log_opentherm: false,
  log_retention_days: 0,
  // OpenTherm raw fields (whatever /thermostatmodel returns)
  ot: {},
  dhwPrograms: {},
};

function reducer(state, action) {
  switch (action.type) {
    case "hydrate": {
      const m = action.model;
      const ot = {};
      for (const [k, v] of Object.entries(m)) {
        if (k.startsWith("ot") || k.startsWith("parsed_ot")) ot[k] = v;
      }
      return {
        ...state,
        loaded: true,
        targetC: (m.target_temperature ?? 0) / 10,
        roomC: (m.room_temperature ?? 0) / 10,
        outsideC: (m.outside_temperature ?? 0) / 10,
        source: m.source ?? SRC_STD_WEEK,
        week: transitionsToWeek(m.standard_week || []),
        exceptions: m.exceptions || [],
        predefinedTemperatures: m.predefined_temperatures || {},
        predefinedLabels: m.predefined_labels || {},
        ta: m.ta ?? 0,
        dim: m.dim ?? 100,
        sl: m.sl ?? 2,
        sd: m.sd ?? 0,
        locale: m.locale ?? "en-GB",
        host: m.host ?? "",
        port: m.port ?? 0,
        fw: m.fw ?? 0,
        hw: m.hw ?? 0,
        oo: m.oo ?? 0,
        log_opentherm: m.log_opentherm ?? false,
        log_retention_days: m.log_retention_days ?? 0,
        ot,
        dhwPrograms: m.dhw_programs || {},
      };
    }
    case "patch":
      return { ...state, ...action.patch };
    case "setWeek":
      return { ...state, week: action.week };
    case "addException":
      return { ...state, exceptions: [...state.exceptions, action.exc] };
    case "removeException":
      return { ...state, exceptions: state.exceptions.filter((e) => e.id !== action.id) };
    case "updateException":
      return {
        ...state,
        exceptions: state.exceptions.map((e) => (e.id === action.exc.id ? action.exc : e)),
      };
    default:
      return state;
  }
}

// ── public hook

export function useStore() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const predTempTimer = useRef(null);

  // Initial hydrate (bootstrap or fetch)
  useEffect(() => {
    if (BOOTSTRAP) {
      dispatch({ type: "hydrate", model: BOOTSTRAP });
    } else {
      fetchModel()
        .then((m) => dispatch({ type: "hydrate", model: m }))
        .catch((err) => console.error("model fetch failed", err));
    }
  }, []);

  // Live updates from Socket.IO
  useEffect(() => {
    const off = onSocketEvents({
      room_temperature: (d) => dispatch({ type: "patch", patch: { roomC: (d.room_temperature ?? 0) / 10 } }),
      outside_temperature: (d) => dispatch({ type: "patch", patch: { outsideC: (d.outside_temperature ?? 0) / 10 } }),
      target_temperature: (d) => dispatch({ type: "patch", patch: { targetC: (d.target_temperature ?? 0) / 10 } }),
      source: (d) => {
        const patch = { source: d.source };
        const c = computePresetTargetC(stateRef.current, d.source);
        if (c != null) patch.targetC = c;
        dispatch({ type: "patch", patch });
      },
      "broadcast-thermostat": (d) => {
        const patch = {};
        const nextState = { ...stateRef.current };
        if (d.target_temperature != null) patch.targetC = d.target_temperature / 10;
        if (d.room_temperature != null) patch.roomC = d.room_temperature / 10;
        if (d.outside_temperature != null) patch.outsideC = d.outside_temperature / 10;
        if (d.oo != null) patch.oo = d.oo;
        if (d.source != null) {
          patch.source = d.source;
          nextState.source = d.source;
        }
        if (d.standard_week != null) {
          patch.week = transitionsToWeek(d.standard_week);
          nextState.week = patch.week;
        }
        if (d.exceptions != null) patch.exceptions = d.exceptions;
        const otPatch = {};
        for (const [k, v] of Object.entries(d)) {
          if (k.startsWith("ot") || k.startsWith("parsed_ot")) otPatch[k] = v;
        }
        if (Object.keys(otPatch).length) {
          patch.ot = { ...stateRef.current.ot, ...otPatch };
        }
        if (d.target_temperature == null && (d.source != null || d.standard_week != null)) {
          const c = computePresetTargetC(nextState, nextState.source);
          if (c != null) patch.targetC = c;
        }
        if (Object.keys(patch).length) dispatch({ type: "patch", patch });
      },
    });
    return off;
  }, []);

  // Mutators
  const actions = {
    async setTargetC(c) {
      const rounded = Math.round(c * 10) / 10;
      dispatch({ type: "patch", patch: { targetC: rounded, source: SRC_MANUAL } });
      try {
        await putThermostat({ target_temperature: rounded });
      } catch (e) {
        console.error(e);
      }
    },
    async pause() {
      const patch = { source: SRC_PAUSE };
      const c = computePresetTargetC(stateRef.current, SRC_PAUSE);
      if (c != null) patch.targetC = c;
      dispatch({ type: "patch", patch });
      try { await pauseDevice(); } catch (e) { console.error(e); }
    },
    async unpause() {
      const patch = { source: SRC_STD_WEEK };
      const c = computePresetTargetC(stateRef.current, SRC_STD_WEEK);
      if (c != null) patch.targetC = c;
      dispatch({ type: "patch", patch });
      try { await unpauseDevice(); } catch (e) { console.error(e); }
    },
    setWeekLocal(week) {
      dispatch({ type: "setWeek", week });
    },
    async commitWeek(week = stateRef.current.week) {
      try {
        await putThermostat({ standard_week: weekToTransitions(week) });
        if (stateRef.current.source === SRC_STD_WEEK) {
          const c = computePresetTargetC({ ...stateRef.current, week }, SRC_STD_WEEK);
          if (c != null) dispatch({ type: "patch", patch: { targetC: c } });
        }
      } catch (e) {
        console.error(e);
      }
    },
    async setWeek(week) {
      dispatch({ type: "setWeek", week });
      try {
        await putThermostat({ standard_week: weekToTransitions(week) });
        if (stateRef.current.source === SRC_STD_WEEK) {
          const c = computePresetTargetC({ ...stateRef.current, week }, SRC_STD_WEEK);
          if (c != null) dispatch({ type: "patch", patch: { targetC: c } });
        }
      } catch (e) {
        console.error(e);
      }
    },
    async setExceptions(exceptions) {
      dispatch({ type: "patch", patch: { exceptions } });
      try {
        await putThermostat({ exceptions });
      } catch (e) {
        console.error(e);
      }
    },
    async setSetting(key, value) {
      dispatch({ type: "patch", patch: { [key]: value } });
      try {
        await putSettings({ [key]: value });
      } catch (e) {
        console.error(e);
      }
    },
    setPredefinedTemperature(key, tenths) {
      const next = { ...stateRef.current.predefinedTemperatures, [key]: tenths };
      dispatch({ type: "patch", patch: { predefinedTemperatures: next } });
      clearTimeout(predTempTimer.current);
      predTempTimer.current = setTimeout(async () => {
        try {
          await putThermostat({ predefined_temperatures: stateRef.current.predefinedTemperatures });
        } catch (e) {
          console.error(e);
        }
      }, 600);
    },
    async setDhwPrograms(programs) {
      dispatch({ type: "patch", patch: { dhwPrograms: programs } });
      try {
        await putThermostat({ dhw_programs: programs });
      } catch (e) {
        console.error(e);
      }
    },
    async bumpCalib(d) {
      const next = Math.max(-25, Math.min(25, (stateRef.current.ta || 0) + d));
      await actions.setSetting("ta", next);
    },
    async bumpDim(d) {
      const next = Math.max(0, Math.min(100, (stateRef.current.dim || 0) + d));
      await actions.setSetting("dim", next);
    },
  };

  return [state, actions, dispatch];
}
