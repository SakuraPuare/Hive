/**
 * Build the SSH commands shown to administrators.
 *
 * Three independent paths exist for every node (docs/NODE-OPERATIONS.md):
 *   - Tailscale: reachable only from the same tailnet
 *   - EasyTier:  reachable only from the same EasyTier mesh
 *   - FRP:       node exposes 127.0.0.1:22 on the VPS as frp_port
 *
 * The node row only stores the mesh addresses and frp_port; the FRP server host
 * is fleet-wide config (`FRP_SERVER_ADDR` in registry). Commands are rendered
 * verbatim into a copy-to-clipboard surface, so every interpolated value is
 * validated to a shell-safe hostname/IPv4/port before use.
 */

export interface SshNodeAddresses {
  hostname?: string | null;
  tailscale_ip?: string | null;
  easytier_ip?: string | null;
  frp_port?: number | null;
}

export type SshCommandKind = 'tailscale' | 'easytier' | 'frp';

export interface SshCommand {
  kind: SshCommandKind;
  command: string;
}

// Hostnames and IPv4 only: no whitespace, shell metacharacters, or leading '-'.
const HOSTNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

export function isSshHost(value: string): boolean {
  return IPV4_RE.test(value) || HOSTNAME_RE.test(value);
}

function usableIPv4(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (v === '' || v.toLowerCase() === 'pending' || !IPV4_RE.test(v)) return '';
  return v;
}

/** Build every usable SSH command for one node, in preference order. */
export function buildSshCommands(
  node: SshNodeAddresses,
  frpServerAddr: string | null | undefined,
): SshCommand[] {
  const commands: SshCommand[] = [];

  // MagicDNS names depend on tailnet DNS config; the IP always resolves once
  // the node is on the tailnet, so prefer it for a copy-paste command.
  const tailscale = usableIPv4(node.tailscale_ip);
  if (tailscale) {
    commands.push({ kind: 'tailscale', command: `ssh root@${tailscale}` });
  }

  const easytier = usableIPv4(node.easytier_ip);
  if (easytier) {
    commands.push({ kind: 'easytier', command: `ssh root@${easytier}` });
  }

  const host = (frpServerAddr ?? '').trim();
  const port = Number(node.frp_port);
  if (host && isSshHost(host) && Number.isInteger(port) && port > 0 && port <= 65535) {
    commands.push({ kind: 'frp', command: `ssh -p ${port} root@${host}` });
  }

  return commands;
}
