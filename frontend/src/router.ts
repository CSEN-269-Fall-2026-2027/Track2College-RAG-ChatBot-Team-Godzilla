import { useEffect, useState } from "react";

export const ROUTES = ["profile", "advisor", "map", "agent"] as const;
export type Route = (typeof ROUTES)[number];

export interface Location {
  route: Route;
  /** Optional second path segment, e.g. the profile section in #/profile/academics. */
  param: string | null;
}

/**
 * Materials (essays, transcript, course plan) now lives in Profile. Old bookmarks still land
 * in the right place: essays → Profile essays, transcript and the retired course plan → Academic history.
 */
const LEGACY_PAGES = new Set(["materials", "insights", "overview", "home", "explore"]);
const LEGACY_SECTION: Record<string, string> = { essays: "essays", transcript: "academics", plan: "academics" };

export function parseLocation(hash: string): Location {
  const [name = "", rawParam = null] = hash.replace(/^#\/?/, "").split("/");
  if (LEGACY_PAGES.has(name)) {
    return { route: "profile", param: (rawParam && LEGACY_SECTION[rawParam]) || "essays" };
  }
  // Empty / unknown hashes open Advisor.
  if (!(ROUTES as readonly string[]).includes(name)) return { route: "advisor", param: null };
  return { route: name as Route, param: rawParam || null };
}

function parseHash(): Location {
  return parseLocation(window.location.hash);
}

export function href(route: Route, param?: string) {
  return `#/${route}${param ? `/${param}` : ""}`;
}

export function navigate(route: Route, param?: string) {
  window.location.hash = href(route, param).slice(1);
}

export function useLocation(): Location {
  const [location, setLocation] = useState(parseHash);
  useEffect(() => {
    const onChange = () => {
      setLocation(parseHash());
      document.querySelector(".page-scroll")?.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return location;
}
