import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  await supabaseServer().auth.signOut();
  const dest = req.nextUrl.clone(); dest.pathname = '/login'; dest.search = '';
  return NextResponse.redirect(dest, { status: 303 });
}
