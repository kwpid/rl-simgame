# Rocket League Sim, Architecture Map

## Stack
- **Vite + React + TypeScript**, UI shell, dark/sleek theme (Claude-UI inspired: dark neutral background, single accent color, generous whitespace, no RL-orange-and-blue chrome soup)
- **Zustand**, global state (active save, current screen, sim clock)
- **IndexedDB** (via `idb-keyval`), save persistence, one record per career save
- **HTML Canvas**, match viewer rendering (Tier 2: continuous tweened movement)
- No backend. Single-player, fully client-side. Revisit only if social/leaderboard features become real requirements.

## Top-level module map

```
src/
  engine/                 # Pure logic, no React/DOM. Unit-testable in isolation.
    calendar/              # Day/week clock, activity scheduling, fatigue
    meta-timeline/         # Mechanic/meta unlock dates, era queries
    skills/                # Skill tree definitions, node unlock/progress logic
    playstyle/             # Playstyle definitions + their modifiers
    gamesense/             # Gamesense growth model (reps/coaching/hours)
    match-sim/             # Event-chain match simulator
      events/              # Event node definitions + probability tables
      resolver.ts          # Steps the chain, produces MatchLog + MovementIntent[]
    ranked/                # Per-queue (1s/2s/3s) MMR, rank tiers, matchmaking
    tournaments/           # Bracket generation, tournament tiers incl. RLCS
    social/                # Friends, parties
    progression/           # XP, titles, season rewards, cosmetics/unlocks
    save/                  # Save schema, migration, serialize/deserialize

  viewer/                  # Canvas match viewer (Tier 2)
    renderer.ts            # Canvas draw loop
    tween.ts               # Position/easing interpolation engine
    intent-player.ts       # Consumes MovementIntent[] and drives renderer

  ui/                      # React components/screens
    screens/               # SaveSelect, Career Hub, Training, Ranked, Tournaments,
                            # Social, Locker/Cosmetics, MatchViewer, Season/Rewards
    components/            # Shared dark-theme UI kit (buttons, cards, stat bars, tree nodes)
    theme/                 # Design tokens (colors, spacing, type)

  data/                    # Static content-as-data (not logic). This is the "easily editable" layer ,
                            # adding/tweaking content should never require touching engine/ or ui/ code.
    meta-timeline.json      # The historical mechanic/meta table
    skill-tree.json         # Node graph definition (mastery method, prerequisites, stat caps)
    playstyles.json
    titles.json
    cosmetics.json
    names/                  # NPC identity pools, tiered by rank/context
      low_rank_random.json   # xbox-gamertag energy for Bronze/Silver lobbies
      mid_rank_grinder.json
      high_rank_grinder.json
      pro_circuit.json       # fictional pro/org names, deliberately not real players, see DATA_MODEL.md

  store/                  # Zustand stores (wrap engine state for React)

  App.tsx
  main.tsx
```

## Modularity principle
The recurring ask is "easy to edit/extend without touching code." The pattern that satisfies this everywhere: **engine code only knows how to interpret a shape; content lives entirely in `data/`.**
- New mechanic → new JSON entries in `meta-timeline.json` + `skill-tree.json`, zero code changes (see DATA_MODEL.md for the walkthrough).
- New NPC names → append a string to the relevant `names/*.json` file.
- New playstyle, title, cosmetic, tournament tier → new data entry, matched against the same generic interfaces.
- The only time engine code changes is when a genuinely new *mechanism* is needed (e.g. a mastery method that doesn't fit the existing `MasteryMethod` union), not for routine content additions.

## Theme & responsive design
- Dark, sleek, Claude-UI-inspired: neutral dark background (not pure black), single restrained accent color, generous spacing, calm typography, not the loud orange/blue RL branding. Concretely: define this as a small `ui/theme/tokens.ts` (background layers, text hierarchy, one accent, subtle borders) referenced everywhere rather than hardcoded colors, so re-skinning later is a token edit, not a hunt-and-replace.
- Mobile support is a layout requirement from day one, not a retrofit: React screens built mobile-first with responsive breakpoints (stat/tree screens reflow to single-column, nav collapses to a bottom bar or drawer on narrow viewports). The Canvas match viewer needs to scale its internal resolution to container size and stay legible at phone width, worth testing early rather than assuming it "just scales."

## Why `engine/` is separate from `ui/`
The match sim, calendar, and progression logic should be pure functions/classes with no React dependency, this keeps them unit-testable, keeps the viewer swappable (Tier 2 → Tier 3 later without touching sim logic), and means the "sim a week" flow can run headless (no viewer) while a single ranked match can run with the viewer attached.

## Data flow for a simulated match
```
player schedules "Ranked 2v2" for a day
  → calendar tells match-sim to run
  → match-sim.resolver walks the event chain (stat checks against Player + Playstyle + Gamesense + era-gated Skill nodes)
  → produces: MatchLog (text, for the log screen) + MovementIntent[] (for the viewer, timestamped)
  → if user is watching live: viewer/intent-player consumes MovementIntent[] in real time on Canvas
  → if user is fast-simming a week: MovementIntent[] is discarded, only MatchLog + result + XP are kept
  → result updates: Rank/MMR (per queue), XP → skill tree progress, Gamesense, fatigue, career stats
```

## Open decisions to confirm as we build
- Exact skill tree size/shape (how many nodes per category), start small, expand later
- Whether tournaments (lower-tier → RLCS) use the same match-sim engine at higher stat variance/opponent quality, or need special-cased logic (recommend: same engine, different opponent-pool generation)
