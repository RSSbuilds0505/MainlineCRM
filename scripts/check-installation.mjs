/** Checks deployment configuration without connecting or printing credentials. */
const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL', 'APP_URL', 'OWNER_EMAIL', 'OWNER_NAME', 'CRON_SECRET'];
const errors = required.filter(key => !process.env[key]?.trim()).map(key => `${key} is missing`);
for (const key of ['APP_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
  if (!process.env[key]) continue;
  try {
    const url = new URL(process.env[key]);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') errors.push(`${key} must be an HTTPS origin without credentials, a path, or query parameters`);
  } catch { errors.push(`${key} is not a valid URL`); }
}
if (process.env.OWNER_EMAIL && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.OWNER_EMAIL)) errors.push('OWNER_EMAIL is invalid');
if (process.env.CRON_SECRET && process.env.CRON_SECRET.length < 32) errors.push('CRON_SECRET must contain at least 32 characters');
if (process.env.DATABASE_URL) {
  try { if (!['postgres:', 'postgresql:'].includes(new URL(process.env.DATABASE_URL).protocol)) errors.push('DATABASE_URL must be a Postgres connection URL'); }
  catch { errors.push('DATABASE_URL is invalid'); }
}
if (process.env.RESEND_API_KEY && !process.env.EMAIL_FROM) errors.push('EMAIL_FROM is required when email is connected');
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else {
  console.log('Required installation configuration is valid.');
  console.log(`Supabase Site URL: ${new URL(process.env.APP_URL).origin}`);
  console.log(`Supabase redirect: ${new URL(process.env.APP_URL).origin}/auth/callback`);
  console.log('Live database, email, storage and sign-in checks still need to be completed.');
}
