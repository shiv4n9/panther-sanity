# Deploy Longevity Button

## Current Issue
The Longevity button is showing in the code but redirecting to the wrong URL because the frontend container is still running the old code.

## Solution
Run these commands on the server (esst-srv2-arm):

```bash
# 1. Pull latest code
git pull

# 2. Rebuild and restart the frontend container
docker-compose up -d --build frontend

# 3. Wait for the build to complete (may take 1-2 minutes)
docker-compose logs -f frontend

# 4. Once you see "Configuration complete; ready for start up", press Ctrl+C

# 5. Clear browser cache or do a hard refresh (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)
```

## Verification
1. Go to http://10.204.134.80
2. You should see a blue "Longevity" button in the header
3. Click it - it should open http://10.204.134.80:3000/?device=snpsrx400a-proto
4. You should see the SRX400A-PROTO device telemetry page

## What Changed
- Added "Longevity" button in the dashboard header
- Links directly to device: `snpsrx400a-proto`
- Opens in new tab
- Blue color scheme to distinguish from other buttons
