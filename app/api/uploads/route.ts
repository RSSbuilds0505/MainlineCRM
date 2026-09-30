import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getViewer } from '@/lib/auth';
import { allow } from '@/lib/ratelimit';
import { BUCKET } from '@/lib/storage';
import { UserError, prepareUpload } from '@/lib/workflow';

export const dynamic = 'force-dynamic';

/** Step 1 of an upload: checks the file and returns a one-time token for uploading straight to storage. */
export async function POST(req: Request): Promise<NextResponse> {
  const v = await getViewer();
  if (!v) return NextResponse.json({ error: 'Your session ended. Sign in again to attach files.' }, { status: 401 });
  const db = getDb();
  const lim = await allow(db, `upload:${v.id}`, 150, 3600);
  if (!lim.ok) return NextResponse.json({ error: `Upload limit reached. Try again in ${Math.ceil(lim.retryAfter / 60)} minutes.` }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { requestId?: string; name?: string; size?: number; type?: string };
  const target = body.requestId ? { requestId: String(body.requestId) } : { draft: true as const };
  try {
    const up = await prepareUpload(db, v, target, { name: String(body.name ?? 'file'), size: Number(body.size ?? 0), type: String(body.type ?? '') });
    return NextResponse.json({ ...up, bucket: BUCKET });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('[uploads] prepare failed', e);
    return NextResponse.json({ error: 'Could not start the upload. Try again.' }, { status: 500 });
  }
}
