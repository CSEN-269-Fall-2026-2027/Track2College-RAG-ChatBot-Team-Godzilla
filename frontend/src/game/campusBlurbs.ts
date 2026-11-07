/** The same answer for every student, so Theo's tour and campus buttons cost no model tokens. */
export const CAMPUS_BLURBS: Record<string, string> = {
  "UC Berkeley": "Bay Area college town across from San Francisco, and the oldest UC. Known for engineering and computer science, the sciences, Haas business, and a history of student activism. Big, intense, and very self-directed.",
  UCLA: "Westwood in Los Angeles, a compact campus near Santa Monica and Hollywood. Known for film, theater, and TV, health sciences, and big-time athletics, with huge school spirit.",
  "UC San Diego": "La Jolla, on the coast. Known for biology, computer science, engineering, and ocean science through Scripps. Students belong to one of eight undergraduate colleges, each with its own general education requirements.",
  "UC Davis": "A bike-everywhere college town near Sacramento. Known for agriculture, veterinary medicine, plant and animal science, and environmental science. Friendly and down-to-earth, with Picnic Day as its signature tradition.",
  "UC Irvine": "Planned suburban Orange County, a short drive from the beach. Known for computer science and games, esports, nursing, biological sciences, and criminology. Quiet and very safe, with a circular campus around a park.",
  "UC Santa Barbara": "On the Pacific next to the student town of Isla Vista. Known for physics and materials research, marine and environmental science, and the College of Creative Studies. Strong social scene beside the beach.",
  "UC Santa Cruz": "Redwood forest above Monterey Bay. Known for marine science, astronomy, games, environmental studies, and a progressive, independent culture. Everyone joins one of ten residential colleges.",
  "UC Riverside": "Inland Southern California. Known for one of the most diverse student bodies in the UC system, strong support for first-generation students, entomology, citrus research, and business.",
  "UC Merced": "Central Valley near Yosemite, the newest and smallest UC. Known for sustainability-focused buildings, undergraduate research access, a majority first-generation student body, and growing engineering and natural sciences programs.",
};

export const CAMPUS_TOUR = Object.entries(CAMPUS_BLURBS)
  .map(([name, blurb]) => `- **${name}:** ${blurb}`)
  .join("\n");

export const WHAT_COUNTS_ANSWER =
  "Sports, clubs, arts, volunteering, jobs, family responsibilities like caring for siblings, personal projects, and honors or awards all count. Anything you regularly do outside of class that shows your interests and commitments can go on your list. To add one, click **Add an activity** above.";
