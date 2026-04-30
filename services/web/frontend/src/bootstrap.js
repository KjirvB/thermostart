// Server-injected bootstrap state (see templates/v2/index.html).
// In dev/standalone mode we fall back to an empty object so api.js fetches /thermostatmodel.

export const BOOTSTRAP = (typeof window !== "undefined" && window.__INITIAL_STATE__) || null;
export const DEVICE_ID = (typeof window !== "undefined" && window.__DEVICE_ID__) || null;
