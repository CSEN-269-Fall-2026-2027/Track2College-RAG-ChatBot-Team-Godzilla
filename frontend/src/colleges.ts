/** University of California campuses — the only schools this app surfaces. */
export interface College {
  name: string;
  city: string;
  state: string;
  website: string;
}

const uc = (name: string, city: string, website: string): College => ({
  name,
  city,
  state: "CA",
  website,
});

export const COLLEGES: College[] = [
  uc("UC Berkeley", "Berkeley", "berkeley.edu"),
  uc("UCLA", "Los Angeles", "ucla.edu"),
  uc("UC San Diego", "La Jolla", "ucsd.edu"),
  uc("UC Davis", "Davis", "ucdavis.edu"),
  uc("UC Irvine", "Irvine", "uci.edu"),
  uc("UC Santa Barbara", "Santa Barbara", "ucsb.edu"),
  uc("UC Santa Cruz", "Santa Cruz", "ucsc.edu"),
  uc("UC Riverside", "Riverside", "ucr.edu"),
  uc("UC Merced", "Merced", "ucmerced.edu"),
];

export const COLLEGE_NAMES = COLLEGES.map((college) => college.name);
