import { useState } from "react";
import { GoogleActivitiesConfirm } from "./story/GoogleActivitiesConfirm";
import { useGoogleActivities } from "../googleActivities";

/** Profile control: re-scan Gmail/Calendar and confirm additions. */
export function GoogleGrabPanel() {
  const { status, error, scan, suggestions } = useGoogleActivities();
  const [showConfirm, setShowConfirm] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const grab = async () => {
    setNote(null);
    setShowConfirm(false);
    const items = await scan({ force: true });
    if (!items.length) {
      setNote(error || "No new activities found in recent email or calendar. Connect Google in onboarding if you haven’t.");
      return;
    }
    setShowConfirm(true);
  };

  return (
    <div className="pf-google-grab">
      <div className="pf-google-grab-bar">
        <button type="button" className="btn-ghost pf-grab-again" onClick={() => void grab()} disabled={status === "scanning"}>
          {status === "scanning" ? "Grabbing…" : "Grab again"}
        </button>
        <span className="pf-google-grab-hint">Pull activities from connected Gmail &amp; Calendar</span>
      </div>
      {note && (
        <p className="pf-google-grab-note" role="status">
          {note}
        </p>
      )}
      {showConfirm && suggestions.length > 0 && (
        <GoogleActivitiesConfirm
          suggestions={suggestions}
          onDone={() => {
            setShowConfirm(false);
            setNote("Saved selections to your profile.");
          }}
        />
      )}
    </div>
  );
}
