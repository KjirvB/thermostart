// Wraps the Socket.IO client with the same event names emitted by the legacy
// backend (services/web/thermostart/events.py and ts/routes.py). Subscribers
// register handlers via tsSocket.on(); tsSocket.save() emits 'store-thermostat'.
window.tsSocket = (function () {
  var io = window.io;
  var socket = null;
  var listeners = {};

  function ensure() {
    if (socket) return socket;
    if (!io) {
      console.warn("[ts] Socket.IO library not loaded");
      return null;
    }
    socket = io({ transports: ["websocket", "polling"] });
    [
      "connect",
      "disconnect",
      "room_temperature",
      "outside_temperature",
      "target_temperature",
      "source",
      "location",
      "broadcast-thermostat",
    ].forEach(function (evt) {
      socket.on(evt, function (data) {
        (listeners[evt] || []).forEach(function (fn) {
          try { fn(data); } catch (e) { console.error(e); }
        });
      });
    });
    return socket;
  }

  return {
    connect: function () { ensure(); },
    on: function (evt, fn) {
      (listeners[evt] = listeners[evt] || []).push(fn);
      ensure();
    },
    save: function (payload) {
      var s = ensure();
      if (!s) return;
      s.emit("store-thermostat", payload);
    },
  };
})();
