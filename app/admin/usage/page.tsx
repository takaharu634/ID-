import type { Metadata } from 'next';
import Link from 'next/link';
import { isAdminEmail } from '../../admin-auth';
import { chatGPTSignInPath, getChatGPTUser } from '../../chatgpt-auth';
import UsagePanel from './usage-panel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '項目の利用状況 | ID東都', robots: { index: false, follow: false } };

export default async function UsagePage() {
  const user = await getChatGPTUser();
  if (!user) return <main><h1>項目の利用状況</h1><a href={chatGPTSignInPath('/admin/usage')}>管理者としてサインイン</a></main>;
  const { env } = await import('cloudflare:workers');
  if (!isAdminEmail(user.email, env.ADMIN_EMAILS)) return <main><h1>管理権限がありません</h1><Link href="/">ID東都へ戻る</Link></main>;
  return <main className="site-shell" style={{ maxWidth: 900, padding: 24 }}>
    <Link href="/admin">CSV管理へ戻る</Link>
    <h1>項目の利用状況</h1>
    <UsagePanel />
  </main>;
}
