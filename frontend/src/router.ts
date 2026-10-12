import { useEffect, useState } from "react";

export const ROUTES = ["overview", "profile", "explore", "advisor", "insights"] as const;
export type Route = (typeof ROUTES)[number];

export interface Location {
  route: Route;
  /** Optional second path segment, e.g. the profile section in #/profile/academics. */
  param: string | null;
}

function parseHash(): Location {
  const [name = "", param = null] = window.location.hash.replace(/^#\/?/, "").split("/");
  const route = (ROUTES as readonly string[]).includes(name) ? (name as Route) : "overview";
  return { route, param: route === name ? param || null : null };
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
