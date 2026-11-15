import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { ensureSnapshotBucket, InfraiError, infrai } from "./infrai_storage.js";
import {
  buildSnapshotManifest,
  snapshotObjectKey,
  snapshotRequestSchema,
  type SnapshotRequest,
} from "./snapshot_manifest.js";

const BUCKET = process.env.SNAPSHOT_BUCKET ?? "game-backend-snapshots";
const MAX_SNAPSHOT_BYTES = 5_000_000;

export async function storeNightlySnapshot(raw: unknown): Promise<{
  bucket: string;
  key: string;
  counts: { assets: number; liveEvents: number; moderationQueue: number };
}> {
  const input: SnapshotRequest = snapshotRequestSchema.parse(raw);
  const manifest = buildSnapshotManifest(input);
  const key = snapshotObjectKey(input);
  const bytes = Buffer.from(JSON.stringify(manifest));
  if (bytes.byteLength > MAX_SNAPSHOT_BYTES) throw new Error("Snapshot exceeds the 5 MB route limit");

  const bucket = await ensureSnapshotBucket(BUCKET);
  const signed = await infrai.storage.object.presign(bucket, key, {
    op: "put",
    expires_seconds: 600,
    content_type: "application/json",
    max_bytes: MAX_SNAPSHOT_BYTES,
    idempotency_key: `nightly-${input.snapshotDate}-${input.region}`,
  });
  const upload = await fetch(signed.url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: bytes,
  });
  if (!upload.ok) throw new Error(`Snapshot upload status ${upload.status}`);

  return { bucket, key, counts: manifest.counts };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

if (process.argv[1]?.endsWith("nightly_snapshot.ts")) {
  const port = Number(process.env.PORT ?? 3000);
  createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/nightly-snapshots") {
      json(response, 404, { error: "Route not found" });
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const result = await storeNightlySnapshot(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      json(response, 201, result);
    } catch (error) {
      const status = error instanceof InfraiError
        ? error.status >= 400 && error.status < 500 ? error.status : 502
        : error instanceof ZodError || error instanceof SyntaxError ? 400 : 422;
      json(response, status, { error: error instanceof Error ? error.message : "Snapshot rejected" });
    }
  }).listen(port, () => console.log(`Nightly snapshot route listening on ${port}`));
}
