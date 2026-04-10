# Domain Name Setup Guide for Panther Sanity Dashboard

This guide explains how to access your dashboard via a domain name instead of IP:PORT.

---

## Current Setup
- Frontend: `http://<server-ip>:3000`
- Backend API: `http://<server-ip>:3001`

## Goal
Access via: `http://panther-sanity.juniper.net` (or your chosen domain)

---

## Option 1: Internal DNS (Recommended for Corporate)

### Prerequisites
- Access to your organization's DNS management
- A domain under your control (e.g., `juniper.net`)

### Steps

1. **Request DNS Record from IT/Network Team**
   ```
   Type: A Record
   Name: panther-sanity
   Domain: juniper.net
   Value: <your-server-ip>
   TTL: 3600
   ```

2. **Install Nginx on Server**
   ```bash
   # On esstsrv2-arm
   sudo yum install nginx -y  # RHEL/CentOS
   # or
   sudo apt install nginx -y  # Ubuntu/Debian
   ```

3. **Configure Nginx Reverse Proxy**
   ```bash
   # Copy the provided config
   sudo cp nginx-reverse-proxy.conf /etc/nginx/conf.d/panther-sanity.conf
   
   # Edit the domain name
   sudo nano /etc/nginx/conf.d/panther-sanity.conf
   # Change: server_name panther-sanity.juniper.net;
   ```

4. **Test and Restart Nginx**
   ```bash
   # Test configuration
   sudo nginx -t
   
   # Restart Nginx
   sudo systemctl restart nginx
   sudo systemctl enable nginx
   
   # Open firewall port 80
   sudo firewall-cmd --permanent --add-service=http
   sudo firewall-cmd --reload
   ```

5. **Access Dashboard**
   ```
   http://panther-sanity.juniper.net
   ```

---

## Option 2: Local Hosts File (Quick Test)

### For Your Mac

1. **Edit hosts file**
   ```bash
   sudo nano /etc/hosts
   ```

2. **Add entry**
   ```
   <server-ip>  panther-sanity.local
   ```

3. **Save and access**
   ```
   http://panther-sanity.local:3000
   ```

**Note:** This only works on your machine. Other users won't be able to access via this name.

---

## Option 3: Public DNS (If Publicly Accessible)

### Prerequisites
- Server has public IP
- You own a domain (e.g., from GoDaddy, Namecheap, etc.)

### Steps

1. **Add DNS A Record in Domain Registrar**
   - Login to your domain registrar (GoDaddy, Namecheap, etc.)
   - Go to DNS Management
   - Add A Record:
     ```
     Type: A
     Host: panther-sanity (or @)
     Points to: <your-public-ip>
     TTL: 3600
     ```

2. **Wait for DNS Propagation** (5-30 minutes)
   ```bash
   # Check if DNS is propagated
   nslookup panther-sanity.yourdomain.com
   ```

3. **Setup Nginx** (same as Option 1, steps 2-4)

4. **Optional: Add SSL Certificate**
   ```bash
   # Install certbot
   sudo yum install certbot python3-certbot-nginx -y
   
   # Get free SSL certificate
   sudo certbot --nginx -d panther-sanity.yourdomain.com
   
   # Auto-renewal
   sudo systemctl enable certbot-renew.timer
   ```

---

## Option 4: Docker with Nginx (Containerized Approach)

### Update docker-compose.yml

Add Nginx service:

```yaml
services:
  # ... existing services ...
  
  nginx:
    image: nginx:alpine
    container_name: panther-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx-reverse-proxy.conf:/etc/nginx/conf.d/default.conf:ro
      - ./ssl:/etc/ssl:ro  # Optional: for SSL certificates
    depends_on:
      - frontend
      - backend
    networks:
      - panther-network
    restart: unless-stopped
```

Then:
```bash
docker-compose up -d nginx
```

---

## Recommended Approach for Your Environment

Based on your setup (esstsrv2-arm in corporate network):

### **Option 1 (Internal DNS) is best because:**
1. ✅ Works for all users in your organization
2. ✅ No port numbers needed
3. ✅ Professional and maintainable
4. ✅ Can add SSL later if needed

### Steps Summary:
1. Contact IT team for DNS record: `panther-sanity.juniper.net` → `<esstsrv2-arm-ip>`
2. Install Nginx on esstsrv2-arm
3. Copy and configure `nginx-reverse-proxy.conf`
4. Restart Nginx
5. Access via `http://panther-sanity.juniper.net`

---

## Troubleshooting

### DNS not resolving
```bash
# Check DNS
nslookup panther-sanity.juniper.net

# Check if Nginx is running
sudo systemctl status nginx

# Check Nginx logs
sudo tail -f /var/log/nginx/error.log
```

### Port conflicts
```bash
# Check what's using port 80
sudo netstat -tulpn | grep :80

# If something else is using port 80, change Nginx to different port
# In nginx config: listen 8080;
```

### Firewall blocking
```bash
# Check firewall status
sudo firewall-cmd --list-all

# Open port 80
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --reload
```

---

## Security Considerations

1. **Internal Network Only**
   - If dashboard should only be accessible internally, ensure firewall rules restrict external access
   - Use internal DNS only

2. **Add Authentication** (Future Enhancement)
   - Consider adding basic auth in Nginx
   - Or implement OAuth/LDAP integration

3. **SSL/TLS** (For Production)
   - Get certificate from your organization's CA
   - Or use Let's Encrypt for public domains
   - Uncomment HTTPS section in nginx config

---

## Next Steps

1. Decide which option fits your needs
2. For Option 1: Contact IT team for DNS record
3. Install and configure Nginx
4. Test access via domain name
5. Update documentation with the new URL

Need help with any specific step? Let me know!
