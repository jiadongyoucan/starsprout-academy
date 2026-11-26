#!/bin/sh
# 以 root 修正挂载目录权限，然后降权到 node 运行应用。
set -eu
mkdir -p /data/snapshots
chown -R node:node /data
exec su-exec node "$@"
