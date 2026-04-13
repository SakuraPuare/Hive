# 内核配置优化

每个板子对应一个优化脚本，构建时自动从 Armbian 基线 config 生成定制版本。

## 工作原理

```
Armbian 基线 config ──→ 优化脚本 ──→ 定制 config（构建时生成，不入库）
```

- `nanopi-zero2.sh` — 基于 `linux-rk35xx-vendor.config` (kernel 6.1)
- `nanopi-r3s.sh` — 基于 `linux-rockchip64-current.config` (kernel 6.18)

构建时 `build.sh` 自动调用对应脚本，无需手动操作。

## 优化内容

两个脚本禁用的内容基本一致，都是 RK3528/RK3566 路由器场景不需要的：

| 类别 | 禁用项 | 理由 |
|------|--------|------|
| 过时网络协议 | AppleTalk, X.25, LAPB, Phonet | 已废弃，无人使用 |
| PCIe WiFi 驱动 | Atheros, Broadcom legacy, Ralink rt2x00 等 | 板子无 PCIe 插槽 |
| 更多过时 WiFi | HostAP (Prism), Libertas, Unisoc | 上古硬件 |
| USB 视频采集 | em28xx, cx231xx, go7007, hdpvr 等 | 路由器不做视频采集 |
| DVB 前端芯片 | 十余种卫星/有线电视解调器 | 路由器不接电视棒 |
| 音频子系统 | 整个 SOUND + 40 余种 SoC codec | headless 不需要声音 |
| 显示/GPU | 整个 DRM + Framebuffer | headless 不需要 HDMI |
| 输入设备 | 游戏手柄、手写板、触摸屏 | 路由器不接这些 |
| 过时文件系统 | ReiserFS, JFS, GFS2, OCFS2, NILFS2, HFS/HFS+ | 只需 ext4/btrfs/f2fs |
| Debug/Profiling | DWARF5, ftrace, kprobes, BTF, LKDTM 等 | 生产镜像不需要 |

nanopi-zero2 特别说明：
- Intel iwlwifi/iwlmvm 保留（AX210 网卡需要）

nanopi-r3s.sh 额外优化：
- `NR_CPUS` 从 256 降到 8（R3S 只有 4 核）
- 禁用 NUMA、XEN（嵌入式不需要）
- 禁用 NFC

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
