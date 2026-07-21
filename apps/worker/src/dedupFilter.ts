import type { Finding } from '@happyfeeling/github/pipeline';
import { computeDedupHash } from '@happyfeeling/github/review/dedup';
import { prisma } from '@happyfeeling/db';

export async function filterNewFindings(repo: string, prNumber: number, findings: Finding[]): Promise<Finding[]> {
  const byHash = new Map<string, Finding>();
  for (const finding of findings) {
    const dedupHash = computeDedupHash(repo, prNumber, finding.file, finding.line);
    if (!byHash.has(dedupHash)) byHash.set(dedupHash, finding);
  }
  if (byHash.size === 0) return [];

  const dedupHashes = [...byHash.keys()];
  let existingHashes: string[];
  try {
    const existingRows = await prisma.finding.findMany({
      where: { dedupHash: { in: dedupHashes } },
      select: { dedupHash: true },
    });
    existingHashes = existingRows.map((row) => row.dedupHash);
  } catch (err) {
    // We genuinely don't know which findings are duplicates here — fail open
    // rather than silently dropping ones that might be new.
    console.error(
      `Dedup lookup failed for ${dedupHashes.length} finding(s) — treating them all as new rather than silently dropping them`,
      err
    );
    return [...byHash.values()];
  }

  if (existingHashes.length > 0) {
    try {
      // Set lastSeenAt explicitly — an empty `data: {}` reports success (count > 0)
      // but does NOT actually trigger Prisma's `@updatedAt` on updateMany, verified
      // against a real Postgres instance (Prisma 7.8).
      await prisma.finding.updateMany({
        where: { dedupHash: { in: existingHashes } },
        data: { lastSeenAt: new Date() },
      });
    } catch (err) {
      // We already know which findings are duplicates (the lookup above succeeded) —
      // a failure to bump lastSeenAt is a best-effort miss, not a reason to repost them.
      console.error(`Failed to bump lastSeenAt for ${existingHashes.length} already-seen finding(s)`, err);
    }
  }

  const existingSet = new Set(existingHashes);
  return [...byHash.entries()].filter(([hash]) => !existingSet.has(hash)).map(([, finding]) => finding);
}
