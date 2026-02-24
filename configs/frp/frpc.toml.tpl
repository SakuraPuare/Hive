# FRP 客户端配置
# ${...}  由 scripts/build.sh 在构建时通过 envsubst 替换（服务端信息）
# %%...%% 由 provision-node.sh 在首次启动时通过 sed 替换（每台设备唯一）

serverAddr = "${FRP_SERVER_ADDR}"
serverPort = ${FRP_SERVER_PORT}

auth.method = "token"
auth.token  = "${FRP_AUTH_TOKEN}"

transport.tcpMux = true

[[proxies]]
name       = "ssh-%%HOSTNAME%%"
type       = "tcp"
localIP    = "127.0.0.1"
localPort  = 22
remotePort = %%FRP_PORT%%
