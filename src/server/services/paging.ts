export const MAX_PAGE_SIZE = 100;

export type Page = { page?: number; pageSize?: number };

/** Turns page numbers (starting at 1) into Prisma `take` and `skip`. The size is capped. */
export function paging({ page = 1, pageSize = 25 }: Page) {
  const size = Number.isFinite(pageSize) ? Math.floor(pageSize) : 25;
  const take = Math.min(Math.max(1, size), MAX_PAGE_SIZE);
  const number = Number.isFinite(page) ? Math.floor(page) : 1;
  return { take, skip: (Math.max(1, number) - 1) * take };
}
