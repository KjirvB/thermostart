import { io } from "socket.io-client";

let socket = null;

export function connectSocket() {
  if (socket) return socket;
  // Reuse the existing namespace + path used by the classic UI
  // (services/web/thermostart/static/js/ithermostat.js:141).
  socket = io({ path: "/socket.io" });
  return socket;
}

export function onSocketEvents(handlers) {
  const s = connectSocket();
  const wired = [];
  for (const [event, fn] of Object.entries(handlers)) {
    s.on(event, fn);
    wired.push([event, fn]);
  }
  return () => {
    for (const [event, fn] of wired) s.off(event, fn);
  };
}
