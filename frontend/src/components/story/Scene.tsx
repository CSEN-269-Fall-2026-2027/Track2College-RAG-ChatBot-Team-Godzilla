import { memo } from "react";
import type { SceneId } from "../../game/characters";

/** Quiet, plain backdrop — soft wash, no illustrated campus clutter. */
export const Scene = memo(function Scene({ scene }: { scene: SceneId }) {
  return <div className={`scene scene-plain scene-${scene}`} aria-hidden="true" />;
});
