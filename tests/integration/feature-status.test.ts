import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Pretend the configured data source is DataForSEO for these tests.
vi.mock("@/server/providers/seo", () => ({ getSeoProviderName: () => "dataforseo" }));

import { requestAiCheck } from "@/server/services/ai-visibility";
import { ConflictError } from "@/server/services/errors";
import { requestListingCheck } from "@/server/services/locations";
import { requestReviewCheck } from "@/server/services/reviews";
import { createAgencyWithMembers, seedPlans } from "../factories";
import { createTestClient, resetDb } from "../helpers/db";

const prisma = createTestClient();
beforeAll(async () => {
  await resetDb(prisma);
  await seedPlans(prisma);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("features DataForSEO cannot give yet", () => {
  it("are refused with a plain message instead of queueing work that would fail", async () => {
    const { members } = await createAgencyWithMembers(prisma, ["OWNER"], undefined, "GROWTH");
    const ctx = members[0]!.ctx;
    await expect(requestAiCheck(ctx, "p")).rejects.toThrow(
      /AI visibility checks are not available/,
    );
    await expect(requestReviewCheck(ctx, "p")).rejects.toBeInstanceOf(ConflictError);
    await expect(requestListingCheck(ctx, "p")).rejects.toThrow(/Directory listing checks/);
  });
});
