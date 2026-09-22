import { adminApiGuard } from "../../admin-auth";
import bundledCsvGzip from "private:initial-csv";
import { bundledCsvResponse } from "../../../server/csv-download";

export const runtime = "edge";

type StorageEnv = {
  BUCKET?: R2Bucket;
  ADMIN_EMAILS?: string;
};

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const storage = env as unknown as StorageEnv;
  const url = new URL(request.url);
  const wantsCsv = url.searchParams.get("format") === "csv";
  if (wantsCsv) {
    const authFailure = adminApiGuard(request, storage.ADMIN_EMAILS);
    if (authFailure) return authFailure;
  }

  if (!storage.BUCKET) {
    return wantsCsv ? bundledCsvResponse(bundledCsvGzip) : new Response(null, { status: 204 });
  }
  const key = wantsCsv ? "datasets/current.csv" : "datasets/current.json";
  const object = await storage.BUCKET.get(key);
  if (!object) {
    return wantsCsv ? bundledCsvResponse(bundledCsvGzip) : new Response(null, { status: 204 });
  }

  const headers = new Headers();
  if (object.httpMetadata?.contentLanguage) headers.set('content-language', object.httpMetadata.contentLanguage);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "no-store");
  if (wantsCsv) {
    headers.set("content-type", "text/csv; charset=utf-8");
    headers.set("content-disposition", 'attachment; filename="tohto-trackman-current.csv"');
  } else {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  // Workers and DOM libraries describe the same runtime web stream differently.
  // Preserve streaming here; materializing the full JSON would add a large allocation.
  return new Response(object.body as unknown as ReadableStream<Uint8Array>, { headers });
}
