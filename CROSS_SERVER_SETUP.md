# Cross-Server Setup Guide

Your setup has CSV files on one server and the application on another:

```
esst-srv25 (CSV Source)          esst-srv2-arm (Application)
├── CSV files                    ├── Frontend (Docker)
└── /root/gramasub/              ├── Backend (Docker)
    PANTHER_SANITY/              └── Database (Docker)
```

---

## Quick Setup (Automated)

### On esst-srv2-arm (Application Server):

```bash
# Make script executable
chmod +x setup-nfs-mount.sh

# Run the setup
sudo ./setup-nfs-mount.sh
```

This will:
1. ✅ Install NFS client
2. ✅ Create mount directory
3. ✅ Mount CSV directory from esst-srv25
4. ✅ Make mount permanent (survives reboots)
5. ✅ Verify CSV files are accessible

---

## Manual Setup (If Script Fails)

### Step 1: On esst-srv25 (CSV Source Server)

**Install and configure NFS server:**

```bash
# Install NFS server
sudo yum install nfs-utils -y

# Start NFS service
sudo systemctl start nfs-server
sudo systemctl enable nfs-server

# Configure export
sudo nano /etc/exports
```

**Add this line to /etc/exports:**
```
/root/gramasub/PANTHER_SANITY *(ro,sync,no_subtree_check)
```

**Apply changes:**
```bash
sudo exportfs -ra

# Open firewall for NFS
sudo firewall-cmd --permanent --add-service=nfs
sudo firewall-cmd --permanent --add-service=rpc-bind
sudo firewall-cmd --permanent --add-service=mountd
sudo firewall-cmd --reload

# Verify export
sudo exportfs -v
```

### Step 2: On esst-srv2-arm (Application Server)

**Install NFS client:**
```bash
sudo yum install nfs-utils -y
```

**Create mount directory:**
```bash
sudo mkdir -p /mnt/panther-sanity-csv
```

**Test mount:**
```bash
sudo mount -t nfs esst-srv25:/root/gramasub/PANTHER_SANITY /mnt/panther-sanity-csv

# Verify
ls -lh /mnt/panther-sanity-csv/*.csv
```

**Make permanent (add to /etc/fstab):**
```bash
# Backup fstab first
sudo cp /etc/fstab /etc/fstab.backup

# Add mount entry
echo "esst-srv25:/root/gramasub/PANTHER_SANITY /mnt/panther-sanity-csv nfs ro,defaults,_netdev 0 0" | sudo tee -a /etc/fstab

# Test fstab entry
sudo umount /mnt/panther-sanity-csv
sudo mount /mnt/panther-sanity-csv
```

### Step 3: Update Docker Configuration

**Option A: Update .env file:**
```bash
nano .env
```

Change:
```env
CSV_DIR=/mnt/panther-sanity-csv
```

**Option B: Update docker-compose.yml:**
```yaml
services:
  backend:
    environment:
      - CSV_DIR=/mnt/panther-sanity-csv
```

### Step 4: Restart Application

```bash
docker-compose down
docker-compose up -d

# Check logs
docker-compose logs -f backend
```

---

## Alternative: rsync (If NFS Doesn't Work)

If NFS is blocked or not available, use rsync to copy files:

### Create sync script:

```bash
cat > ~/sync-csv.sh << 'EOF'
#!/bin/bash
# Sync CSV files from esst-srv25 to local directory

SOURCE="root@esst-srv25:/root/gramasub/PANTHER_SANITY/"
DEST="/opt/panther-sanity/csv-data/"

mkdir -p "$DEST"

rsync -avz --delete "$SOURCE" "$DEST"

if [ $? -eq 0 ]; then
    echo "✅ CSV sync completed at $(date)"
else
    echo "❌ CSV sync failed at $(date)"
fi
EOF

chmod +x ~/sync-csv.sh
```

### Setup SSH key (for passwordless sync):

```bash
# Generate SSH key if you don't have one
ssh-keygen -t rsa -b 4096 -N "" -f ~/.ssh/id_rsa

# Copy to esst-srv25
ssh-copy-id root@esst-srv25

# Test
ssh root@esst-srv25 "ls /root/gramasub/PANTHER_SANITY/*.csv"
```

### Run sync manually:

```bash
~/sync-csv.sh
```

### Setup automatic sync (cron):

```bash
# Edit crontab
crontab -e

# Add this line (sync every 5 minutes)
*/5 * * * * /root/sync-csv.sh >> /var/log/panther-csv-sync.log 2>&1
```

### Update Docker to use local directory:

```bash
# In .env or docker-compose.yml
CSV_DIR=/opt/panther-sanity/csv-data
```

---

## Verification

### Check NFS mount:
```bash
# Is it mounted?
df -h | grep panther

# Mount details
mount | grep panther

# List CSV files
ls -lh /mnt/panther-sanity-csv/*.csv
```

### Check Docker can access:
```bash
# Check backend logs
docker-compose logs backend | grep CSV

# Check inside container
docker-compose exec backend ls -lh /data/csvs/
```

### Test ingestion:
```bash
# Trigger manual ingest
curl -X POST http://localhost:3001/api/ingest

# Check response
curl http://localhost:3001/api/sanity-results
```

---

## Troubleshooting

### Problem: "mount.nfs: access denied"

**On esst-srv25:**
```bash
# Check exports
sudo exportfs -v

# Ensure directory is exported
sudo nano /etc/exports
# Add: /root/gramasub/PANTHER_SANITY *(ro,sync,no_subtree_check)

# Reload
sudo exportfs -ra
```

### Problem: "mount.nfs: Connection refused"

**Check NFS service on esst-srv25:**
```bash
sudo systemctl status nfs-server
sudo systemctl start nfs-server

# Check firewall
sudo firewall-cmd --list-all
```

### Problem: "Stale file handle"

**Remount:**
```bash
sudo umount -f /mnt/panther-sanity-csv
sudo mount /mnt/panther-sanity-csv
```

### Problem: "Permission denied" in Docker

**Check mount permissions:**
```bash
ls -ld /mnt/panther-sanity-csv
ls -lh /mnt/panther-sanity-csv/*.csv

# If needed, adjust permissions on esst-srv25
# (But be careful with security!)
```

### Problem: Mount doesn't survive reboot

**Check fstab:**
```bash
cat /etc/fstab | grep panther

# Ensure _netdev option is present
# This tells system to wait for network before mounting
```

---

## Security Considerations

1. **Read-only mount** (ro) - Application can't modify CSV files
2. **Network dependency** (_netdev) - Mount waits for network
3. **Firewall rules** - Only allow NFS from esst-srv2-arm to esst-srv25
4. **SSH keys** (for rsync) - Use dedicated key with limited permissions

---

## Which Method to Use?

| Method | Pros | Cons | Recommended For |
|--------|------|------|-----------------|
| **NFS** | Real-time access, no sync delay | Requires NFS setup, network dependency | Production (if NFS allowed) |
| **rsync** | Works anywhere, no NFS needed | Sync delay, uses disk space | When NFS is blocked |

**Recommendation:** Use NFS (automated script) for real-time access. Fall back to rsync if NFS is not available.

---

## Summary

1. Run `sudo ./setup-nfs-mount.sh` on esst-srv2-arm
2. Update CSV_DIR in .env or docker-compose.yml
3. Restart Docker containers
4. Test by clicking "Ingest Latest" on dashboard

Total setup time: ~5 minutes

Need help? Check logs:
```bash
# NFS mount logs
dmesg | grep nfs

# Docker logs
docker-compose logs backend
```
