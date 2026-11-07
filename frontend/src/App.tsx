import type { Mentor } from "./game/characters";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkHealth } from "./api";
import { AuthProvider, useAuth } from "./auth";
import { ProfileProvider, useProfile } from "./profile";
import { PiqDraftsProvider } from "./journey/usePiqDrafts";
import { navigate, useLocation, type Route } from "./router";
import { AuthPage } from "./pages/AuthPage";
import { ProfilePage } from "./pages/ProfilePage";
import { Advisor } from "./pages/Advisor";
import { PlanningProvider } from "./planning";
import { GameProvider } from "./game/GameProvider";
import { AppTopbar } from "./components/AppTopbar";
import { Logo } from "./components/icons";
import { OnboardingPage } from "./onboarding/OnboardingPage";
import { JourneyMap } from "./journey/JourneyMap";
import { isOnboardingComplete } from "./onboarding/logic";

export type Theme = "light" | "dark";
export type Health = "checking" | "online" | "offline";

/** How a question handed to the advisor is sent. */
export interface AskOptions {
  /** What the chat shows, when the model gets more than the student should see. */
  display?: string;
  /** The guide to ask, instead of whoever covers the question. */
  mentorId?: Mentor["id"];
}

export interface Handoff extends AskOptions {
  id: string;
  text: string;
}

const TITLES: Record<Route, string> = {
  profile: "Profile",
  advisor: "Advisor",
  map: "UC Journey Map",
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

/** After profile load: onboarding gate or main shell. */
function GatedApp({
  userId,
  theme,
  toggleTheme,
  health,
  setHealth,
}: {
  userId: string;
  theme: Theme;
  toggleTheme: () => void;
  health: Health;
  setHealth: (h: Health) => void;
}) {
  const { profile } = useProfile();
  const { route, param } = useLocation();
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const complete = isOnboardingComplete(profile);
  // Where the map's Back button returns to.
  const lastRoute = useRef<Route>("advisor");
  if (route !== "map") lastRoute.current = route;

  const askAdvisor = useCallback((text: string, options?: AskOptions) => {
    setHandoff({ id: crypto.randomUUID(), text, ...options });
    window.location.hash = "/advisor";
  }, []);

  useEffect(() => {
    if (!complete) return;
    if (route !== "advisor") document.title = `${TITLES[route]} · Track2College`;
  }, [route, complete]);

  if (!complete) {
    return (
      <OnboardingPage
        theme={theme}
        onToggleTheme={toggleTheme}
        onFinished={() => {
          window.location.hash = "/advisor";
        }}
      />
    );
  }

  return (
    <div className="shell shell-immersive">
      <main className="page">
        <AppTopbar route={route} health={health} theme={theme} onToggleTheme={toggleTheme} />
        {route === "map" && <JourneyMap userId={userId} onBack={() => navigate(lastRoute.current)} />}
        {route === "profile" && <ProfilePage section={param} onAsk={askAdvisor} />}
        <Advisor userId={userId} visible={route === "advisor"} onHealth={setHealth} handoff={handoff} />
      </main>
    </div>
  );
}

function Shell() {
  const { account, loading } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const [health, setHealth] = useHealth();

  if (loading) return <LoadingScreen />;
  if (!account) return <AuthPage theme={theme} onToggleTheme={toggleTheme} />;

  return (
    <ProfileProvider key={account.id} userId={account.id} name={account.name} fallback={<LoadingScreen />}>
      <PlanningProvider userId={account.id}>
        <GameProvider userId={account.id}>
          <PiqDraftsProvider>
            <GatedApp userId={account.id} theme={theme} toggleTheme={toggleTheme} health={health} setHealth={setHealth} />
          </PiqDraftsProvider>
        </GameProvider>
      </PlanningProvider>
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
