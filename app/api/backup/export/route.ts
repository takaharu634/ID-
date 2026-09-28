import { backupExportResponse } from '../../../../server/backup-service.mjs';
export const runtime = 'edge';
export async function GET(request: Request) {
  const { env } = await import('cloudflare:workers');
  return backupExportResponse(request, env);
}
