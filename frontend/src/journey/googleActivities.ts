import type { GoogleActivitySuggestion } from "../api";
import { saveActivitySuggestions } from "./activityImports";
import { journeyOf } from "./logic";
import type { ActivitySectionId, Profile, WaitlistItem } from "../types";

/** Mark Google suggestions as reviewed so Milo doesn't ask again. */
export function withGoogleActivitiesReviewed(profile: Profile): Profile {
  const journey = journeyOf(profile);
  return {
    ...profile,
    ucJourney: { ...journey, checks: { ...journey.checks, "google-activities-reviewed": true } },
  };
}

/** Milo Confirm: keep the imported list, close the Google step, and finish Activities. */
export function completeGoogleActivitiesConfirm(profile: Profile): Profile {
  const reviewed = withGoogleActivitiesReviewed(profile);
  const journey = journeyOf(reviewed);
  return { ...reviewed, ucJourney: { ...journey, activitiesReviewed: true } };
}

/** Write suggestions into Profile activity lists (merge by name). Does not mark reviewed. */
export function saveGoogleActivitySuggestions(
  profile: Profile,
  suggestions: GoogleActivitySuggestion[],
  newId: () => string,
): Profile {
  const bySection = new Map<string, GoogleActivitySuggestion[]>();
  for (const item of suggestions) {
    const section = item.section || "activities";
    const list = bySection.get(section) ?? [];
    list.push(item);
    bySection.set(section, list);
  }
  let next = profile;
  for (const [section, items] of bySection) {
    next = saveActivitySuggestions(next, sectionOf(section), items, newId);
  }
  return next;
}

/** Save suggestions and mark the Google confirm step done. */
export function applyGoogleActivitySuggestions(
  profile: Profile,
  suggestions: GoogleActivitySuggestion[],
  newId: () => string,
): Profile {
  return withGoogleActivitiesReviewed(saveGoogleActivitySuggestions(profile, suggestions, newId));
}

const SECTIONS: ActivitySectionId[] = ["activities", "volunteering", "job", "awards"];
const sectionOf = (section: string): ActivitySectionId =>
  (SECTIONS as string[]).includes(section) ? (section as ActivitySectionId) : "activities";

/** The Google waitlist, or null when the scan hasn't filled one in for this student. */
export function waitlistOf(profile: Profile): WaitlistItem[] | null {
  const list = journeyOf(profile).googleWaitlist;
  return Array.isArray(list) ? list : null;
}

export function setWaitlist(profile: Profile, items: WaitlistItem[]): Profile {
  const journey = journeyOf(profile);
  return { ...profile, ucJourney: { ...journey, googleWaitlist: items } };
}

/**
 * The first finished scan (even one that found nothing) goes into the waitlist, not the profile.
 * Sets `google-activities-imported` so a later scan doesn't overwrite the student's edits.
 */
export function queueGoogleSuggestionsOnce(
  profile: Profile,
  suggestions: GoogleActivitySuggestion[],
  newId: () => string,
): Profile {
  const j = journeyOf(profile);
  if (j.checks?.["google-activities-imported"]) return profile;
  // Anything the student already added in Milo's popup stays; Google's finds join it (no repeats by name).
  const existing = Array.isArray(j.googleWaitlist) ? j.googleWaitlist : [];
  const seen = new Set(existing.map((i) => i.name.trim().toLowerCase()));
  const found: WaitlistItem[] = suggestions
    .filter((s) => s.name.trim() && !seen.has(s.name.trim().toLowerCase()))
    .map((s) => ({
      id: newId(),
      section: sectionOf(s.section),
      name: s.name.trim(),
      role: s.role.trim(),
      description: s.description.trim(),
      level: s.level.trim(),
    }));
  return {
    ...profile,
    ucJourney: { ...j, googleWaitlist: [...existing, ...found], checks: { ...j.checks, "google-activities-imported": true } },
  };
}

/** New finds from another scan, added after what's already listed (the student's edits stay; no repeats by name). */
export function mergeIntoWaitlist(items: WaitlistItem[], suggestions: GoogleActivitySuggestion[], newId: () => string): WaitlistItem[] {
  const seen = new Set(items.map((i) => i.name.trim().toLowerCase()));
  const added: WaitlistItem[] = [];
  for (const s of suggestions) {
    const key = s.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    added.push({ id: newId(), section: sectionOf(s.section), name: s.name.trim(), role: s.role.trim(), description: s.description.trim(), level: s.level.trim() });
  }
  return [...items, ...added];
}

/** Milo's Confirm: move the waitlist into the activities and awards lists, then finish Activities. */
export function confirmGoogleWaitlist(profile: Profile, newId: () => string): Profile {
  const items = (waitlistOf(profile) ?? []).filter((i) => i.name.trim());
  let next = profile;
  for (const section of SECTIONS) {
    const inSection = items.filter((i) => i.section === section);
    if (!inSection.length) continue;
    next = saveActivitySuggestions(next, section, inSection, newId);
  }
  const done = completeGoogleActivitiesConfirm(next);
  const { googleWaitlist: _list, ...journey } = journeyOf(done);
  return { ...done, ucJourney: journey };
}

const numbered = (items: WaitlistItem[]) =>
  items
    .map((item, i) => {
      const detail = [item.role, item.level, item.description].filter(Boolean).join(" · ");
      return detail ? `${i + 1}. **${item.name}** — ${detail}` : `${i + 1}. **${item.name}**`;
    })
    .join("\n");

/** Milo's first bubble: the activities (including volunteering and jobs) Google found, or 0. */
export function googleActivitiesFoundMessage(items: WaitlistItem[]): string {
  const found = items.filter((i) => i.section !== "awards");
  const head = `I found **${found.length} ${found.length === 1 ? "activity" : "activities"}** from your email and calendar.`;
  return found.length ? `${head}\n\n${numbered(found)}` : head;
}

/** Milo's second bubble, right after the activities: the honors and awards Google found, or 0. */
export function googleHonorsFoundMessage(items: WaitlistItem[]): string {
  const found = items.filter((i) => i.section === "awards");
  const head = `I found **${found.length} ${found.length === 1 ? "honor" : "honors"}** from your email and calendar.`;
  return found.length ? `${head}\n\n${numbered(found)}` : head;
}
