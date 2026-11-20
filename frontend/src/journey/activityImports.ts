import type { ActivitySectionId, Award, Profile } from "../types";
import { ACTIVITY_DESC_LIMIT, ACTIVITY_SECTIONS, activitySection, journeyOf, withActivitySection } from "./logic";

export interface ActivityItem {
  name: string;
  role: string;
  description: string;
  level?: string;
}

/** Merge confirmed Google suggestions into the student's lists without duplicating existing entries. */
export function saveActivitySuggestions(profile: Profile, section: ActivitySectionId, items: ActivityItem[], newId: () => string): Profile {
  const journey = journeyOf(profile);
  const { count } = activitySection(journey, section);
  return {
    ...profile,
    ...(section === "awards"
      ? { awards: mergeAwards(profile.awards, items, newId) }
      : { activities: mergeActivities(profile.activities, section, items, newId) }),
    ucJourney: withActivitySection(journey, section, { count, notes: "From Google" }),
  };
}

function mergeActivities(list: Profile["activities"], section: ActivitySectionId, items: ActivityItem[], newId: () => string): Profile["activities"] {
  const category = ACTIVITY_SECTIONS.find((s) => s.id === section)!.category;
  const key = (name: string) => name.trim().toLowerCase();
  return items.reduce((acts, item) => {
    const description = item.description.slice(0, ACTIVITY_DESC_LIMIT);
    const same = acts.find((a) => a.category === category && key(a.name) === key(item.name));
    if (same) {
      return acts.map((a) => (a === same ? { ...a, role: item.role || a.role, description: description || a.description } : a));
    }
    return [...acts, { id: newId(), name: item.name, role: item.role, hoursPerWeek: "", weeksPerYear: "", years: "", description, category }];
  }, list);
}

const AWARD_LEVELS: Award["level"][] = ["school", "regional", "state", "national", "international"];

/** Adds confirmed Google suggestions to the honors and awards list, updating an award already there. */
function mergeAwards(list: Award[], items: ActivityItem[], newId: () => string): Award[] {
  const key = (title: string) => title.trim().toLowerCase();
  return items.reduce((awards, item) => {
    const level = AWARD_LEVELS.find((l) => l === item.level) ?? "";
    const same = awards.find((a) => key(a.title) === key(item.name));
    if (same) return awards.map((a) => (a === same ? { ...a, level: level || a.level } : a));
    return [...awards, { id: newId(), title: item.name, level }];
  }, list);
}

