import { adminApiGuard } from '../../admin-auth';
import { storageHealthResponse } from '../../../server/storage-health.mjs';

export const runtime = 'edge';

// Existing administrator authentication is unchanged. Metadata reads only.
export async function GET(request: Request) {
  const { env } = await import('cloudflare:workers');
  const storage = env as unknown as { BUCKET?: R2Bucket; ADMIN_EMAILS?: string };
  return storageHealthResponse(request, storage, adminApiGuard);
}
