import type { Metadata } from "next";
import { AssistantChat } from "@/components/app/assistant-chat";
import { getPageContext } from "@/server/auth/page-context";
import { can } from "@/server/auth/permissions";
import { ASSISTANT_DAILY_LIMIT, listConversation } from "@/server/services/assistant";

export const metadata: Metadata = { title: "Assistant" };
export const dynamic = "force-dynamic";

export default async function AssistantPage({
  params,
}: {
  params: Promise<{ agencySlug: string; projectId: string }>;
}) {
  const { agencySlug, projectId } = await params;
  const { ctx } = await getPageContext(agencySlug);
  const items = await listConversation(ctx, projectId);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Assistant</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Ask a question about this website. The answer uses only the numbers saved here (rankings,
          audit, content, keywords, AI visibility, competitors, goals and links), shows what it is
          based on and how sure it is, and can suggest next steps. Nothing is changed unless you
          approve it. Only you can see your questions. Your agency can ask {ASSISTANT_DAILY_LIMIT}{" "}
          questions a day.
        </p>
      </div>
      <AssistantChat
        agencySlug={agencySlug}
        projectId={projectId}
        items={items}
        canAsk={can(ctx.role, "tools.run")}
        canEdit={can(ctx.role, "content.edit")}
      />
    </div>
  );
}
