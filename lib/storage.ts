/**
 * File storage for attachments. Production uses a private Supabase Storage bucket: browsers upload
 * straight to storage with a one-time signed upload token, and files are shown through short-lived
 * signed links. Tests swap in an in-memory implementation.
 */
import { supabaseAdmin } from './supabase/server';
import { MAX_UPLOAD_BYTES } from './media';

export const BUCKET = 'attachments';

export type StoredInfo = { size: number; mime: string | null };
export interface FileStore {
  ensureBucket(): Promise<void>;
  signUpload(path: string): Promise<{ token: string }>;
  info(path: string): Promise<StoredInfo | null>;
  signedUrls(paths: string[], seconds: number): Promise<Map<string, string>>;
  remove(paths: string[]): Promise<void>;
}

const supabaseStore: FileStore = {
  async ensureBucket() {
    const admin = supabaseAdmin();
    const { data } = await admin.storage.getBucket(BUCKET);
    if (data) return;
    const { error } = await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_UPLOAD_BYTES });
    if (error && !/exists/i.test(error.message)) throw new Error(`Could not create the attachments bucket: ${error.message}`);
  },
  async signUpload(path) {
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(`Could not prepare the upload: ${error?.message ?? 'no data'}`);
    return { token: data.token };
  },
  async info(path) {
    const slash = path.lastIndexOf('/');
    const dir = path.slice(0, slash), file = path.slice(slash + 1);
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).list(dir, { search: file, limit: 5 });
    if (error || !data) return null;
    const hit = data.find((f) => f.name === file);
    if (!hit) return null;
    const meta = (hit.metadata ?? {}) as { size?: number; mimetype?: string };
    return { size: Number(meta.size ?? 0), mime: meta.mimetype ?? null };
  },
  async signedUrls(paths, seconds) {
    const out = new Map<string, string>();
    if (!paths.length) return out;
    const { data } = await supabaseAdmin().storage.from(BUCKET).createSignedUrls(paths, seconds);
    for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
    return out;
  },
  async remove(paths) {
    if (paths.length) await supabaseAdmin().storage.from(BUCKET).remove(paths);
  },
};

let current: FileStore = supabaseStore;
export const store = (): FileStore => current;
export function setStoreForTests(s: FileStore): void { current = s; }

/** In-memory store for tests. */
export function memoryStore(): FileStore & { put(path: string, size: number, mime: string): void } {
  const files = new Map<string, StoredInfo>();
  return {
    async ensureBucket() {},
    async signUpload(path) { return { token: `t-${path}` }; },
    async info(path) { return files.get(path) ?? null; },
    async signedUrls(paths) { return new Map(paths.filter((p) => files.has(p)).map((p) => [p, `https://files.test/${p}`])); },
    async remove(paths) { paths.forEach((p) => files.delete(p)); },
    put(path, size, mime) { files.set(path, { size, mime }); },
  };
}
