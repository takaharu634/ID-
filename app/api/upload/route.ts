import { buildDatasetFromCsv } from "../../../lib/csv-analytics.js";
import { adminApiGuard } from "../../admin-auth";

export const runtime = "edge";

type RuntimeEnv = {
  DB?: D1Database;
  BUCKET?: R2Bucket;
  ADMIN_EMAILS?: string;
};

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const runtimeEnv = env as unknown as RuntimeEnv;
  const authFailure = adminApiGuard(request, runtimeEnv.ADMIN_EMAILS);
  if (authFailure) return authFailure;

  if (!runtimeEnv.DB || !runtimeEnv.BUCKET) {
    return Response.json({ error: "保存領域が利用できません。" }, { status: 503 });
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    const season = String(form.get("season") ?? "").trim() || "追加データ";
    if (!(file instanceof File)) {
      return Response.json({ error: "CSVファイルを選択してください。" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".csv")) {
      return Response.json({ error: "CSV形式のファイルのみ追加できます。" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json({ error: "CSVは30MB以下にしてください。" }, { status: 413 });
    }

    const csvText = await file.text();
    const uploadedAt = new Date().toISOString();
    const uploadedBy = request.headers.get("oai-authenticated-user-email")!;
    const dataset = buildDatasetFromCsv(csvText, {
      title: `東都大学野球 ${season}`,
      season,
      sourceName: file.name,
      generatedAt: uploadedAt,
    });
    if (dataset.metadata.pitches < 1) {
      return Response.json({ error: "有効な投球データが見つかりませんでした。" }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const rawObjectKey = `datasets/imports/${id}.csv`;
    const summaryObjectKey = `datasets/imports/${id}.json`;
    const datasetJson = JSON.stringify(dataset);

    await runtimeEnv.BUCKET.put(rawObjectKey, csvText, { httpMetadata: { contentType: "text/csv; charset=utf-8" } });
    await runtimeEnv.BUCKET.put(summaryObjectKey, datasetJson, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
    await runtimeEnv.BUCKET.put("datasets/current.csv", csvText, { httpMetadata: { contentType: "text/csv; charset=utf-8" } });
    await runtimeEnv.BUCKET.put("datasets/current.json", datasetJson, { httpMetadata: { contentType: "application/json; charset=utf-8" } });

    await runtimeEnv.DB.batch([
      runtimeEnv.DB.prepare("UPDATE data_imports SET is_active = 0 WHERE is_active = 1"),
      runtimeEnv.DB.prepare(`
        INSERT INTO data_imports (
          id, file_name, uploaded_at, uploaded_by, raw_object_key,
          summary_object_key, pitch_count, game_count, team_count, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).bind(
        id, file.name, uploadedAt, uploadedBy, rawObjectKey, summaryObjectKey,
        dataset.metadata.pitches, dataset.metadata.games, dataset.metadata.teams,
      ),
    ]);

    return Response.json({
      ok: true,
      metadata: dataset.metadata,
      message: `${dataset.metadata.pitches.toLocaleString("ja-JP")}球を反映しました。`,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CSVの処理に失敗しました。";
    return Response.json({ error: message }, { status: 400 });
  }
}
