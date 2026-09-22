const USER_EMAIL_HEADER = "oai-authenticated-user-email";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isAdminEmail(email: string | null, allowlist: string | undefined): boolean {
  if (!email || !allowlist) return false;

  const allowed = new Set(
    allowlist
      .split(/[\n,;]+/)
      .map(normalizeEmail)
      .filter(Boolean),
  );

  return allowed.has(normalizeEmail(email));
}

export function adminApiGuard(request: Request, allowlist: string | undefined): Response | null {
  const email = request.headers.get(USER_EMAIL_HEADER);

  if (!email) {
    return Response.json(
      { error: "管理者としてサインインしてください。" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  if (!isAdminEmail(email, allowlist)) {
    return Response.json(
      { error: "このアカウントには管理権限がありません。" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  return null;
}
