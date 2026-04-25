// tsStore: single source of truth for the thermostat model. Mirrors the fields
// returned by GET /thermostatmodel and the payload accepted by the
// 'store-thermostat' Socket.IO event in services/web/thermostart/events.py.

window.tsStore = (function () {
  var SOURCE = {
    CRASH: 0,
    MANUAL: 1,
    SERVER: 2,
    STD_WEEK: 3,
    EXCEPTION: 4,
    PAUSE: 5,
  };

  var FIELDS_FOR_SAVE = [
    "exceptions", "predefined_temperatures", "predefined_labels",
    "standard_week", "dhw_programs", "ta", "dim", "sl", "sd", "locale",
    "host", "port", "source", "target_temperature",
  ];

  var DEFAULT_LABELS = {
    anti_freeze: "Anti freeze",
    home: "Home",
    not_home: "Not home",
    comfort: "Comfort",
    pause: "Pause",
  };

  var state = {
    loaded: false,
    exceptions: [],
    standard_week: [],
    predefined_temperatures: { anti_freeze: 50, home: 180, not_home: 150, comfort: 215, pause: 125 },
    predefined_labels: Object.assign({}, DEFAULT_LABELS),
    target_temperature: 0,
    room_temperature: 0,
    outside_temperature: 0,
    outside_temperature_icon: null,
    source: SOURCE.STD_WEEK,
    ui_synced: false,
    ui_source: null,
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
    dhw_programs: [],
    utc_offset: 0,
    location: "",
    ot0: 0, ot1: 0, ot3: 0, ot17: 0, ot18: 0, ot19: 0, ot25: 0,
    ot26: 0, ot27: 0, ot28: 0, ot34: 0, ot56: 0, ot125: 0,
  };

  function set(patch) {
    Object.keys(patch).forEach(function (k) {
      state[k] = patch[k];
    });
  }

  function programLabel(key) {
    if (!key) return "";
    if (state.predefined_labels && state.predefined_labels[key]) {
      return state.predefined_labels[key];
    }
    return DEFAULT_LABELS[key] || key;
  }

  function programTemperatureC(key) {
    var raw = (state.predefined_temperatures || {})[key];
    if (raw == null) return null;
    return raw / 10;
  }

  function buildSavePayload(patch) {
    var combined = Object.assign({}, state);
    if (patch) Object.assign(combined, patch);
    var out = {};
    FIELDS_FOR_SAVE.forEach(function (f) { out[f] = combined[f]; });
    out.ui_synced = false;
    out.ui_source = (patch && patch.ui_source) || combined.ui_source || "v2_ui";
    return out;
  }

  function save(patch, options) {
    options = options || {};
    if (patch) set(patch);
    var payload = buildSavePayload(patch);
    if (!options.skipEmit) {
      window.tsSocket.save(payload);
    }
    return payload;
  }

  function hasFreshSlot(date) {
    var d = date || new Date();
    return d.getMinutes() % 15 === 0 && d.getSeconds() === 0;
  }

  // Project a JS Date to device-local time using state.utc_offset (hours).
  // Returns Mon=0..Sun=6 to match the backend's day numbering.
  function deviceLocal(date) {
    date = date || new Date();
    var offsetMs = (state.utc_offset || 0) * 3600 * 1000;
    var local = new Date(date.getTime() + offsetMs);
    var day = (local.getUTCDay() + 6) % 7;
    return {
      day: day,
      hour: local.getUTCHours(),
      minute: local.getUTCMinutes(),
      year: local.getUTCFullYear(),
      month: local.getUTCMonth(),
      date: local.getUTCDate(),
      jsDate: local,
    };
  }

  function currentStandardWeekBlock(date) {
    var loc = deviceLocal(date);
    var minutesNow = loc.day * 1440 + loc.hour * 60 + loc.minute;
    var sw = state.standard_week || [];
    if (!sw.length) return null;
    var sorted = sw.slice().sort(function (a, b) {
      return blockMinutes(a) - blockMinutes(b);
    });
    var current = sorted[sorted.length - 1];
    for (var i = 0; i < sorted.length; i++) {
      if (blockMinutes(sorted[i]) <= minutesNow) {
        current = sorted[i];
      }
    }
    return current;
  }

  function blockMinutes(b) {
    return b.start[0] * 1440 + b.start[1] * 60 + b.start[2];
  }

  function currentExceptionBlock(date) {
    var loc = deviceLocal(date);
    var localMs = loc.jsDate.getTime();
    return (state.exceptions || []).find(function (e) {
      var s = Date.UTC(e.start[0], e.start[1], e.start[2], e.start[3], e.start[4]);
      var en = Date.UTC(e.end[0], e.end[1], e.end[2], e.end[3], e.end[4]);
      return localMs >= s && localMs < en;
    });
  }

  return {
    SOURCE: SOURCE,
    DEFAULT_LABELS: DEFAULT_LABELS,
    state: state,
    set: set,
    save: save,
    programLabel: programLabel,
    programTemperatureC: programTemperatureC,
    blockMinutes: blockMinutes,
    deviceLocal: deviceLocal,
    currentStandardWeekBlock: currentStandardWeekBlock,
    currentExceptionBlock: currentExceptionBlock,
    hasFreshSlot: hasFreshSlot,
  };
})();
