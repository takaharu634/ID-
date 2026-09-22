import { desc } from "drizzle-orm";
import { adminApiGuard } from "../../admin-auth";
import { getDb } from "../../../db";
import { dataImports } from "../../../db/schema";

export const runtime = "edge";

type RuntimeEnv = {
  ADMIN_EMAILS?: string;
};

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const runtimeEnv = env as unknown as RuntimeEnv;
  const authFailure = adminApiGuard(request, runtimeEnv.ADMIN_EMAILS);
  if (authFailure) return authFailure;

  try {
    const db = await getDb();
    const rows = await db.select({
      id: dataImports.id,
      fileName: dataImports.fileName,
      uploadedAt: dataImports.uploadedAt,
      uploadedBy: dataImports.uploadedBy,
      pitchCount: dataImports.pitchCount,
      gameCount: dataImports.gameCount,
      teamCount: dataImports.teamCount,
      isActive: dataImports.isActive,
    }).from(dataImports).orderBy(desc(dataImports.uploadedAt)).limit(12);
    return Response.json({ imports: rows }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ imports: [] }, { headers: { "cache-control": "no-store" } });
  }
}
