import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Hive',
  description: 'RK3528A 分布式边缘节点集群管理系统',
  lang: 'zh-CN',
  base: process.env.VITE_BASE ?? '/',
  themeConfig: {
    nav: [
      { text: '快速开始', link: '/BUILD' },
      { text: 'API', link: '/NODE-REGISTRY-API' },
    ],
    sidebar: [
      {
        text: '入门',
        items: [
          { text: '概览', link: '/' },
          { text: '快速参考', link: '/quick-reference' },
          { text: '构建镜像', link: '/BUILD' },
          { text: '首次启动（Provision）', link: '/PROVISION' },
        ],
      },
      {
        text: '日常运维',
        items: [
          { text: '节点操作', link: '/NODE-OPERATIONS' },
          { text: '故障排查', link: '/TROUBLESHOOTING' },
        ],
      },
      {
        text: '安全',
        items: [
          { text: '安全概述', link: '/SECURITY-SUMMARY' },
          { text: '防火墙（UFW）', link: '/FIREWALL' },
          { text: '入侵防护（fail2ban）', link: '/FAIL2BAN' },
        ],
      },
      {
        text: 'API',
        items: [
          { text: 'Node Registry API', link: '/NODE-REGISTRY-API' },
        ],
      },
      {
        text: '服务端部署',
        collapsed: true,
        items: [
          { text: '概览', link: '/management/00-overview' },
          { text: '境外 VPS（frps + EasyTier）', link: '/management/01-foreign-vps' },
          { text: '管理 VPS（Registry + 监控）', link: '/management/02-china-vps' },
          { text: 'Cloudflare 凭证', link: '/management/03-cloudflare-tokens' },
          { text: 'Tailscale OAuth', link: '/management/04-tailscale-key' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/SakuraPuare/rk3528-hive' },
    ],
    search: { provider: 'local' },
  },
})
