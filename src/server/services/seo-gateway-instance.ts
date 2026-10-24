import "server-only";
import { rawDb } from "@/server/db/client";
import { RedisLockStore } from "@/server/locks";
import { getSeoProvider } from "@/server/providers/seo";
import { getRedis } from "@/server/redis";
import { SeoGateway } from "./seo-gateway";

let gateway: SeoGateway | undefined;

/**
 * The shared gateway used by the app and the worker.
 * It uses the plain database client: provider cache is shared between agencies, and the
 * usage rows it writes always carry the caller's agencyId.
 */
export function getSeoGateway(): SeoGateway {
  gateway ??= new SeoGateway({
    provider: (module) => getSeoProvider(module),
    db: rawDb,
    locks: new RedisLockStore(getRedis()),
  });
  return gateway;
}
