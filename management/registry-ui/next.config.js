/** @type {import('next').NextConfig} */
const nextConfig = {
  // 静态导出：由 nginx 直接托管生成的 out/ 目录
  output: 'export',
  reactStrictMode: true,
  turbopack: {
    root: __dirname,
  },
};

module.exports = nextConfig;

