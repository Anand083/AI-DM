import { stopSupportSessionAction } from "@/app/admin-actions";

/** Whole minutes left in a support session, at least 1. */
export function minutesLeft(expiresAt: Date, now: number = Date.now()): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - now) / 60_000));
}

/** A red bar shown during a support session, so it is impossible to forget. */
export function SupportBanner({
  agencyName,
  userName,
  minutesLeft,
}: {
  agencyName: string;
  userName: string;
  minutesLeft: number;
}) {
  return (
    <div
      role="status"
      data-testid="support-banner"
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-red-700 px-4 py-2 text-sm font-medium text-white"
    >
      <span>
        Support session: you are viewing {agencyName} as {userName}. It ends in {minutesLeft}{" "}
        {minutesLeft === 1 ? "minute" : "minutes"}.
      </span>
      <form action={stopSupportSessionAction}>
        <button
          type="submit"
          className="rounded bg-white px-3 py-1 text-red-800 underline-offset-2 hover:underline"
        >
          End session
        </button>
      </form>
    </div>
  );
}
