import { useCallback, useEffect, useState } from "react";
import { checkHealth } from "./api";
import { AnalysisProvider } from "./analysis";
import { AuthProvider, useAuth } from "./auth";
import { ProfileProvider } from "./profile";
import { useLocation, type Route } from "./router";
import { AuthPage } from "./pages/AuthPage";
import { Overview } from "./pages/Overview";
import { ProfilePage } from "./pages/ProfilePage";
import { Advisor } from "./pages/Advisor";
import { Insights } from "./pages/Insights";
import { Explore } from "./pages/Explore";
import { PlanningProvider } from "./planning";
import { NavRail } from "./components/NavRail";
import { Logo } from "./components/icons";

export type Theme = "light" | "dark";
export type Health = "checking" | "online" | "offline";

export interface Handoff {
  id: string;
  text: string;
}

const TITLES: Record<Route, string> = {
  overview: "Home",
  profile: "My profile",
  explore: "Explore colleges",
  advisor: "Advisor",
  insights: "Insights",
};

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme) ?? "light");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("t2c.theme", theme);
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return [theme, toggle] as const;
}

function useHealth() {
  const [health, setHealth] = useState<Health>("checking");
  useEffect(() => {
    let controller = new AbortController();
    const probe = async () => {
      controller.abort();
      controller = new AbortController();
      setHealth((await checkHealth(controller.signal)) ? "online" : "offline");
    };
    probe();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") probe();
    }, 30_000);
    return () => {
      window.clearInterval(id);
      controller.abort();
    };
  }, []);
  return [health, setHealth] as const;
}

function LoadingScreen() {
  return (
    <div className="loading-screen" aria-busy="true" aria-label="Loading">
      <Logo size={44} />
    </div>
  );
}

function Shell() {
  const { account, loading } = useAuth();
  const { route, param } = useLocation();
  const [theme, toggleTheme] = useTheme();
  const [health, setHealth] = useHealth();
  const [handoff, setHandoff] = useState<Handoff | null>(null);

  const askAdvisor = useCallback((text: string) => {
    setHandoff({ id: crypto.randomUUID(), text });
    window.location.hash = "/advisor";
  }, []);

  useEffect(() => {
    if (route !== "advisor") document.title = `${TITLES[route]} · Track2College`;
  }, [route]);

  if (loading) return <LoadingScreen />;
  if (!account) return <AuthPage theme={theme} onToggleTheme={toggleTheme} />;

  return (
    <ProfileProvider key={account.id} userId={account.id} name={account.name} fallback={<LoadingScreen />}>
      <AnalysisProvider userId={account.id}>
        <PlanningProvider userId={account.id}>
          <div className="shell">
            <NavRail route={route} health={health} theme={theme} onToggleTheme={toggleTheme} />
            <main className="page">
              {route === "overview" && <Overview onAsk={askAdvisor} />}
              {route === "profile" && <ProfilePage section={param} />}
              {route === "explore" && <Explore onAsk={askAdvisor} />}
              {route === "insights" && <Insights tab={param} onAsk={askAdvisor} />}
              <Advisor userId={account.id} visible={route === "advisor"} health={health} onHealth={setHealth} handoff={handoff} />
            </main>
          </div>
        </PlanningProvider>
      </AnalysisProvider>
    </ProfileProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
