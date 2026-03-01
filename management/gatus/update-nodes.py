#!/usr/bin/env python3
"""update-nodes.py - 读取 Prometheus targets，生成完整 Gatus config.yaml

Gatus 通过 inotify (fsnotify) 监听文件变动，自动热重载，无需重启容器。
cron 每分钟运行本脚本（与 hive-targets 同频），节点无变化时跳过写入。

用法：python3 /path/to/management/gatus/update-nodes.py
"""

import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
TARGETS_FILE = os.path.normpath(os.path.join(SCRIPT_DIR, "../prometheus/targets/nodes.json"))
GATUS_CONFIG = os.path.join(SCRIPT_DIR, "config.yaml")

# ─── 静态配置（每次都写入，保证与代码同步）────────────────────────────────────

STATIC_HEAD = """\
web:
  port: 4232

ui:
  title: "Hive Network Status"
  description: "Hive 蜂巢网络状态监控"
  header: "Hive 状态"

storage:
  type: sqlite
  path: /data/gatus.db

endpoints:
"""

# ─── 节点之后的静态端点 ────────────────────────────────────────────────────────

STATIC_TAIL = """\
  # ── 管理服务（直接 HTTP 探测）────────────────────────────────────────────

  - name: Registry API
    group: 管理服务
    url: http://localhost:6677/health
    interval: 60s
    conditions:
      - "[STATUS] == 200"

  - name: Prometheus
    group: 管理服务
    url: http://localhost:4230/-/healthy
    interval: 60s
    conditions:
      - "[STATUS] == 200"

  - name: Grafana
    group: 管理服务
    url: http://localhost:4231/api/health
    interval: 60s
    conditions:
      - "[STATUS] == 200"

  # ── 网络概览（Prometheus API 查询）──────────────────────────────────────
  # `or vector(0)` 保证空舰队时 result 数组不为空，避免 JSONPath 解析错误

  - name: 在线节点数
    group: 网络概览
    url: http://localhost:4230/api/v1/query
    method: POST
    headers:
      Content-Type: application/x-www-form-urlencoded
    body: 'query=count(up{job="hives"} == 1) or vector(0)'
    interval: 120s
    conditions:
      - "[STATUS] == 200"
      - "[body].data.result.0.value.1 >= 1"

  - name: 离线节点数
    group: 网络概览
    url: http://localhost:4230/api/v1/query
    method: POST
    headers:
      Content-Type: application/x-www-form-urlencoded
    body: 'query=count(up{job="hives"} == 0) or vector(0)'
    interval: 120s
    conditions:
      - "[STATUS] == 200"
      - "[body].data.result.0.value.1 < 1"

  - name: 网络在线率
    group: 网络概览
    url: http://localhost:4230/api/v1/query
    method: POST
    headers:
      Content-Type: application/x-www-form-urlencoded
    body: 'query=sum(up{job="hives"}) / count(up{job="hives"}) * 100 or vector(0)'
    interval: 120s
    conditions:
      - "[STATUS] == 200"
      - "[body].data.result.0.value.1 >= 80"

  # ── 节点资源（Prometheus API 查询，阈值与 alert rules 一致）──────────────

  - name: CPU高负载节点
    group: 节点资源
    url: http://localhost:4230/api/v1/query
    method: POST
    headers:
      Content-Type: application/x-www-form-urlencoded
    body: 'query=count(100 - (avg by(instance)(rate(node_cpu_seconds_total{mode="idle",job="hives"}[5m]))*100) > 90) or vector(0)'
    interval: 120s
    conditions:
      - "[STATUS] == 200"
      - "[body].data.result.0.value.1 < 1"

  - name: 内存不足节点
    group: 节点资源
    url: http://localhost:4230/api/v1/query
    method: POST
    headers:
      Content-Type: application/x-www-form-urlencoded
    body: 'query=count(node_memory_MemAvailable_bytes{job="hives"} < 104857600) or vector(0)'
    interval: 120s
    conditions:
      - "[STATUS] == 200"
      - "[body].data.result.0.value.1 < 1"

  - name: 磁盘不足节点
    group: 节点资源
    url: http://localhost:4230/api/v1/query
    method: POST
    headers:
      Content-Type: application/x-www-form-urlencoded
    body: 'query=count(node_filesystem_avail_bytes{job="hives",mountpoint="/"} < 524288000) or vector(0)'
    interval: 120s
    conditions:
      - "[STATUS] == 200"
      - "[body].data.result.0.value.1 < 1"

  # ── 管理服务器（Prometheus API 查询，management-server job）─────────────
  # 不加 `or vector(0)`：node_exporter 挂掉时应显示为红色

  - name: CPU使用率
    group: 管理服务器
    url: http://localhost:4230/api/v1/query
    method: POST
    headers:
      Content-Type: application/x-www-form-urlencoded
    body: 'query=100 - (avg(rate(node_cpu_seconds_total{mode="idle",job="management-server"}[5m]))*100)'
    interval: 120s
    conditions:
      - "[STATUS] == 200"
      - "[body].data.result.0.value.1 < 85"

  - name: 内存可用率
    group: 管理服务器
    url: http://localhost:4230/api/v1/query
    method: POST
    headers:
      Content-Type: application/x-www-form-urlencoded
    body: 'query=node_memory_MemAvailable_bytes{job="management-server"} / node_memory_MemTotal_bytes{job="management-server"} * 100'
    interval: 120s
    conditions:
      - "[STATUS] == 200"
      - "[body].data.result.0.value.1 >= 10"

  - name: 磁盘可用空间
    group: 管理服务器
    url: http://localhost:4230/api/v1/query
    method: POST
    headers:
      Content-Type: application/x-www-form-urlencoded
    body: 'query=node_filesystem_avail_bytes{job="management-server",mountpoint="/"}'
    interval: 120s
    conditions:
      - "[STATUS] == 200"
      - "[body].data.result.0.value.1 >= 5368709120"

  - name: 系统运行时长
    group: 管理服务器
    url: http://localhost:4230/api/v1/query
    method: POST
    headers:
      Content-Type: application/x-www-form-urlencoded
    body: 'query=time() - node_boot_time_seconds{job="management-server"}'
    interval: 120s
    conditions:
      - "[STATUS] == 200"
      - "[body].data.result.0.value.1 >= 0"
"""

# ─── 每节点端点模板 ────────────────────────────────────────────────────────────
# {{}} 在 .format() 中输出字面量 {}，用于 PromQL 的 label matchers

NODE_HEADER = "  # ── 节点状态（动态，每分钟同步自 Prometheus targets）─────────────────────\n"

NODE_ENDPOINT = """\
  - name: "{hostname}"
    group: 节点状态
    url: http://localhost:4230/api/v1/query
    method: POST
    headers:
      Content-Type: application/x-www-form-urlencoded
    body: 'query=up{{job="hives",instance="{hostname}"}}'
    interval: 60s
    conditions:
      - "[STATUS] == 200"
      - "[body].data.result.0.value.1 == 1"
"""


def load_nodes():
    """读取 Prometheus targets 文件，返回按字母排序的 hostname 列表。"""
    try:
        with open(TARGETS_FILE) as f:
            targets = json.load(f)
        nodes = sorted(
            entry["labels"]["hostname"]
            for entry in targets
            if entry.get("labels", {}).get("hostname")
        )
        return nodes
    except FileNotFoundError:
        return []
    except Exception as e:
        print(f"Warning: failed to parse {TARGETS_FILE}: {e}", file=sys.stderr)
        return []


def build_config(nodes):
    """拼接完整 config.yaml 内容：节点状态在前，其余组在后。"""
    parts = [STATIC_HEAD]
    if nodes:
        parts.append(NODE_HEADER)
        for hostname in nodes:
            parts.append(NODE_ENDPOINT.format(hostname=hostname))
        parts.append("\n")
    parts.append(STATIC_TAIL)
    return "".join(parts)


def main():
    nodes = load_nodes()
    new_config = build_config(nodes)

    # 内容无变化时跳过写入，避免触发不必要的 Gatus 热重载
    try:
        with open(GATUS_CONFIG) as f:
            if f.read() == new_config:
                sys.exit(0)
    except FileNotFoundError:
        pass

    with open(GATUS_CONFIG, "w") as f:
        f.write(new_config)

    print(f"Gatus config updated: {len(nodes)} node(s){': ' + ', '.join(nodes) if nodes else ''}")


if __name__ == "__main__":
    main()
