# OTA 更新与 NanoPi Zero2 / R28S A/B 镜像

Hive 支持两类签名更新包，均通过后台「OTA 更新」上传并分配设备。

客户网关与可信出口使用同一板型镜像，但出口权限必须单独配置：只有运营方出口安装 `/etc/hive/server-token`。客户镜像默认不运行出口 Xray；固件健康确认只在服务器密钥非空时检查 Xray 服务。设备心跳和 OTA 仍使用 `/etc/hive/device-token`。升级到服务器计费版本的迁移步骤见 [订阅授权说明](subscription-enforcement.md)。

| 类型 | 更新范围 | 生效与回滚 |
|---|---|---|
| application | 脚本、程序、服务单元、静态资源 | 备份后替换；安装、服务重启或健康检查失败时恢复；进程中断后在下次运行或开机时恢复 |
| firmware | NanoPi Zero2 / R28S 各自的内核、DTB、initramfs 和根文件系统 | 写备用槽，读回校验后试启动；健康检查通过才确认；试启动失败后回到原槽 |

**A/B 代码已接入两种板型，U-Boot v2026.07-rc4 的 Zero2 / R28S A/B 产物已实际交叉编译并校验 FIT、设备树和保留区边界；完整系统镜像尚未实编译，三组设备尚未真机验收。** 当前工作区没有足够空间完成完整 Armbian 镜像构建，也没有板卡。应用回滚、固件写入/回切在隔离环境中测试；TF 扩容还验证了真实 `sfdisk` 对普通镜像文件保留系统分区及 UUID。不能把这些检查当成批量上线验收。

## 设备分组与迁移

当前设备按板型、内存和上线状态分为三组：

| 设备 | 状态 | 构建与升级安排 |
|---|---|---|
| NanoPi Zero2，2 GB | 已上线 | 先核对现有系统中的 updater、签名公钥、设备凭证和服务依赖，再接入应用 OTA。当前分区若未初始化为 Hive A/B，须安排离线首刷才能使用 firmware 包；先备份并恢复本机身份与配置。 |
| NanoPi Zero2，1 GB | 未上线 | 沿用 `nanopi-zero2` 配置，以这批设备优先进行 A/B 首刷和升级验收，通过后再上线。内存容量不作为拆分固件包的依据。 |
| NanoPi R28S，1 GB | 未上线 | 使用 `make build-r28s` 或 `make build-ab-r28s VERSION=…`；保留厂商内核的双网口和 AIC8800 SDIO 无线支持，配套独立引导设备树和 firmware 包。不能使用 Zero2/R3S 镜像。 |

[Zero2 官方规格](https://wiki.friendlyelec.com/wiki/index.php/NanoPi_Zero2/zh)列出 1 GB / 2 GB 内存版本；同一构建配置并不代表本仓库产物已经在两种实物上验证。[R28S 官方规格](https://wiki.friendlyelec.com/wiki/index.php/NanoPi_R28S/zh)列出 RK3528A、1 GB 内存、双千兆网口及板载无线。它与 Zero2 同属 RK3528 系列，但板级外围不同，也不是本仓库已有的 RK3566 / NanoPi R3S。

[Armbian 的 R28S 配置](https://github.com/armbian/build/blob/main/config/boards/nanopi-r28s.csc)使用 `vendor` 6.1 内核、`rk3528-nanopi-rev03.dtb` 和 `radxa-aic8800` 扩展。Hive 为其接入固定版本主线 U-Boot，并在 `userpatches/u-boot/hive-r28s-v2026.07/` 保存板级回移补丁；Linux 设备树来源固定到提交 `c1e23f3425c4`，配置依据 [R28S U-Boot 上游 RFC](https://mail-archive.com/u-boot%40lists.u-boot-project.org/msg07609.html)。该固定版本的引导器设备树不含新 USB 节点，因此补丁省略这些节点，只用于 SD/eMMC 引导；不影响厂商 Linux 中的 USB 驱动。该补丁是本仓库适配，不代表 R28S 配置已被 U-Boot 上游合入。

**1 GB / 2 GB 是运行内存，A/B 分区占用的是 TF 卡存储。** 本批设备均使用 32 GB 或 64 GB TF 卡，使用同一板型出厂镜像。首次启动的 `hive-data-grow` 校验 GPT、三个分区名称与边界，仅扩大最后的数据分区并调整 ext4；系统槽、设备标识和分区 UUID 不变。写入 GPT 后中断可在下次启动继续扩展文件系统；不允许改动非 Hive 分区或已挂载的数据分区。

`hive-memory-generator` 按实际 `MemTotal` 在每次启动及 `daemon-reload` 时生成临时服务配置，低于 1.5 GiB 的设备使用 1 GB 档位：Xray 的 `MemoryHigh/MemoryMax` 为 160/224 MiB，Mihomo 为 192/256 MiB，Go 软内存限制分别为 128/160 MiB，部分管理代理也配置较低的 Go 软限制。2 GB 档位分别为 200/300 MiB、384/512 MiB。这些限额用于约束进程，不能保证所有服务满负载同时运行不发生 OOM；验收应观察实际内存峰值、重启和吞吐。管理员可通过 `/etc/systemd/system/<service>.d/90-local-memory.conf` 覆盖。内存环境变量在进程下次启动后生效。

OTA 下载与解包暂存于磁盘 `/var/lib/hive`，不把整个固件包装进内存。首次注册优先选择设备树 `ethernet0` 对应的物理有线网卡，避免 R28S 无线或隧道接口先出现造成身份选择变化；已经完成初始化的设备继续使用持久化身份。

推荐顺序：先验收一台未上线的 1 GB Zero2，再验证一台 2 GB Zero2 的备份、离线迁移与身份恢复，最后逐批更新存量设备。R28S 独立验收双网口、板载无线和固件升级。各组都需验证实际使用的 TF 卡冷启动；不要从已初始化的生产设备复制含凭证的整盘镜像作为新设备母盘。

## 已上线设备首次接入应用 OTA

旧设备没有 updater 时，后台分配更新包不会自动安装客户端。先在可信构建主机构建首次安装包：

```bash
make build-ota-bootstrap VERSION=1.0.0
# output/ota/hive-ota-bootstrap-1.0.0.tar.gz 和 .sha256
```

通过已验证主机密钥的 SSH/SCP 将安装包传到目标设备，并与构建主机输出的 SHA256 比对后解包。此初次安装工具的信任来自该传输及独立校验；不要当作普通 OTA 包上传后台。后续 OTA 仍强制验证 Ed25519 签名。

```bash
# 在目标设备上执行，目录来自已验证的安装包
sudo bash hive-ota-bootstrap-1.0.0/install.sh --check
sudo bash hive-ota-bootstrap-1.0.0/install.sh --install
```

`--check` 只检查 ARM64、板型、依赖、Registry 地址、独立设备 Token、节点信息和公钥；如缺少依赖，应先补齐工具，再执行安装。`--install` 获取 OTA 锁、备份旧文件和定时器状态、原子安装客户端并启用定时器；普通安装错误会恢复旧文件。备份保留在 `/var/lib/hive/ota-bootstrap.*`，供首次安装被断电打断时人工恢复/重新安装。不会覆盖设备身份、运行配置、现有分区，也不会主动重启代理或整机。若已有 OTA 公钥不同，会拒绝替换：必须使用原签名密钥对应的公钥构建工具包。

安装成功后先下发一个应用包，确认任务回执、失败回滚及管理连接正常。要迁移到固件 A/B，仍需备份设备数据并离线整盘首刷。

## 后台上传与发布

1. 更新 Registry、前端和对应 Nginx 配置。Registry 启动自动执行 migration 27，增加 `installing` 和 `rolled_back` 状态。
2. 为 Registry 配置可写、持久化的 `OTA_ARTIFACT_DIR`，默认 `/var/lib/hive-registry/ota`。`setup-vps.sh` 会创建目录。容器部署必须为此目录挂载持久卷，并保证运行用户有写权限；镜像内的空目录不能代替持久卷。
3. 后台「OTA 更新 → 创建 Rollout」选择 `.tar.gz`。浏览器按 16 MiB 分片上传，自动填写版本和整个包的 SHA256，包上限 2 GiB。也可填写外部 HTTP(S) 下载地址。
4. 先分配一台测试节点，通过后再分配更多节点。列表和详情显示等待、安装/试启动、完成、失败、已回滚及设备结果。

上传会话绑定创建管理员，分片重复提交必须内容相同，完成请求可重试。已完成的会话不再接收分片；重试完成请求会重新检查包是否仍存在并续期保留时间。发布包按 SHA256 去重保存。

### 存储保留与回收

Registry 启动时及每小时自动清理一次；也可在「OTA 更新 → 存储管理」查看受管包、上传暂存和可清理空间，并执行相同规则的即时清理。查看需要 `ota:read`，清理需要 `ota:write`；手动清理记入审计日志。

- **默认保留 30 天**：只有超过保留期且没有任何当前设备任务引用的包才可清理。`pending`、`installing`、`done`、`failed`、`rolled_back` 的当前分配都保护其包；多个发布记录共享 SHA256 时，只要任一记录被设备引用，就保留同一个文件。
- **保留最近 3 个不同版本**：应用包、Zero2 固件、R28S 固件分别保留；按最近上传/使用时间排序，不按版本字符串排序。同一版本重复构建只占一个版本名额，默认保留其中最新的一份包；其余包仍受 30 天期限及任务引用保护。
- 保留期依据文件最后上传/分配时间及最新发布记录创建时间。重复上传相同包、重试完成上传、创建新发布记录或再次分配会续期。旧数据直接扫描现有目录和数据库，无需新增数据库迁移。
- 废弃的单次上传临时文件、分片会话、完成回执在 **24 小时无活动后**回收，不依赖再次上传来触发。正在接收的单次上传使用独立文件锁，慢上传不会阻止其他包清理；分片写入、组装、发布、分配及清理也有互斥保护。
- 清理只移除受管的包文件和已过期上传目录，**保留发布记录与当前任务记录**。后台显示「包已清理或缺失」，并禁止再次分配；重新上传相同 SHA256 的包后可继续使用该发布记录。外部 HTTP(S) 下载地址的文件不由 Hive 删除。
- 数据库读取失败会中止清理。无法读取元数据的包、未知文件和符号链接不会自动删除，存储管理页面会显示可识别包的检查异常。已打开的下载通过文件描述符继续完成；空间统计按文件逻辑大小估算，打开文件或硬链接可能延迟实际空间释放。

配置 Registry 的 `OTA_RETENTION_DAYS=30` 可修改保留期；`0` 关闭历史包回收，废弃上传仍按 24 小时清理。无效或负数配置也会禁用历史包回收，以避免错误配置缩短保留期。`setup-vps.sh` 从 `.env` 写入此配置；已部署实例可修改 `/etc/hive-registry.env` 后重启 Registry。

所有写入实例必须运行配套版本、共享同一制品目录和数据库，存储卷必须支持 `flock` 与硬链接。不要混跑不支持存储锁的旧 Registry 写入进程，也不要把不同 Hive 数据库配置到同一制品目录。文件锁覆盖跨进程操作；多实例网络存储还需自行验证锁语义，未验证时继续将所有写入路由到单个 Registry。文件下载不长时间持有全局锁。

设备从 Registry 下载托管包时使用本机凭证，只能下载分配给自己的包；不会把凭证发送给外部下载地址或重定向目标。服务器不解压执行上传内容。设备必须通过 Ed25519 签名、整包和每个文件的 SHA256 校验后才安装。

分片上传适配现有 Cloudflare 入口。外部反向代理仍需允许至少 16 MiB 的请求；直接调用单请求上传接口的上限还受入口限制，参见 [Cloudflare 上传大小说明](https://developers.cloudflare.com/network/maximum-upload-size/)。

### 设备临时下载与包大小

NanoPi Zero2 1 GB/2 GB 和 R28S 1 GB 均按需下载，32/64 GB TF 卡使用相同策略：

- 本地不长期缓存 OTA 包。安装时从服务器下载到 `/var/lib/hive/ota-download.*/bundle.tar.gz`，整个包最多 **2 GiB**；整包 SHA256、Ed25519 签名、hook 和清单文件哈希全部通过后才安装。
- 安装成功或失败退出时清理下载包和解压目录；断电或进程被强制终止留下的 `ota-download.*` 在下次 updater 启动并取得互斥锁后清理。定时任务和手动更新不会并行下载。
- 重试安装或强制重装时重新从服务器下载。已经安装的相同版本和 SHA256 可以直接确认任务，不重复安装。
- 下载前按当时可用空间设置上限，预留 **64 MiB**。除了 curl 大小限制，还使用进程文件大小限制，防止没有 `Content-Length` 的响应无限写入。解压前再次检查解压大小和可用空间，空间不足则停止本次更新。
- 临时文件清理不删除 `ota-transaction` 回滚备份、待确认固件状态或 A/B 分区。应用回滚恢复本地事务备份，固件回滚启动旧槽，不依赖重新下载 OTA 包；解压、备份和两个系统槽仍需单独预留空间。

包大小取决于构建内容：默认应用包包含脚本、服务及静态文件，加入 Xray/Mihomo 等二进制后需要以实际构建输出为准。完整固件包尚未实构建，暂无可靠压缩体积；构建脚本会输出最终包大小，上传与设备下载均限制为 2 GiB。管理后台继续使用 30 天/各类型最近 3 个版本策略；设备按需下载不会给后台目录设置总容量额度。

## 应用更新

```bash
make gen-ota-keys                 # 首次生成；保管私钥，后续版本继续用同一密钥
make build-ota VERSION=1.0.0

# 限定更新文件，并增加实际功能检查
./scripts/build-ota.sh 1.0.1 \
  --include usr/local/bin/my-service \
  --restart my-service.service \
  --health-hook /path/to/check-my-service.sh
```

默认包包含应用脚本和服务单元，启用 OTA 恢复服务和订阅守护，不覆盖设备 Token、SSH 密钥和个性化运行配置。

启动/恢复关键文件不接受应用包，`build-ota.sh` 打包和 `hive-ota-transaction` 安装前各拦一次（签名包同样拒绝）：`boot/**`、`usr/lib/hive/**`、`usr/lib/modules/**`、`usr/lib/systemd/system/**`、`usr/local/bin/hive-data`、`hive-data-grow`、`hive-board`、`hive-node-info`、`hive-firmware`，以及 `hive-data.service*`、`hive-ota-recover.service*`、`hive-firmware-confirm.service*`（前缀匹配，覆盖 `.d/` drop-in 与 `.wants/` 链接这类侧路径），以及 `var/lib/hive/ota-transaction/**`（安装前由引擎写入，包内容覆盖 `recover.sh`/`paths.json` 会让开机回滚跑包带来的副本）。回滚备份和事务标记都在 `/var/lib/hive`，该路径由 `hive-data` 从数据分区 bind 挂载；一旦这些文件被坏包替换，数据分区挂不上、回滚脚本永远跑不到，设备只会无限重启。除引擎自管的 `ota-transaction` 目录外，这些文件只能随 firmware 包（A/B rootfs 槽）更新。

此外，应用包里的 `etc/systemd/system/**` 单元若声明 `FailureAction=`/`JobTimeoutAction=` 为 `reboot|poweroff|halt` 系列，`hive-updater` 在写入前直接拒绝：那会让任意服务故障变成整机重启，而用户态没有任何恢复入口。

身份与运行配置同样不能作为包内容下发：`etc/hive/**`、`etc/xray/**`、`etc/mihomo/**`、`etc/frp/**`、`etc/ssh/**` 在 `ota_prepare` 里被拒绝（`build-ota.sh --include` 也拦），只能用签名 hook 迁移。hook 需要保护的文件通过 `--backup`/`rollback_paths` 声明，那只是备份与回滚声明，不安装内容，因此不受此限制。

`hive-data` 挂载失败不再由 unit 直接 `FailureAction=reboot`：脚本内部重试 3 次，仍未成功时最多重启 3 次（计数存于 `/usr/lib/hive/data-failures`，成功即清除），之后保持运行以便人工介入。

更新前，`/var/lib/hive/ota-transaction` 保存旧文件、权限、原服务启用/运行状态和旧版本记录；备份刷盘后才允许修改。新文件逐个原子替换，之后执行有超时的 hook、服务重启和健康检查。成功后才提交版本和完成回执。失败时恢复全部受管文件，删除本次新增文件，恢复服务状态。恢复本身失败会保留备份并停止新更新，结果提示需要人工恢复。

健康检查除 `health_services` 的单元状态外，还用设备凭证探测 Registry（`nodes/<mac>/ota-version`），与固件试启动确认用的是同一条认证管理路径：应用包能改 xray/mihomo/frp 配置、路由和单元依赖，隧道断了进程仍 `active`，只查单元状态会把"节点失联"判成健康。探测依赖的 `hive-node-info` 属受保护文件，被测包改不掉身份。未注册设备（无 `device-token`）跳过该探测。探测与单元状态在同一重试循环内，`health_timeout_seconds` 内任一轮全部通过即提交，超时才回滚。

恢复引擎会在安装前复制到事务目录，`hive-ota-recover.service` 开机执行这份旧副本，因此恢复不依赖更新后的 updater 是否能运行。回执保存到磁盘，网络恢复后继续发送；旧任务回执不能覆盖新任务。

`--pre-hook`、`--post-hook` 是受签名保护的 root 脚本。若 hook 要修改额外文件，必须用 `--backup etc/path/to/file` 声明；自动回滚只覆盖清单和明确声明的文件、服务状态，不能撤销数据库迁移、远程操作或任意外部副作用。hook 不应重启设备或停止更新控制器。涉及系统分区、内核或软件包管理器的变更请使用 firmware 包。

## 首次启用 A/B

普通单分区 Armbian 设备不能直接接收 firmware 包。需要先构建并**离线整盘刷写**新的 A/B 出厂镜像；这会覆盖原有分区与数据。已有身份、配置如需保留，须先另行备份并在首刷后恢复，不能指望第一次整盘 `dd` 自动保留。

适配路径为 **NanoPi Zero2 / current 内核** 与 **NanoPi R28S / vendor 6.1 内核**，均使用固定的主线 U-Boot 加 Hive A/B 配置。Zero2 的 1 GB / 2 GB 沿用同一构建配置。R3S、Orange Pi、USB 根盘和自定义分区未启用这条固件升级路径。

```bash
make env
# 按 README 准备配置、构建工具、Armbian 和预编译程序
make setup-armbian
make download-binaries
make gen-ota-keys
make build-ab VERSION=1.0.0       # Zero2 1 GB / 2 GB
make build-ab-r28s VERSION=1.0.0  # R28S 1 GB
```

除了原有 Armbian 构建依赖，镜像转换主机需要 `rsync`、`jq`、`binutils`、`util-linux`、`udev`、`e2fsprogs`。转换通过 `sudo` 创建临时 loop 设备，只接受普通镜像文件作为输入输出，不接受块设备路径。

以 Zero2 为例，输出：

- `output/ab/hive-nanopi-zero2-ab-1.0.0.img`：用于首次整盘刷写的镜像。
- `output/ab/hive-nanopi-zero2-rootfs-1.0.0.img`：系统 OTA 的根文件系统原料，不能当作整盘镜像刷写。
- `output/ota/hive-firmware-nanopi-zero2-v1.0.0.tar.gz`：已签名的系统更新包，上传后台使用。
- 相应 SHA256 校验文件。

R28S 产物将文件名中的 `nanopi-zero2` 替换为 `nanopi-r28s`。后台上传完成后显示固件目标板型；设备同时校验实际设备树、已安装布局及签名清单板型，拒绝跨板型安装。

出厂镜像约 16 GiB，可写入本批 **32 GB / 64 GB TF 卡**。首次启动自动扩容数据分区：

| 区域 | 默认位置/容量 | 用途 |
|---|---|---|
| 引导保留区 | 前 16 MiB | GPT、U-Boot、两份启动环境 |
| U-Boot | LBA 64 起 | 首刷写入；OTA 不更新 |
| 启动环境 | `0xc00000` 与 `0xc10000`，每份 `0x8000` 字节 | 冗余保存当前确认槽、候选槽、剩余尝试次数 |
| `hive-rootA` | 第 1 分区，4 GiB | 系统 A，内含 `/boot` |
| `hive-rootB` | 第 2 分区，4 GiB | 系统 B，内含 `/boot` |
| `hive-data` | 第 3 分区，初始 8 GiB，首启扩至卡尾 | 设备身份、运行配置、OTA 状态和下载暂存 |

构建脚本会检查 U-Boot 中的 A/B 标记及大小（从 LBA 64 起的引导镜像必须在 12 MiB 环境区之前结束），拒绝普通引导器或会覆盖启动环境的产物。`post_uboot_custom_postprocess` 在 `olddefconfig` 之后复核最终 `.config` 的 `ENV_IS_IN_MMC`、`ENV_REDUNDANT`、`ENV_SIZE`/`ENV_OFFSET`/`ENV_OFFSET_REDUND`、`CMD_SAVEENV`/`CMD_SETEXPR`/`CMD_PART`/`CMD_FDT` 并要求 `ENV_IS_NOWHERE` 关闭，缺任何一项直接中断构建；同时把这份配置写入镜像的 `/usr/lib/hive/uboot-env`。`scripts/check-uboot-env.sh` 在建厂镜像时再对照两份证据：stamp 内容，以及 `u-boot-rockchip.bin` 里确实存在 MMC 环境驱动、冗余读写、`saveenv`、`setexpr`、`part uuid`、`booti`、`fdt` 的字符串。只匹配 `HIVE_AB_V1` 不能证明环境可写。固件安装时根据**实际当前根分区的父磁盘**确定备用槽，不假设 Linux 的 `mmcblk0` 永远代表某种介质，也不按全局分区标签误选另一张卡。

首刷可使用烧录工具，或从另一张启动卡/救援系统运行 `dd`。确认目标**整盘**且其分区都未挂载后执行；绝不能覆盖当前运行系统所在的盘：

```bash
# /dev/目标整盘 是占位符，必须替换为已核对的目标设备
test -b /dev/目标整盘 && sudo dd if=output/ab/hive-nanopi-zero2-ab-1.0.0.img \
  of=/dev/目标整盘 bs=4M conv=fsync status=progress
sync
```

首刷后按 README 为每台设备安装独立 `/etc/hive/device-token`，完成注册和网络配置，再进行 OTA 验收。普通 `make build` / `make build-r28s` 仍生成普通镜像，不会隐式改变现有板型的分区方案。

## 后续系统更新与回切

构建下一版：

```bash
make build-ab VERSION=1.1.0
# R28S 使用 make build-ab-r28s VERSION=1.1.0
# 上传 output/ota/hive-firmware-nanopi-zero2-v1.1.0.tar.gz；无需再 dd 整盘镜像
```

设备验证签名、板型、布局和镜像内版本后，只写未运行且未挂载的备用根分区。写入完成后读回计算 SHA256，再检查/扩展 ext4，保存任务状态，最后通过一次冗余环境更新设置候选槽及 **3 次试启动**，然后重启。

U-Boot 在每次试启动前先持久化扣减尝试次数。新内核/DTB/initramfs 无法加载时立即尝试原槽；次数耗尽后清除候选槽并回到原槽。启动配置含 `panic=10`，内核 panic 可触发重启。用户态确认服务有总超时和失败重启策略。

确认槽自身无法加载（`/boot/Image`、`/boot/uInitrd` 或 DTB 读不出来）时，引导脚本不改写任何槽变量，先尝试另一个槽一次，再 `bootflow scan -lb` 兜底，仍失败才复位；重复启动做出的仍是同一个决定，不会因为反复复位而更坏。环境不可写（`saveenv` 失败）时不再 `reset`：初始化失败直接启动出厂槽，试启动计数无法持久化时退回已确认槽不启动未记录的候选，A/B 记录降级但不进入复位循环。

`hive-firmware-confirm.service` 验证当前槽和新版本、NetworkManager/Nginx/Xray/Cloudflared/EasyTier 服务、OTA 与订阅守护定时器、携带设备凭证的 Registry 连接。也可安装可执行的 `/etc/hive/firmware-health-check` 增加实际业务检查。只有这些检查通过才将新槽标记为已确认；如果回到了旧槽，则恢复旧版本记录并上报 `rolled_back`。管理服务在试启动期间持续失联也会导致回切。

回切分支先删掉 `firmware-pending.json` 再清理其余状态：该文件是确认服务的 `ConditionPathExists` 门控，先失败退出会配合 `FailureAction=reboot` 变成无限重启，而环境不可写时 `hive_pending` 根本清不掉。清环境失败只记警告并继续回切。

数据分区在正常服务启动前绑定以下目录，因此槽位切换保留身份和运行状态：`/etc/hive`、`/etc/ssh`、`/root/.ssh`、Nginx 站点配置、`/etc/cloudflared`、`/etc/frp`、`/etc/xray`、`/etc/mihomo`、NetworkManager 连接配置，以及 Hive、Tailscale、WARP、EasyTier 的对应 `/var/lib` 目录。不会共享整个 `/etc`、包管理器数据库或系统二进制。跨版本数据格式变更必须兼容旧版本，否则回切旧程序也无法恢复已迁移的数据。

## 真机验收与当前边界

发布到其他设备前，在 1 GB Zero2、2 GB Zero2、1 GB R28S 上分别验证以下场景，保留串口日志和可恢复的启动卡；1 GB 设备还须进行上述业务与 OTA 并行负载测试：

1. 分别使用 32 GB / 64 GB TF 卡冷启动，确认数据分区扩容到卡尾，再确认正确识别启动卡、两份环境可读写、数据分区成功绑定，设备身份跨重启保持。
2. 正常升级：从 A 到 B，再从 B 到 A；版本只在健康确认后变更。
3. 在下载、备用槽写入、环境切换、第一次启动期间分别断电；恢复后确认仍有可启动系统、身份不变、任务结果可上报。
4. 注入服务检查失败、Registry 不可达和坏内核文件，验证回切旧槽及 `rolled_back` 状态。
5. 验证真实内核卡死与硬件看门狗。**本实现没有补入未经验证的 RK3528 硬件看门狗驱动/设备树。无法自行重启的硬锁死仍需断电或外部看门狗；启动次数逻辑在下一次重启才继续生效。**

A/B 不能修复损坏的 U-Boot、介质物理故障或两个系统槽同时损坏。固件安装阶段不修改 GPT 或引导器；首启数据扩容仅增大最后一个分区。改变系统槽大小、分区顺序或引导器仍需离线维护。

实现依据：[U-Boot Rockchip 支持说明](https://docs.u-boot.org/en/latest/board/rockchip/rockchip.html)、[U-Boot 冗余环境配置](https://github.com/u-boot/u-boot/blob/master/env/Kconfig)、[Rockchip 启动介质选择实现](https://github.com/u-boot/u-boot/blob/master/arch/arm/mach-rockchip/board.c)。仓库继续使用板型配置中固定的 U-Boot 版本，不在设备上自动切换到上游最新版本。

本地回归：

```bash
python3 scripts/test-ota.py
python3 scripts/test-hardware.py
# 使用专用测试数据库运行 Go 集成测试，配置方式见 README
cd management/registry && go test -race ./...
cd ../registry-ui && npm test && npm run typecheck
```
