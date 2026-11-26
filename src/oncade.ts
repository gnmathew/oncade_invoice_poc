// Talks to the Oncade Platform API.
// Every request gets the right headers; Oncade's error replies become readable errors.
// Phase 3 only has getMe(). createInvoice() and cancelInvoice() come in Phase 4.
import { config } from "./config";

const BASE_URL = "https://www.oncade.gg/api";
const API_VERSION = "v1";
const TIMEOUT_MS = 15_000;

/** An error reply from Oncade (or a failure to reach it). */
export class OncadeError extends Error {
  readonly status: number; // HTTP status, or 0 if Oncade couldn't be reached
  readonly code: string | undefined; // Oncade's error code, e.g. "INVOICE_INVALID_STATUS"

  constructor(status: number, code: string | undefined, message: string) {
    super(`Oncade ${status || "unreachable"}${code ? ` ${code}` : ""}: ${message}`);
    this.name = "OncadeError";
    this.status = status;
    this.code = code;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  /** Required for POST/PUT so a repeated request can't create a duplicate. */
  idempotencyKey?: string;
  /** Send X-Target-Business-Id (default true). Not needed for platform-level calls like /me. */
  withBusiness?: boolean;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.ONCADE_API_KEY}`,
    "X-Oncade-API-Version": API_VERSION,
  };
  if (options.withBusiness ?? true) {
    headers["X-Target-Business-Id"] = config.ONCADE_BUSINESS_ID;
  }
  if (method !== "GET") {
    if (!options.idempotencyKey) {
      throw new Error(`${method} ${path} needs an idempotency key`);
    }
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new OncadeError(0, "NETWORK_ERROR", (err as Error).message);
  }

  // Read the reply. Oncade normally answers in JSON, but don't crash if it doesn't.
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }

  if (!response.ok) {
    // Oncade's documented error shape: { "error": "...", "code": "..." }
    const body = (typeof data === "object" && data !== null ? data : {}) as {
      error?: unknown;
      code?: unknown;
    };
    const code = typeof body.code === "string" ? body.code : undefined;
    const message =
      typeof body.error === "string"
        ? body.error
        : typeof data === "string" && data
          ? data.slice(0, 200)
          : response.statusText;
    throw new OncadeError(response.status, code, message);
  }

  return data as T;
}

/** Reply of GET /v1/platform/me. Fields are optional because the docs' example isn't verified yet. */
export type PlatformMe = {
  platformId?: string;
  businessId?: string;
  status?: string;
  approvedScopes?: string[];
  pendingScopes?: string[];
  keyInfo?: {
    keyId?: string;
    environment?: string;
    activeScopes?: string[];
    requestedScopes?: string[];
  };
};

/** Who am I? Confirms the key works and shows the platform's details. Scope: platform:read */
export function getMe(): Promise<PlatformMe> {
  return request<PlatformMe>("/v1/platform/me", { withBusiness: false });
}
