import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase/server';

/** Verifies a one-time sign-in link (token hash) and starts a session. Works in any browser. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const u = req.nextUrl;
  const tokenHash = u.searchParams.get('token_hash');
  const type = (u.searchParams.get('type') ?? 'magiclink') as EmailOtpType;
  const dest = u.clone(); dest.search = '';
  if (tokenHash) {
    const { error } = await supabaseServer().auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) { dest.pathname = '/'; return NextResponse.redirect(dest); }
  }
  dest.pathname = '/login'; dest.search = '?e=expired';
  return NextResponse.redirect(dest);
}
