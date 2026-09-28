import Link from 'next/link';
import { getChatGPTUser, chatGPTSignInPath } from '../../chatgpt-auth';
import { isAdminEmail } from '../../admin-auth';
import RecoveryApp from './recovery-app';
export const dynamic = 'force-dynamic';
export const metadata = { title:'外部バックアップの復旧 | ID東都', robots:{index:false,follow:false} };
export default async function RecoveryPage() {
  const user=await getChatGPTUser();
  const {env}=await import('cloudflare:workers');
  if(!user || !isAdminEmail(user.email,(env as unknown as {ADMIN_EMAILS?:string}).ADMIN_EMAILS)) return <main className="page-wrap"><h1>管理者としてサインインしてください</h1><a href={chatGPTSignInPath('/admin/recovery')}>ChatGPTでサインイン</a><p><Link href="/">公開サイトへ戻る</Link></p></main>;
  return <RecoveryApp/>;
}
