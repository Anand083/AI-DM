import { buildReviewAlert } from "@/lib/alert-rules";
import { reviewKey, toTenths } from "@/lib/reviews";
import type { Db } from "@/server/db/client";
import type { ReviewSummary } from "@/server/providers/seo/types";
import type { ReplyInput } from "@/server/providers/summary/types";
import { createAlerts } from "./alert-store";
import type { GatewayCaller, GatewayResult } from "./seo-gateway";

export type ReviewGateway = {
  getReviews(
    caller: GatewayCaller,
    input: { businessName: string; locationCode: number },
  ): Promise<GatewayResult<ReviewSummary>>;
};

export type ReplyWriter = { suggestReply(input: ReplyInput): Promise<string> };

export type ReviewRun = {
  projectId: string;
  agencyId: string;
  /** UTC day, YYYY-MM-DD. */
  date: string;
};

export type ReviewRunResult =
  | { status: "inactive" }
  | { status: "no-business" }
  | { status: "already-checked" }
  | { status: "done"; newReviews: number; lowReviews: number; alerted: boolean };

const day = (value: string) => new Date(`${value}T00:00:00Z`);

/**
 * Reads the business's rating and latest reviews, saves reviews it has not seen, writes a suggested
 * reply for each new one, saves the day's rating and raises one alert for the new reviews.
 * The first check only fills the list: nothing in it is "new", so it sends no alert.
 * Running it twice for the same day does nothing the second time.
 */
export async function runReviewRefresh(
  deps: { db: Db; gateway: ReviewGateway; replies: ReplyWriter },
  run: ReviewRun,
): Promise<ReviewRunResult> {
  const { db, gateway, replies } = deps;
  const project = await db.project.findFirst({
    where: {
      id: run.projectId,
      agencyId: run.agencyId,
      deletedAt: null,
      client: { deletedAt: null, status: "ACTIVE" },
    },
    select: { id: true, name: true, locationCode: true },
  });
  if (!project) return { status: "inactive" };

  const business = await db.localBusiness.findFirst({
    where: { agencyId: run.agencyId, projectId: project.id },
    select: { id: true, name: true },
  });
  if (!business) return { status: "no-business" };

  const takenOn = day(run.date);
  const today = await db.reviewSnapshot.findFirst({
    where: { agencyId: run.agencyId, projectId: project.id, takenOn },
    select: { id: true },
  });
  if (today) return { status: "already-checked" };

  const { data } = await gateway.getReviews(
    { agencyId: run.agencyId, projectId: project.id },
    { businessName: business.name, locationCode: project.locationCode },
  );

  const fetched = data.recent.map((r) => ({ ...r, key: reviewKey(r) }));
  const known = new Set(
    (
      await db.review.findMany({
        where: {
          agencyId: run.agencyId,
          projectId: project.id,
          key: { in: fetched.map((f) => f.key) },
        },
        select: { key: true },
        take: fetched.length + 1,
      })
    ).map((k) => k.key),
  );
  const fresh = fetched.filter((f) => !known.has(f.key));
  // Newest first, so alerts and lists start with the latest.
  fresh.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const hadBefore = await db.reviewSnapshot.count({
    where: { agencyId: run.agencyId, projectId: project.id, takenOn: { lt: takenOn } },
  });

  for (const r of fresh) {
    const suggestedReply = await replies.suggestReply({
      businessName: business.name,
      reviewerName: r.author,
      rating: r.rating,
      text: r.text,
    });
    await db.review.createMany({
      data: [
        {
          agencyId: run.agencyId,
          projectId: project.id,
          key: r.key,
          author: r.author.slice(0, 120),
          rating: r.rating,
          text: r.text.slice(0, 2000),
          publishedAt: day(r.publishedAt),
          firstSeenOn: takenOn,
          suggestedReply,
        },
      ],
      skipDuplicates: true,
    });
  }

  const isRepeat = hadBefore > 0;
  try {
    await db.reviewSnapshot.create({
      data: {
        agencyId: run.agencyId,
        projectId: project.id,
        takenOn,
        ratingTenths: toTenths(data.rating),
        reviewCount: data.reviewCount,
        newReviews: isRepeat ? fresh.length : 0,
      },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { status: "already-checked" };
    throw error;
  }
  await db.localBusiness.updateMany({
    where: { id: business.id, agencyId: run.agencyId },
    data: { lastCheckedOn: takenOn },
  });

  let alerted = false;
  if (isRepeat) {
    const draft = buildReviewAlert({
      projectId: project.id,
      projectName: project.name,
      date: run.date,
      reviews: fresh,
    });
    if (draft) alerted = (await createAlerts(db, run.agencyId, [draft])) > 0;
  }
  return {
    status: "done",
    newReviews: isRepeat ? fresh.length : 0,
    lowReviews: isRepeat ? fresh.filter((r) => r.rating <= 2).length : 0,
    alerted,
  };
}
