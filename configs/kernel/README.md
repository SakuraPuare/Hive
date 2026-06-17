# 内核配置优化

每个板子对应一个优化脚本，构建时自动从 Armbian 基线 config 生成定制版本。

## 工作原理

```
Armbian 基线 config ──→ 优化脚本 ──→ userpatches/config/kernel/<LINUXCONFIG>.config
                                       （构建时生成，不入库，Armbian 按文件名自动采用）
```

- `nanopi-zero2.sh` — 基于 `linux-rk35xx-vendor.config` (kernel 6.1)
- `nanopi-r3s.sh` — 基于 `linux-rockchip64-current.config` (kernel 6.18)
- `orangepi4-lts.sh` — 基于 `linux-rockchip64-current.config`（香橙派 Pi 4 LTS / RK3399）

构建时 `build.sh` 自动调用对应脚本，无需手动操作。

> 注意：优化 config 必须用「默认名」（如 `linux-rockchip64-current.config`，不加 `-hive` 后缀）
> 写入 `userpatches/config/kernel/`。Armbian 选 config 只认 `LINUXCONFIG` 变量，且 family
> 配置会无条件覆盖命令行传值，唯一可靠的覆盖入口就是 userpatches 里的同名文件
> （见 `lib/functions/compilation/kernel-config.sh`）。

## 优化内容

两个脚本禁用的内容基本一致，都是 Rockchip ARM 路由器场景不需要的：

| 类别 | 禁用项 | 理由 |
|------|--------|------|
| 过时网络协议 | AppleTalk, X.25, LAPB, Phonet | 已废弃，无人使用 |
| PCIe WiFi 驱动 | Atheros, Broadcom legacy, Ralink rt2x00 等 | 板子无 PCIe 插槽 |
| 更多过时 WiFi | HostAP (Prism), Libertas, Unisoc | 上古硬件 |
| **整个媒体子系统** | `CONFIG_MEDIA_SUPPORT` 顶层一刀切 | V4L/DVB/USB采集/调谐器/红外/SDR 全不需要，olddefconfig 级联清除数百模块 |
| 音频子系统 | 整个 SOUND + 40 余种 SoC codec | headless 不需要声音 |
| 显示/GPU | 整个 DRM + Framebuffer | headless 不需要 HDMI |
| 输入设备 | 游戏手柄、手写板、触摸屏 | 路由器不接这些 |
| CAN 总线 | `CONFIG_CAN` 顶层 | 车载/工业现场总线，不需要 |
| 1-Wire / 业余无线电 | `CONFIG_W1` / `CONFIG_HAMRADIO` | 单总线传感器、AX.25/NetRom 不需要 |
| 过时文件系统 | ReiserFS, JFS, GFS2, OCFS2, NILFS2, HFS/HFS+ | 只需 ext4/btrfs/f2fs |
| Debug/Profiling | DWARF5, ftrace, kprobes, BTF, LKDTM 等 | 生产镜像不需要 |

> 媒体/DRM/SOUND/CAN 等大块一律禁**顶层总开关**，而非逐个点名子项：
> 内核编译前 kbuild 会跑 `olddefconfig`，禁顶层后其下所有依赖子项自动清除，
> 既彻底又不必跟上游改子项名。保留项：HWMON（PWM 风扇调速依赖它）、
> 全部 netfilter/IPVS/QoS（路由器核心）、USB 网卡/存储/串口。

nanopi-zero2 特别说明：
- Intel iwlwifi/iwlmvm 保留（AX210 网卡需要）

nanopi-r3s.sh 额外优化：
- `NR_CPUS` 从 256 降到 8（R3S 只有 4 核）
- 禁用 NUMA、XEN（嵌入式不需要）
- 禁用 NFC、CAN、HAMRADIO

orangepi4-lts.sh 特别说明：
- `NR_CPUS` 从 256 降到 8（RK3399 只有 6 核：2×Cortex-A72 + 4×Cortex-A53）
- 板载 WiFi/BT 是 **Spreadtrum 芯片**（sprdwl_ng / sprdbt_tty out-of-tree 模块，由 Armbian board 配置加载），禁用各类内置 PCIe/USB WiFi 驱动不影响板载无线；保留 RK3399 内置 GMAC（板载 RTL8211F GbE PHY）
- 禁用 DRM（含 rockchip drm / analogix-dp / dw-hdmi）——本项目作为 headless 边缘节点不接屏幕

## 如何更新

Armbian 上游更新基线 config 后，优化脚本通常不需要改动（用 sed 按 key 匹配，不依赖行号）。

如果上游删除了某个 config 项，sed 只是静默跳过，不会报错。

如果需要新增禁用项：

```bash
# 编辑对应脚本，在合适的分类下添加
disable CONFIG_XXX  # 注释说明理由
```

验证方法：

```bash
# 手动运行脚本查看效果
./configs/kernel/nanopi-zero2.sh \
  armbian-build/build/config/kernel/linux-rk35xx-vendor.config \
  /tmp/test.config

# 对比差异
diff armbian-build/build/config/kernel/linux-rk35xx-vendor.config /tmp/test.config
```
