/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@hackathon/shared', '@hackathon/db'],
  output: 'standalone',
};

module.exports = nextConfig;
