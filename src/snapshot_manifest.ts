import { z } from "zod";

const assetSchema = z.object({
  assetId: z.string().min(1),
  playerId: z.string().min(1),
  kind: z.enum(["level", "skin", "replay"]),
  revision: z.number().int().nonnegative(),
  state: z.enum(["published", "hidden"]),
});

const liveEventSchema = z.object({
  eventId: z.string().min(1),
  title: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  status: z.enum(["scheduled", "live", "ended"]),
});

const moderationItemSchema = z.object({
  queueId: z.string().min(1),
  assetId: z.string().min(1),
  reason: z.enum(["player_report", "automated_review", "appeal"]),
  priority: z.enum(["normal", "urgent"]),
});

export const snapshotRequestSchema = z.object({
  snapshotDate: z.string().date(),
  region: z.string().min(2),
  assets: z.array(assetSchema),
  liveEvents: z.array(liveEventSchema),
  moderationQueue: z.array(moderationItemSchema),
});

export type SnapshotRequest = z.infer<typeof snapshotRequestSchema>;

export type SnapshotManifest = SnapshotRequest & {
  schemaVersion: 1;
  counts: { assets: number; liveEvents: number; moderationQueue: number };
};

export function buildSnapshotManifest(input: SnapshotRequest): SnapshotManifest {
  const parsed = snapshotRequestSchema.parse(input);
  const assetIds = new Set(parsed.assets.map((asset) => asset.assetId));
  const dangling = parsed.moderationQueue
    .filter((item) => !assetIds.has(item.assetId))
    .map((item) => item.queueId);

  if (dangling.length > 0) {
    throw new Error(`Moderation items reference unknown assets: ${dangling.join(", ")}`);
  }

  return {
    schemaVersion: 1,
    ...parsed,
    assets: [...parsed.assets].sort((a, b) => a.assetId.localeCompare(b.assetId)),
    liveEvents: [...parsed.liveEvents].sort((a, b) => a.eventId.localeCompare(b.eventId)),
    moderationQueue: [...parsed.moderationQueue].sort((a, b) =>
      a.queueId.localeCompare(b.queueId),
    ),
    counts: {
      assets: parsed.assets.length,
      liveEvents: parsed.liveEvents.length,
      moderationQueue: parsed.moderationQueue.length,
    },
  };
}

export function snapshotObjectKey(input: Pick<SnapshotRequest, "snapshotDate" | "region">): string {
  return `nightly/${input.snapshotDate}/${encodeURIComponent(input.region)}.json`;
}
