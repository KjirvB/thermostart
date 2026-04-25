// tsStore: single source of truth for the thermostat model. Mirrors the
// fields returned by GET /thermostatmodel and the payload accepted by the
// 'store-thermostat' Socket.IO event in services/web/thermostart/events.py.
//
// The Alpine component re-points `api.state` at its reactive proxy during
// init so that mutations from the socket layer flow back into the UI.
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

  var api = {
    SOURCE: SOURCE,
    DEFAULT_LABELS: DEFAULT_LABELS,
    state: {
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
    },

    bindReactive: function (proxy) {
      // Copy current defaults into the proxy and adopt it as the live store.
      Object.assign(proxy, api.state);
      api.state = proxy;
    },

    set: function (patch) {
      if (!patch) return;
      Object.keys(patch).forEach(function (k) { api.state[k] = patch[k]; });
    },

    programLabel: function (key) {
      if (!key) return "";
      var labels = api.state.predefined_labels || {};
      return labels[key] || DEFAULT_LABELS[key] || key;
    },

    programTemperatureC: function (key) {
      var raw = (api.state.predefined_temperatures || {})[key];
      return raw == null ? null : raw / 10;
    },

    save: function (patch, options) {
      options = options || {};
      if (patch) api.set(patch);
      var combined = Object.assign({}, api.state);
      var out = {};
      FIELDS_FOR_SAVE.forEach(function (f) { out[f] = combined[f]; });
      out.ui_synced = false;
      out.ui_source = (patch && patch.ui_source) || combined.ui_source || "v2_ui";
      if (!options.skipEmit) window.tsSocket.save(out);
      return out;
    },

    blockMinutes: function (b) {
      return b.start[0] * 1440 + b.start[1] * 60 + b.start[2];
    },

    // Project a JS Date to device-local time using state.utc_offset (hours).
    // Returns Mon=0..Sun=6 to match the backend's day numbering.
    deviceLocal: function (date) {
      date = date || new Date();
      var offsetMs = (api.state.utc_offset || 0) * 3600 * 1000;
      var local = new Date(date.getTime() + offsetMs);
      return {
        day: (local.getUTCDay() + 6) % 7,
        hour: local.getUTCHours(),
        minute: local.getUTCMinutes(),
        year: local.getUTCFullYear(),
        month: local.getUTCMonth(),
        date: local.getUTCDate(),
        jsDate: local,
      };
    },

    currentStandardWeekBlock: function (date) {
      var loc = api.deviceLocal(date);
      var minutesNow = loc.day * 1440 + loc.hour * 60 + loc.minute;
      var sw = api.state.standard_week || [];
      if (!sw.length) return null;
      var sorted = sw.slice().sort(function (a, b) {
        return api.blockMinutes(a) - api.blockMinutes(b);
      });
      var current = sorted[sorted.length - 1];
      for (var i = 0; i < sorted.length; i++) {
        if (api.blockMinutes(sorted[i]) <= minutesNow) current = sorted[i];
      }
      return current;
    },

    currentExceptionBlock: function (date) {
      var loc = api.deviceLocal(date);
      var localMs = loc.jsDate.getTime();
      return (api.state.exceptions || []).find(function (e) {
        var s = Date.UTC(e.start[0], e.start[1], e.start[2], e.start[3], e.start[4]);
        var en = Date.UTC(e.end[0], e.end[1], e.end[2], e.end[3], e.end[4]);
        return localMs >= s && localMs < en;
      });
    },
  };

  return api;
})();
