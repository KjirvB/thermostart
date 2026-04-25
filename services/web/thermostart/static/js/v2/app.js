// Alpine entry point. Exposes a single `thermostatApp()` factory used by
// templates/v2/base.html and the page partials. The factory returns an Alpine
// component whose reactive `store` mirrors window.tsStore.state.
window.thermostatApp = function () {
  var SOURCE = window.tsStore.SOURCE;

  function deviceTimeOf(date) {
    return window.tsStore.deviceLocal(date);
  }

  return {
    loaded: false,
    connected: false,
    route: "home",
    store: window.tsStore.state,
    tabs: [
      { hash: "home", label: "Overview" },
      { hash: "exceptions", label: "Agenda" },
      { hash: "standard-week", label: "Schedule" },
      { hash: "settings", label: "Settings" },
      { hash: "ot", label: "OpenTherm" },
    ],
    modal: { kind: null, title: "", draft: {}, allowPause: false, allowDescription: false, onConfirm: null, message: "" },
    exceptionsView: {
      // Monday 00:00 device-local time for the visible week.
      weekStartIso: "",
    },
    standardWeek: {
      blocks: [],
      selectedProgram: "home",
    },
    exceptions: {
      selectedProgram: "home",
    },
    settings: {
      hostInput: "",
      portInput: "",
    },

    init: function () {
      var self = this;
      // Re-point the store at the Alpine reactive proxy so socket-driven
      // updates flip the UI.
      window.tsStore.bindReactive(this.store);

      this.applyHash();
      window.addEventListener("hashchange", function () { self.applyHash(); });

      // Pull initial state.
      window.tsApi.fetchModel().then(function (data) {
        window.tsStore.set(data);
        self.settings.hostInput = data.host || "";
        self.settings.portInput = data.port != null ? String(data.port) : "";
        self.standardWeek.blocks = self.computeStandardWeekBlocks();
        self.exceptionsView.weekStartIso = self.computeWeekStartIso(new Date());
        self.loaded = true;
      }).catch(function (err) {
        console.error("[ts] failed to load model:", err);
      });

      // Wire socket events into the store.
      window.tsSocket.on("connect", function () { self.connected = true; });
      window.tsSocket.on("disconnect", function () { self.connected = false; });
      ["room_temperature", "outside_temperature", "target_temperature", "source", "location", "broadcast-thermostat"].forEach(function (evt) {
        window.tsSocket.on(evt, function (data) { window.tsStore.set(data); });
      });
      window.tsSocket.connect();

      // Re-render time-driven views every minute.
      setInterval(function () {
        // Touch a reactive field so Alpine recomputes "now"-derived getters.
        self.store._tick = (self.store._tick || 0) + 1;
      }, 60 * 1000);
    },

    applyHash: function () {
      var h = (window.location.hash || "").replace(/^#/, "");
      var valid = this.tabs.some(function (t) { return t.hash === h; });
      this.route = valid ? h : "home";
      if (!valid) window.location.hash = "home";
    },

    switchUi: function (version) {
      window.tsApi.setUiPreference(version).then(function () {
        window.location.reload();
      });
    },

    // --- Program helpers -------------------------------------------------
    programKeys: function (includePause) {
      var keys = ["anti_freeze", "home", "not_home", "comfort"];
      if (includePause) keys.push("pause");
      return keys;
    },
    programLabel: function (key) { return window.tsStore.programLabel(key); },
    programTemperatureC: function (key) { return window.tsStore.programTemperatureC(key); },
    programColorClass: function (key) { return "ts-block-" + key; },

    // --- Overview --------------------------------------------------------
    targetC: function () { return (this.store.target_temperature || 0) / 10; },
    roomC: function () { return (this.store.room_temperature || 0) / 10; },
    outsideC: function () { return (this.store.outside_temperature || 0) / 10; },
    pauseActive: function () { return this.store.source === SOURCE.PAUSE; },
    bumpTarget: function (deltaSteps) {
      var step = 5; // 0.5°C in 0.1°C units
      var next = Math.max(50, Math.min(300, (this.store.target_temperature || 0) + deltaSteps * step));
      window.tsStore.save({
        target_temperature: next,
        source: SOURCE.SERVER,
        ui_source: deltaSteps > 0 ? "direct_temperature_setter_up" : "direct_temperature_setter_down",
      });
    },
    togglePause: function () {
      if (this.pauseActive()) {
        // Resume: derive temp from current standard-week block.
        var block = window.tsStore.currentStandardWeekBlock();
        var key = block ? block.temperature : "home";
        var temp = (this.store.predefined_temperatures || {})[key] || 180;
        window.tsStore.save({
          source: SOURCE.STD_WEEK,
          target_temperature: temp,
          ui_source: "pause_button",
        });
      } else {
        var pauseTemp = (this.store.predefined_temperatures || {})["pause"] || 125;
        window.tsStore.save({
          source: SOURCE.PAUSE,
          target_temperature: pauseTemp,
          ui_source: "pause_button",
        });
      }
    },
    currentProgramLabel: function () {
      var ex = window.tsStore.currentExceptionBlock();
      if (ex) return this.programLabel(ex.temperature) + (ex.description ? " — " + ex.description : "");
      var sw = window.tsStore.currentStandardWeekBlock();
      if (sw) return this.programLabel(sw.temperature);
      if (this.store.source === SOURCE.MANUAL) return "Manual";
      if (this.store.source === SOURCE.PAUSE) return this.programLabel("pause");
      return "—";
    },

    // --- Standard week ---------------------------------------------------
    computeStandardWeekBlocks: function () {
      return window.tsSchedule.blocksFromStandardWeek(this.store.standard_week);
    },
    refreshStandardWeek: function () {
      this.standardWeek.blocks = this.computeStandardWeekBlocks();
    },
    blocksForDay: function (dayIndex) {
      return (this.standardWeek.blocks || []).filter(function (b) { return b.day === dayIndex; });
    },
    weekdayShort: function (dayIndex) {
      var arr = window.tsI18n.weekdaysShort();
      return arr[dayIndex] || "";
    },
    slotToHHMM: function (slot) { return window.tsSchedule.slotToHHMM(slot); },
    blockTopPct: function (b) { return (b.startSlot / window.tsSchedule.SLOTS_PER_DAY) * 100; },
    blockHeightPct: function (b) { return ((b.endSlot - b.startSlot) / window.tsSchedule.SLOTS_PER_DAY) * 100; },
    addStandardWeekBlock: function (dayIndex, programKey) {
      // Insert a default 1-hour block at the first 4-slot gap in the chosen day.
      var blocks = this.blocksForDay(dayIndex).slice().sort(function (a, b) { return a.startSlot - b.startSlot; });
      var startSlot = 8 * 4; // 08:00 default
      for (var i = 0; i < blocks.length; i++) {
        if (blocks[i].startSlot >= startSlot + 4) break;
        startSlot = Math.max(startSlot, blocks[i].endSlot);
      }
      if (startSlot + 4 > window.tsSchedule.SLOTS_PER_DAY) startSlot = window.tsSchedule.SLOTS_PER_DAY - 4;
      // Trim collisions by limiting endSlot to the next block's startSlot.
      var endSlot = startSlot + 4;
      for (var j = 0; j < blocks.length; j++) {
        if (blocks[j].startSlot >= startSlot && blocks[j].startSlot < endSlot) {
          endSlot = blocks[j].startSlot;
        }
      }
      if (endSlot - startSlot < 2) return;
      var all = this.standardWeek.blocks.slice();
      all.push({ day: dayIndex, startSlot: startSlot, endSlot: endSlot, temperature: programKey });
      this.persistStandardWeek(all);
    },
    editStandardWeekBlock: function (block) {
      var self = this;
      this.openModal({
        kind: "editBlock",
        title: "Edit block",
        allowPause: true,
        allowDescription: false,
        allowDelete: true,
        draft: { temperature: block.temperature },
        onConfirm: function (draft) {
          var updated = self.standardWeek.blocks.map(function (b) {
            return (b === block) ? Object.assign({}, b, { temperature: draft.temperature }) : b;
          });
          self.persistStandardWeek(updated);
        },
        onDelete: function () { self.deleteStandardWeekBlock(block); },
      });
    },
    deleteStandardWeekBlock: function (block) {
      var remaining = this.standardWeek.blocks.filter(function (b) { return b !== block; });
      if (!remaining.length) return; // refuse to leave empty
      this.persistStandardWeek(remaining);
    },
    persistStandardWeek: function (blocks) {
      var transitions = window.tsSchedule.blocksToStandardWeek(blocks);
      window.tsStore.save({ standard_week: transitions, ui_source: "standard_week" });
      this.standardWeek.blocks = this.computeStandardWeekBlocks();
    },
    editProgram: function (key) {
      var self = this;
      this.openModal({
        kind: "editProgram",
        title: "Edit program",
        draft: {
          key: key,
          label: window.tsStore.programLabel(key),
          temperature: (this.store.predefined_temperatures || {})[key] || 180,
        },
        onConfirm: function (draft) {
          var temps = Object.assign({}, self.store.predefined_temperatures);
          var labels = Object.assign({}, self.store.predefined_labels);
          temps[draft.key] = Math.max(50, Math.min(250, draft.temperature));
          labels[draft.key] = draft.label || window.tsStore.DEFAULT_LABELS[draft.key] || draft.key;
          window.tsStore.save({
            predefined_temperatures: temps,
            predefined_labels: labels,
            ui_source: "edit_program",
          });
        },
      });
    },

    // --- Exceptions ------------------------------------------------------
    computeWeekStartIso: function (date) {
      var loc = deviceTimeOf(date);
      var ms = Date.UTC(loc.year, loc.month, loc.date) - loc.day * 86400 * 1000;
      var d = new Date(ms);
      return d.toISOString().slice(0, 10);
    },
    weekStartLocal: function () {
      // Treat the ISO string as UTC midnight to keep arithmetic consistent.
      return new Date(this.exceptionsView.weekStartIso + "T00:00:00Z");
    },
    setExceptionsWeek: function (isoDate) {
      // Snap any selected date to its week's Monday.
      if (!isoDate) return;
      var d = new Date(isoDate + "T00:00:00Z");
      var dayMon = (d.getUTCDay() + 6) % 7;
      var monday = new Date(d.getTime() - dayMon * 86400 * 1000);
      this.exceptionsView.weekStartIso = monday.toISOString().slice(0, 10);
    },
    exceptionsBlocks: function () {
      return window.tsSchedule.blocksFromExceptions(this.store.exceptions || [], this.weekStartLocal());
    },
    formatWeekLabel: function () {
      var s = this.weekStartLocal();
      var e = new Date(s.getTime() + 6 * 86400 * 1000);
      function fmt(d) {
        return d.getUTCDate() + " " + window.tsI18n.monthsShort()[d.getUTCMonth()];
      }
      return fmt(s) + " – " + fmt(e) + " " + e.getUTCFullYear();
    },
    addException: function (dayIndex, programKey) {
      var weekStart = this.weekStartLocal();
      var dayMs = weekStart.getTime() + dayIndex * 86400 * 1000;
      var startSlot = 8 * 4; // 08:00 default
      var existing = this.exceptionsBlocks().filter(function (b) { return b.day === dayIndex; })
        .sort(function (a, b) { return a.startSlot - b.startSlot; });
      for (var i = 0; i < existing.length; i++) {
        if (existing[i].startSlot >= startSlot + 4) break;
        startSlot = Math.max(startSlot, existing[i].endSlot);
      }
      var endSlot = Math.min(window.tsSchedule.SLOTS_PER_DAY, startSlot + 4);
      for (var j = 0; j < existing.length; j++) {
        if (existing[j].startSlot >= startSlot && existing[j].startSlot < endSlot) {
          endSlot = existing[j].startSlot;
        }
      }
      if (endSlot - startSlot < 2) return;
      var startMs = dayMs + startSlot * 15 * 60 * 1000;
      var endMs = dayMs + endSlot * 15 * 60 * 1000;
      var newException = {
        start: window.tsSchedule.exceptionToTuple(new Date(startMs)),
        end: window.tsSchedule.exceptionToTuple(new Date(endMs)),
        temperature: programKey,
        description: "",
      };
      var all = (this.store.exceptions || []).slice();
      all.push(newException);
      window.tsStore.save({ exceptions: all, ui_source: "exceptions" });
    },
    editException: function (block) {
      var self = this;
      this.openModal({
        kind: "editBlock",
        title: "Edit exception",
        allowPause: false,
        allowDescription: true,
        allowDelete: true,
        draft: { temperature: block.temperature, description: block.description || "" },
        onConfirm: function (draft) {
          var all = (self.store.exceptions || []).map(function (e, idx) {
            if (idx !== block.refIndex) return e;
            return Object.assign({}, e, { temperature: draft.temperature, description: draft.description || "" });
          });
          window.tsStore.save({ exceptions: all, ui_source: "exceptions" });
        },
        onDelete: function () { self.deleteException(block); },
      });
    },
    deleteException: function (block) {
      var all = (this.store.exceptions || []).filter(function (e, idx) { return idx !== block.refIndex; });
      window.tsStore.save({ exceptions: all, ui_source: "exceptions" });
    },

    // --- Settings --------------------------------------------------------
    setTa: function (delta) {
      var next = Math.max(-25, Math.min(25, (this.store.ta || 0) + delta));
      window.tsStore.save({ ta: next, ui_source: "temperature_calibration" });
    },
    setDim: function (delta) {
      var next = Math.max(0, Math.min(100, (this.store.dim || 0) + delta));
      window.tsStore.save({ dim: next, ui_source: "dim_toggle" });
    },
    setStatusLed: function (mode) {
      window.tsStore.save({ sl: parseInt(mode, 10), ui_source: "statusled_toggle" });
    },
    setDisplayMode: function (mode) {
      window.tsStore.save({ sd: parseInt(mode, 10), ui_source: "display_mode_toggle" });
    },
    setLocale: function (locale) {
      window.tsStore.save({ locale: locale, ui_source: "locale_toggle" });
    },
    saveHostPort: function () {
      var host = (this.settings.hostInput || "").trim();
      var port = parseInt(this.settings.portInput, 10);
      if (!host || isNaN(port)) return;
      window.tsStore.save({ host: host, port: port, ui_source: "host_changed" });
    },
    downloadFirmware: function (version) {
      window.tsApi.downloadFirmware(version);
    },

    // --- OpenTherm -------------------------------------------------------
    otRows: function () {
      var s = this.store;
      return [
        { label: "ot0 status",       value: this.formatOt0(s.ot0) },
        { label: "ot1 setpoint",     value: this.formatOtFloat(s.ot1) + " °C" },
        { label: "ot3 config",       value: this.formatOt3(s.ot3) },
        { label: "ot17 modulation",  value: this.formatOtFloat(s.ot17) + " %" },
        { label: "ot18 CH pressure", value: this.formatOtFloat(s.ot18) + " bar" },
        { label: "ot19 DHW flow",    value: this.formatOtFloat(s.ot19) },
        { label: "ot25 boiler temp", value: this.formatOtFloat(s.ot25) + " °C" },
        { label: "ot26 DHW temp",    value: this.formatOtFloat(s.ot26) + " °C" },
        { label: "ot27 outside temp",value: this.formatOtFloat(s.ot27) + " °C" },
        { label: "ot28 return temp", value: this.formatOtFloat(s.ot28) + " °C" },
        { label: "ot34 max CH temp", value: this.formatOtFloat(s.ot34) + " °C" },
        { label: "ot56 DHW setpoint",value: this.formatOtFloat(s.ot56) + " °C" },
        { label: "ot125 OEM diag",   value: "0x" + (s.ot125 || 0).toString(16).toUpperCase() },
      ];
    },
    formatOtFloat: function (raw) {
      if (raw == null) return "—";
      // OpenTherm f8.8 stored as 16-bit signed: high byte = integer, low byte = 1/256.
      var int = (raw >> 8) & 0xff;
      var signed = int > 127 ? int - 256 : int;
      var frac = (raw & 0xff) / 256;
      return (signed + frac).toFixed(2);
    },
    formatOt0: function (raw) {
      if (!raw) return "—";
      var bits = ["fault", "ch_mode", "dhw_mode", "flame", "cooling", "ch2", "diag"];
      var on = [];
      bits.forEach(function (n, i) { if (raw & (1 << i)) on.push(n); });
      return on.length ? on.join(", ") : "idle";
    },
    formatOt3: function (raw) {
      if (raw == null) return "—";
      var bits = ["dhw_present", "control_type", "cooling_config", "dhw_config", "master_low_off", "ch2_present", "remote_fill", "heat_cool"];
      var on = [];
      bits.forEach(function (n, i) { if (raw & (1 << i)) on.push(n); });
      return on.length ? on.join(", ") : "—";
    },

    // --- Modal -----------------------------------------------------------
    openModal: function (cfg) {
      this.modal = Object.assign(
        { kind: null, title: "", draft: {}, allowPause: false, allowDescription: false,
          allowDelete: false, onConfirm: null, onDelete: null, message: "" },
        cfg
      );
    },
    closeModal: function () {
      this.modal = { kind: null, title: "", draft: {}, allowPause: false, allowDescription: false,
        allowDelete: false, onConfirm: null, onDelete: null, message: "" };
    },
    confirmDelete: function () {
      var fn = this.modal.onDelete;
      this.closeModal();
      if (fn) fn();
    },
    confirmEditBlock: function () {
      var fn = this.modal.onConfirm;
      var draft = Object.assign({}, this.modal.draft);
      this.closeModal();
      if (fn) fn(draft);
    },
    confirmEditProgram: function () {
      var fn = this.modal.onConfirm;
      var draft = Object.assign({}, this.modal.draft);
      this.closeModal();
      if (fn) fn(draft);
    },
  };
};
