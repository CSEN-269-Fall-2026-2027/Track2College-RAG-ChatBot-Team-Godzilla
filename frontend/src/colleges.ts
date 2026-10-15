export const REGIONS = [
  { id: "bay-area", label: "Bay Area" },
  { id: "socal", label: "Southern California" },
  { id: "central-coast", label: "Central Coast" },
  { id: "norcal-valley", label: "Sacramento, Central Valley & North" },
  { id: "pacific-nw", label: "Pacific Northwest" },
  { id: "southwest", label: "Southwest & Mountain West" },
  { id: "midwest", label: "Midwest" },
  { id: "south", label: "South & Texas" },
  { id: "mid-atlantic", label: "New York & Mid-Atlantic" },
  { id: "new-england", label: "New England" },
] as const;

export type RegionId = (typeof REGIONS)[number]["id"];
export type CollegeType = "public" | "private" | "community";

export interface College {
  name: string;
  city: string;
  state: string;
  region: RegionId;
  type: CollegeType;
  /** System or category tags, e.g. "UC", "CSU", "Ivy League", "Liberal arts". */
  tags: string[];
  website: string;
  /** The advisor's knowledge base has official pages for this school. */
  inKnowledgeBase?: boolean;
}

const c = (
  name: string,
  city: string,
  state: string,
  region: RegionId,
  type: CollegeType,
  website: string,
  tags: string[] = [],
  inKnowledgeBase = false,
): College => ({ name, city, state, region, type, website, tags, inKnowledgeBase });

export const COLLEGES: College[] = [
  // Bay Area
  c("UC Berkeley", "Berkeley", "CA", "bay-area", "public", "berkeley.edu", ["UC"]),
  c("Stanford University", "Stanford", "CA", "bay-area", "private", "stanford.edu"),
  c("Santa Clara University", "Santa Clara", "CA", "bay-area", "private", "scu.edu", [], true),
  c("San José State University", "San Jose", "CA", "bay-area", "public", "sjsu.edu", ["CSU"], true),
  c("San Francisco State University", "San Francisco", "CA", "bay-area", "public", "sfsu.edu", ["CSU"]),
  c("Cal State East Bay", "Hayward", "CA", "bay-area", "public", "csueastbay.edu", ["CSU"], true),
  c("Sonoma State University", "Rohnert Park", "CA", "bay-area", "public", "sonoma.edu", ["CSU"]),
  c("University of San Francisco", "San Francisco", "CA", "bay-area", "private", "usfca.edu"),
  c("Saint Mary's College of California", "Moraga", "CA", "bay-area", "private", "stmarys-ca.edu"),
  c("Dominican University of California", "San Rafael", "CA", "bay-area", "private", "dominican.edu"),
  c("De Anza College", "Cupertino", "CA", "bay-area", "community", "deanza.edu", ["Transfer pathway"]),
  c("Foothill College", "Los Altos Hills", "CA", "bay-area", "community", "foothill.edu", ["Transfer pathway"]),

  // Southern California
  c("UCLA", "Los Angeles", "CA", "socal", "public", "ucla.edu", ["UC"], true),
  c("UC San Diego", "La Jolla", "CA", "socal", "public", "ucsd.edu", ["UC"], true),
  c("UC Irvine", "Irvine", "CA", "socal", "public", "uci.edu", ["UC"]),
  c("UC Riverside", "Riverside", "CA", "socal", "public", "ucr.edu", ["UC"], true),
  c("University of Southern California", "Los Angeles", "CA", "socal", "private", "usc.edu"),
  c("Caltech", "Pasadena", "CA", "socal", "private", "caltech.edu"),
  c("Pomona College", "Claremont", "CA", "socal", "private", "pomona.edu", ["Liberal arts"]),
  c("Harvey Mudd College", "Claremont", "CA", "socal", "private", "hmc.edu", ["Liberal arts"]),
  c("Pepperdine University", "Malibu", "CA", "socal", "private", "pepperdine.edu"),
  c("Loyola Marymount University", "Los Angeles", "CA", "socal", "private", "lmu.edu"),
  c("University of San Diego", "San Diego", "CA", "socal", "private", "sandiego.edu"),
  c("Chapman University", "Orange", "CA", "socal", "private", "chapman.edu"),
  c("San Diego State University", "San Diego", "CA", "socal", "public", "sdsu.edu", ["CSU"]),
  c("Cal State Long Beach", "Long Beach", "CA", "socal", "public", "csulb.edu", ["CSU"], true),
  c("Cal State Fullerton", "Fullerton", "CA", "socal", "public", "fullerton.edu", ["CSU"], true),
  c("Cal State LA", "Los Angeles", "CA", "socal", "public", "calstatela.edu", ["CSU"], true),
  c("Cal State Northridge", "Northridge", "CA", "socal", "public", "csun.edu", ["CSU"]),
  c("Cal Poly Pomona", "Pomona", "CA", "socal", "public", "cpp.edu", ["CSU"]),
  c("CSU Dominguez Hills", "Carson", "CA", "socal", "public", "csudh.edu", ["CSU"], true),
  c("Santa Monica College", "Santa Monica", "CA", "socal", "community", "smc.edu", ["Transfer pathway"]),

  // Central Coast
  c("UC Santa Barbara", "Santa Barbara", "CA", "central-coast", "public", "ucsb.edu", ["UC"], true),
  c("UC Santa Cruz", "Santa Cruz", "CA", "central-coast", "public", "ucsc.edu", ["UC"]),
  c("Cal Poly San Luis Obispo", "San Luis Obispo", "CA", "central-coast", "public", "calpoly.edu", ["CSU"], true),
  c("CSU Monterey Bay", "Seaside", "CA", "central-coast", "public", "csumb.edu", ["CSU"]),

  // Sacramento, Central Valley & North
  c("UC Davis", "Davis", "CA", "norcal-valley", "public", "ucdavis.edu", ["UC"], true),
  c("UC Merced", "Merced", "CA", "norcal-valley", "public", "ucmerced.edu", ["UC"]),
  c("Sacramento State", "Sacramento", "CA", "norcal-valley", "public", "csus.edu", ["CSU"]),
  c("Fresno State", "Fresno", "CA", "norcal-valley", "public", "fresnostate.edu", ["CSU"], true),
  c("CSU Bakersfield", "Bakersfield", "CA", "norcal-valley", "public", "csub.edu", ["CSU"], true),
  c("CSU Stanislaus", "Turlock", "CA", "norcal-valley", "public", "csustan.edu", ["CSU"]),
  c("Chico State", "Chico", "CA", "norcal-valley", "public", "csuchico.edu", ["CSU"], true),
  c("Cal Poly Humboldt", "Arcata", "CA", "norcal-valley", "public", "humboldt.edu", ["CSU"]),
  c("University of the Pacific", "Stockton", "CA", "norcal-valley", "private", "pacific.edu"),

  // Pacific Northwest
  c("University of Washington", "Seattle", "WA", "pacific-nw", "public", "washington.edu"),
  c("Washington State University", "Pullman", "WA", "pacific-nw", "public", "wsu.edu"),
  c("Seattle University", "Seattle", "WA", "pacific-nw", "private", "seattleu.edu"),
  c("University of Oregon", "Eugene", "OR", "pacific-nw", "public", "uoregon.edu"),
  c("Oregon State University", "Corvallis", "OR", "pacific-nw", "public", "oregonstate.edu"),
  c("Reed College", "Portland", "OR", "pacific-nw", "private", "reed.edu", ["Liberal arts"]),
  c("University of Portland", "Portland", "OR", "pacific-nw", "private", "up.edu"),

  // Southwest & Mountain West
  c("Arizona State University", "Tempe", "AZ", "southwest", "public", "asu.edu"),
  c("University of Arizona", "Tucson", "AZ", "southwest", "public", "arizona.edu"),
  c("University of Colorado Boulder", "Boulder", "CO", "southwest", "public", "colorado.edu"),
  c("University of Denver", "Denver", "CO", "southwest", "private", "du.edu"),
  c("University of Utah", "Salt Lake City", "UT", "southwest", "public", "utah.edu"),
  c("University of Nevada, Reno", "Reno", "NV", "southwest", "public", "unr.edu"),
  c("UNLV", "Las Vegas", "NV", "southwest", "public", "unlv.edu"),

  // Midwest
  c("University of Michigan", "Ann Arbor", "MI", "midwest", "public", "umich.edu"),
  c("University of Illinois Urbana-Champaign", "Champaign", "IL", "midwest", "public", "illinois.edu"),
  c("University of Chicago", "Chicago", "IL", "midwest", "private", "uchicago.edu"),
  c("Northwestern University", "Evanston", "IL", "midwest", "private", "northwestern.edu"),
  c("University of Wisconsin–Madison", "Madison", "WI", "midwest", "public", "wisc.edu"),
  c("Purdue University", "West Lafayette", "IN", "midwest", "public", "purdue.edu"),
  c("University of Notre Dame", "Notre Dame", "IN", "midwest", "private", "nd.edu"),
  c("Ohio State University", "Columbus", "OH", "midwest", "public", "osu.edu"),
  c("University of Minnesota Twin Cities", "Minneapolis", "MN", "midwest", "public", "umn.edu"),
  c("Washington University in St. Louis", "St. Louis", "MO", "midwest", "private", "wustl.edu"),

  // South & Texas
  c("University of Texas at Austin", "Austin", "TX", "south", "public", "utexas.edu"),
  c("Texas A&M University", "College Station", "TX", "south", "public", "tamu.edu"),
  c("Rice University", "Houston", "TX", "south", "private", "rice.edu"),
  c("Georgia Tech", "Atlanta", "GA", "south", "public", "gatech.edu"),
  c("Emory University", "Atlanta", "GA", "south", "private", "emory.edu"),
  c("Spelman College", "Atlanta", "GA", "south", "private", "spelman.edu", ["HBCU", "Women's college", "Liberal arts"]),
  c("UNC Chapel Hill", "Chapel Hill", "NC", "south", "public", "unc.edu"),
  c("Duke University", "Durham", "NC", "south", "private", "duke.edu"),
  c("Vanderbilt University", "Nashville", "TN", "south", "private", "vanderbilt.edu"),
  c("University of Florida", "Gainesville", "FL", "south", "public", "ufl.edu"),
  c("University of Virginia", "Charlottesville", "VA", "south", "public", "virginia.edu"),

  // New York & Mid-Atlantic
  c("Columbia University", "New York", "NY", "mid-atlantic", "private", "columbia.edu", ["Ivy League"]),
  c("New York University", "New York", "NY", "mid-atlantic", "private", "nyu.edu"),
  c("Cornell University", "Ithaca", "NY", "mid-atlantic", "private", "cornell.edu", ["Ivy League"]),
  c("Princeton University", "Princeton", "NJ", "mid-atlantic", "private", "princeton.edu", ["Ivy League"]),
  c("Rutgers University–New Brunswick", "New Brunswick", "NJ", "mid-atlantic", "public", "rutgers.edu"),
  c("University of Pennsylvania", "Philadelphia", "PA", "mid-atlantic", "private", "upenn.edu", ["Ivy League"]),
  c("Carnegie Mellon University", "Pittsburgh", "PA", "mid-atlantic", "private", "cmu.edu"),
  c("Penn State", "University Park", "PA", "mid-atlantic", "public", "psu.edu"),
  c("Johns Hopkins University", "Baltimore", "MD", "mid-atlantic", "private", "jhu.edu"),
  c("University of Maryland", "College Park", "MD", "mid-atlantic", "public", "umd.edu"),
  c("Georgetown University", "Washington", "DC", "mid-atlantic", "private", "georgetown.edu"),
  c("Howard University", "Washington", "DC", "mid-atlantic", "private", "howard.edu", ["HBCU"]),

  // New England
  c("Harvard University", "Cambridge", "MA", "new-england", "private", "harvard.edu", ["Ivy League"]),
  c("MIT", "Cambridge", "MA", "new-england", "private", "mit.edu"),
  c("Boston University", "Boston", "MA", "new-england", "private", "bu.edu"),
  c("Northeastern University", "Boston", "MA", "new-england", "private", "northeastern.edu"),
  c("Boston College", "Chestnut Hill", "MA", "new-england", "private", "bc.edu"),
  c("Tufts University", "Medford", "MA", "new-england", "private", "tufts.edu"),
  c("Williams College", "Williamstown", "MA", "new-england", "private", "williams.edu", ["Liberal arts"]),
  c("Amherst College", "Amherst", "MA", "new-england", "private", "amherst.edu", ["Liberal arts"]),
  c("Wellesley College", "Wellesley", "MA", "new-england", "private", "wellesley.edu", ["Women's college", "Liberal arts"]),
  c("UMass Amherst", "Amherst", "MA", "new-england", "public", "umass.edu"),
  c("Yale University", "New Haven", "CT", "new-england", "private", "yale.edu", ["Ivy League"]),
  c("UConn", "Storrs", "CT", "new-england", "public", "uconn.edu"),
  c("Brown University", "Providence", "RI", "new-england", "private", "brown.edu", ["Ivy League"]),
  c("Dartmouth College", "Hanover", "NH", "new-england", "private", "dartmouth.edu", ["Ivy League"]),
  c("University of Vermont", "Burlington", "VT", "new-england", "public", "uvm.edu"),
];

export const COLLEGE_NAMES = COLLEGES.map((college) => college.name);

/** Picks the region a free-text preference like "Bay Area or Boston" most likely means. */
export function regionFromText(text: string): RegionId | null {
  const t = text.toLowerCase();
  const hints: [RegionId, RegExp][] = [
    ["bay-area", /bay area|san francisco|san jose|silicon valley|oakland|\bsf\b/],
    ["socal", /southern california|socal|los angeles|\bla\b|san diego|orange county/],
    ["central-coast", /central coast|santa barbara|santa cruz|san luis/],
    ["norcal-valley", /sacramento|central valley|northern california|norcal|fresno/],
    ["pacific-nw", /pacific northwest|seattle|portland|oregon|washington state/],
    ["southwest", /southwest|arizona|colorado|utah|nevada|mountain/],
    ["midwest", /midwest|chicago|michigan|ohio|illinois/],
    ["south", /south|texas|atlanta|georgia|carolina|florida/],
    ["mid-atlantic", /new york|mid-atlantic|philadelphia|\bnyc\b|\bdc\b|east coast/],
    ["new-england", /new england|boston|massachusetts|connecticut/],
  ];
  return hints.find(([, pattern]) => pattern.test(t))?.[0] ?? null;
}
