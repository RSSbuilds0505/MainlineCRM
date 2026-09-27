import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

/** Handles Supabase's default magic-link email (PKCE code exchange). Used when Resend is not configured. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const code = req.nextUrl.searchParams.get('code');
  const dest = req.nextUrl.clone(); dest.search = '';
  if (code) {
    const { error } = await supabaseServer().auth.exchangeCodeForSession(code);
    if (!error) { dest.pathname = '/'; return NextResponse.redirect(dest); }
  }
  dest.pathname = '/login'; dest.search = '?e=expired';
  return NextResponse.redirect(dest);
}
