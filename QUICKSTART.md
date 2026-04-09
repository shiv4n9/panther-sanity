# 🚀 Quick Start Guide

Get the Sanity Dashboard running in 5 minutes!

## Prerequisites

- Python 3.8+ installed
- Node.js 14+ installed
- Access to `/root/gramasub/PANTHER_SANITY/` directory

## Step 1: Start Backend (2 minutes)

```bash
cd backend
./install.sh
./start.sh
```

✅ Backend running at `http://localhost:3001`

## Step 2: Start Frontend (2 minutes)

```bash
# In a new terminal
npm install
npm run dev
```

✅ Frontend running at `http://localhost:5173`

## Step 3: Test (1 minute)

1. Open browser: `http://localhost:5173`
2. You should see the dashboard with test data
3. Click on numeric values to open GNATS links
4. Hover over results to see CPU/Memory/SHM tooltips

## 🎉 Done!

Your dashboard is now running and connected to the Python backend.

## Next Steps

### For Development
- Edit CSV files in `/root/gramasub/PANTHER_SANITY/`
- Backend will automatically serve the latest file
- Frontend will reload on code changes

### For Production
See `DEPLOYMENT_GUIDE.md` for:
- Systemd service setup
- Nginx configuration
- SSL certificates
- Monitoring

## Troubleshooting

### Backend won't start?
```bash
# Check Python version
python3 --version

# Check if port 3001 is available
sudo lsof -i :3001

# View detailed logs
cd backend
source venv/bin/activate
python server.py
```

### Frontend shows "Loading..."?
```bash
# Test backend directly
curl http://localhost:3001/health

# Check if CSV files exist
ls -la /root/gramasub/PANTHER_SANITY/

# Check browser console for errors
```

### No CSV files?
```bash
# Create sample file
cp public/sample-data.csv /root/gramasub/PANTHER_SANITY/test.csv
```

## API Endpoints

Test these in your browser or with curl:

- Health: http://localhost:3001/health
- Latest CSV: http://localhost:3001/api/sanity-results/latest
- List files: http://localhost:3001/api/sanity-results

## Features

✅ Automatic CSV loading
✅ GNATS issue links (numeric values)
✅ Historical performance view
✅ System metrics tooltips
✅ Real-time search
✅ Responsive design
✅ Loading/error states

## Support

- Backend docs: `backend/README.md`
- Deployment: `DEPLOYMENT_GUIDE.md`
- API setup: `API_SETUP.md`
- Features: `IMPLEMENTATION_SUMMARY.md`

---

**Need help?** Check the troubleshooting section above or review the detailed guides.
