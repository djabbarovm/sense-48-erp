import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@finance-os/core', '@finance-os/db', '@finance-os/adapters'],
};

export default nextConfig;
