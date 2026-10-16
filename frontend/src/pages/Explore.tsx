import { useMemo, useState } from "react";
import { COLLEGES, REGIONS, regionFromText, type College, type CollegeType, type RegionId } from "../colleges";
import { useProfile } from "../profile";
import { href } from "../router";
import { newId } from "../storage";
import { ChatIcon, CheckIcon, ExternalIcon, PlusIcon } from "../components/icons";

const TYPES: { id: CollegeType | "all"; label: string }[] = [
  { id: "all", label: "All types" },
  { id: "public", label: "Public" },
  { id: "private", label: "Private" },
  { id: "community", label: "Community college" },
];

const TAGS = ["UC", "CSU", "Ivy League", "Liberal arts", "HBCU", "Women's college", "Transfer pathway"];
const TYPE_LABEL: Record<CollegeType, string> = { public: "Public", private: "Private", community: "Community college" };

function toCatalogCollege(name: string): College {
  const known = COLLEGES.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (known) return known;
  return {
    name,
    city: "",
    state: "",
    website: "",
    type: "private",
    region: "bay-area",
    tags: [],
    inKnowledgeBase: false,
  };
}

export function Explore({ onAsk }: { onAsk: (text: string) => void }) {
  const { profile, update } = useProfile();
  const [region, setRegion] = useState<RegionId | "all">(() => regionFromText(profile.preferences.regions) ?? "all");
  const [type, setType] = useState<CollegeType | "all">("all");
  const [tag, setTag] = useState("");
  const [query, setQuery] = useState("");
  const [advisorOnly, setAdvisorOnly] = useState(false);
  const [listOnly, setListOnly] = useState(false);

  const onList = useMemo(() => new Set(profile.colleges.map((c) => c.name.toLowerCase())), [profile.colleges]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const source = listOnly ? profile.colleges.map((c) => toCatalogCollege(c.name)) : COLLEGES;
    return source.filter(
      (c) =>
        (region === "all" || c.region === region) &&
        (type === "all" || c.type === type) &&
        (!tag || c.tags.includes(tag)) &&
        (!advisorOnly || c.inKnowledgeBase) &&
        (!q || `${c.name} ${c.city} ${c.state}`.toLowerCase().includes(q)),
    );
  }, [region, type, tag, query, advisorOnly, listOnly, profile.colleges]);

  const groups = useMemo(
    () =>
      listOnly
        ? [{ id: "list" as const, label: "My list", colleges: filtered }]
        : REGIONS.map((r) => ({ ...r, colleges: filtered.filter((c) => c.region === r.id) })).filter((g) => g.colleges.length > 0),
    [filtered, listOnly],
  );

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const college of COLLEGES) result[college.region] = (result[college.region] ?? 0) + 1;
    return result;
  }, []);

  const toggle = (college: College) =>
    update((p) =>
      onList.has(college.name.toLowerCase())
        ? { ...p, colleges: p.colleges.filter((c) => c.name.toLowerCase() !== college.name.toLowerCase()) }
        : { ...p, colleges: [...p.colleges, { id: newId(), name: college.name, status: "researching", plan: "", deadline: "", notes: "" }] },
    );

  const regionLabel = REGIONS.find((r) => r.id === region)?.label;

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <header className="page-head">
          <div>
            <h1>Explore colleges</h1>
            <p>Browse schools by region, add them to your list, then review them under Insights.</p>
          </div>
          {profile.colleges.length > 0 && (
            <button className={`btn-ghost ${listOnly ? "added" : ""}`} onClick={() => setListOnly((v) => !v)} aria-pressed={listOnly}>
              <CheckIcon width={15} height={15} />
              {listOnly ? `Showing my list (${profile.colleges.length})` : `My list (${profile.colleges.length})`}
            </button>
          )}
        </header>

        {!listOnly && (
          <div className="region-chips" role="tablist" aria-label="Region">
            <button role="tab" aria-selected={region === "all"} className={region === "all" ? "on" : ""} onClick={() => setRegion("all")}>
              All regions <span>{COLLEGES.length}</span>
            </button>
            {REGIONS.map((r) => (
              <button key={r.id} role="tab" aria-selected={region === r.id} className={region === r.id ? "on" : ""} onClick={() => setRegion(r.id)}>
                {r.label} <span>{counts[r.id]}</span>
              </button>
            ))}
          </div>
        )}

        <div className="filter-bar">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or city" aria-label="Search colleges" />
          <select value={type} onChange={(e) => setType(e.target.value as CollegeType | "all")} aria-label="Type">
            {TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Category" className={tag ? "" : "placeholder"}>
            <option value="">Any category</option>
            {TAGS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <label className="check-toggle">
            <input type="checkbox" checked={advisorOnly} onChange={(e) => setAdvisorOnly(e.target.checked)} />
            Advisor has official info
          </label>
          <label className="check-toggle">
            <input type="checkbox" checked={listOnly} onChange={(e) => setListOnly(e.target.checked)} />
            My list only
          </label>
        </div>

        {listOnly && (
          <div className="region-banner">
            <span>
              These schools also show on <a href={href("insights")}>Insights → Readiness</a>. Edit deadlines and status in{" "}
              <a href={href("profile", "colleges")}>Profile</a>.
            </span>
          </div>
        )}

        {!listOnly && region !== "all" && (
          <div className="region-banner">
            <span>
              Want help narrowing down <strong>{regionLabel}</strong> schools?
            </span>
            <button className="btn-ghost" onClick={() => onAsk(`Which colleges in the ${regionLabel} might be a good fit for me, and why?`)}>
              <ChatIcon width={15} height={15} /> Ask the advisor
            </button>
          </div>
        )}

        {groups.length === 0 || filtered.length === 0 ? (
          <p className="list-empty explore-empty">
            {listOnly ? (
              <>
                Your list is empty. Turn off “My list only” and add schools, or <a href={href("profile", "colleges")}>add them in Profile</a>.
              </>
            ) : (
              "No colleges match those filters."
            )}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.id} className="college-group">
              {(listOnly || region === "all") && (
                <h2 className="group-title">
                  {group.label} <span>{group.colleges.length}</span>
                </h2>
              )}
              <div className="college-grid">
                {group.colleges.map((college) => {
                  const added = onList.has(college.name.toLowerCase());
                  return (
                    <article key={college.name} className="college-card">
                      <div className="college-card-top">
                        <div>
                          <h3>{college.name}</h3>
                          <p>
                            {[college.city, college.state].filter(Boolean).join(", ") || "Added to your list"}
                          </p>
                        </div>
                        {college.website && (
                          <a href={`https://${college.website}`} target="_blank" rel="noreferrer" className="icon-btn" aria-label={`${college.name} website`} title={college.website}>
                            <ExternalIcon width={16} height={16} />
                          </a>
                        )}
                      </div>
                      <div className="college-tags">
                        <span className={`ctag ctag-${college.type}`}>{TYPE_LABEL[college.type]}</span>
                        {college.tags.map((t) => (
                          <span key={t} className="ctag">
                            {t}
                          </span>
                        ))}
                        {college.inKnowledgeBase && <span className="ctag ctag-kb">Advisor ready</span>}
                      </div>
                      <div className="college-actions">
                        <button className={added ? "btn-ghost added" : "btn-ghost"} onClick={() => toggle(college)} aria-pressed={added}>
                          {added ? <CheckIcon width={15} height={15} /> : <PlusIcon width={15} height={15} />}
                          {added ? "On my list" : "Add to list"}
                        </button>
                        <button className="link-btn" onClick={() => onAsk(`Tell me about applying to ${college.name}.`)}>
                          <ChatIcon width={13} height={13} /> Ask
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
