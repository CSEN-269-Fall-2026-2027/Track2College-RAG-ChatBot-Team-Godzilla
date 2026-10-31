import { useEffect, useState } from "react";

export const ROUTES = ["materials", "profile", "advisor", "map"] as const;
export type Route = (typeof ROUTES)[number];

export interface Location {
  route: Route;
  /** Optional second path segment, e.g. the profile section in #/profile/academics. */
  param: string | null;
}

function parseHash(): Location {
  const [rawName = "", rawParam = null] = window.location.hash.replace(/^#\/?/, "").split("/");
  // Legacy bookmarks → Materials.
  const name =
    rawName === "overview" || rawName === "home" || rawName === "insights" || rawName === "explore"
      ? "materials"
      : rawName;
  const param =
    rawName === "insights"
      ? rawParam === "essays" || rawParam === "plan"
        ? rawParam
        : null
      : rawName === "explore"
        ? null
        : rawParam;
  // Empty / unknown hashes open Advisor (not Materials).
  const route = (ROUTES as readonly string[]).includes(name) ? (name as Route) : "advisor";
  const keepParam =
    route === name ||
    rawName === "overview" ||
    rawName === "home" ||
    rawName === "insights";
  return { route, param: keepParam ? param || null : null };
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
