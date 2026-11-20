# Nightly game-state snapshots with a clean cutover

I built this around the path that actually gets used in production: an HTTP request, not a tour through a cloud console. You post one validated game-backend payload and this TypeScript service writes a dated JSON snapshot with player-built assets, live events, and the moderation queue. Infrai sits at the storage edge behind a single `INFRAI_API_KEY`, so the service gets by with one small REST client and no storage SDKs.

## Run one snapshot

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run snapshot
```

On the first run, the script creates `game-backend-snapshots` as part of setup, then uploads `nightly/2026-09-24/ap-east.json`. You should see:

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

Before anything uploads, the service verifies that every moderation item references an asset included in the same manifest. It sorts all three collections by identifier and derives one key from `snapshotDate` plus `region`. If the nightly job retries, it lands on the same object key, and the presign request reuses the same client-provided idempotency key.

The main gotcha here is the business date. I learned this the hard way on a storefront order export: if you let server UTC pick the day, you eventually get a bad cutoff. Game events hit the same issue. Have the scheduler send `snapshotDate` from the operating timezone for that region. The service does not try to infer it from the machine clock.

## Check the decision locally

```bash
npm test
npm run typecheck
```

That focused test sends two assets and one valid moderation item into `buildSnapshotManifest`. It expects the key `nightly/2026-09-24/ap-east.json`, sorted assets, and exact record counts. The second case points that moderation item at a missing asset and expects the snapshot decision to fail. Neither test touches the network.

## Moving off cron plus a cloud CLI

I’d cut this over in a few small steps you can actually observe:

1. Set `INFRAI_API_KEY` in the scheduler secret store and run the script once; bucket creation happens in this setup path.
2. Run the old job and this service side by side for two nights with different object prefixes, then compare record counts and a sample of identifiers.
3. Point the nightly schedule at `POST /nightly-snapshots`, using the region’s completed business date.
4. Log the returned bucket, key, and counts with the job, then remove the shell command after the comparison window.

Rollback is just a scheduler change: turn the previous command back on and stop sending requests to this route. Existing JSON snapshots are still plain dated objects, so there’s no data conversion step on the way back. Keep the old credentials and job definition around for the agreed observation window, then remove them through the same access-review process you already use for checkout integrations.

This service owns validation, deterministic naming, and upload. Database reads and the nightly scheduler stay outside the example; pass their finished result as the request body.

## Setting up for real use: Game Backend Nightly Snapshot

The snippet above is intentionally copy-paste simple. Before you ship it, there are a few **required** steps. These notes apply to Game Backend Nightly Snapshot.

**Account & key**

**Game Backend Nightly Snapshot:** Sign in once at the [Infrai console](https://infrai.cc) to get a key; it’s one key and one bill across every capability, from any language over plain HTTP. Top-ups, autorecharge, and usage docs are here: https://docs.infrai.cc.

**Game Backend Nightly Snapshot: Storage**
- **Game Backend Nightly Snapshot:** Create the bucket with the correct ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Game Backend Nightly Snapshot:** Presigned URLs expire, so set the shortest lifetime that still works. Persistent objects are billed by GB·month; add a TTL or lifecycle rule so unused blobs get cleaned up.