#!/bin/bash
# Setup NFS mount for CSV files from esst-srv25 to esst-srv2-arm

set -e

echo "=========================================="
echo "PANTHER Sanity - NFS Mount Setup"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Please run as root or with sudo"
    exit 1
fi

# Configuration
CSV_SOURCE_SERVER="esst-srv25"
CSV_SOURCE_PATH="/root/gramasub/PANTHER_SANITY"
LOCAL_MOUNT_PATH="/mnt/panther-sanity-csv"

echo "📋 Configuration:"
echo "   Source Server: $CSV_SOURCE_SERVER"
echo "   Source Path: $CSV_SOURCE_PATH"
echo "   Local Mount: $LOCAL_MOUNT_PATH"
echo ""

read -p "Continue with this configuration? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ]; then
    echo "❌ Setup cancelled"
    exit 0
fi

echo ""
echo "🔧 Step 1: Installing NFS client..."

# Detect OS and install NFS client
if [ -f /etc/redhat-release ]; then
    # RHEL/CentOS/Fedora
    yum install -y nfs-utils
elif [ -f /etc/debian_version ]; then
    # Debian/Ubuntu
    apt-get update
    apt-get install -y nfs-common
else
    echo "❌ Unsupported OS. Please install NFS client manually."
    exit 1
fi

echo "✅ NFS client installed"

echo ""
echo "🔧 Step 2: Creating mount directory..."

mkdir -p "$LOCAL_MOUNT_PATH"
echo "✅ Mount directory created: $LOCAL_MOUNT_PATH"

echo ""
echo "🔧 Step 3: Testing NFS mount..."

# Test mount first
mount -t nfs "$CSV_SOURCE_SERVER:$CSV_SOURCE_PATH" "$LOCAL_MOUNT_PATH"

if [ $? -ne 0 ]; then
    echo "❌ Failed to mount NFS share"
    echo ""
    echo "Possible issues:"
    echo "1. esst-srv25 NFS server not configured"
    echo "2. Firewall blocking NFS ports"
    echo "3. Permission issues"
    echo ""
    echo "On esst-srv25, ensure NFS is configured:"
    echo "   sudo yum install nfs-utils"
    echo "   sudo systemctl start nfs-server"
    echo "   sudo systemctl enable nfs-server"
    echo ""
    echo "Add to /etc/exports on esst-srv25:"
    echo "   $CSV_SOURCE_PATH *(ro,sync,no_subtree_check)"
    echo ""
    echo "Then run: sudo exportfs -ra"
    exit 1
fi

echo "✅ NFS mount successful (temporary)"

echo ""
echo "🔧 Step 4: Verifying CSV files..."

CSV_COUNT=$(ls -1 "$LOCAL_MOUNT_PATH"/*.csv 2>/dev/null | wc -l)

if [ "$CSV_COUNT" -eq 0 ]; then
    echo "⚠️  No CSV files found in $LOCAL_MOUNT_PATH"
    echo "   Make sure CSV files exist on esst-srv25:$CSV_SOURCE_PATH"
else
    echo "✅ Found $CSV_COUNT CSV file(s)"
    echo ""
    echo "Latest CSV files:"
    ls -lht "$LOCAL_MOUNT_PATH"/*.csv 2>/dev/null | head -3
fi

echo ""
echo "🔧 Step 5: Making mount permanent..."

# Check if already in fstab
if grep -q "$CSV_SOURCE_SERVER:$CSV_SOURCE_PATH" /etc/fstab; then
    echo "⚠️  Mount already exists in /etc/fstab"
else
    # Backup fstab
    cp /etc/fstab /etc/fstab.backup.$(date +%Y%m%d_%H%M%S)
    
    # Add to fstab
    echo "$CSV_SOURCE_SERVER:$CSV_SOURCE_PATH $LOCAL_MOUNT_PATH nfs ro,defaults,_netdev 0 0" >> /etc/fstab
    echo "✅ Added to /etc/fstab (backup created)"
fi

echo ""
echo "🔧 Step 6: Updating Docker configuration..."

# Check if docker-compose.yml exists
if [ -f "docker-compose.yml" ]; then
    echo "✅ Found docker-compose.yml"
    
    # Check if CSV_DIR is already set correctly
    if grep -q "CSV_DIR=$LOCAL_MOUNT_PATH" docker-compose.yml; then
        echo "✅ CSV_DIR already configured correctly"
    else
        echo "⚠️  Please update docker-compose.yml:"
        echo "   In backend service, set:"
        echo "   environment:"
        echo "     - CSV_DIR=$LOCAL_MOUNT_PATH"
        echo ""
        echo "   Or update .env file:"
        echo "   CSV_DIR=$LOCAL_MOUNT_PATH"
    fi
else
    echo "⚠️  docker-compose.yml not found in current directory"
fi

echo ""
echo "🔧 Step 7: Testing mount persistence..."

# Unmount and remount using fstab
umount "$LOCAL_MOUNT_PATH"
mount "$LOCAL_MOUNT_PATH"

if [ $? -eq 0 ]; then
    echo "✅ Mount from fstab successful"
else
    echo "❌ Failed to mount from fstab"
    exit 1
fi

echo ""
echo "=========================================="
echo "✅ NFS Mount Setup Complete!"
echo "=========================================="
echo ""
echo "📝 Summary:"
echo "   Source: $CSV_SOURCE_SERVER:$CSV_SOURCE_PATH"
echo "   Mounted at: $LOCAL_MOUNT_PATH"
echo "   CSV files found: $CSV_COUNT"
echo "   Mount type: Read-only (ro)"
echo "   Auto-mount: Enabled (via /etc/fstab)"
echo ""
echo "📊 Next Steps:"
echo ""
echo "1. Update your .env or docker-compose.yml:"
echo "   CSV_DIR=$LOCAL_MOUNT_PATH"
echo ""
echo "2. Restart Docker containers:"
echo "   docker-compose down"
echo "   docker-compose up -d"
echo ""
echo "3. Verify backend can access CSV files:"
echo "   docker-compose logs backend"
echo ""
echo "4. Test the dashboard:"
echo "   Click 'Ingest Latest' button"
echo ""
echo "🔍 Useful Commands:"
echo "   Check mount:        df -h | grep panther"
echo "   List CSV files:     ls -lh $LOCAL_MOUNT_PATH/*.csv"
echo "   Unmount:            sudo umount $LOCAL_MOUNT_PATH"
echo "   Remount:            sudo mount $LOCAL_MOUNT_PATH"
echo "   View mount status:  mount | grep panther"
echo ""
