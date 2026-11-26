#!/usr/bin/env bash
# 为局域网平板生成自签名 HTTPS 证书（摄像头 / PWA 安装需要安全上下文）
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/certs
IP="${1:-$(ipconfig getifaddr en0 2>/dev/null || echo 127.0.0.1)}"
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
  -keyout data/certs/key.pem -out data/certs/cert.pem \
  -subj "/C=CN/ST=Local/L=Local/O=StarSprout/CN=${IP}" \
  -addext "subjectAltName=IP:${IP},DNS:localhost,IP:127.0.0.1"
echo "✅ 证书已生成：data/certs/cert.pem / key.pem（IP: ${IP}）"
echo "   在 .env 中设置："
echo "   TLS_CERT=./data/certs/cert.pem"
echo "   TLS_KEY=./data/certs/key.pem"
echo "   PUBLIC_URL=https://${IP}:8080"
echo "   重启后访问 https://${IP}:8080/device （首次需在平板信任该证书）"
