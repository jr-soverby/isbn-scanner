// GitHub Pages serves project sites from /<repo-name>, so the build needs that
// prefix. The deploy workflow sets NEXT_PUBLIC_BASE_PATH; locally it's empty.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
