import { memo, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import { completeness, useProfile } from "../profile";
import { href, type Route } from "../router";
import type { Health, Theme } from "../App";
import { FileIcon, HomeIcon, Logo, LogoutIcon, MoonIcon, SunIcon, UserIcon } from "./icons";

const ITEMS: { route: Route; label: string; Icon: typeof FileIcon }[] = [
  { route: "advisor", label: "Home", Icon: HomeIcon },
  { route: "materials", label: "Materials", Icon: FileIcon },
  { route: "profile", label: "Profile", Icon: UserIcon },
];

interface NavRailProps {
  route: Route;
  health: Health;
  theme: Theme;
  onToggleTheme: () => void;
}

export const NavRail = memo(function NavRail({ route, health, theme, onToggleTheme }: NavRailProps) {
  const { account, signOut } = useAuth();
  const { profile } = useProfile();
  const percent = Math.round(completeness(profile).overall * 100);
  const [menuOpen, setMenuOpen] = useState(false);
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
    <nav className="rail" aria-label="Main">
      <a className="rail-brand" href={href("advisor")}>
        <Logo size={28} />
        <span>Track2College</span>
      </a>

      <ul className="rail-items">
        {ITEMS.map(({ route: target, label, Icon }) => (
          <li key={target}>
            <a className={`rail-item ${route === target ? "active" : ""}`} href={href(target)} aria-current={route === target ? "page" : undefined}>
              <Icon width={19} height={19} />
              <span>{label}</span>
              {target === "profile" && percent < 100 && <span className="rail-badge">{percent}%</span>}
            </a>
          </li>
        ))}
      </ul>

      <div className="rail-footer">
        <span className={`status status-${health}`} title={`Advisor API ${health}`}>
          <span className="status-dot" />
          {health === "online" ? "Advisor online" : health === "offline" ? "Advisor offline" : "Connecting"}
        </span>

        <div className="user-menu" ref={menuRef}>
          <button className="user-btn" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-haspopup="menu">
            <span className="user-avatar">{initials}</span>
            <span className="user-text">
              <span className="user-name">{name}</span>
              <span className="user-email">{account?.email}</span>
            </span>
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              <button role="menuitem" onClick={onToggleTheme}>
                {theme === "dark" ? <SunIcon width={16} height={16} /> : <MoonIcon width={16} height={16} />}
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </button>
              <button role="menuitem" className="danger" onClick={signOut}>
                <LogoutIcon width={16} height={16} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
});
