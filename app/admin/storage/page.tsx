import type { Metadata } from 'next';
import Link from 'next/link';
import { isAdminEmail } from '../../admin-auth';
import { chatGPTSignInPath, getChatGPTUser } from '../../chatgpt-auth';
import StoragePanel from './storage-panel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '保存容量 | ID東都', robots: { index: false, follow: false } };

export default async function StoragePage() {
  const user = await getChatGPTUser();
  if (!user) return <main><h1>保存容量</h1><a href={chatGPTSignInPath('/admin/storage')}>管理者としてサインイン</a></main>;
  const { env } = await import('cloudflare:workers');
  const settings = env as unknown as { ADMIN_EMAILS?: string };
  if (!isAdminEmail(user.email, settings.ADMIN_EMAILS)) return <main><h1>管理権限がありません</h1><Link href="/">ID東都へ戻る</Link></main>;
  return <main className="site-shell" style={{ maxWidth: 900, padding: 24 }}>
    <Link href="/admin">CSV管理へ戻る</Link>
    <h1>保存容量</h1>
    <StoragePanel />
  </main>;
}
