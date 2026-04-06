#!/bin/bash
# Odos AI — 一键更新部署脚本
# 在服务器上执行: bash deploy.sh

set -e

cd /opt/odos-ai

echo "=== 拉取最新代码 ==="
git pull origin main

echo "=== 构建 Docker 镜像 ==="
docker build -t odos-ai .

echo "=== 重启容器 ==="
docker stop odos-ai 2>/dev/null || true
docker rm odos-ai 2>/dev/null || true
docker run -d \
  --name odos-ai \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env.production \
  odos-ai

echo "=== 清理旧镜像 ==="
docker image prune -f

echo "=== 部署完成: $(date) ==="
echo "验证: curl http://localhost:3000"
