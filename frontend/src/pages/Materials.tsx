import { href } from "../router";
import { FileIcon, UploadIcon } from "../components/icons";
import { CoursePlanTab } from "./CoursePlanTab";
import { EssayTab } from "./EssayTab";
import { TranscriptTab } from "./TranscriptTab";

const TABS = [
  { id: "essays", label: "Essays", Icon: FileIcon, blurb: "Your four UC Personal Insight Question drafts." },
  { id: "transcript", label: "Transcript", Icon: UploadIcon, blurb: "Upload and review your courses and grades." },
] as const;

export function Materials({ tab: param, onAsk }: { tab: string | null; onAsk: (text: string) => void }) {
  // Course plans are no longer a tab, but old links to them still open.
  const coursePlan = param === "plan";
  const tab = TABS.find((t) => t.id === param) ?? TABS[0];

  return (
    <div className="page-scroll">
      <div className="page-inner">
        <header className="page-head">
          <div>
            <h1>Materials</h1>
            <p>{coursePlan ? "A year-by-year high school course plan aimed at a UC campus." : tab.blurb}</p>
          </div>
        </header>

        <nav className="tabs" aria-label="Materials sections">
          {TABS.map(({ id, label, Icon }) => {
            const on = !coursePlan && id === tab.id;
            return (
              <a key={id} href={href("materials", id)} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
                <Icon width={15} height={15} /> {label}
              </a>
            );
          })}
        </nav>

        <div key={coursePlan ? "plan" : tab.id} className="tab-panel">
          {coursePlan ? <CoursePlanTab onAsk={onAsk} /> : tab.id === "essays" ? <EssayTab onAsk={onAsk} /> : <TranscriptTab onAsk={onAsk} />}
        </div>
      </div>
    </div>
  );
}
