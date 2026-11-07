import { COLLEGE_NAMES } from "./colleges";
import { UC_MAJORS } from "./constants";

export interface CampusLink {
  campus: string;
  /** Button text: the campus and major when there's a department page, else just the campus. */
  label: string;
  url: string;
}

/** Each campus's homepage, the link when a major has no page of its own there. */
const HOME: Record<string, string> = {
  "UC Berkeley": "https://www.berkeley.edu",
  UCLA: "https://www.ucla.edu",
  "UC San Diego": "https://ucsd.edu",
  "UC Davis": "https://www.ucdavis.edu",
  "UC Irvine": "https://uci.edu",
  "UC Santa Barbara": "https://www.ucsb.edu",
  "UC Santa Cruz": "https://www.ucsc.edu",
  "UC Riverside": "https://www.ucr.edu",
  "UC Merced": "https://www.ucmerced.edu",
};

/**
 * Campus → major choice (see UC_MAJORS) → the closest department or school page. A major left out
 * has no clear match at that campus (e.g. Communication at UC Berkeley), so it links to HOME.
 * UC Merced's links are its schools, which house those majors.
 */
const MAJOR_PAGES: Record<string, Record<string, string>> = {
  "UC Berkeley": {
    Biology: "https://mcb.berkeley.edu",
    "Computer Science": "https://eecs.berkeley.edu",
    Psychology: "https://psychology.berkeley.edu",
    Economics: "https://econ.berkeley.edu",
    Business: "https://haas.berkeley.edu/undergrad/",
    Engineering: "https://engineering.berkeley.edu",
    "Political Science": "https://polisci.berkeley.edu",
    Sociology: "https://sociology.berkeley.edu",
    Mathematics: "https://math.berkeley.edu",
  },
  UCLA: {
    Biology: "https://lifesciences.ucla.edu",
    "Computer Science": "https://www.cs.ucla.edu",
    Psychology: "https://www.psych.ucla.edu",
    Economics: "https://economics.ucla.edu",
    Business: "https://economics.ucla.edu",
    Engineering: "https://samueli.ucla.edu",
    "Political Science": "https://polisci.ucla.edu",
    Sociology: "https://soc.ucla.edu",
    Communication: "https://comm.ucla.edu",
    Mathematics: "https://ww3.math.ucla.edu",
  },
  "UC San Diego": {
    Biology: "https://biology.ucsd.edu",
    "Computer Science": "https://cse.ucsd.edu",
    Psychology: "https://psychology.ucsd.edu",
    Economics: "https://economics.ucsd.edu",
    Business: "https://rady.ucsd.edu",
    Engineering: "https://jacobsschool.ucsd.edu",
    "Political Science": "https://polisci.ucsd.edu",
    Sociology: "https://sociology.ucsd.edu",
    Communication: "https://communication.ucsd.edu",
    Mathematics: "https://math.ucsd.edu",
  },
  "UC Davis": {
    Biology: "https://biology.ucdavis.edu",
    "Computer Science": "https://cs.ucdavis.edu",
    Psychology: "https://psychology.ucdavis.edu",
    Economics: "https://economics.ucdavis.edu",
    Engineering: "https://engineering.ucdavis.edu",
    "Political Science": "https://ps.ucdavis.edu",
    Sociology: "https://sociology.ucdavis.edu",
    Communication: "https://communication.ucdavis.edu",
    Mathematics: "https://www.math.ucdavis.edu",
  },
  "UC Irvine": {
    Biology: "https://www.bio.uci.edu",
    "Computer Science": "https://cs.ics.uci.edu",
    Psychology: "https://www.psychology.uci.edu",
    Economics: "https://www.economics.uci.edu",
    Business: "https://merage.uci.edu",
    Engineering: "https://engineering.uci.edu",
    "Political Science": "https://www.polisci.uci.edu",
    Sociology: "https://www.sociology.uci.edu",
    Mathematics: "https://math.uci.edu",
  },
  "UC Santa Barbara": {
    Biology: "https://biology.ucsb.edu",
    "Computer Science": "https://cs.ucsb.edu",
    Psychology: "https://psych.ucsb.edu",
    Economics: "https://econ.ucsb.edu",
    Business: "https://tmp.ucsb.edu",
    Engineering: "https://engineering.ucsb.edu",
    "Political Science": "https://www.polsci.ucsb.edu",
    Sociology: "https://www.soc.ucsb.edu",
    Communication: "https://www.comm.ucsb.edu",
    Mathematics: "https://www.math.ucsb.edu",
  },
  "UC Santa Cruz": {
    Biology: "https://mcd.ucsc.edu",
    "Computer Science": "https://engineering.ucsc.edu/departments/computer-science-and-engineering/",
    Psychology: "https://psychology.ucsc.edu",
    Economics: "https://economics.ucsc.edu",
    Business: "https://economics.ucsc.edu",
    Engineering: "https://engineering.ucsc.edu",
    "Political Science": "https://politics.ucsc.edu",
    Sociology: "https://sociology.ucsc.edu",
    Mathematics: "https://math.ucsc.edu",
  },
  "UC Riverside": {
    Biology: "https://eeob.ucr.edu",
    "Computer Science": "https://www1.cs.ucr.edu",
    Psychology: "https://psychologicalbrainsciences.ucr.edu",
    Economics: "https://economics.ucr.edu",
    Business: "https://business.ucr.edu",
    Engineering: "https://engr.ucr.edu",
    "Political Science": "https://politicalscience.ucr.edu",
    Sociology: "https://sociology.ucr.edu",
    Mathematics: "https://mathdept.ucr.edu",
  },
  "UC Merced": {
    Biology: "https://naturalsciences.ucmerced.edu",
    "Computer Science": "https://engineering.ucmerced.edu",
    Psychology: "https://ssha.ucmerced.edu",
    Economics: "https://ssha.ucmerced.edu",
    Business: "https://gallo.ucmerced.edu",
    Engineering: "https://engineering.ucmerced.edu",
    "Political Science": "https://ssha.ucmerced.edu",
    Sociology: "https://ssha.ucmerced.edu",
    Mathematics: "https://naturalsciences.ucmerced.edu",
  },
};

/** How a student or Theo may name each campus. "Cal" is left out: it also means Cal Grant. */
const CAMPUS_NAMES: Record<string, RegExp> = {
  "UC Berkeley": /\bberkeley\b/i,
  UCLA: /\bucla\b/i,
  "UC San Diego": /\b(ucsd|san diego)\b/i,
  "UC Davis": /\b(ucd|davis)\b/i,
  "UC Irvine": /\b(uci|irvine)\b/i,
  "UC Santa Barbara": /\b(ucsb|santa barbara)\b/i,
  "UC Santa Cruz": /\b(ucsc|santa cruz)\b/i,
  "UC Riverside": /\b(ucr|riverside)\b/i,
  "UC Merced": /\bmerced\b/i,
};

const campusesIn = (text: string) => COLLEGE_NAMES.filter((name) => CAMPUS_NAMES[name].test(text));

/** The website button for one campus: its page for the major, or its homepage. */
export function campusLink(campus: string, major: string): CampusLink {
  const page = MAJOR_PAGES[campus]?.[major];
  return page ? { campus, label: `${campus} ${major}`, url: page } : { campus, label: `Visit ${campus}`, url: HOME[campus] };
}

/**
 * The campuses a Theo answer is about: the ones the student asked about, or if they named none
 * ("Tell me about each UC"), the ones the answer covers. This keeps a passing comparison in the
 * answer from adding a button. A major named in the question wins over the student's own, so
 * "What's Biology like at UCLA?" links to UCLA Biology.
 */
export function campusLinksFor(question: string, answer: string, major: string): CampusLink[] {
  const asked = campusesIn(question);
  const askedMajor = UC_MAJORS.find((m) => new RegExp(`\\b${m}\\b`, "i").test(question));
  return (asked.length ? asked : campusesIn(answer)).map((campus) => campusLink(campus, askedMajor ?? major));
}
