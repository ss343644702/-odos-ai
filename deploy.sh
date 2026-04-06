#!/bin/bash
# Odos AI — 一键更新部署脚本
# 在服务器上执行: bash deploy.sh

set -e

cd /opt/odos-ai

echo "=== 拉取最新代码 ==="
git pull origin main

echo "=== 读取 NEXT_PUBLIC 变量 ==="
SUPABASE_URL=$(grep NEXT_PUBLIC_SUPABASE_URL .env.production | cut -d= -f2-)
SUPABASE_KEY=$(grep NEXT_PUBLIC_SUPABASE_ANON_KEY .env.production | cut -d= -f2-)

echo "=== 构建 Docker 镜像 ==="
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$SUPABASE_KEY" \
  -t odos-ai .

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
