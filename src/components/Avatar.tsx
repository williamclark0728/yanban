import { usePrefs } from "../store";
import type { Agent, AgentColor } from "../types";

export const palette: Record<AgentColor, { body: string; eye: string; text: string }> = {
  violet: { body: "#8b6cff", eye: "#ffffff", text: "#b4a2ff" },
  amber: { body: "#b5814f", eye: "#ffffff", text: "#d9a574" },
  teal: { body: "#22b8a0", eye: "#ffffff", text: "#4fd6bf" },
  orange: { body: "#f59a2f", eye: "#ffffff", text: "#ffb45c" },
  rose: { body: "#f06283", eye: "#ffffff", text: "#ff8aa5" },
  sky: { body: "#4596ff", eye: "#ffffff", text: "#7cb4ff" },
  snow: { body: "#f1f1f4", eye: "#16161a", text: "#d8d8de" },
};

/** Soft blob with two eyes; `look` shifts the gaze. */
export function BotAvatar({ agent, size = 40, className }: { agent: Pick<Agent, "color" | "look">; size?: number; className?: string }) {
  const c = palette[agent.color];
  const dx = agent.look * 6;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden>
      <path
        d="M51 5c25 0 44 18 44 44 0 27-19 46-46 46C23 95 5 76 5 50 5 24 25 5 51 5z"
        fill={c.body}
        stroke={agent.color === "snow" ? "rgb(0 0 0 / 0.1)" : "none"}
        strokeWidth={2}
      />
      <g fill={c.eye}>
        <ellipse cx={40 + dx} cy={46} rx={5.5} ry={9} transform={`rotate(-8 ${40 + dx} 46)`} />
        <ellipse cx={60 + dx} cy={45} rx={5.5} ry={9} transform={`rotate(-8 ${60 + dx} 45)`} />
      </g>
    </svg>
  );
}

/** Up to three member avatars stacked, like a group icon. */
export function GroupAvatar({ members, size = 48 }: { members: Agent[]; size?: number }) {
  const shown = members.slice(0, 3);
  const s = Math.round(size * 0.56);
  const spots = [
    { left: size - s, top: 0 },
    { left: 0, top: size - s },
    { left: size - s, top: size - s },
  ];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <div
        className="absolute rounded-full bg-raise-2 text-[9px] font-semibold text-fg-2 grid place-items-center"
        style={{ width: s * 0.82, height: s * 0.82, left: 2, top: 2, fontSize: s * 0.36 }}
      >
        {size >= 40 && <MeInitial />}
      </div>
      {shown.map((m, i) => (
        <div key={m.id} className="absolute rounded-full" style={{ ...spots[i], width: s, height: s }}>
          <BotAvatar agent={m} size={s} />
        </div>
      ))}
    </div>
  );
}

/** Two characters for the user's avatar: the given name for Chinese names, initials otherwise. */
export function initials(name: string) {
  const chars = Array.from(name.trim());
  if (!chars.length) return "我";
  if (/\p{Script=Han}/u.test(name)) return (chars.length >= 3 ? chars.slice(-2) : chars.slice(0, 2)).join("");
  const words = name.trim().split(/\s+/);
  return (words.length > 1 ? words[0][0] + words[1][0] : chars.slice(0, 2).join("")).toUpperCase();
}

function MeInitial() {
  const name = usePrefs((s) => s.name);
  return Array.from(initials(name))[0];
}

export function MeAvatar({ size = 32 }: { size?: number }) {
  const name = usePrefs((s) => s.name);
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full bg-raise-2 font-semibold text-fg-2"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(name)}
    </div>
  );
}
