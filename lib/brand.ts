/** Installation-wide branding. Values are rendered as text, never HTML. */
export const brand = {
  name: process.env.NEXT_PUBLIC_APP_NAME?.trim() || 'Mainline',
  company: process.env.NEXT_PUBLIC_COMPANY_NAME?.trim() || 'Rogers Systems Solutions',
  attribution: process.env.NEXT_PUBLIC_BRAND_ATTRIBUTION?.trim() || 'by RSS',
};
