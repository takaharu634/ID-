import { backupRestoreResponse } from '../../../../server/backup-service.mjs';
import { adminApiGuard } from '../../../admin-auth';
export const runtime = 'edge';
export async function PUT(request: Request) {
  const { env } = await import('cloudflare:workers');
  return backupRestoreResponse(request, env, adminApiGuard);
}
