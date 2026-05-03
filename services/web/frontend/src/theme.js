// Theme persistence: light | dark | system. Stored in localStorage.
// "system" follows window.matchMedia("(prefers-color-scheme: dark)") and tracks live changes.

import { useEffect, useState } from "react";

const KEY = "ui.theme";

function readPref() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch (_) {}
  return "system";
}

function effective(mode) {
  if (mode === "system") {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark" : "light";
  }
  return mode;
}

export function useTheme() {
  const [mode, setMode] = useState(readPref);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", effective(mode));
    try { localStorage.setItem(KEY, mode); } catch (_) {}
  }, [mode]);

  // Live-track system changes when in "system" mode
  useEffect(() => {
    if (mode !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => document.documentElement.setAttribute("data-theme", mq.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  return [mode, setMode];
}
