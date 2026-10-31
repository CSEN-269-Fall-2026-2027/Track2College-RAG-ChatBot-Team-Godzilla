import { memo, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import { useProfile } from "../profile";
import { href, type Route } from "../router";
import type { Health, Theme } from "../App";
import { ChatIcon, FileIcon, Logo, LogoutIcon, MoonIcon, RetryIcon, SunIcon, UserIcon } from "./icons";
import { ResetDataDialog } from "./ResetDataDialog";

const LINKS: { route: Route; label: string; Icon: typeof FileIcon }[] = [
  { route: "advisor", label: "Advisor", Icon: ChatIcon },
  { route: "materials", label: "Materials", Icon: FileIcon },
  { route: "profile", label: "Profile", Icon: UserIcon },
];

interface AppTopbarProps {
  route: Route;
  health: Health;
  theme: Theme;
  onToggleTheme: () => void;
}

/** Shared top nav for Advisor, Materials, and Profile. */
export const AppTopbar = memo(function AppTopbar({ route, health, theme, onToggleTheme }: AppTopbarProps) {
  const { account, signOut } = useAuth();
  const { profile } = useProfile();
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
          {LINKS.map(({ route: target, label, Icon }) => {
            const active = route === target;
            return (
              <a
                key={target}
                href={href(target)}
                className={active ? "on" : undefined}
                aria-current={active ? "page" : undefined}
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
