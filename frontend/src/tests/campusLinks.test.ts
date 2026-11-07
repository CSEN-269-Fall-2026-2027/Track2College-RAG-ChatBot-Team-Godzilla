import { describe, expect, it } from "vitest";
import { COLLEGE_NAMES } from "../colleges";
import { UC_MAJORS } from "../constants";
import { campusLink, campusLinksFor } from "../campusLinks";

describe("Theo's campus links", () => {
  it("links to the major's page when the campus has one", () => {
    expect(campusLink("UC Davis", "Biology")).toEqual({ campus: "UC Davis", label: "UC Davis Biology", url: "https://biology.ucdavis.edu" });
  });

  it("falls back to the campus homepage with no major, Other, or no matching department", () => {
    for (const major of ["", "Other"]) {
      expect(campusLink("UCLA", major)).toEqual({ campus: "UCLA", label: "Visit UCLA", url: "https://www.ucla.edu" });
    }
    expect(campusLink("UC Berkeley", "Communication").url).toBe("https://www.berkeley.edu");
  });

  it("has an https link for every campus and major", () => {
    for (const campus of COLLEGE_NAMES) {
      for (const major of ["", "Other", ...UC_MAJORS]) expect(campusLink(campus, major).url).toMatch(/^https:\/\//);
    }
  });

  it("uses the campuses the student asked about, ignoring others in the answer", () => {
    const links = campusLinksFor("What's special about UC Santa Cruz?", "Unlike UCLA, Santa Cruz has redwoods.", "Sociology");
    expect(links.map((l) => l.campus)).toEqual(["UC Santa Cruz"]);
  });

  it("links to the major named in the question over the student's own", () => {
    const links = campusLinksFor("What's Sociology like at UCLA and UC Davis?", "", "Biology");
    expect(links.map((l) => l.label)).toEqual(["UCLA Sociology", "UC Davis Sociology"]);
  });

  it("uses the campuses in the answer when the student named none", () => {
    const links = campusLinksFor("Tell me a little about each UC campus.", "UCSD is coastal. UC Merced is the newest.", "");
    expect(links.map((l) => l.campus)).toEqual(["UC San Diego", "UC Merced"]);
  });

  it("adds no buttons when no campus comes up, and doesn't read Cal Grant as Berkeley", () => {
    expect(campusLinksFor("How does a Cal Grant work?", "It helps pay tuition.", "Biology")).toEqual([]);
  });
});
