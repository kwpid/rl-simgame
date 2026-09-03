export type IconName =
  | "home"
  | "stats"
  | "training"
  | "ranked"
  | "tournaments"
  | "social"
  | "locker"
  | "lock"
  | "chevron-down"
  | "fame"
  | "org"
  | "solo"
  | "duos"
  | "trios"
  | "aerial"
  | "eye"
  | "flag"
  | "steering"
  | "bolt"
  | "crosshair"
  | "shield"
  | "swap"
  | "brain"
  | "cycle"
  | "clock"
  | "trash"
  | "plus"
  | "settings"
  | "logout"
  | "signal";

const paths: Record<IconName, React.ReactNode> = {
  home: (
    <path d="M4 11.5 12 4l8 7.5M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9" />
  ),
  stats: (
    <path d="M5 20V10M12 20V4M19 20v-7" />
  ),
  training: (
    <path d="M4 8v8M2 10v4M20 8v8M22 10v4M7 8h10v8H7z" />
  ),
  ranked: (
    <path d="M6 3h12v4a6 6 0 0 1-12 0V3zM6 5H3v2a3 3 0 0 0 3 3M18 5h3v2a3 3 0 0 1-3 3M9 17h6M12 13v4M8 21h8" />
  ),
  tournaments: (
    <path d="M4 4h6v6a3 3 0 0 1-6 0V4zM14 4h6v6a3 3 0 0 1-6 0V4zM10 6h4M12 10v5M8 21h8M12 15c-2 0-3 1.5-3 3h6c0-1.5-1-3-3-3z" />
  ),
  social: (
    <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 2.5-5 6-5s6 2 6 5M12 20c0-2.5 2-4.5 5-4.5s5 2 5 4.5" />
  ),
  locker: (
    <path d="M4 3h16v18H4zM12 3v18M8 8h.01M16 8h.01" />
  ),
  lock: (
    <path d="M6 11V8a6 6 0 1 1 12 0v3M5 11h14v10H5z" />
  ),
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  fame: (
    <path d="m12 2 2.9 6.6L22 9.3l-5 4.9 1.2 7-6.2-3.5L5.8 21.2 7 14.2l-5-4.9 7.1-.7z" />
  ),
  org: (
    <path d="M3 21V8l9-5 9 5v13M8 21v-6h8v6M8 12h.01M12 12h.01M16 12h.01" />
  ),
  solo: (
    <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.6-7 8-7s8 3 8 7" />
  ),
  duos: (
    <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 21c0-3.3 3.1-6 7-6s7 2.7 7 6M13 15.5c.8-.3 1.6-.5 2.5-.5 3.9 0 7 2.7 7 6" />
  ),
  trios: (
    <path d="M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM3 21c0-3.5 2-6 5-6h8c3 0 5 2.5 5 6M9 21v-3a3 3 0 0 1 6 0v3" />
  ),
  aerial: (
    <path d="M12 20V6M6 12l6-6 6 6" />
  ),
  eye: (
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
  ),
  flag: (
    <path d="M5 21V4M5 4h13l-3 4 3 4H5" />
  ),
  steering: (
    <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 12V4M12 12l6.5 4.5M12 12l-6.5 4.5" />
  ),
  bolt: (
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
  ),
  crosshair: (
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
  ),
  shield: (
    <path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z" />
  ),
  swap: (
    <path d="M4 8h13l-3-3M20 16H7l3 3" />
  ),
  brain: (
    <path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-1 5.8V15a3 3 0 0 0 3 3h1v2M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 1 5.8V15a3 3 0 0 1-3 3h-1v2M9 4a2.5 2.5 0 0 1 3 0M9 4v14M15 4v14" />
  ),
  cycle: (
    <path d="M4 12a8 8 0 0 1 14-5.3M18 4v4h-4M20 12a8 8 0 0 1-14 5.3M6 20v-4h4" />
  ),
  clock: (
    <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3.5 2" />
  ),
  trash: (
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  ),
  plus: (
    <path d="M12 5v14M5 12h14" />
  ),
  settings: (
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.87 19.7a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.87a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.04z" />
  ),
  logout: (
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  ),
  signal: (
    <path d="M4 20v-4M10 20v-8M16 20v-12M22 20V4" />
  ),
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
