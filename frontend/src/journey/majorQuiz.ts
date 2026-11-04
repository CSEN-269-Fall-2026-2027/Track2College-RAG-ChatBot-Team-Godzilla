/**
 * Major match: a six-question interest survey on Profile → Major selection. Each answer adds
 * points to one or two interest areas; the top areas suggest UC majors to look into. It's a
 * conversation starter for picking majors, not a prediction or a placement test.
 */

export type AreaId = "tech" | "engineering" | "health" | "environment" | "business" | "social" | "humanities" | "arts";

export interface Area {
  id: AreaId;
  title: string;
  blurb: string;
  majors: string[];
}

export const AREAS: Record<AreaId, Area> = {
  tech: {
    id: "tech",
    title: "Computing & data",
    blurb: "Building software, finding patterns in data, and solving logic puzzles.",
    majors: ["Computer Science", "Data Science", "Mathematics"],
  },
  engineering: {
    id: "engineering",
    title: "Engineering & building",
    blurb: "Designing and making things that work in the physical world.",
    majors: ["Mechanical Engineering", "Electrical Engineering", "Bioengineering"],
  },
  health: {
    id: "health",
    title: "Health & life sciences",
    blurb: "How bodies work and how to keep people healthy.",
    majors: ["Biology", "Public Health", "Nursing"],
  },
  environment: {
    id: "environment",
    title: "Earth & environment",
    blurb: "Climate, oceans, ecosystems, and caring for the planet.",
    majors: ["Environmental Science", "Marine Biology", "Geography"],
  },
  business: {
    id: "business",
    title: "Business & economics",
    blurb: "Money, markets, and how organizations run and grow.",
    majors: ["Economics", "Business Economics", "Statistics"],
  },
  social: {
    id: "social",
    title: "People & society",
    blurb: "Why people do what they do, and how communities and policy work.",
    majors: ["Psychology", "Sociology", "Political Science"],
  },
  humanities: {
    id: "humanities",
    title: "Writing, history & ideas",
    blurb: "Reading, writing, arguing a point, and understanding the past.",
    majors: ["English", "History", "Communication"],
  },
  arts: {
    id: "arts",
    title: "Arts & design",
    blurb: "Making visual art, music, film, or designs people experience.",
    majors: ["Art", "Film & Media Studies", "Music"],
  },
};

export interface QuizOption {
  id: string;
  label: string;
  /** First area gets 2 points, the second (if any) 1. */
  areas: [AreaId] | [AreaId, AreaId];
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: QuizOption[];
}

export const QUIZ: QuizQuestion[] = [
  {
    id: "class",
    prompt: "Which class do you look forward to most?",
    options: [
      { id: "math", label: "Math or computer science", areas: ["tech", "engineering"] },
      { id: "science", label: "Biology or chemistry", areas: ["health", "environment"] },
      { id: "physics", label: "Physics or shop / robotics", areas: ["engineering", "tech"] },
      { id: "english", label: "English or history", areas: ["humanities", "social"] },
      { id: "art", label: "Art, music, or media", areas: ["arts"] },
      { id: "econ", label: "Economics or business", areas: ["business", "social"] },
    ],
  },
  {
    id: "saturday",
    prompt: "On a free Saturday, you'd rather…",
    options: [
      { id: "build", label: "Build or code something", areas: ["tech", "engineering"] },
      { id: "help", label: "Volunteer or help someone out", areas: ["health", "social"] },
      { id: "create", label: "Draw, play music, or make videos", areas: ["arts"] },
      { id: "outside", label: "Be outside — hiking, beach, garden", areas: ["environment"] },
      { id: "read", label: "Read, write, or get into a debate", areas: ["humanities", "social"] },
      { id: "hustle", label: "Work on a side hustle", areas: ["business"] },
    ],
  },
  {
    id: "problem",
    prompt: "What kind of problem is most fun to work on?",
    options: [
      { id: "puzzle", label: "A tricky puzzle with a right answer", areas: ["tech", "engineering"] },
      { id: "people", label: "Figuring out why people act the way they do", areas: ["social", "humanities"] },
      { id: "design", label: "Making something look or feel great", areas: ["arts", "engineering"] },
      { id: "body", label: "How the body or a disease works", areas: ["health"] },
      { id: "planet", label: "A big issue like climate change", areas: ["environment", "social"] },
      { id: "money", label: "How to make a plan or business succeed", areas: ["business"] },
    ],
  },
  {
    id: "workplace",
    prompt: "Which place would you most like to work someday?",
    options: [
      { id: "lab", label: "A tech company or research lab", areas: ["tech", "health"] },
      { id: "clinic", label: "A hospital or clinic", areas: ["health"] },
      { id: "studio", label: "A studio or creative agency", areas: ["arts"] },
      { id: "field", label: "Outdoors, out in the field", areas: ["environment", "engineering"] },
      { id: "office", label: "An office or my own startup", areas: ["business", "tech"] },
      { id: "community", label: "A school, nonprofit, or government office", areas: ["social", "humanities"] },
    ],
  },
  {
    id: "role",
    prompt: "In a group project, you usually end up…",
    options: [
      { id: "builder", label: "Building the actual thing", areas: ["engineering", "tech"] },
      { id: "leader", label: "Organizing everyone and the timeline", areas: ["business", "social"] },
      { id: "designer", label: "Making the slides and visuals", areas: ["arts"] },
      { id: "researcher", label: "Doing the research", areas: ["health", "environment"] },
      { id: "writer", label: "Writing it up or presenting", areas: ["humanities"] },
    ],
  },
  {
    id: "impact",
    prompt: "Which kind of impact matters most to you?",
    options: [
      { id: "invent", label: "Inventing new tools and tech", areas: ["tech", "engineering"] },
      { id: "heal", label: "Keeping people healthy", areas: ["health"] },
      { id: "protect", label: "Protecting the planet", areas: ["environment"] },
      { id: "move", label: "Making people think or feel something", areas: ["arts", "humanities"] },
      { id: "justice", label: "Making communities fairer", areas: ["social", "humanities"] },
      { id: "grow", label: "Creating jobs and growing businesses", areas: ["business"] },
    ],
  },
];

/** Question id → chosen option id. */
export type QuizAnswers = Record<string, string>;

export function quizComplete(answers: QuizAnswers): boolean {
  return QUIZ.every((q) => q.options.some((o) => o.id === answers[q.id]));
}

export interface AreaScore {
  area: Area;
  score: number;
}

/** Areas ranked by points from the answers (ties keep the AREAS order). Unknown answers are ignored. */
export function scoreQuiz(answers: QuizAnswers): AreaScore[] {
  const points = Object.fromEntries(Object.keys(AREAS).map((id) => [id, 0])) as Record<AreaId, number>;
  for (const q of QUIZ) {
    const option = q.options.find((o) => o.id === answers[q.id]);
    if (!option) continue;
    option.areas.forEach((area, i) => {
      points[area] += i === 0 ? 2 : 1;
    });
  }
  return (Object.keys(AREAS) as AreaId[])
    .map((id) => ({ area: AREAS[id], score: points[id] }))
    .sort((a, b) => b.score - a.score);
}

/** The student's top areas: up to three with any points. */
export function topAreas(answers: QuizAnswers, count = 3): Area[] {
  return scoreQuiz(answers)
    .filter((s) => s.score > 0)
    .slice(0, count)
    .map((s) => s.area);
}

/** Starter question for Milo about the results. */
export function miloPrompt(areas: Area[]): string {
  const list = areas.map((a) => `${a.title} (${a.majors.join(", ")})`).join("; ");
  return `I took the major match survey and my top interest areas were: ${list}. Which of these majors fit me best, and what are they like at the UC campuses?`;
}
