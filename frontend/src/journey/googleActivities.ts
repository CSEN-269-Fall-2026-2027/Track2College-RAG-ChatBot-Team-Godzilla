import type { GoogleActivitySuggestion } from "../api";
import { applyGuidedEffect, type GuidedEffect } from "./guided";
import { journeyOf } from "./logic";
import type { ActivitySectionId, Profile } from "../types";

/** Mark Google suggestions as reviewed so Milo doesn't ask again. */
export function withGoogleActivitiesReviewed(profile: Profile): Profile {
  const journey = journeyOf(profile);
  return {
    ...profile,
    ucJourney: { ...journey, checks: { ...journey.checks, "google-activities-reviewed": true } },
  };
}

/** Save chosen Google suggestions into the profile activity lists. */
export function applyGoogleActivitySuggestions(
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
    const effect: GuidedEffect = {
      type: "saveActivitySection",
      section: section as ActivitySectionId,
      notes: "From Google",
      items: items.map((a) => ({ name: a.name, role: a.role, description: a.description, level: a.level })),
    };
    next = applyGuidedEffect(next, effect, newId);
  }
  return withGoogleActivitiesReviewed(next);
}

/** Second Milo bubble: numbered list of activities found in email/calendar. */
export function googleActivitiesConfirmMessage(suggestions: GoogleActivitySuggestion[]): string {
  const n = suggestions.length;
  const noun = n === 1 ? "activity" : "activities";
  const lines = suggestions.map((item, i) => {
    const detail = [item.role, item.description].filter(Boolean).join(" · ");
    return detail ? `${i + 1}. **${item.name}** — ${detail}` : `${i + 1}. **${item.name}**`;
  });
  return (
    `I found ${n} ${noun} from your email and calendar. Please confirm these look right and I'll add them to your list:\n\n` +
    lines.join("\n")
  );
}
