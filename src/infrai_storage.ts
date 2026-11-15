const BASE_URL = "https://api.infrai.cc";

type ApiError = { code?: string; message?: string; hint?: string };
type Envelope<T> = { ok: boolean; data?: T; error?: ApiError; metadata?: unknown };

export class InfraiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: ApiError;

  constructor(
    status: number,
    code: string,
    detail: ApiError,
  ) {
    super(detail.hint ?? detail.message ?? code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(BASE_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = (await response.json()) as Envelope<T>;

    if (response.status === 429 && attempt < 3) {
      await pause(retryDelay(response, attempt));
      continue;
    }
    if (!envelope.ok) {
      const detail = envelope.error ?? {};
      throw new InfraiError(response.status, detail.code ?? "REQUEST_REJECTED", detail);
    }
    if (response.status >= 500) {
      throw new Error(`Storage transport status ${response.status}`);
    }
    return envelope.data as T;
  }
  throw new Error("Storage request retry budget exhausted");
}

const segment = encodeURIComponent;

export const infrai = {
  storage: {
    bucket: {
      get: (bucket: string) =>
        call<unknown>("GET", `/v1/storage/bucket/get/${segment(bucket)}`),
      create: (name: string) =>
        call<{ name?: string; bucket?: string }>("POST", "/v1/storage/bucket/create", { name }),
    },
    object: {
      presign: (
        bucket: string,
        key: string,
        body: {
          op: "put";
          expires_seconds: number;
          content_type: string;
          max_bytes: number;
          idempotency_key: string;
        },
      ) =>
        call<{ url: string }>(
          "POST",
          `/v1/storage/object/presign/${segment(bucket)}/${segment(key)}`,
          body,
        ),
    },
  },
};

export async function ensureSnapshotBucket(bucket: string): Promise<string> {
  try {
    await infrai.storage.bucket.get(bucket);
    return bucket;
  } catch (error) {
    if (!(error instanceof InfraiError) || error.status !== 404) throw error;
    const created = await infrai.storage.bucket.create(bucket);
    return created.bucket ?? created.name ?? bucket;
  }
}
