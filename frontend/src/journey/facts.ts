/**
 * UC fun facts for story mode's Review & Apply step: each is a question with one true answer
 * and three false ones. Only long-standing UC rules go here; the deadline comes from the same
 * helper the Apply page's countdown uses, so the two never disagree.
 */

export interface UcFact {
  id: string;
  question: string;
  answer: string;
  wrong: [string, string, string];
  /** One line shown after the student answers. */
  why: string;
}

/** `deadline` is the application deadline as shown elsewhere in the app, e.g. "November 30". */
export function ucFacts(deadline: string): UcFact[] {
  return [
    {
      id: "tests",
      question: "Does UC use SAT or ACT scores to decide admission?",
      answer: "No, UC doesn't use them at all",
      wrong: ["Yes, both are required", "Only the SAT counts", "Only for out-of-state students"],
      why: "UC is test-blind: SAT and ACT scores aren't part of admission decisions.",
    },
    {
      id: "deadline",
      question: "When is the UC application due?",
      answer: deadline,
      wrong: ["October 1", "January 1", "March 2"],
      why: `Applications are due ${deadline} at 11:59 PM Pacific. October 1 is when you can start submitting.`,
    },
    {
      id: "campuses",
      question: "How many UC campuses does one application cover?",
      answer: "9",
      wrong: ["1", "5", "10"],
      why: "One application reaches all nine undergraduate campuses. You pick which ones get it.",
    },
    {
      id: "piqs",
      question: "How many Personal Insight Questions do you answer?",
      answer: "4 of the 8",
      wrong: ["All 8", "2 of the 4", "Just 1 essay"],
      why: "You choose four of the eight questions. No question is worth more than another.",
    },
    {
      id: "words",
      question: "What's the word limit for each Personal Insight answer?",
      answer: "350 words",
      wrong: ["250 words", "500 words", "650 words"],
      why: "Each answer can be up to 350 words.",
    },
    {
      id: "activities",
      question: "How many activities and awards can you list?",
      answer: "Up to 20",
      wrong: ["Up to 5", "Up to 10", "Unlimited"],
      why: "There's room for 20 entries, but quality matters more than filling every slot.",
    },
    {
      id: "waiver",
      question: "How many campuses can a UC fee waiver cover?",
      answer: "Up to 4",
      wrong: ["Just 1", "Up to 2", "All 9"],
      why: "Eligible students can get application fees waived for up to four campuses.",
    },
    {
      id: "gpa",
      question: "What's the minimum GPA in A–G courses for California residents?",
      answer: "3.0",
      wrong: ["2.0", "3.5", "4.0"],
      why: "California residents need at least a 3.0 in A–G courses (3.4 for non-residents).",
    },
  ];
}

/** A shuffled copy (Fisher–Yates). */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
