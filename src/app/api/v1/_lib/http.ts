import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";

import { fieldErrorsFromZod } from "@/lib/forms";
import { describeError, logger } from "@/lib/logger";

/**
 * JSON conventions for `/api/v1` (consumed by future iOS/Android apps):
 * - success: the resource itself (no wrapper)
 * - failure: `{ "error": { "code", "message", "fields"? } }` with an HTTP status
 * - every response is `Cache-Control: no-store`
 * Request and response bodies are never logged.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string[]>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const NO_STORE = { "Cache-Control": "no-store" };

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

function problem(error: ApiError): NextResponse {
  return NextResponse.json(
    { error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } },
    { status: error.status, headers: { ...NO_STORE, ...error.headers } },
  );
}

/** 429 with Retry-After (Stage 16 rate limits). */
export function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError(429, "rate_limited", "Too many requests. Please wait and try again.", undefined, {
    "Retry-After": String(retryAfterSeconds),
  });
}

export const MAX_BODY_BYTES = 16 * 1024;

const tooLarge = () => new ApiError(413, "payload_too_large", "Request body is too large.");

/** Reads the body as text, stopping as soon as it exceeds `max` bytes (never buffers an oversized body). */
async function readCappedText(request: NextRequest, max: number): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) throw tooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Parses and validates a JSON body against a Zod schema (422 with field errors on failure). */
export async function readJson<S extends z.ZodType>(request: NextRequest, schema: S): Promise<z.output<S>> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Send a JSON body (Content-Type: application/json).");
  }
  const text = await readCappedText(request, MAX_BODY_BYTES);
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "invalid_json", "Request body is not valid JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "validation_failed",
      "Please check the highlighted fields.",
      fieldErrorsFromZod(parsed.error),
    );
  }
  return parsed.data;
}

type Handler<C> = (request: NextRequest, context: C) => Promise<NextResponse>;

/** Wraps a route handler: maps ApiError to the error envelope and hides everything else behind a 500. */
export function route<C>(name: string, handler: Handler<C>): Handler<C> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ApiError) return problem(error);
      logger.error("api.unhandled", { route: name, ...describeError(error) });
      return problem(new ApiError(500, "internal_error", "Something went wrong. Please try again."));
    }
  };
}
