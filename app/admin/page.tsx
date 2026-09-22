import type { Metadata } from "next";
import Link from "next/link";
import { isAdminEmail } from "../admin-auth";
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "../chatgpt-auth";
import AdminApp from "./admin-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CSV管理 | ID東都",
  robots: { index: false, follow: false },
};

type AdminEnv = {
  ADMIN_EMAILS?: string;
};

function AccessPage({ title, description, actionHref, actionLabel, account }: {
  title: string;
  description: string;
  actionHref: string;
  actionLabel: string;
  account?: string;
}) {
  return (
    <div className="site-shell">
      <header className="admin-simple-header">
        <Link className="admin-brand-link" href="/">ID東都</Link>
        <Link className="admin-public-link" href="/">公開サイトへ戻る</Link>
      </header>
      <main className="admin-access-wrap">
        <section className="admin-access-card">
          <p className="eyebrow">管理者限定</p>
          <h1>{title}</h1>
          <p>{description}</p>
          {account && <small>現在のアカウント：{account}</small>}
          <div className="hero-actions">
            <a className="primary-button" href={actionHref}>{actionLabel}</a>
            <Link className="secondary-button" href="/">公開サイトを見る</Link>
          </div>
        </section>
      </main>
    </div>
  );
}

export default async function AdminPage() {
  const user = await getChatGPTUser();

  if (!user) {
    return (
      <AccessPage
        title="CSVデータ管理"
        description="CSVの追加、再集計、元データの保存は管理者だけが利用できます。"
        actionHref={chatGPTSignInPath("/admin")}
        actionLabel="ChatGPTでサインイン"
      />
    );
  }

  const { env } = await import("cloudflare:workers");
  const adminEnv = env as unknown as AdminEnv;

  if (!isAdminEmail(user.email, adminEnv.ADMIN_EMAILS)) {
    return (
      <AccessPage
        title="管理権限がありません"
        description="公開データは閲覧できますが、このアカウントではCSV管理を利用できません。"
        actionHref={chatGPTSignOutPath("/admin")}
        actionLabel="別のアカウントでサインイン"
        account={user.email}
      />
    );
  }

  return <AdminApp displayName={user.displayName} />;
}
