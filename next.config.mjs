/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ['postgres'] },
  poweredByHeader: false,
};
export default nextConfig;
