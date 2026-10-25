import Link from "next/link";

type Notice =
  | { kind: "trial"; daysLeft: number }
  | { kind: "past_due"; graceEnds: string }
  | { kind: "read_only" };

/** Shows trial, payment and read-only notices at the top of the agency app. */
export function SubscriptionBanner({
  notice,
  billingHref,
}: {
  notice: Notice | null;
  /** Null for people who cannot manage billing: they see the message but no link. */
  billingHref: string | null;
}) {
  if (!notice) return null;
  const urgent = notice.kind !== "trial";
  const text =
    notice.kind === "trial"
      ? `Your free trial ends in ${notice.daysLeft} ${notice.daysLeft === 1 ? "day" : "days"}.`
      : notice.kind === "past_due"
        ? `Your last payment failed. Pay by ${notice.graceEnds} to keep your account running.`
        : "Your account is read-only. You can see your data, but new checks, audits and reports are paused.";
  const action =
    notice.kind === "trial"
      ? "Choose a plan"
      : notice.kind === "past_due"
        ? "Fix payment"
        : "Choose a plan";
  return (
    <div
      role="status"
      data-testid="subscription-banner"
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-sm ${
        urgent
          ? "bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200"
          : "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      }`}
    >
      <span>{text}</span>
      {billingHref ? (
        <Link href={billingHref} className="font-medium underline underline-offset-4">
          {action}
        </Link>
      ) : (
        <span>Ask an owner of this account to fix it.</span>
      )}
    </div>
  );
}
