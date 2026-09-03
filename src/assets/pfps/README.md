# Profile pictures

Drop any number of image files (`.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`) directly into this folder. Nothing
else needs to change — `src/data/pfps.ts` picks them up automatically the next time the app builds or the
dev server reloads (no manifest file to hand-edit).

Every tracked AI identity (pros, regional grinders, leaderboard fillers, friends) gets a stable, randomly
assigned picture from this pool (duplicates are expected once you have more AI than pictures), with a rare
chance to switch to a different one every so often. If you add or remove files and want everyone to
reassign against the new pool immediately, use the "Reset Profile Pictures" button on the Settings screen —
otherwise stale/removed files only get cleared out for a given name the next time that name would have
switched anyway.

This file itself is never picked up as a picture — only actual image extensions are globbed.
