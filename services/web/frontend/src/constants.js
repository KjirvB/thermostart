export const PROGRAMS = {
  home:        { key: "home",        tk: "program.home",       label: "Home",        temp: 210, color: "var(--p-home)" },
  not_home:    { key: "not_home",    tk: "program.away",       label: "Away",        temp: 165, color: "var(--p-not_home)" },
  comfort:     { key: "comfort",     tk: "program.comfort",    label: "Comfort",     temp: 225, color: "var(--p-comfort)" },
  anti_freeze: { key: "anti_freeze", tk: "program.antifreeze", label: "Anti-freeze", temp: 70,  color: "var(--p-anti_freeze)" },
  pause:       { key: "pause",       tk: "program.pause",      label: "Pause",       temp: 130, color: "var(--p-pause)" },
};

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_LONG  = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function slotToHHMM(slot) {
  const m = slot * 15;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function nowSlot() {
  const d = new Date();
  return Math.floor((d.getHours() * 60 + d.getMinutes()) / 15);
}

export function nowDayIdx() {
  // 0 = Monday … 6 = Sunday
  const js = new Date().getDay();
  return (js + 6) % 7;
}
