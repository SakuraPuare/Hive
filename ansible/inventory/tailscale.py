#!/usr/bin/env python3
"""Ansible dynamic inventory for Hive nodes tagged tag:hive in Tailscale.

`plugin: community.general.tailscale` never existed, so the previous YAML file
aborted every ansible-inventory run with "unknown plugin". This script reads the
local client's status instead:

    ansible-inventory -i inventory/tailscale.py --list
    ansible hive_nodes -m ping

Set HIVE_TAILSCALE_STATUS to a saved `tailscale status --json` file to test the
mapping without a tailnet.
"""
import json
import os
import subprocess
import sys

TAG = "tag:hive"
GROUP = "hive_nodes"


def load_status():
    override = os.environ.get("HIVE_TAILSCALE_STATUS")
    if override:
        with open(override) as handle:
            return json.load(handle)
    try:
        output = subprocess.check_output(["tailscale", "status", "--json"], text=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        sys.stderr.write(f"tailscale status failed: {exc}\n")
        return {}
    return json.loads(output)


def node_name(node):
    dns = (node.get("DNSName") or "").rstrip(".")
    if dns:
        return dns.split(".")[0]
    return node.get("HostName") or node.get("ID") or ""


def ipv4(node):
    for address in node.get("TailscaleIPs") or []:
        if ":" not in address:
            return address
    return ""


def hostvars(status):
    nodes = list((status.get("Peer") or {}).values())
    if status.get("Self"):
        nodes.append(status["Self"])
    hosts = {}
    for node in nodes:
        if TAG not in (node.get("Tags") or []):
            continue
        name = node_name(node)
        if not name:
            continue
        entry = {"tailscale_online": bool(node.get("Online"))}
        address = ipv4(node)
        if address:
            entry["ansible_host"] = address
        if node.get("DNSName"):
            entry["tailscale_dns_name"] = node["DNSName"]
        hosts[name] = entry
    return hosts


def main():
    hosts = hostvars(load_status())
    if "--list" in sys.argv:
        print(json.dumps({GROUP: {"hosts": sorted(hosts)}, "_meta": {"hostvars": hosts}}))
        return
    if "--host" in sys.argv:
        name = sys.argv[sys.argv.index("--host") + 1]
        print(json.dumps(hosts.get(name, {})))
        return
    sys.stderr.write(__doc__)
    sys.exit(1)


if __name__ == "__main__":
    main()
