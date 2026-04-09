# Cross-Server Deployment Guide

## Architecture Overview

```
┌─────────────────────┐         ┌─────────────────────┐
│   ttbg-shell001     │         │   ttbg-shell001     │
│   esstsrv2-arm      │         │   esst-srv25        │
│                     │         │                     │
│  ┌───────────────┐  │         │  ┌───────────────┐  │
│  │   Frontend    │  │         │  │  CSV Files    │  │
│  │   (React)     │  │         │  │  /root/...    │  │
│  │   Port 5173   │  │         │  │  PANTHER_     │  │
│  └───────────────┘  │         │  │  SANITY/      │  │
│                     │         │  └───────────────┘  │
│  ┌───────────────┐  │         │                     │
│  │   Backend     │  │         │                     │
│  │   (Flask)     │◄─┼─────────┼─────────────────────┤
│  │   Port 3001   │  │  Access │                     │
│  └───────────────┘  │  CSV    │                     │
│                     │  Files  │                     │
└─────────────────────┘         └─────────────────────┘
```

## Deployment Options

### Option 1: NFS Mount (Recommended)
Mount the CSV directory from esst-srv25 to esstsrv2-arm.

#### On esst-srv25 (CSV Server):
```bash
# Install NFS server
sudo apt-get install nfs-kernel-server  # Ubuntu/Debian
# or
sudo yum install nfs-utils              # RHEL/CentOS

# Configure NFS export
sudo nano /etc/exports

# Add this line (replace esstsrv2-arm-ip with actual IP):
/root/gramasub/PANTHER_SANITY esstsrv2-arm-ip(ro,sync,no_subtree_check)

# Apply changes
sudo exportfs -ra
sudo systemctl restart nfs-server
```

#### On esstsrv2-arm (Application Server):
```bash
# Install NFS client
sudo apt-get install nfs-common  # Ubuntu/Debian
# or
sudo yum install nfs-utils       # RHEL/CentOS

# Create mount point
sudo mkdir -p /mnt/panther-sanity-csv

# Mount the remote directory
sudo mount esst-srv25:/root/gramasub/PANTHER_SANITY /mnt/panther-sanity-csv

# Make it permanent (add to /etc/fstab)
echo "esst-srv25:/root/gramasub/PANTHER_SANITY /mnt/panther-sanity-csv nfs ro,defaults 0 0" | sudo tee -a /etc/fstab

# Update backend .env
echo "CSV_DIR=/mnt/panther-sanity-csv" >> backend/.env
```

### Option 2: SSH/SCP with Cron Sync
Periodically copy CSV files from esst-srv25 to esstsrv2-arm.

#### Setup SSH Key Authentication:
```bash
# On esstsrv2-arm
ssh-keygen -t rsa -b 4096 -f ~/.ssh/panther_sync
ssh-copy-id -i ~/.ssh/panther_sync.pub user@esst-srv25
```

#### Create Sync Script:
```bash
# On esstsrv2-arm
cat > ~/sync-csv.sh << 'EOF'
#!/bin/bash
# Sync CSV files from esst-srv25

SOURCE_SERVER="user@esst-srv25"
SOURCE_PATH="/root/gramasub/PANTHER_SANITY/"
DEST_PATH="/opt/panther-sanity/csv-data/"

# Create destination if it doesn't exist
mkdir -p "$DEST_PATH"

# Sync files (only copy new/modified files)
rsync -avz --progress \
  -e "ssh -i ~/.ssh/panther_sync" \
  "$SOURCE_SERVER:$SOURCE_PATH" \
  "$DEST_PATH"

echo "Sync completed at $(date)"
EOF

chmod +x ~/sync-csv.sh
```

#### Setup Cron Job (sync every 5 minutes):
```bash
crontab -e

# Add this line:
*/5 * * * * /home/user/sync-csv.sh >> /var/log/panther-csv-sync.log 2>&1
```

#### Update Backend Configuration:
```bash
# backend/.env
CSV_DIR=/opt/panther-sanity/csv-data
```

### Option 3: Remote API Access
Create a simple file server on esst-srv25 and access it via HTTP.

#### On esst-srv25:
```bash
# Create simple Python file server
cat > /root/gramasub/csv-server.py << 'EOF'
#!/usr/bin/env python3
from flask import Flask, send_file, jsonify
from pathlib import Path
import os

app = Flask(__name__)
CSV_DIR = '/root/gramasub/PANTHER_SANITY'

@app.route('/latest')
def get_latest():
    csv_files = sorted(Path(CSV_DIR).glob('*.csv'), 
                      key=lambda x: x.stat().st_mtime, 
                      reverse=True)
    if csv_files:
        return send_file(csv_files[0], mimetype='text/csv')
    return jsonify({'error': 'No files found'}), 404

@app.route('/file/<filename>')
def get_file(filename):
    file_path = os.path.join(CSV_DIR, filename)
    if os.path.exists(file_path):
        return send_file(file_path, mimetype='text/csv')
    return jsonify({'error': 'File not found'}), 404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
EOF

# Install Flask
pip3 install flask

# Run server
python3 /root/gramasub/csv-server.py
```

#### On esstsrv2-arm:
Modify backend to fetch from remote server instead of local filesystem.

### Option 4: Shared Storage (if available)
If both servers have access to shared storage (SAN, NAS, etc.), configure both to use the same path.

## Recommended Approach

**For your setup, I recommend Option 1 (NFS Mount)** because:
- ✅ Real-time access to latest CSV files
- ✅ No sync delays
- ✅ Read-only mount is secure
- ✅ No code changes needed
- ✅ Minimal overhead

## Deployment Steps (NFS Method)

### 1. On esst-srv25 (CSV Server):
```bash
# Install NFS server
sudo apt-get update
sudo apt-get install -y nfs-kernel-server

# Configure export
echo "/root/gramasub/PANTHER_SANITY $(hostname -I | awk '{print $1}')(ro,sync,no_subtree_check,no_root_squash)" | sudo tee -a /etc/exports

# Or if you know esstsrv2-arm IP:
# echo "/root/gramasub/PANTHER_SANITY 10.x.x.x(ro,sync,no_subtree_check,no_root_squash)" | sudo tee -a /etc/exports

# Apply and restart
sudo exportfs -ra
sudo systemctl enable nfs-server
sudo systemctl restart nfs-server

# Check firewall (if enabled)
sudo ufw allow from esstsrv2-arm-ip to any port nfs
```

### 2. On esstsrv2-arm (Application Server):
```bash
# Install NFS client
sudo apt-get update
sudo apt-get install -y nfs-common

# Test mount first
sudo mkdir -p /mnt/panther-sanity-csv
sudo mount -t nfs esst-srv25:/root/gramasub/PANTHER_SANITY /mnt/panther-sanity-csv

# Verify
ls -la /mnt/panther-sanity-csv

# If successful, make permanent
echo "esst-srv25:/root/gramasub/PANTHER_SANITY /mnt/panther-sanity-csv nfs ro,defaults,_netdev 0 0" | sudo tee -a /etc/fstab

# Deploy application
cd /opt
git clone https://github.com/shiv4n9/panther-sanity.git
cd panther-sanity

# Setup backend
cd backend
./install.sh

# Configure CSV path
echo "CSV_DIR=/mnt/panther-sanity-csv" >> .env
echo "PORT=3001" >> .env
echo "HOST=0.0.0.0" >> .env

# Start backend
./start.sh

# Setup frontend
cd ..
npm install

# Configure API URL
echo "REACT_APP_API_URL=http://esstsrv2-arm:3001" >> .env

# Build frontend
npm run build

# Serve with nginx or run dev server
npm run dev -- --host 0.0.0.0
```

### 3. Verify Setup:
```bash
# Check NFS mount
df -h | grep panther

# Check backend can read CSV
curl http://localhost:3001/health

# Check latest CSV
curl http://localhost:3001/api/sanity-results/latest

# Access frontend
# Open browser: http://esstsrv2-arm:5173
```

## Troubleshooting

### NFS Mount Issues:
```bash
# Check NFS exports on esst-srv25
showmount -e esst-srv25

# Check mount status
mount | grep panther

# Remount if needed
sudo umount /mnt/panther-sanity-csv
sudo mount -a
```

### Permission Issues:
```bash
# On esst-srv25, ensure directory is readable
sudo chmod -R 755 /root/gramasub/PANTHER_SANITY

# Check SELinux (if enabled)
sudo setsebool -P nfs_export_all_ro 1
```

### Network Issues:
```bash
# Test connectivity
ping esst-srv25

# Check NFS ports
sudo netstat -tulpn | grep -E '(2049|111)'

# Test NFS connection
rpcinfo -p esst-srv25
```

## Security Considerations

1. **Read-Only Mount**: CSV directory is mounted read-only on esstsrv2-arm
2. **Network Isolation**: Ensure NFS traffic is on trusted network
3. **Firewall Rules**: Restrict NFS access to specific IPs
4. **No Root Squash**: Only if needed for root-owned files

## Alternative: If NFS is Not Available

Use Option 2 (rsync with cron) as fallback:

```bash
# Quick setup script
cat > ~/setup-csv-sync.sh << 'EOF'
#!/bin/bash
mkdir -p /opt/panther-sanity/csv-data
cat > ~/sync-csv.sh << 'INNER'
#!/bin/bash
rsync -avz root@esst-srv25:/root/gramasub/PANTHER_SANITY/ /opt/panther-sanity/csv-data/
INNER
chmod +x ~/sync-csv.sh
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/sync-csv.sh") | crontab -
~/sync-csv.sh  # Run first sync
EOF

chmod +x ~/setup-csv-sync.sh
./setup-csv-sync.sh
```

## Questions?

Contact the deployment team or check logs:
- Backend logs: `journalctl -u sanity-api -f`
- NFS logs: `sudo tail -f /var/log/syslog | grep nfs`
- Sync logs: `tail -f /var/log/panther-csv-sync.log`
