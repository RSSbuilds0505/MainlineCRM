import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db';
import { getViewer } from '@/lib/auth';
import { deliver } from '@/lib/notify';
import { UserError, addFiles } from '@/lib/workflow';

export const dynamic = 'force-dynamic';

/** Step 2 of an upload: records the finished files on the request and notifies the other side. */
export async function POST(req: Request): Promise<NextResponse> {
  const v = await getViewer();
  if (!v) return NextResponse.json({ error: 'Your session ended. Sign in again to attach files.' }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { requestId?: string; files?: { path?: string; name?: string }[]; internal?: boolean };
  const files = (body.files ?? []).slice(0, 20).map((f) => ({ path: String(f.path ?? ''), name: String(f.name ?? '') }));
  try {
    const r = await addFiles(getDb(), v, String(body.requestId ?? ''), files, !!body.internal);
    await deliver(r.out);
    revalidatePath('/', 'layout');
    return NextResponse.json({ ok: true, count: r.value });
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error('[uploads] confirm failed', e);
    return NextResponse.json({ error: 'Could not save the attachment. Try again.' }, { status: 500 });
  }
}
