#!/bin/bash
# Panther Sanity Dashboard - Domain Setup Script
# This script sets up Nginx reverse proxy for domain-based access

set -e

echo "=========================================="
echo "Panther Sanity Dashboard - Domain Setup"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Please run as root or with sudo"
    exit 1
fi

# Get domain name from user
read -p "Enter your domain name (e.g., panther-sanity.juniper.net): " DOMAIN_NAME

if [ -z "$DOMAIN_NAME" ]; then
    echo "❌ Domain name cannot be empty"
    exit 1
fi

echo ""
echo "📋 Configuration:"
echo "   Domain: $DOMAIN_NAME"
echo "   Frontend: http://localhost:3000"
echo "   Backend: http://localhost:3001"
echo ""

read -p "Continue with this configuration? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ]; then
    echo "❌ Setup cancelled"
    exit 0
fi

echo ""
echo "🔧 Step 1: Installing Nginx..."

# Detect OS and install Nginx
if [ -f /etc/redhat-release ]; then
    # RHEL/CentOS/Fedora
    yum install -y nginx
elif [ -f /etc/debian_version ]; then
    # Debian/Ubuntu
    apt-get update
    apt-get install -y nginx
else
    echo "❌ Unsupported OS. Please install Nginx manually."
    exit 1
fi

echo "✅ Nginx installed"

echo ""
echo "🔧 Step 2: Creating Nginx configuration..."

# Create Nginx config
cat > /etc/nginx/conf.d/panther-sanity.conf << EOF
# Panther Sanity Dashboard - Reverse Proxy Configuration
# Generated on $(date)

server {
    listen 80;
    server_name $DOMAIN_NAME;
    
    # Increase buffer sizes for large responses
    proxy_buffer_size 128k;
    proxy_buffers 4 256k;
    proxy_busy_buffers_size 256k;
    
    # Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Backend API
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
EOF

echo "✅ Nginx configuration created at /etc/nginx/conf.d/panther-sanity.conf"

echo ""
echo "🔧 Step 3: Testing Nginx configuration..."

nginx -t

if [ $? -ne 0 ]; then
    echo "❌ Nginx configuration test failed"
    exit 1
fi

echo "✅ Nginx configuration is valid"

echo ""
echo "🔧 Step 4: Configuring firewall..."

# Configure firewall based on system
if command -v firewall-cmd &> /dev/null; then
    # firewalld (RHEL/CentOS)
    firewall-cmd --permanent --add-service=http
    firewall-cmd --reload
    echo "✅ Firewall configured (firewalld)"
elif command -v ufw &> /dev/null; then
    # ufw (Ubuntu)
    ufw allow 80/tcp
    echo "✅ Firewall configured (ufw)"
else
    echo "⚠️  No firewall detected. You may need to manually open port 80"
fi

echo ""
echo "🔧 Step 5: Starting Nginx..."

systemctl restart nginx
systemctl enable nginx

if [ $? -ne 0 ]; then
    echo "❌ Failed to start Nginx"
    exit 1
fi

echo "✅ Nginx started and enabled"

echo ""
echo "🔧 Step 6: Verifying services..."

# Check if frontend is running
if curl -s http://localhost:3000 > /dev/null; then
    echo "✅ Frontend is running on port 3000"
else
    echo "⚠️  Frontend is not responding on port 3000"
    echo "   Make sure your Docker containers are running:"
    echo "   docker-compose ps"
fi

# Check if backend is running
if curl -s http://localhost:3001/health > /dev/null; then
    echo "✅ Backend is running on port 3001"
else
    echo "⚠️  Backend is not responding on port 3001"
    echo "   Make sure your Docker containers are running:"
    echo "   docker-compose ps"
fi

echo ""
echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo "📝 Next Steps:"
echo ""
echo "1. Add DNS record (contact your IT team):"
echo "   Type: A Record"
echo "   Name: $DOMAIN_NAME"
echo "   Value: $(hostname -I | awk '{print $1}')"
echo ""
echo "2. Wait for DNS propagation (5-30 minutes)"
echo ""
echo "3. Test DNS resolution:"
echo "   nslookup $DOMAIN_NAME"
echo ""
echo "4. Access your dashboard:"
echo "   http://$DOMAIN_NAME"
echo ""
echo "📊 Useful Commands:"
echo "   Check Nginx status:  systemctl status nginx"
echo "   View Nginx logs:     tail -f /var/log/nginx/error.log"
echo "   Restart Nginx:       systemctl restart nginx"
echo "   Test config:         nginx -t"
echo ""
echo "🔒 Optional: Add SSL/HTTPS later with:"
echo "   sudo certbot --nginx -d $DOMAIN_NAME"
echo ""
