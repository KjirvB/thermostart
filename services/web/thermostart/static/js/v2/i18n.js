// Tiny re-export of the legacy `window.i18n` table with a safe lookup helper.
// Keeps the same translation source-of-truth as the legacy UI.
window.tsI18n = {
  t: function (key, fallback) {
    if (window.i18n && Object.prototype.hasOwnProperty.call(window.i18n, key)) {
      return window.i18n[key];
    }
    return fallback != null ? fallback : key;
  },
  weekdaysShort: function () {
    return (window.i18n && window.i18n["weekdaysShort"]) || [
      "mon", "tue", "wed", "thu", "fri", "sat", "sun"
    ];
  },
  weekdaysLong: function () {
    return (window.i18n && window.i18n["weekdaysLong"]) || [
      "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
    ];
  },
  monthsShort: function () {
    return (window.i18n && window.i18n["monthsShort"]) || [
      "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sept", "oct", "nov", "dec"
    ];
  },
};
