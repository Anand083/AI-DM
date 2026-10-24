import "server-only";
import { gunzipSync } from "node:zlib";
import { getEnv } from "@/env";
import { enqueueProcessTask } from "@/server/jobs/enqueue";
import { logger } from "@/server/logger";
import { consume, RedisRateLimitStore } from "@/server/rate-limit";
import { getRedis } from "@/server/redis";
import { rawDb } from "@/server/db/client";
import { receivePingback, receivePostback, type TaskDeps } from "@/server/services/provider-tasks";
import { clientIp } from "@/server/auth/auth-rate-limit";
import { secretMatches } from "./callback-auth";

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const LIMIT_PER_MINUTE = 300;

const json = (body: unknown, status: number) => Response.json(body, { status });

function deps(): TaskDeps {
  return { db: rawDb, enqueueProcess: enqueueProcessTask };
}

/**
 * Checks rate limit and secret for an inbound DataForSEO callback. Returns an error response,
 * or null when the request may continue. These routes have no user session.
 */
async function guard(request: Request, route: string): Promise<Response | null> {
  const ip = clientIp(request.headers);
  try {
    const limit = await consume(new RedisRateLimitStore(getRedis()), {
      key: `dfs-callback:${ip}`,
      limit: LIMIT_PER_MINUTE,
      windowSec: 60,
    });
    if (!limit.allowed) {
      logger.warn({ route, ip }, "dataforseo callback rate limited");
      return json({ error: "Too many requests" }, 429);
    }
  } catch (error) {
    // If Redis is down we still check the secret below.
    logger.warn({ err: error }, "dataforseo callback rate limit check failed");
  }
  const secret = new URL(request.url).searchParams.get("secret");
  if (!secretMatches(secret, getEnv().DATAFORSEO_CALLBACK_SECRET)) {
    logger.warn({ route, ip }, "dataforseo callback with a bad secret");
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}

/** `GET ...pingback?id=$id&tag=$tag&secret=...` : DataForSEO says a task is ready. */
export async function handlePingback(request: Request): Promise<Response> {
  const denied = await guard(request, "pingback");
  if (denied) return denied;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id || id.length > 200) return json({ error: "Missing task id" }, 400);

  const outcome = await receivePingback(deps(), id);
  logger.info(
    { route: "pingback", taskId: id, tag: url.searchParams.get("tag"), outcome },
    "dataforseo callback",
  );
  if (outcome === "unknown") return json({ error: "Unknown task" }, 404);
  return json({ ok: true, outcome }, 200);
}

/** `POST ...postback?secret=...` : DataForSEO sends the finished result (gzip compressed). */
export async function handlePostback(request: Request): Promise<Response> {
  const denied = await guard(request, "postback");
  if (denied) return denied;

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return json({ error: "Body too large" }, 413);

  let body: unknown;
  try {
    let bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length > MAX_BODY_BYTES) return json({ error: "Body too large" }, 413);
    // gzip files start with the bytes 1f 8b.
    if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      bytes = gunzipSync(bytes, { maxOutputLength: MAX_BODY_BYTES * 5 });
    }
    body = JSON.parse(bytes.toString("utf8"));
  } catch {
    return json({ error: "Body is not valid JSON" }, 400);
  }

  const counts = await receivePostback(deps(), body);
  logger.info({ route: "postback", ...counts }, "dataforseo callback");
  if (counts.unknown > 0 && counts.queued === 0 && counts.duplicate === 0) {
    return json({ error: "Unknown task" }, 404);
  }
  return json({ ok: true, ...counts }, 200);
}
