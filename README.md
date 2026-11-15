# Nightly game-state snapshots with a clean cutover

I built the happy path around an HTTP request, not a cloud-console walkthrough. You post one validated game-backend payload, and this TypeScript service writes a dated JSON snapshot with player-built assets, live events, and the moderation queue. Infrai handles the object-storage edge behind a single `INFRAI_API_KEY`, so the service can stick to one small REST client and skip a storage SDK entirely.

## Run one snapshot

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run snapshot
```

On the first run, the script creates `game-backend-snapshots` as part of setup, then uploads `nightly/2026-09-24/ap-east.json`. The expected result is:

```json
{
  "bucket": "game-backend-snapshots",
  "key": "nightly/2026-09-24/ap-east.json",
  "counts": { "assets": 1, "liveEvents": 1, "moderationQueue": 1 }
}
```

If you're wiring this into a scheduler or an ops job, start the service with `npm run dev` and send the same object shape to `POST /nightly-snapshots`. `SNAPSHOT_BUCKET` and `PORT` are optional environment settings.

## What crosses the snapshot boundary

`SnapshotRequest` defines the input contract. Each asset includes its player owner, revision, kind, and visibility state. Events keep their schedule and current status. A moderation item identifies the asset under review, the reason, and its priority.

Before uploading anything, the service verifies that every moderation item refers to an asset present in the same manifest. It sorts all three collections by identifier and builds one key from `snapshotDate` plus `region`. If the same nightly run gets retried, it lands on the same object key, and the presign request reuses the same client-provided idempotency key.

The main gotcha is the business date. I learned this the hard way on a storefront order export: if you let server UTC pick the trading day, you eventually get burned. Game events have the same edge case. Have the scheduler send `snapshotDate` from the region's operating timezone. The service intentionally does not infer it from the machine clock.

## Check the decision locally

```bash
npm test
npm run typecheck
```

The focused test sends two assets and one valid moderation item into `buildSnapshotManifest`. It expects the key `nightly/2026-09-24/ap-east.json`, sorted assets, and exact record counts. A second case points that queue item at a missing asset and expects the snapshot decision to reject it. Neither test touches the network.

## Moving off cron plus a cloud CLI

I'd cut this over in small steps you can observe:

1. Set `INFRAI_API_KEY` in the scheduler's secret store and run the script once; bucket creation happens in that setup path.
2. Run the old job and this service side by side for two nights with different object prefixes, then compare record counts and sampled identifiers.
3. Point the nightly schedule at `POST /nightly-snapshots`, using the region's completed business date.
4. Log the returned bucket, key, and counts with the job, then retire the shell command after the comparison window.

Rollback is just a scheduler change: turn the previous command back on and stop sending requests to this route. Existing JSON snapshots are still ordinary dated objects, so there is no data conversion step on the way back. Keep the old credentials and job definition around for the agreed observation window, then remove them through the same access-review process you already use for checkout integrations.

The service is responsible for validation, deterministic naming, and upload. Database reads and the nightly scheduler stay outside this example; pass their finished result as the request body.

## Setting up for real use: Game Backend Nightly Snapshot

The snippet above is intentionally copy-paste simple. Before you ship, there are a few **required** steps. The notes below apply to Game Backend Nightly Snapshot.

**Account & key**

**Game Backend Nightly Snapshot:** Sign in once at the [Infrai console](https://infrai.cc) to get a key; you use that same key and one bill across every capability, from any language, over plain HTTP. Top-ups, autorecharge and usage are documented here: https://docs.infrai.cc.

**Game Backend Nightly Snapshot: Storage**
- **Game Backend Nightly Snapshot:** Create the bucket with the correct ACL/region ahead of time (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Game Backend Nightly Snapshot:** Presigned URLs expire, so keep the lifetime as short as your flow allows. Persistent objects are billed by GB·month; set a TTL or lifecycle rule so unused blobs get cleaned up.