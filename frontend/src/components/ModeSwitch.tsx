import { useGame } from "../game/GameProvider";

/** Story ↔ Manual toggle used on Advisor. */
export function ModeSwitch({ className = "" }: { className?: string }) {
  const { state, updateSettings } = useGame();
  const storyMode = state.storyMode;

  return (
    <div className={`mode-switch ${className}`.trim()} role="tablist" aria-label="Advisor mode">
      <button
        type="button"
        role="tab"
        aria-selected={storyMode}
        className={storyMode ? "on" : undefined}
        onClick={() => updateSettings({ storyMode: true })}
      >
        Story
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={!storyMode}
        className={!storyMode ? "on" : undefined}
        onClick={() => updateSettings({ storyMode: false })}
      >
        Manual
      </button>
    </div>
  );
}
