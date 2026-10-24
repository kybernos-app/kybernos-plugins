// Did the host cut the list of Creations? (T2-09, 2026-10-24.) It lists at most ARTIFACT_LIMIT files and used to say nothing when it cut: the sidebar and the page then
// wrote « 500 » as if it were the count, while the Workspaces cards (counted without the cap) added up to more.

/**
 * `ownFound`: how many files the scanned root holds (before any cut). `listed`: the length of the list about to be cut to `limit`: that root's files, already cut to
 * `limit`, plus those of the other workspaces. The list is cut when either is above `limit`: the first alone misses a root under the limit whose neighbours push the
 * list over it, the second alone misses a root over the limit that has no neighbour.
 */
export const kbArtifactsCut = (ownFound, listed, limit) => ownFound > limit || listed > limit
