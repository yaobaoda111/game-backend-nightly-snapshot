import { describe, expect, it } from "vitest";
import { buildSnapshotManifest, snapshotObjectKey } from "../src/snapshot_manifest.js";

const input = {
  snapshotDate: "2026-09-24",
  region: "ap-east",
  assets: [
    { assetId: "skin-2", playerId: "p-2", kind: "skin" as const, revision: 3, state: "published" as const },
    { assetId: "level-1", playerId: "p-1", kind: "level" as const, revision: 9, state: "hidden" as const },
  ],
  liveEvents: [],
  moderationQueue: [
    { queueId: "q-9", assetId: "level-1", reason: "appeal" as const, priority: "urgent" as const },
  ],
};

describe("nightly snapshot decision", () => {
  it("builds a stable dated manifest when every review points at a captured asset", () => {
    const manifest = buildSnapshotManifest(input);

    expect(snapshotObjectKey(input)).toBe("nightly/2026-09-24/ap-east.json");
    expect(manifest.assets.map((asset) => asset.assetId)).toEqual(["level-1", "skin-2"]);
    expect(manifest.counts).toEqual({ assets: 2, liveEvents: 0, moderationQueue: 1 });
  });

  it("rejects a moderation item whose asset is absent from the same snapshot", () => {
    expect(() => buildSnapshotManifest({
      ...input,
      moderationQueue: [{ ...input.moderationQueue[0], assetId: "missing-asset" }],
    })).toThrow("q-9");
  });
});
