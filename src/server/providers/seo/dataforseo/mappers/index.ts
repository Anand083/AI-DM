import type { DfsResponse } from "../client";

/**
 * Mappers turn DataForSEO response shapes into our own types (see ../../types.ts).
 * Nothing outside this folder and `../client.ts` may know a vendor shape.
 * Step 8c adds one mapper per operation, tested with recorded sandbox responses.
 */

type UserData = { login?: string; money?: { balance?: number } };

/** `GET /v3/appendix/user_data` to our connection status. */
export function mapUserData(response: DfsResponse<UserData>): {
  ok: true;
  balanceUsd?: number;
  message: string;
} {
  const info = response.tasks?.[0]?.result?.[0];
  const balance = info?.money?.balance;
  return {
    ok: true,
    balanceUsd: typeof balance === "number" ? balance : undefined,
    message: info?.login
      ? "Connected to DataForSEO."
      : "Connected to DataForSEO (no account details returned).",
  };
}

type ReadyTask = { id: string; tag?: string };

/** `GET .../tasks_ready` to the ids of finished tasks. */
export function mapTasksReady(response: DfsResponse<ReadyTask>): ReadyTask[] {
  return (response.tasks ?? []).flatMap((task) => task.result ?? []);
}
