#!/bin/bash
#
# Mihomo TProxy setup for Hive nodes (IPv4 only).
# Based on ShellCrash fw_nftables.sh policy-routing approach.

set -e

PROXY_GROUP="mihomo"
BYPASS_GROUP="mihomo-bypass"
PROXY_MARK="0x1ed4"
DIRECT_MARK="0x1ed6"
PROXY_PORT="7893"
DNS_PORT="1053"
ROUTING_TABLE="100"

ensure_group() {
    if ! getent group "$PROXY_GROUP" >/dev/null 2>&1; then
        groupadd --system "$PROXY_GROUP"
    fi
    if ! getent group "$BYPASS_GROUP" >/dev/null 2>&1; then
        groupadd --system "$BYPASS_GROUP"
    fi
    PROXY_GID="$(getent group "$PROXY_GROUP" | cut -d: -f3)"
    BYPASS_GID="$(getent group "$BYPASS_GROUP" | cut -d: -f3)"
}

cidr_network() {
    local cidr="$1"
    local ip="${cidr%/*}"
    local prefix="${cidr#*/}"
    local a b c d ip_int mask network

    IFS=. read -r a b c d <<EOF
$ip
EOF
    if [ -z "$a" ] || [ -z "$b" ] || [ -z "$c" ] || [ -z "$d" ] || [ -z "$prefix" ]; then
        return 1
    fi

    ip_int=$(( (a << 24) + (b << 16) + (c << 8) + d ))
    if [ "$prefix" -eq 0 ]; then
        mask=0
    else
        mask=$(( (0xffffffff << (32 - prefix)) & 0xffffffff ))
    fi
    network=$(( ip_int & mask ))

    printf "%d.%d.%d.%d/%d\n" \
        $(( (network >> 24) & 255 )) \
        $(( (network >> 16) & 255 )) \
        $(( (network >> 8) & 255 )) \
        $(( network & 255 )) \
        "$prefix"
}

detect_local_subnet() {
    local iface cidr

    iface="$(ip -4 route show default 2>/dev/null | awk '{for (i=1; i<=NF; i++) if ($i == "dev") {print $(i+1); exit}}')"
    if [ -z "$iface" ]; then
        iface="$(ip -o -4 addr show scope global 2>/dev/null \
            | awk '$2 !~ /^(lo|tailscale|easytier|zt|docker|br-|veth|warp)/ {print $2; exit}')"
    fi
    [ -n "$iface" ] || return 1

    cidr="$(ip -o -4 addr show dev "$iface" scope global 2>/dev/null | awk '{print $4; exit}')"
    [ -n "$cidr" ] || return 1

    cidr_network "$cidr"
}

cleanup() {
    nft delete table inet mihomo 2>/dev/null || true
    nft delete table ip mihomo 2>/dev/null || true
    ip rule del fwmark "$PROXY_MARK" table "$ROUTING_TABLE" 2>/dev/null || true
    ip route del local default dev lo table "$ROUTING_TABLE" 2>/dev/null || true
}

start() {
    command -v nft >/dev/null 2>&1 || {
        echo "ERROR: nft command not found. Install nftables first."
        exit 1
    }
    ensure_group
    LOCAL_SUBNET="$(detect_local_subnet)" || {
        echo "ERROR: cannot detect local IPv4 subnet from the default route interface."
        exit 1
    }

    modprobe nf_tproxy_ipv4 2>/dev/null || true
    modprobe nft_tproxy 2>/dev/null || true
    modprobe nft_socket 2>/dev/null || true

    sysctl -w net.ipv4.ip_forward=1 >/dev/null

    cleanup

    ip rule add fwmark "$PROXY_MARK" table "$ROUTING_TABLE"
    ip route add local default dev lo table "$ROUTING_TABLE"

    nft -f - <<EOF
table ip mihomo {
    chain prerouting_dns {
        type nat hook prerouting priority dstnat; policy accept;
        ip saddr != $LOCAL_SUBNET return
        meta mark $DIRECT_MARK return
        meta l4proto { tcp, udp } th dport 53 redirect to :$DNS_PORT
    }

    chain output_dns {
        type nat hook output priority dstnat; policy accept;
        meta skgid $PROXY_GID return
        meta skgid $BYPASS_GID return
        meta mark $DIRECT_MARK return
        meta l4proto { tcp, udp } th dport 53 redirect to :$DNS_PORT
    }

    chain prerouting {
        type filter hook prerouting priority mangle; policy accept;
        ip saddr != $LOCAL_SUBNET return
        meta mark $DIRECT_MARK return
        meta l4proto { tcp, udp } th dport 53 return
        tcp dport { 7890, $PROXY_PORT } return
        ip daddr { 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 224.0.0.0/3 } return
        meta l4proto { tcp, udp } meta mark set $PROXY_MARK tproxy to :$PROXY_PORT
    }

    chain output {
        type route hook output priority mangle; policy accept;
        meta skgid $PROXY_GID return
        meta skgid $BYPASS_GID return
        meta mark $DIRECT_MARK return
        ip daddr { 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 224.0.0.0/3 } return
        meta l4proto { tcp, udp } meta mark set $PROXY_MARK
    }
}
EOF

    echo "Mihomo TProxy loaded: subnet=${LOCAL_SUBNET} proxy_port=${PROXY_PORT} dns_port=${DNS_PORT} table=${ROUTING_TABLE} gid=${PROXY_GID} bypass_gid=${BYPASS_GID}"
}

case "${1:-start}" in
    start)
        start
        ;;
    stop)
        cleanup
        echo "Mihomo TProxy rules removed."
        ;;
    restart|reload)
        start
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|reload}" >&2
        exit 1
        ;;
esac
