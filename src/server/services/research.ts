import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { LANGUAGE_CODES } from "@/data/languages";
import { LOCATION_CODES } from "@/data/locations";
import { INTENTS } from "@/lib/research";
import { can } from "@/server/auth/permissions";
import type { TenantContext } from "@/server/auth/tenant-context";
import { db } from "@/server/db/client";
import type { KeywordIdea } from "@/server/providers/seo/types";
import { logActivity } from "./activity";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import { addKeywords, type AddKeywordsResult } from "./keywords";
import { paging, type Page } from "./paging";
import { getSeoGateway } from "./seo-gateway-instance";
import { parseInput } from "./validation";

/** How many ideas one search asks for. */
export const IDEAS_PER_SEARCH = 100;
export const MAX_LIST_ITEMS = 5000;
export const MAX_LISTS = 200;

export const searchSchema = z.object({
  seed: z
    .string()
    .trim()
    .min(2, "Enter at least 2 characters.")
    .max(80, "Use 80 characters or fewer.")
    .transform((v) => v.toLowerCase().replace(/\s+/g, " ")),
  locationCode: z.coerce
    .number()
    .int()
    .refine((v) => LOCATION_CODES.has(v), "Choose a country from the list."),
  languageCode: z.string().refine((v) => LANGUAGE_CODES.has(v), "Choose a language from the list."),
});

export type ResearchResult = {
  ideas: KeywordIdea[];
  /** True when the answer came from earlier results. Those searches are free and do not count against the plan. */
  cached: boolean;
};

function requireRun(ctx: TenantContext): void {
  if (!can(ctx.role, "tools.run")) throw new ForbiddenError();
}

/**
 * Finds keyword ideas for a seed keyword. New searches count against the plan's monthly keyword
 * research limit; repeating a search is answered from the saved results and is free.
 */
export async function searchKeywordIdeas(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<ResearchResult> {
  requireRun(ctx);
  const input = parseInput(searchSchema, rawInput);
  const result = await getSeoGateway().getKeywordIdeas(
    { agencyId: ctx.agencyId },
    {
      seed: input.seed,
      locationCode: input.locationCode,
      languageCode: input.languageCode,
      limit: IDEAS_PER_SEARCH,
    },
  );
  return { ideas: result.data, cached: result.cached };
}

// ---------------------------------------------------------------------------
// Saved lists
// ---------------------------------------------------------------------------

function requireEdit(ctx: TenantContext): void {
  if (!can(ctx.role, "content.edit")) throw new ForbiddenError();
}

function requireView(ctx: TenantContext): void {
  if (ctx.role === "CLIENT" || !can(ctx.role, "data.view")) throw new ForbiddenError();
}

export const listNameSchema = z
  .string()
  .trim()
  .min(2, "Enter at least 2 characters.")
  .max(80, "Use 80 characters or fewer.");

export const saveItemSchema = z.object({
  phrase: z.string().trim().toLowerCase().min(1).max(100),
  volume: z.number().int().min(0).max(1_000_000_000),
  cpcMicros: z.number().int().min(0).max(1_000_000_000),
  difficulty: z.number().int().min(0).max(100),
  intent: z.enum(INTENTS as [string, ...string[]]),
  locationCode: z
    .number()
    .int()
    .refine((v) => LOCATION_CODES.has(v)),
  languageCode: z.string().refine((v) => LANGUAGE_CODES.has(v)),
});
export type SaveItem = z.infer<typeof saveItemSchema>;

export const saveToListSchema = z
  .object({
    listId: z.string().min(1).max(100).optional(),
    newListName: listNameSchema.optional(),
    items: z.array(saveItemSchema).min(1, "Select at least one keyword.").max(IDEAS_PER_SEARCH),
  })
  .refine((v) => Boolean(v.listId) !== Boolean(v.newListName), {
    message: "Choose a list or enter a new list name.",
    path: ["listId"],
  });

export async function listKeywordLists(ctx: TenantContext) {
  requireView(ctx);
  const lists = await db.keywordList.findMany({
    where: { agencyId: ctx.agencyId },
    select: { id: true, name: true, createdAt: true, _count: { select: { items: true } } },
    orderBy: { name: "asc" },
    take: MAX_LISTS,
  });
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    createdAt: l.createdAt,
    itemCount: l._count.items,
  }));
}

export async function getKeywordList(ctx: TenantContext, listId: string) {
  requireView(ctx);
  const list = await db.keywordList.findFirst({
    where: { id: listId, agencyId: ctx.agencyId },
    select: { id: true, name: true, createdAt: true },
  });
  if (!list) throw new NotFoundError("List not found.");
  return list;
}

export async function listKeywordListItems(ctx: TenantContext, listId: string, p: Page = {}) {
  await getKeywordList(ctx, listId);
  const { take, skip } = paging({ pageSize: 50, ...p });
  const where = { agencyId: ctx.agencyId, listId };
  const [rows, total] = await Promise.all([
    db.keywordListItem.findMany({
      where,
      select: {
        id: true,
        phrase: true,
        volume: true,
        cpcMicros: true,
        difficulty: true,
        intent: true,
        locationCode: true,
        languageCode: true,
      },
      orderBy: [{ volume: "desc" }, { phrase: "asc" }],
      take,
      skip,
    }),
    db.keywordListItem.count({ where }),
  ]);
  return { rows, total };
}

export const LIST_EXPORT_LIMIT = MAX_LIST_ITEMS;

export async function listKeywordListItemsForExport(ctx: TenantContext, listId: string) {
  await getKeywordList(ctx, listId);
  return db.keywordListItem.findMany({
    where: { agencyId: ctx.agencyId, listId },
    select: {
      phrase: true,
      volume: true,
      cpcMicros: true,
      difficulty: true,
      intent: true,
      locationCode: true,
      languageCode: true,
    },
    orderBy: [{ volume: "desc" }, { phrase: "asc" }],
    take: LIST_EXPORT_LIMIT,
  });
}

/** Saves researched keywords to a list (an existing one, or a new one made on the spot). Repeats are skipped. */
export async function saveToList(
  ctx: TenantContext,
  rawInput: unknown,
): Promise<{ listId: string; added: number; skipped: number }> {
  requireEdit(ctx);
  const input = parseInput(saveToListSchema, rawInput);

  let listId = input.listId;
  if (listId) {
    await getKeywordList(ctx, listId);
  } else {
    const count = await db.keywordList.count({ where: { agencyId: ctx.agencyId } });
    if (count >= MAX_LISTS) throw new ConflictError(`You can have up to ${MAX_LISTS} lists.`);
    try {
      const created = await db.keywordList.create({
        data: { agencyId: ctx.agencyId, name: input.newListName!, createdById: ctx.userId },
        select: { id: true },
      });
      listId = created.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ValidationError("You already have a list with this name.", {
          newListName: "You already have a list with this name.",
        });
      }
      throw error;
    }
  }

  const existing = await db.keywordListItem.count({ where: { agencyId: ctx.agencyId, listId } });
  if (existing + input.items.length > MAX_LIST_ITEMS) {
    throw new ConflictError(`A list can hold up to ${MAX_LIST_ITEMS} keywords.`);
  }
  const unique = [...new Map(input.items.map((i) => [i.phrase, i])).values()];
  const result = await db.keywordListItem.createMany({
    data: unique.map((i) => ({ ...i, agencyId: ctx.agencyId, listId: listId! })),
    skipDuplicates: true,
  });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "research.saved",
    targetType: "KeywordList",
    targetId: listId,
    metadata: { added: result.count },
  });
  return { listId: listId!, added: result.count, skipped: unique.length - result.count };
}

export async function removeListItems(
  ctx: TenantContext,
  listId: string,
  itemIds: string[],
): Promise<number> {
  requireEdit(ctx);
  await getKeywordList(ctx, listId);
  const ids = itemIds.filter((id) => typeof id === "string" && id.length <= 100).slice(0, 1000);
  if (ids.length === 0) return 0;
  return (
    await db.keywordListItem.deleteMany({
      where: { agencyId: ctx.agencyId, listId, id: { in: ids } },
    })
  ).count;
}

export async function renameKeywordList(
  ctx: TenantContext,
  listId: string,
  rawName: unknown,
): Promise<void> {
  requireEdit(ctx);
  const name = parseInput(listNameSchema, rawName);
  await getKeywordList(ctx, listId);
  try {
    await db.keywordList.update({ where: { id: listId, agencyId: ctx.agencyId }, data: { name } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ValidationError("You already have a list with this name.");
    }
    throw error;
  }
}

export async function deleteKeywordList(ctx: TenantContext, listId: string): Promise<void> {
  if (!can(ctx.role, "content.delete")) throw new ForbiddenError();
  await getKeywordList(ctx, listId);
  await db.keywordList.delete({ where: { id: listId, agencyId: ctx.agencyId } });
  await logActivity({
    agencyId: ctx.agencyId,
    actorUserId: ctx.userId,
    action: "research.list_deleted",
    targetType: "KeywordList",
    targetId: listId,
  });
}

/** Adds researched keywords to a project's rank tracker (same rules and plan limit as pasting them). */
export async function addResearchToTracker(
  ctx: TenantContext,
  projectId: string,
  phrases: string[],
): Promise<AddKeywordsResult> {
  requireEdit(ctx);
  const clean = phrases.filter((p) => typeof p === "string").slice(0, MAX_LIST_ITEMS);
  return addKeywords(ctx, projectId, { text: clean.join("\n"), tags: "research" });
}
