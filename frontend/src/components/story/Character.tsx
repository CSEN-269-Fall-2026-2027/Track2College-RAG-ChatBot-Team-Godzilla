import { memo, useEffect, useState, type ReactNode } from "react";
import type { Mood } from "../../types";
import type { Mentor } from "../../game/characters";

interface CharacterProps {
  mentor: Mentor;
  mood: Mood;
  talking?: boolean;
  size?: number;
  className?: string;
}

/** Pixel portrait assets (public/mentors). */
const PIXEL_SRC: Partial<Record<Mentor["id"], string>> = {
  sage: "/mentors/sage.png?v=5",
  theo: "/mentors/theo.png",
  penny: "/mentors/penny.png",
  quill: "/mentors/quill.png",
  milo: "/mentors/milo.png",
  counselor: "/mentors/counselor.png",
  assistant: "/mentors/assistant.png",
};

/**
 * Mentors: pixel sprites when available, otherwise cartoon SVG humans.
 */
export const Character = memo(function Character({ mentor, mood, talking = false, size = 280, className = "" }: CharacterProps) {
  const pixel = PIXEL_SRC[mentor.id];
  if (pixel) {
    return (
      <img
        className={`mentor mentor-pixel mentor-${mentor.id} mood-${mood} ${talking ? "is-talking" : ""} ${className}`}
        src={pixel}
        alt={`${mentor.name}, looking ${mood}`}
        width={size}
        height={size}
        draggable={false}
      />
    );
  }

  const mouthOpen = useMouthFlap(talking);
  const look = LOOK[mentor.id as "penny" | "quill"];

  return (
    <svg
      className={`mentor mentor-human mentor-${mentor.id} mood-${mood} ${talking ? "is-talking" : ""} ${className}`}
      viewBox="0 0 240 320"
      width={size}
      height={size * (320 / 240)}
      role="img"
      aria-label={`${mentor.name}, looking ${mood}`}
    >
      <ellipse className="mentor-shadow" cx={120} cy={308} rx={58} ry={8} fill="#000" opacity={0.12} />
      <g className="mentor-body">
        <ellipse cx={120} cy={250} rx={62} ry={48} fill={look.jacket} />
        <path d="M70 230 Q120 248 170 230 L168 268 Q120 292 72 268 Z" fill={look.shirt} />
        {look.trim && <path d="M78 236 H162" stroke={look.trim} strokeWidth={6} strokeLinecap="round" />}
        {look.prop}
        <ellipse cx={78} cy={248} rx={14} ry={22} fill={look.skin} transform="rotate(18 78 248)" />
        <ellipse cx={162} cy={248} rx={14} ry={22} fill={look.skin} transform="rotate(-18 162 248)" />

        <g className="mentor-head">
          {look.hairBack}
          <ellipse cx={120} cy={128} rx={58} ry={64} fill={look.skin} />
          <ellipse cx={88} cy={148} rx={10} ry={6} fill="#ff9aaa" opacity={0.55} />
          <ellipse cx={152} cy={148} rx={10} ry={6} fill="#ff9aaa" opacity={0.55} />
          <Eyes mood={mood} />
          <Brows mood={mood} color={look.hair} />
          <Mouth mood={mood} open={mouthOpen} />
          {look.hairFront}
          {look.accessory}
        </g>
      </g>
      <MoodEffects mood={mood} />
    </svg>
  );
});

interface Look {
  skin: string;
  hair: string;
  jacket: string;
  shirt: string;
  trim?: string;
  hairBack: ReactNode;
  hairFront: ReactNode;
  accessory: ReactNode;
  prop: ReactNode;
}

const LOOK: Record<"penny" | "quill", Look> = {
  penny: {
    skin: "#8d5524",
    hair: "#8b3a1a",
    jacket: "#5a9a6a",
    shirt: "#fff6e8",
    hairBack: (
      <g fill="#8b3a1a">
        <circle cx={78} cy={110} r={22} />
        <circle cx={162} cy={110} r={22} />
        <circle cx={96} cy={78} r={20} />
        <circle cx={144} cy={76} r={22} />
        <circle cx={120} cy={68} r={24} />
        <circle cx={70} cy={138} r={16} />
        <circle cx={170} cy={138} r={16} />
      </g>
    ),
    hairFront: (
      <g fill="#8b3a1a">
        <circle cx={100} cy={86} r={14} />
        <circle cx={140} cy={86} r={14} />
      </g>
    ),
    accessory: <circle cx={168} cy={92} r={7} fill="#f2c94c" stroke="#c9a227" strokeWidth={2} />,
    prop: (
      <g transform="translate(58 228)">
        <rect x={0} y={8} width={28} height={22} rx={4} fill="#2c2c34" />
        <rect x={3} y={11} width={22} height={8} rx={2} fill="#9fe0b0" />
        <circle cx={8} cy={26} r={2} fill="#666" />
        <circle cx={14} cy={26} r={2} fill="#666" />
        <circle cx={20} cy={26} r={2} fill="#666" />
      </g>
    ),
  },
  quill: {
    skin: "#e8c4a2",
    hair: "#1a1a22",
    jacket: "#2f3a55",
    shirt: "#f7f4ef",
    hairBack: (
      <g fill="#1a1a22">
        <ellipse cx={120} cy={86} rx={54} ry={40} />
        <path d="M66 120 Q62 160 78 176" stroke="#1a1a22" strokeWidth={14} fill="none" strokeLinecap="round" />
        <path d="M174 118 Q180 155 164 174" stroke="#1a1a22" strokeWidth={14} fill="none" strokeLinecap="round" />
      </g>
    ),
    hairFront: (
      <g fill="#1a1a22">
        <path d="M74 108 Q100 78 128 100 Q146 78 168 108 Q140 96 120 108 Q100 96 74 108 Z" />
        <path d="M88 100 Q110 118 120 108" opacity={0.85} />
      </g>
    ),
    accessory: null,
    prop: (
      <g transform="translate(156 232)">
        <rect x={0} y={4} width={26} height={34} rx={3} fill="#f5f0e6" stroke="#1f2433" strokeOpacity={0.2} />
        <path d="M22 -2 L28 40" stroke="#1f2433" strokeWidth={3} strokeLinecap="round" />
        <path d="M22 -2 L18 -8 L28 -4 Z" fill="#b7791f" />
      </g>
    ),
  },
};

function useMouthFlap(talking: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!talking || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setOpen(false);
      return;
    }
    const id = window.setInterval(() => setOpen((o) => !o), 120);
    return () => window.clearInterval(id);
  }, [talking]);
  return open;
}

function Eyes({ mood }: { mood: Mood }) {
  const left = 98;
  const right = 142;
  const y = 128;
  if (mood === "happy") {
    return (
      <g fill="none" stroke="#1f1a16" strokeWidth={4} strokeLinecap="round">
        <path d={`M${left - 10} ${y + 2} Q${left} ${y - 10} ${left + 10} ${y + 2}`} />
        <path d={`M${right - 10} ${y + 2} Q${right} ${y - 10} ${right + 10} ${y + 2}`} />
      </g>
    );
  }
  const big = mood === "excited";
  const ry = big ? 13 : mood === "concerned" ? 10 : 11.5;
  const look = mood === "thinking" ? { x: -3, y: -3 } : { x: 0, y: 0 };
  return (
    <g>
      {[left, right].map((x) => (
        <g key={x}>
          <ellipse cx={x + look.x} cy={y + look.y} rx={big ? 12 : 10} ry={ry} fill="#fff" stroke="#1f1a16" strokeWidth={3} />
          <ellipse cx={x + look.x} cy={y + look.y + 1} rx={5.5} ry={6.5} fill="#3d2914" />
          <circle cx={x + look.x + 2.5} cy={y + look.y - 3} r={2.4} fill="#fff" />
        </g>
      ))}
    </g>
  );
}

function Brows({ mood, color }: { mood: Mood; color: string }) {
  const paths: Record<Mood, [string, string]> = {
    neutral: ["M86 108 Q98 102 110 108", "M130 108 Q142 102 154 108"],
    happy: ["M86 110 Q98 102 110 108", "M130 108 Q142 102 154 110"],
    excited: ["M86 102 Q98 94 110 102", "M130 102 Q142 94 154 102"],
    thinking: ["M86 110 L110 106", "M130 100 Q142 92 154 100"],
    concerned: ["M86 112 L110 102", "M130 102 L154 112"],
  };
  return (
    <g fill="none" stroke={color} strokeWidth={3.2} strokeLinecap="round">
      <path d={paths[mood][0]} />
      <path d={paths[mood][1]} />
    </g>
  );
}

function Mouth({ mood, open }: { mood: Mood; open: boolean }) {
  const y = 158;
  if (open) {
    return (
      <g>
        <ellipse cx={120} cy={y + 2} rx={7} ry={6} fill="#1f1a16" />
        <ellipse cx={120} cy={y + 5} rx={4} ry={2.5} fill="#ff8fa3" />
      </g>
    );
  }
  if (mood === "excited") {
    return <path d={`M${120 - 14} ${y - 2} Q${120} ${y + 16} ${120 + 14} ${y - 2} Z`} fill="#1f1a16" />;
  }
  const d: Record<Exclude<Mood, "excited">, string> = {
    neutral: `M${120 - 8} ${y} Q${120} ${y + 6} ${120 + 8} ${y}`,
    happy: `M${120 - 12} ${y - 1} Q${120} ${y + 12} ${120 + 12} ${y - 1}`,
    thinking: `M${120 - 5} ${y + 2} Q${120 + 4} ${y} ${120 + 10} ${y + 1}`,
    concerned: `M${120 - 10} ${y + 4} Q${120} ${y - 2} ${120 + 10} ${y + 4}`,
  };
  return <path d={d[mood]} fill="none" stroke="#1f1a16" strokeWidth={3.2} strokeLinecap="round" />;
}

function MoodEffects({ mood }: { mood: Mood }) {
  if (mood === "thinking") {
    return (
      <g fill="currentColor" opacity={0.45}>
        <circle cx={190} cy={72} r={4} />
        <circle cx={203} cy={54} r={6} />
        <circle cx={216} cy={31} r={9} />
      </g>
    );
  }
  if (mood === "concerned") {
    return <path d="M178 86 Q170 100 178 106 Q186 100 178 86 Z" fill="#7cc4f2" />;
  }
  if (mood === "excited") {
    return (
      <g fill="#f2c94c">
        <circle cx={42} cy={70} r={4} />
        <circle cx={206} cy={88} r={3.5} />
        <circle cx={214} cy={48} r={3} />
      </g>
    );
  }
  return null;
}
