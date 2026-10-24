export type CallbackMode = "poll" | "pingback" | "postback";

/**
 * Fields to add to a `task_post` request so DataForSEO tells us when the task is done.
 * `$id` and `$tag` are placeholders that DataForSEO fills in. With "poll" nothing is added and
 * the poll job asks for ready tasks instead (this works on localhost).
 */
export function callbackFields(
  mode: CallbackMode,
  appUrl: string,
  secret: string,
): Record<string, string> {
  const base = appUrl.replace(/\/+$/, "");
  const encoded = encodeURIComponent(secret);
  if (mode === "pingback") {
    return {
      pingback_url: `${base}/api/providers/dataforseo/pingback?id=$id&tag=$tag&secret=${encoded}`,
    };
  }
  if (mode === "postback") {
    return {
      postback_url: `${base}/api/providers/dataforseo/postback?secret=${encoded}`,
      postback_data: "advanced",
    };
  }
  return {};
}
