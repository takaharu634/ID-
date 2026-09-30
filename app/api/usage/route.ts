import { adminApiGuard } from "../../admin-auth";
import { usageFeature } from "../../../lib/feature-usage";

export const runtime = "edge";
const headers = { "cache-control": "no-store" };
const jstDay = (time: number) => new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

// Count at most once per section and tab each day on the client. Store only totals.
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return new Response(null, { status: 415 });
  if (Number(request.headers.get("content-length") || 0) > 256) return new Response(null, { status: 413 });
  try {
    const body = await request.text();
    if (body.length > 256) return new Response(null, { status: 413 });
    const value = JSON.parse(body) as { feature?: unknown };
    if (typeof value.feature !== "string") return new Response(null, { status: 400 });
    const known = value.feature.startsWith("leaders:")
      ? usageFeature("leaders", value.feature.slice(8)) : usageFeature(value.feature);
    if (known !== value.feature)
      return new Response(null, { status: 400 });
    const { env } = await import("cloudflare:workers");
    if (!env.DB) return new Response(null, { status: 503, headers });
    await env.DB.prepare("INSERT INTO feature_daily_views (day, feature, views) VALUES (?, ?, 1) ON CONFLICT (day, feature) DO UPDATE SET views = views + 1")
      .bind(jstDay(Date.now()), value.feature).run();
    return new Response(null, { status: 204, headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const denied = adminApiGuard(request, env.ADMIN_EMAILS);
  if (denied) return denied;
  if (!env.DB) return Response.json({ error: "利用状況を読み取れませんでした。" }, { status: 503, headers });
  try {
    const start = jstDay(Date.now() - 27 * 24 * 60 * 60 * 1000);
    const rows = await env.DB.prepare("SELECT feature, SUM(views) AS views FROM feature_daily_views WHERE day >= ? GROUP BY feature ORDER BY views DESC")
      .bind(start).all<{ feature: string; views: number }>();
    return Response.json({ start, end: jstDay(Date.now()), rows: rows.results }, { headers });
  } catch {
    return Response.json({ error: "利用状況を読み取れませんでした。" }, { status: 503, headers });
  }
}
