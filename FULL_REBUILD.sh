#!/bin/bash
# Full rebuild script - stops all containers, rebuilds, and restarts

echo "=== Pulling latest code from git ==="
git pull

echo ""
echo "=== Stopping all containers ==="
docker-compose down

echo ""
echo "=== Rebuilding all containers ==="
docker-compose build --no-cache

echo ""
echo "=== Starting all containers ==="
docker-compose up -d

echo ""
echo "=== Waiting for services to be healthy ==="
sleep 10

echo ""
echo "=== Checking container status ==="
docker-compose ps

echo ""
echo "=== Checking frontend logs ==="
docker-compose logs frontend --tail=20

echo ""
echo "=== Deployment complete! ==="
echo "Dashboard: http://10.204.134.80"
