// REST wrappers. Mutations use the HA-friendly /thermostat/<id> endpoints
// (see services/web/thermostart/ts/routes.py). Settings fields not covered
// there go through /ui/v2/api/settings (session-auth).

import { DEVICE_ID } from "./bootstrap.js";

function deviceId() {
  if (!DEVICE_ID) throw new Error("device id missing — bootstrap not loaded");
  return DEVICE_ID;
}

async function send(url, options) {
  const res = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options && options.headers),
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`${options?.method || "GET"} ${url} → ${res.status} ${txt}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export function fetchModel() {
  return send("/thermostatmodel", { method: "GET" });
}

export function putThermostat(patch) {
  return send(`/thermostat/${deviceId()}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export function pauseDevice() {
  return send(`/thermostat/${deviceId()}/pause`, { method: "POST" });
}

export function unpauseDevice() {
  return send(`/thermostat/${deviceId()}/unpause`, { method: "POST" });
}

export function putSettings(patch) {
  return send("/ui/v2/api/settings", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

export function downloadFirmware(version) {
  const form = new FormData();
  form.append("version", String(version));
  return fetch("/firmware", {
    method: "POST",
    body: form,
    credentials: "same-origin",
  }).then(async (res) => {
    if (!res.ok) throw new Error(`firmware download failed: ${res.status}`);
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename="?([^"]+)"?/);
    const filename = m ? m[1] : `firmware_v${version}.bin`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}
