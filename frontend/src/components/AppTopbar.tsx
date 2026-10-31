import { memo, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import { useGame } from "../game/GameProvider";
import { storyComplete } from "../journey/guided";
import { completeness, useProfile } from "../profile";
import { href, type Route } from "../router";
import type { Health, Theme } from "../App";
import { BookIcon, ChatIcon, FileIcon, LockIcon, SparkIcon, Logo, LogoutIcon, MoonIcon, RetryIcon, SunIcon, UserIcon } from "./icons";
import { ResetDataDialog } from "./ResetDataDialog";

/** Story and Manual both live on the Advisor route; `story` picks the mode. */
const LINKS: { route: Route; label: string; Icon: typeof FileIcon; story?: boolean }[] = [
  { route: "advisor", label: "Story", Icon: BookIcon, story: true },
  { route: "advisor", label: "Manual", Icon: ChatIcon, story: false },
  { route: "profile", label: "Profile", Icon: UserIcon },
];

interface AppTopbarProps {
  route: Route;
  health: Health;
  theme: Theme;
  onToggleTheme: () => void;
}

/** Shared top nav for Advisor (Story / Manual), Profile, and Apply. */
export const AppTopbar = memo(function AppTopbar({ route, health, theme, onToggleTheme }: AppTopbarProps) {
  const { account, signOut } = useAuth();
  const { profile } = useProfile();
  const { state, updateSettings } = useGame();
  const [menuOpen, setMenuOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuOpen]);

  // Apply is always reachable; until the story is finished it opens on a locked page.
  const applyLocked = !storyComplete(profile, completeness(profile).sections);
  const links: typeof LINKS = [{ route: "agent", label: "Apply", Icon: applyLocked ? LockIcon : SparkIcon }, ...LINKS];
  const name = profile.basics.firstName || account?.name || "";
  const initials = (name.trim()[0] ?? "?").toUpperCase() + (profile.basics.lastName.trim()[0] ?? "").toUpperCase();

  return (
    <header className="topbar app-topbar">
      <div className="topbar-left">
        <a className="advisor-brand" href={href("advisor")} aria-label="Track2College home">
          <Logo size={26} />
          <span>Track2College</span>
        </a>
        <nav className="app-nav" aria-label="App sections">
          {links.map(({ route: target, label, Icon, story }) => {
            const active = route === target && (story === undefined || story === state.storyMode);
            return (
              <a
                key={label}
                href={href(target)}
                onClick={story === undefined ? undefined : () => updateSettings({ storyMode: story })}
                className={active ? "on" : undefined}
                aria-current={active ? "page" : undefined}
                title={target === "agent" && applyLocked ? "Unlocks when you finish the story" : undefined}
              >
                <Icon width={16} height={16} />
                <span>{label}</span>
              </a>
            );
          })}
        </nav>
      </div>

      <div className="topbar-right">
        {health === "offline" && (
          <span className="status status-offline">
            <span className="status-dot" />
            Offline
          </span>
        )}

        <div className="user-menu user-menu-top" ref={menuRef}>
            <button
              className="user-btn user-btn-compact"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              title={account?.email}
            >
              <span className="user-avatar">{initials}</span>
            </button>
            {menuOpen && (
              <div className="menu" role="menu">
                <div className="menu-head">
                  <span className="menu-name">{name}</span>
                  <span className="menu-email">{account?.email}</span>
                </div>
                <button
                  role="menuitem"
                  onClick={() => {
                    onToggleTheme();
                    setMenuOpen(false);
                  }}
                >
                  {theme === "dark" ? <SunIcon width={16} height={16} /> : <MoonIcon width={16} height={16} />}
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    signOut();
                  }}
                >
                  <LogoutIcon width={16} height={16} />
                  Sign out
                </button>
                <div className="menu-sep" role="separator" />
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setMenuOpen(false);
                    setResetOpen(true);
                  }}
                >
                  <RetryIcon width={16} height={16} />
                  Reset all data…
                </button>
              </div>
            )}
          </div>
      </div>
      {resetOpen && <ResetDataDialog onClose={() => setResetOpen(false)} />}
    </header>
  );
});
