---
layout: home

hero:
  name: "Hive"
  text: "Rockchip 边缘节点与网关"
  tagline: "同一镜像刷写多台设备。首次启动选用有线网卡 MAC 作为身份，没有设备凭证时向 Registry 登记，并接上管理通道。"
  actions:
    - theme: brand
      text: 开始部署 →
      link: /BUILD
    - theme: alt
      text: 首次启动
      link: /PROVISION

features:
  - icon: 🔌
    title: 同一镜像首启
    details: 出厂镜像不含设备凭证。首启把主机名设为 hive-<mac6>；若已配置 Registry 且还没有 /etc/hive/device-token，会向 /nodes/enroll 登记并写入该文件。登记被拒绝时，需管理员为该 MAC 轮换凭证后再启动。
  - icon: 🌐
    title: 三层管理通道
    details: Tailscale 是主管理面，EasyTier 作备用，FRP 提供应急 SSH。EasyTier 地址由 Registry 按 MAC 在 172.20.0.0/16 分配，同一 MAC 再次登记成功后领回原地址。FRP 端口由完整 MAC 的 MD5 映射到 10000–59999。
  - icon: 🔑
    title: 重刷后的身份
    details: 主机名随有线网卡 MAC 重算，重刷后不变。SSH 主机密钥和节点 xray UUID 在首启随机生成，并保存在数据分区。整卡重刷会换新的 SSH 主机密钥和 xray UUID，指纹变化后需要更新 known_hosts；只切换 A/B 根文件系统时这两项保留。
  - icon: 📊
    title: 注册后的监控
    details: Registry 的 /prometheus-targets 提供 Prometheus file_sd 目标，只包含已启用、状态为 active、且 Tailscale 地址已就绪的节点。EasyTier 地址落在 172.20.0.0/16 时，还会加入该地址上的 node_exporter。Grafana 展示 Prometheus 抓到的指标。
  - icon: 🛡️
    title: 节点安全基线
    details: UFW 默认拒绝入站和转发、允许出站。fail2ban 封禁 SSH 暴力破解和端口扫描。镜像安装并启用 auditd。unattended-upgrades 只安装发行版安全更新，且不自动重启。
  - icon: 📡
    title: 热点与局域网网关
    details: 至少两个有线口时，默认把 WAN 以外的口配成 LAN，下游经 Mihomo 做透明代理。只有一个有线口时不配置这套转发。检测到可做 AP 的无线网卡会自动开热点；默认 SSID 来自身份 MAC，密码写在 /etc/hive/default-hotspot-psk，整卡重刷且未保留数据分区后会变。
---
