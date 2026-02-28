---
layout: home

hero:
  name: "Hive"
  text: "规模化边缘节点基础设施"
  tagline: "同一镜像，任意数量。设备上电两分钟后自主完成注册、配置与接入——集群规模与运维成本彻底解耦。"
  actions:
    - theme: brand
      text: 开始部署 →
      link: /BUILD
    - theme: alt
      text: 了解架构
      link: /PROVISION

features:
  - icon: 🔌
    title: 零配置部署
    details: 同一镜像刻录至任意数量的设备。首次上电自动完成身份生成、隧道建立与服务初始化，集群从 1 台扩展至 100 台的边际成本趋近于零。
  - icon: 🌐
    title: 三层冗余管理
    details: Tailscale mesh 为主管理面，EasyTier P2P 作热备，FRP 应急隧道兜底。三通道互为冗余，单点故障不影响对整个集群的控制权。
  - icon: 🔑
    title: 确定性节点标识
    details: 主机名、SSH 指纹、服务密钥均由网卡 MAC 确定性派生。重新烧录后节点身份不变，无需更新 known_hosts 或重新分发配置。
  - icon: 📊
    title: 统一可观测性
    details: Prometheus + Grafana 全量指标覆盖，Node Registry 动态服务发现。新节点上线后自动纳入监控，无需手工注册。
  - icon: 🛡️
    title: 纵深安全防护
    details: UFW 默认拒绝全部入站，fail2ban 实时封禁暴力破解，auditd 记录关键变更，unattended-upgrades 自动应用安全补丁。生产级防护，开箱即用。
  - icon: ⚡
    title: ARM64 原生
    details: 专为 RK3528A SoC 裁剪，全链路 arm64 静态二进制，无运行时依赖。典型空载内存占用低于 200 MB。
---
