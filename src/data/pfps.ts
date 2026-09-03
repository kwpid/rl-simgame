// Player-supplied profile pictures live in src/assets/pfps/ (see that folder's own README) — this module
// just resolves whatever's actually in there at build time via Vite's import.meta.glob, so dropping in new
// files and reloading the dev server (or rebuilding) is the entire "add more pictures" workflow, no manifest
// to hand-maintain. Sorted so the pool's order (and therefore every hash-based index into it, see
// usePfpStore.ts) stays stable across reloads regardless of filesystem iteration order.

const modules = import.meta.glob<{ default: string }>(
  "/src/assets/pfps/*.{png,jpg,jpeg,webp,gif,PNG,JPG,JPEG,WEBP,GIF}",
  { eager: true }
);

const sortedPaths = Object.keys(modules).sort();

// Three files, matched by ORIGINAL source filename (any extension/case — a production build hashes the
// bundled `url` itself, so matching has to happen on the glob key, not the resolved URL) are the deliberate
// "generic/unknown person" pool rather than a real distinct curated picture: a generic AI nobody's supposed
// to recognize (see usePfpStore's `isNotableIdentity`) draws from these instead of the curated pool, and
// once the curated pool itself runs out of never-used pictures (see MAX/DOUBLE_USE in usePfpStore.ts),
// notable identities spill over onto this same pool too — rotating across a few generic pictures instead of
// one single repeated image reads a lot less like the same person cloned across the leaderboard.
const DEFAULT_FILE_NAMES = ["fullblack", "defaultpfp", "questionmark"];
function isDefaultPath(path: string): boolean {
  return DEFAULT_FILE_NAMES.some((n) => new RegExp(`/${n}\\.[a-z]+$`, "i").test(path));
}

export const PFP_DEFAULT_POOL: string[] = sortedPaths.filter(isDefaultPath).map((path) => modules[path].default);
export const PFP_CURATED_POOL: string[] = sortedPaths.filter((path) => !isDefaultPath(path)).map((path) => modules[path].default);
// The full pool, curated + default — used by the Settings screen's "Choose from Pool" gallery, where the
// player should be able to manually pick literally anything in the folder, defaults included.
export const PFP_POOL: string[] = sortedPaths.map((path) => modules[path].default);

export function hasPfpPool(): boolean {
  return PFP_POOL.length > 0;
}
