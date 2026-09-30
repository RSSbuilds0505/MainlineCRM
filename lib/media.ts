/** Pure rules for attachments: which files are allowed, safe names, and recognizing video links. No I/O here. */

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // Supabase Storage free-plan per-file limit
export const MAX_ATTACHMENTS_PER_REQUEST = 100;

const ALLOWED: Record<string, string> = {
  'image/png': 'Screenshot', 'image/jpeg': 'Image', 'image/gif': 'Image', 'image/webp': 'Image', 'image/heic': 'Image',
  'video/mp4': 'Video', 'video/webm': 'Video', 'video/quicktime': 'Video',
  'application/pdf': 'PDF', 'text/plain': 'Text file', 'text/csv': 'CSV',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Spreadsheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'Slides',
};
/** The accept attribute for file pickers. */
export const ACCEPT = Object.keys(ALLOWED).join(',');
export const allowedType = (mime: string): boolean => Object.prototype.hasOwnProperty.call(ALLOWED, mime);
export const typeLabel = (mime: string | null | undefined): string => (mime && ALLOWED[mime]) || 'File';
export const isImage = (mime: string | null | undefined): boolean => !!mime && mime.startsWith('image/') && mime !== 'image/heic';
export const isVideo = (mime: string | null | undefined): boolean => !!mime && mime.startsWith('video/');

/** Storage-safe file name: keeps letters, numbers, dots, dashes and underscores. */
export function safeName(name: string): string {
  const base = name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '-');
  const clean = base.replace(/^\.+/, '').slice(-80);
  return clean || 'file';
}

export function fmtBytes(n: number | null | undefined): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export type VideoLink = { provider: 'Loom' | 'YouTube' | 'Vimeo'; embed: string };

/** Recognizes Loom, YouTube and Vimeo links and returns an embeddable player URL. */
export function videoEmbed(url: string | null | undefined): VideoLink | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\./, '');
  let m: RegExpMatchArray | null;
  if (host === 'loom.com' && (m = u.pathname.match(/^\/(?:share|embed)\/([a-zA-Z0-9]{16,64})/))) return { provider: 'Loom', embed: `https://www.loom.com/embed/${m[1]}` };
  if (host === 'youtu.be' && (m = u.pathname.match(/^\/([\w-]{6,20})/))) return { provider: 'YouTube', embed: `https://www.youtube-nocookie.com/embed/${m[1]}` };
  if ((host === 'youtube.com' || host === 'm.youtube.com') && u.pathname === '/watch' && /^[\w-]{6,20}$/.test(u.searchParams.get('v') ?? '')) return { provider: 'YouTube', embed: `https://www.youtube-nocookie.com/embed/${u.searchParams.get('v')}` };
  if (host === 'vimeo.com' && (m = u.pathname.match(/^\/(\d{5,12})/))) return { provider: 'Vimeo', embed: `https://player.vimeo.com/video/${m[1]}` };
  return null;
}

/** Validates a pasted link and gives it a readable name. */
export function checkLink(raw: string): { url: string; name: string } | null {
  const text = raw.trim();
  if (!text || text.length > 600) return null;
  let u: URL;
  try { u = new URL(text); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const v = videoEmbed(u.toString());
  return { url: u.toString(), name: v ? `${v.provider} video` : u.hostname.replace(/^www\./, '') };
}
