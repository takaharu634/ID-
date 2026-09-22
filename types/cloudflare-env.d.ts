// Import only bindings: Workers HTMLRewriter.Element must not replace the browser DOM Element.
type D1Database = import("@cloudflare/workers-types/2023-07-01").D1Database;
type R2Bucket = import("@cloudflare/workers-types/2023-07-01").R2Bucket;
declare module "cloudflare:workers" {
  export const env: { DB?: D1Database; BUCKET?: R2Bucket; ADMIN_EMAILS?: string };
}
