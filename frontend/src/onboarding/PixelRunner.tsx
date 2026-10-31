/**
 * Replaceable local pixel-style student. No sprite sheet existed in the repo;
 * this is a hand-drawn 3-frame SVG run cycle (idle / run-a / run-b).
 */
export type RunnerPose = "idle" | "run-a" | "run-b" | "jump";

interface PixelRunnerProps {
  pose?: RunnerPose;
  className?: string;
}

export function PixelRunner({ pose = "idle", className = "" }: PixelRunnerProps) {
  return (
    <svg
      className={`ob-pixel ${className}`}
      viewBox="0 0 16 20"
      width="40"
      height="50"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {/* shadow */}
      <rect x="3" y="18" width="10" height="2" fill="rgba(0,0,0,0.18)" />
      {/* legs */}
      {pose === "jump" ? (
        <>
          <rect x="5" y="14" width="2" height="3" fill="#2a3d36" />
          <rect x="9" y="14" width="2" height="3" fill="#2a3d36" />
        </>
      ) : pose === "run-a" ? (
        <>
          <rect x="4" y="14" width="2" height="4" fill="#2a3d36" />
          <rect x="10" y="13" width="2" height="3" fill="#2a3d36" />
          <rect x="3" y="17" width="3" height="2" fill="#0f6b5c" />
          <rect x="10" y="16" width="3" height="2" fill="#0f6b5c" />
        </>
      ) : pose === "run-b" ? (
        <>
          <rect x="10" y="14" width="2" height="4" fill="#2a3d36" />
          <rect x="4" y="13" width="2" height="3" fill="#2a3d36" />
          <rect x="10" y="17" width="3" height="2" fill="#0f6b5c" />
          <rect x="3" y="16" width="3" height="2" fill="#0f6b5c" />
        </>
      ) : (
        <>
          <rect x="5" y="14" width="2" height="4" fill="#2a3d36" />
          <rect x="9" y="14" width="2" height="4" fill="#2a3d36" />
          <rect x="4" y="17" width="3" height="2" fill="#0f6b5c" />
          <rect x="9" y="17" width="3" height="2" fill="#0f6b5c" />
        </>
      )}
      {/* torso */}
      <rect x="4" y={pose === "jump" ? 7 : 8} width="8" height="7" fill="#1a8f7a" />
      <rect x="5" y={pose === "jump" ? 9 : 10} width="6" height="3" fill="#e8f4f0" />
      {/* arms */}
      {pose === "run-a" ? (
        <>
          <rect x="2" y="9" width="2" height="4" fill="#c48a6a" />
          <rect x="12" y="10" width="2" height="3" fill="#c48a6a" />
        </>
      ) : pose === "run-b" ? (
        <>
          <rect x="12" y="9" width="2" height="4" fill="#c48a6a" />
          <rect x="2" y="10" width="2" height="3" fill="#c48a6a" />
        </>
      ) : pose === "jump" ? (
        <>
          <rect x="2" y="7" width="2" height="3" fill="#c48a6a" />
          <rect x="12" y="7" width="2" height="3" fill="#c48a6a" />
        </>
      ) : (
        <>
          <rect x="2" y="9" width="2" height="4" fill="#c48a6a" />
          <rect x="12" y="9" width="2" height="4" fill="#c48a6a" />
        </>
      )}
      {/* head */}
      <rect x="5" y={pose === "jump" ? 1 : 2} width="6" height="6" fill="#e0b090" />
      <rect x="6" y={pose === "jump" ? 3 : 4} width="1" height="1" fill="#14241f" />
      <rect x="9" y={pose === "jump" ? 3 : 4} width="1" height="1" fill="#14241f" />
      <rect x="7" y={pose === "jump" ? 5 : 6} width="2" height="1" fill="#c45c3e" />
      {/* hair */}
      <rect x="5" y={pose === "jump" ? 0 : 1} width="6" height="2" fill="#3b2a1e" />
      <rect x="4" y={pose === "jump" ? 1 : 2} width="1" height="2" fill="#3b2a1e" />
      <rect x="11" y={pose === "jump" ? 1 : 2} width="1" height="2" fill="#3b2a1e" />
    </svg>
  );
}
