import { storeNightlySnapshot } from "../src/nightly_snapshot.js";

const sample = {
  snapshotDate: "2026-09-24",
  region: "ap-east",
  assets: [
    { assetId: "level-1042", playerId: "player-88", kind: "level", revision: 7, state: "published" },
  ],
  liveEvents: [
    { eventId: "harvest-week", title: "Harvest Week", startsAt: "2026-09-21T00:00:00Z", endsAt: "2026-09-28T00:00:00Z", status: "live" },
  ],
  moderationQueue: [
    { queueId: "review-501", assetId: "level-1042", reason: "player_report", priority: "urgent" },
  ],
} as const;

storeNightlySnapshot(sample)
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
