# Complete Deployment Guide

## 🚀 Quick Start (Development)

### Backend Setup

1. **Navigate to backend directory:**
```bash
cd backend
```

2. **Run installation script:**
```bash
chmod +x install.sh
./install.sh
```

3. **Configure environment:**
```bash
nano .env
```

Set your CSV directory:
```
CSV_DIR=/root/gramasub/PANTHER_SANITY
PORT=3001
HOST=0.0.0.0
```

4. **Start the server:**
```bash
chmod +x start.sh
./start.sh
```

Server will be running at `http://localhost:3001`

### Frontend Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Configure API URL:**
```bash
cp .env.example .env
nano .env
```

Set:
```
REACT_APP_API_URL=http://localhost:3001
```

3. **Start development server:**
```bash
npm run dev
```

Frontend will be running at `http://localhost:5173`

## 📦 Production Deployment

### Backend (Python API)

#### Option 1: Systemd Service (Recommended)

1. **Install backend:**
```bash
cd /root
git clone <your-repo> sanity-api
cd sanity-api/backend
./install.sh
```

2. **Configure:**
```bash
nano .env
```

3. **Install systemd service:**
```bash
sudo cp sanity-api.service /etc/systemd/system/
sudo nano /etc/systemd/system/sanity-api.service
```

Update paths in service file:
```ini
WorkingDirectory=/root/sanity-api/backend
Environment="PATH=/root/sanity-api/backend/venv/bin"
EnvironmentFile=/root/sanity-api/backend/.env
ExecStart=/root/sanity-api/backend/venv/bin/python /root/sanity-api/backend/server.py
```

4. **Enable and start:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable sanity-api
sudo systemctl start sanity-api
sudo systemctl status sanity-api
```

5. **View logs:**
```bash
sudo journalctl -u sanity-api -f
```

#### Option 2: Screen Session

```bash
screen -S sanity-api
cd /root/sanity-api/backend
./start.sh
# Press Ctrl+A then D to detach
```

### Frontend (React)

#### Option 1: Build and Serve with Nginx

1. **Build production bundle:**
```bash
npm run build
```

2. **Install Nginx:**
```bash
sudo apt-get update
sudo apt-get install nginx
```

3. **Copy build files:**
```bash
sudo cp -r dist/* /var/www/html/sanity-dashboard/
```

4. **Configure Nginx:**
```bash
sudo nano /etc/nginx/sites-available/sanity-dashboard
```

Add:
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    root /var/www/html/sanity-dashboard;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # Proxy API requests to backend
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

5. **Enable site:**
```bash
sudo ln -s /etc/nginx/sites-available/sanity-dashboard /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### Option 2: Serve with Python

```bash
cd dist
python3 -m http.server 8080
```

## 🔒 Security Setup

### 1. Firewall Configuration

```bash
# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow API port (only from localhost if using nginx proxy)
sudo ufw allow from 127.0.0.1 to any port 3001

# Enable firewall
sudo ufw enable
```

### 2. SSL Certificate (Let's Encrypt)

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

### 3. API Authentication (Optional)

Add to `backend/server.py`:
```python
API_KEY = os.environ.get('API_KEY', 'your-secret-key')

@app.before_request
def check_api_key():
    if request.endpoint != 'health_check':
        key = request.headers.get('X-API-Key')
        if key != API_KEY:
            return jsonify({'error': 'Unauthorized'}), 401
```

Update frontend `.env`:
```
REACT_APP_API_KEY=your-secret-key
```

## 📊 Monitoring

### Backend Health Check

```bash
curl http://localhost:3001/health
```

### Check Logs

```bash
# Systemd
sudo journalctl -u sanity-api -f

# Nginx
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Monitor CSV Directory

```bash
watch -n 5 'ls -lth /root/gramasub/PANTHER_SANITY/ | head -10'
```

## 🔄 Auto-Update CSV

### Option 1: Cron Job

```bash
crontab -e
```

Add:
```cron
# Restart API every hour to pick up new CSV files
0 * * * * systemctl restart sanity-api

# Or just touch a file to trigger reload
*/5 * * * * touch /root/gramasub/PANTHER_SANITY/.reload
```

### Option 2: File Watcher

Install inotify:
```bash
sudo apt-get install inotify-tools
```

Create watcher script:
```bash
#!/bin/bash
inotifywait -m /root/gramasub/PANTHER_SANITY -e create -e modify |
while read path action file; do
    echo "New CSV detected: $file"
    # Optionally restart API or send notification
done
```

## 🧪 Testing

### Test Backend

```bash
# Health check
curl http://localhost:3001/health

# Get latest CSV
curl http://localhost:3001/api/sanity-results/latest

# List files
curl http://localhost:3001/api/sanity-results

# Get metadata
curl http://localhost:3001/api/sanity-results/metadata/25.4X300-202603150112.0-EVO.csv
```

### Test Frontend

1. Open browser: `http://your-server-ip`
2. Check browser console for errors
3. Verify CSV data loads
4. Test GNATS links
5. Test historical view
6. Test search functionality

## 🐛 Troubleshooting

### Backend Not Starting

```bash
# Check Python version
python3 --version  # Should be 3.8+

# Check if port is in use
sudo lsof -i :3001

# Check logs
sudo journalctl -u sanity-api -n 50

# Test manually
cd backend
source venv/bin/activate
python server.py
```

### Frontend Not Loading Data

```bash
# Check API URL in browser console
# Verify CORS is enabled
# Test API directly with curl
curl http://localhost:3001/api/sanity-results/latest

# Check .env file
cat .env
```

### CSV Files Not Found

```bash
# Verify directory exists
ls -la /root/gramasub/PANTHER_SANITY/

# Check permissions
sudo chmod 755 /root/gramasub/PANTHER_SANITY/
sudo chmod 644 /root/gramasub/PANTHER_SANITY/*.csv

# Check service user
sudo systemctl status sanity-api
```

## 📝 Maintenance

### Update Backend

```bash
cd /root/sanity-api/backend
git pull
source venv/bin/activate
pip install -r requirements.txt --upgrade
sudo systemctl restart sanity-api
```

### Update Frontend

```bash
cd /root/sanity-api
git pull
npm install
npm run build
sudo cp -r dist/* /var/www/html/sanity-dashboard/
```

### Backup

```bash
# Backup CSV files
tar -czf sanity-backup-$(date +%Y%m%d).tar.gz /root/gramasub/PANTHER_SANITY/

# Backup configuration
tar -czf config-backup-$(date +%Y%m%d).tar.gz backend/.env .env
```

## 🎯 Performance Optimization

### Backend

1. **Enable caching:**
```python
from flask_caching import Cache
cache = Cache(app, config={'CACHE_TYPE': 'simple'})

@app.route('/api/sanity-results/latest')
@cache.cached(timeout=300)  # Cache for 5 minutes
def get_latest():
    # ...
```

2. **Use gunicorn:**
```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:3001 server:app
```

### Frontend

1. **Enable gzip in Nginx:**
```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript;
```

2. **Add caching headers:**
```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

## ✅ Deployment Checklist

- [ ] Backend installed and running
- [ ] Frontend built and deployed
- [ ] Environment variables configured
- [ ] Firewall rules set
- [ ] SSL certificate installed (production)
- [ ] Systemd service enabled
- [ ] Logs accessible
- [ ] Health check passing
- [ ] CSV files accessible
- [ ] GNATS links working
- [ ] Historical view functional
- [ ] Search working
- [ ] Tooltips displaying
- [ ] Responsive on mobile
- [ ] Backup strategy in place
- [ ] Monitoring configured

## 📞 Support

For issues:
1. Check logs: `sudo journalctl -u sanity-api -f`
2. Test API endpoints with curl
3. Verify CSV directory and files
4. Check browser console for frontend errors
5. Review this guide's troubleshooting section

---

**Status**: Ready for production deployment
**Last Updated**: 2026-04-09
