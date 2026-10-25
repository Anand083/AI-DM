import type { Prisma } from "@prisma/client";
import { cleanText, type AssistantBundle } from "@/lib/assistant";
import type { Db } from "@/server/db/client";
import type { AssistantProvider } from "@/server/providers/assistant/types";

export type AssistantRunResult =
  | { status: "skipped" }
  | { status: "no-access" }
  | { status: "failed" }
  | { status: "answered"; actions: number };

/**
 * Answers one waiting question: builds the facts the asking person is allowed to see, asks the
 * provider, saves the answer with its evidence and confidence, and saves the suggested actions
 * as proposals (nothing is done until a person approves). A question is answered once.
 */
export async function runAssistant(
  deps: {
    db: Db;
    provider: AssistantProvider;
    /** Facts for the project as the asking person sees them. Null when that person lost access. */
    buildBundle: (
      userId: string,
      agencyId: string,
      projectId: string,
    ) => Promise<AssistantBundle | null>;
  },
  run: { agencyId: string; projectId: string; messageId: string },
): Promise<AssistantRunResult> {
  const { db } = deps;
  const question = await db.assistantMessage.findFirst({
    where: {
      id: run.messageId,
      agencyId: run.agencyId,
      projectId: run.projectId,
      role: "USER",
      status: "PENDING",
    },
    select: { id: true, userId: true, content: true },
  });
  if (!question) return { status: "skipped" };

  const fail = async (status: "FAILED") => {
    await db.assistantMessage.updateMany({
      where: { id: question.id, agencyId: run.agencyId, status: "PENDING" },
      data: { status },
    });
  };

  let bundle: AssistantBundle | null;
  try {
    bundle = await deps.buildBundle(question.userId, run.agencyId, run.projectId);
  } catch {
    await fail("FAILED");
    return { status: "failed" };
  }
  if (!bundle) {
    await fail("FAILED");
    return { status: "no-access" };
  }
  let answer;
  try {
    answer = await deps.provider.answer(question.content, bundle);
  } catch {
    await fail("FAILED");
    return { status: "failed" };
  }

  // Claim the question first, so a retry cannot save a second answer.
  const claimed = await db.assistantMessage.updateMany({
    where: { id: question.id, agencyId: run.agencyId, status: "PENDING" },
    data: { status: "DONE" },
  });
  if (claimed.count === 0) return { status: "skipped" };
  const saved = await db.assistantMessage.create({
    data: {
      agencyId: run.agencyId,
      projectId: run.projectId,
      userId: question.userId,
      role: "ASSISTANT",
      content: cleanText(answer.answer, 2000),
      replyToId: question.id,
      evidence: answer.evidence as unknown as Prisma.InputJsonValue,
      confidence: answer.confidence,
      provider: deps.provider.name,
    },
    select: { id: true },
  });
  if (answer.actions.length > 0) {
    await db.assistantAction.createMany({
      data: answer.actions.map((a) => ({
        agencyId: run.agencyId,
        projectId: run.projectId,
        messageId: saved.id,
        type: a.type,
        payload: a as unknown as Prisma.InputJsonValue,
      })),
    });
  }
  return { status: "answered", actions: answer.actions.length };
}
