// Schedule helpers shared by the Standard Week and Exceptions pages.
// The legacy schedule grid is 7 days × 96 fifteen-minute slots. Slots match
// the backend representation: standard_week entries are [day, hour, minute],
// exceptions use [year, month, date, hour, minute] in device-local time.
window.tsSchedule = (function () {
  var SLOT_MINUTES = 15;
  var SLOTS_PER_DAY = 24 * 60 / SLOT_MINUTES; // 96

  function sortedWeek(week) {
    return (week || []).slice().sort(function (a, b) {
      return (a.start[0] * 1440 + a.start[1] * 60 + a.start[2])
           - (b.start[0] * 1440 + b.start[1] * 60 + b.start[2]);
    });
  }

  // Convert a sparse standard_week (transition list) into 7 arrays of contiguous
  // blocks: [{day, startSlot, endSlot, temperature}]. The last block on day 6
  // wraps to the first block of day 0.
  function blocksFromStandardWeek(week) {
    var sorted = sortedWeek(week);
    if (!sorted.length) return [];
    var result = [];
    for (var i = 0; i < sorted.length; i++) {
      var cur = sorted[i];
      var next = sorted[(i + 1) % sorted.length];
      var startMin = cur.start[0] * 1440 + cur.start[1] * 60 + cur.start[2];
      var nextMin = next.start[0] * 1440 + next.start[1] * 60 + next.start[2];
      if (i === sorted.length - 1) nextMin += 7 * 1440;
      var startDay = cur.start[0];
      var startSlot = (cur.start[1] * 60 + cur.start[2]) / SLOT_MINUTES;
      var totalSlots = Math.round((nextMin - startMin) / SLOT_MINUTES);
      // Split into per-day segments
      var remaining = totalSlots;
      var day = startDay;
      var slotInDay = startSlot;
      while (remaining > 0) {
        var available = SLOTS_PER_DAY - slotInDay;
        var take = Math.min(available, remaining);
        result.push({
          day: day % 7,
          startSlot: slotInDay,
          endSlot: slotInDay + take,
          temperature: cur.temperature,
          ref: cur,
        });
        remaining -= take;
        day = (day + 1) % 7;
        slotInDay = 0;
      }
    }
    return result;
  }

  // Convert exceptions into per-day-of-week display blocks for the week
  // containing `weekStart` (Monday at 00:00 device-local). Returns blocks with
  // their original exception ref so editors can mutate the source list.
  function blocksFromExceptions(exceptions, weekStartLocal) {
    var weekEndLocal = new Date(weekStartLocal.getTime() + 7 * 86400 * 1000);
    var out = [];
    (exceptions || []).forEach(function (e, idx) {
      var s = Date.UTC(e.start[0], e.start[1], e.start[2], e.start[3], e.start[4]);
      var en = Date.UTC(e.end[0], e.end[1], e.end[2], e.end[3], e.end[4]);
      if (en <= weekStartLocal.getTime() || s >= weekEndLocal.getTime()) return;
      var clampedStart = Math.max(s, weekStartLocal.getTime());
      var clampedEnd = Math.min(en, weekEndLocal.getTime());
      var msInDay = 86400 * 1000;
      var ms = clampedStart;
      while (ms < clampedEnd) {
        var dayIndex = Math.floor((ms - weekStartLocal.getTime()) / msInDay);
        var dayStart = weekStartLocal.getTime() + dayIndex * msInDay;
        var dayEnd = dayStart + msInDay;
        var segStart = ms;
        var segEnd = Math.min(clampedEnd, dayEnd);
        out.push({
          day: dayIndex,
          startSlot: Math.round((segStart - dayStart) / 60000 / SLOT_MINUTES),
          endSlot: Math.round((segEnd - dayStart) / 60000 / SLOT_MINUTES),
          temperature: e.temperature,
          description: e.description || "",
          refIndex: idx,
        });
        ms = segEnd;
      }
    });
    return out;
  }

  function slotToHHMM(slot) {
    var minutes = slot * SLOT_MINUTES;
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  // Convert a full {day -> array of contiguous blocks} structure back to the
  // sparse standard_week transition list, auto-filling gaps with 'pause'.
  // Input: array of {day, startSlot, endSlot, temperature} sorted by (day,startSlot).
  function blocksToStandardWeek(blocks) {
    var sorted = blocks.slice().sort(function (a, b) {
      return a.day * SLOTS_PER_DAY + a.startSlot - (b.day * SLOTS_PER_DAY + b.startSlot);
    });
    if (!sorted.length) return [];
    var transitions = [];
    // Walk each slot of the week; emit a transition whenever the temperature changes.
    var pauseFill = "pause";
    var current = null;
    var weekSlots = SLOTS_PER_DAY * 7;
    var slotMap = new Array(weekSlots).fill(pauseFill);
    sorted.forEach(function (b) {
      for (var s = b.startSlot; s < b.endSlot; s++) {
        slotMap[b.day * SLOTS_PER_DAY + s] = b.temperature;
      }
    });
    for (var i = 0; i < weekSlots; i++) {
      if (slotMap[i] !== current) {
        var day = Math.floor(i / SLOTS_PER_DAY);
        var slotInDay = i % SLOTS_PER_DAY;
        var minutes = slotInDay * SLOT_MINUTES;
        transitions.push({
          start: [day, Math.floor(minutes / 60), minutes % 60],
          temperature: slotMap[i],
        });
        current = slotMap[i];
      }
    }
    return transitions;
  }

  // Compute the Monday-00:00 device-local time for the week containing `local`.
  function weekStart(local) {
    var msInDay = 86400 * 1000;
    var d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
    var jsDay = d.getUTCDay();
    var dayMon = (jsDay + 6) % 7;
    return new Date(d.getTime() - dayMon * msInDay);
  }

  function exceptionToTuple(localDate) {
    return [
      localDate.getUTCFullYear(),
      localDate.getUTCMonth(),
      localDate.getUTCDate(),
      localDate.getUTCHours(),
      localDate.getUTCMinutes(),
    ];
  }

  return {
    SLOT_MINUTES: SLOT_MINUTES,
    SLOTS_PER_DAY: SLOTS_PER_DAY,
    sortedWeek: sortedWeek,
    blocksFromStandardWeek: blocksFromStandardWeek,
    blocksFromExceptions: blocksFromExceptions,
    blocksToStandardWeek: blocksToStandardWeek,
    slotToHHMM: slotToHHMM,
    weekStart: weekStart,
    exceptionToTuple: exceptionToTuple,
  };
})();
