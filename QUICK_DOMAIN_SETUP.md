# Quick Domain Setup for All Users

This is the **fastest way** to make your dashboard accessible to all users via a domain name.

---

## Prerequisites

- ✅ You have root/sudo access on esstsrv2-arm
- ✅ Docker containers are running (`docker-compose ps`)
- ✅ You know what domain name you want (e.g., `panther-sanity.juniper.net`)

---

## Step 1: Run the Setup Script

On your server (esstsrv2-arm):

```bash
# Make script executable
chmod +x setup-domain.sh

# Run the setup script
sudo ./setup-domain.sh
```

The script will:
1. ✅ Install Nginx
2. ✅ Create reverse proxy configuration
3. ✅ Configure firewall
4. ✅ Start and enable Nginx
5. ✅ Verify everything is working

**You'll be asked for:**
- Domain name (e.g., `panther-sanity.juniper.net`)

---

## Step 2: Add DNS Record

Contact your IT/Network team and request:

```
DNS A Record:
─────────────────────────────────
Type:   A
Name:   panther-sanity
Domain: juniper.net
Value:  <your-server-ip>
TTL:    3600
```

**To find your server IP:**
```bash
hostname -I | awk '{print $1}'
```

---

## Step 3: Wait for DNS Propagation

DNS changes take 5-30 minutes to propagate.

**Check if DNS is ready:**
```bash
nslookup panther-sanity.juniper.net
```

You should see your server's IP address.

---

## Step 4: Access Dashboard

Once DNS is propagated, access via:

```
http://panther-sanity.juniper.net
```

**No port numbers needed!** 🎉

---

## Verification

### Check if Nginx is running:
```bash
sudo systemctl status nginx
```

### Check if services are accessible:
```bash
# Frontend
curl -I http://localhost:3000

# Backend
curl http://localhost:3001/health

# Through Nginx
curl -I http://panther-sanity.juniper.net
```

### View Nginx logs:
```bash
# Error logs
sudo tail -f /var/log/nginx/error.log

# Access logs
sudo tail -f /var/log/nginx/access.log
```

---

## Troubleshooting

### Problem: "Connection refused"

**Check if Docker containers are running:**
```bash
docker-compose ps
```

**Start containers if needed:**
```bash
docker-compose up -d
```

### Problem: "502 Bad Gateway"

**Frontend or backend not responding:**
```bash
# Check frontend
curl http://localhost:3000

# Check backend
curl http://localhost:3001/health

# Restart containers
docker-compose restart
```

### Problem: "DNS not resolving"

**Wait longer or check DNS:**
```bash
# Check DNS
nslookup panther-sanity.juniper.net

# Try from another machine
ping panther-sanity.juniper.net
```

**Temporary workaround (add to /etc/hosts on client machines):**
```bash
<server-ip>  panther-sanity.juniper.net
```

### Problem: "Firewall blocking"

**Check firewall:**
```bash
# For firewalld (RHEL/CentOS)
sudo firewall-cmd --list-all

# Open port 80
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --reload

# For ufw (Ubuntu)
sudo ufw status
sudo ufw allow 80/tcp
```

### Problem: "Nginx won't start"

**Check what's using port 80:**
```bash
sudo netstat -tulpn | grep :80
```

**If something else is using port 80, change Nginx port:**
```bash
sudo nano /etc/nginx/conf.d/panther-sanity.conf
# Change: listen 80; to listen 8080;

sudo systemctl restart nginx
```

Then access via: `http://panther-sanity.juniper.net:8080`

---

## Architecture

```
User Browser
     ↓
http://panther-sanity.juniper.net
     ↓
[DNS Resolution]
     ↓
esstsrv2-arm:80 (Nginx)
     ↓
     ├─→ localhost:3000 (Frontend Container)
     └─→ localhost:3001 (Backend Container)
```

---

## What This Setup Does

1. **Nginx listens on port 80** (standard HTTP port)
2. **Forwards requests to:**
   - `/` → Frontend (port 3000)
   - `/api/*` → Backend (port 3001)
3. **Users access via domain name** (no port numbers)
4. **Works for all users** in your network

---

## Optional: Add HTTPS/SSL

For production environments, add SSL:

```bash
# Install certbot
sudo yum install certbot python3-certbot-nginx -y

# Get free SSL certificate
sudo certbot --nginx -d panther-sanity.juniper.net

# Auto-renewal
sudo systemctl enable certbot-renew.timer
```

Then access via: `https://panther-sanity.juniper.net`

---

## Useful Commands

```bash
# Restart Nginx
sudo systemctl restart nginx

# Check Nginx status
sudo systemctl status nginx

# Test Nginx config
sudo nginx -t

# View error logs
sudo tail -f /var/log/nginx/error.log

# Reload Nginx (without downtime)
sudo systemctl reload nginx

# Stop Nginx
sudo systemctl stop nginx
```

---

## Summary

✅ **One script** sets up everything  
✅ **Works for all users** (not just your machine)  
✅ **No port numbers** needed  
✅ **Professional domain** access  
✅ **Production-ready** with Nginx  

**Total setup time:** ~10 minutes + DNS propagation time

Need help? Check the detailed guide in `DOMAIN_SETUP_GUIDE.md`
