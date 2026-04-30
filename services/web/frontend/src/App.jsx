import { useEffect, useMemo, useState } from "react";
import { useStore } from "./store.js";
import { useTheme } from "./theme.js";
import { Overview, Schedule, Exceptions, Boiler, Settings } from "./components/Screens.jsx";
import { makeT } from "./translations.js";

const NAV = [
  { k: "overview",   tk: "nav.overview",   icon: (<path d="M3 12l9-9 9 9M5 10v10h14V10" />) },
  { k: "schedule",   tk: "nav.schedule",   icon: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v4M16 4v4" /></>) },
  { k: "exceptions", tk: "nav.exceptions", icon: (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 10h10M7 14h6" /></>) },
  { k: "boiler",     tk: "nav.boiler",     icon: (<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>) },
  { k: "settings",   tk: "nav.settings",   icon: (<><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1.3l2-1.6-2-3.4-2.4 1a7 7 0 00-2.3-1.3L13.7 3h-3.4l-.5 2.4a7 7 0 00-2.3 1.3l-2.4-1-2 3.4 2 1.6A7 7 0 005 12c0 .4 0 .9.1 1.3l-2 1.6 2 3.4 2.4-1a7 7 0 002.3 1.3l.5 2.4h3.4l.5-2.4a7 7 0 002.3-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z" /></>) },
];

function Icon({ children }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export default function App() {
  const [state, actions] = useStore();
  const [themeMode, setThemeMode] = useTheme();
  const [route, setRoute] = useState("overview");
  const t = useMemo(() => makeT(state.locale || "en-GB"), [state.locale]);

  useEffect(() => {
    document.documentElement.setAttribute("data-skin", "paper");
    document.documentElement.setAttribute("data-density", "cozy");
  }, []);

  if (!state.loaded) {
    return (
      <div className="app">
        <div className="shell" style={{ padding: 40, textAlign: "center", color: "var(--ink-2)", fontFamily: "var(--font-mono)" }}>
          {t("app.loading")}
        </div>
      </div>
    );
  }

  const screens = {
    overview:   <Overview   state={state} actions={actions} t={t} onGoSchedule={() => setRoute("schedule")} />,
    schedule:   <Schedule   state={state} actions={actions} t={t} />,
    exceptions: <Exceptions state={state} actions={actions} t={t} />,
    boiler:     <Boiler     state={state} t={t} />,
    settings:   <Settings   state={state} actions={actions} t={t} themeMode={themeMode} setThemeMode={setThemeMode} />,
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="mark"></span> Thermosmart</div>
        <nav>
          {NAV.map(it => (
            <button key={it.k} className={route === it.k ? "active" : ""} onClick={() => setRoute(it.k)}>
              <Icon>{it.icon}</Icon>
              {t(it.tk)}
            </button>
          ))}
        </nav>
        <div className="ui-toggle">
          {t("sidebar.classic_hint")}<br />
          <a href="/ui/switch?to=classic">{t("sidebar.classic_link")}</a>
        </div>
      </aside>

      <header className="topbar">
        <div className="brand"><span className="mark"></span> Thermosmart</div>
      </header>

      <div className="shell">
        {screens[route]}
      </div>

      <nav className="bottom-nav">
        {NAV.map(it => (
          <button key={it.k} className={route === it.k ? "active" : ""} onClick={() => setRoute(it.k)}>
            <Icon>{it.icon}</Icon>
            {t(it.tk)}
          </button>
        ))}
      </nav>
    </div>
  );
}
