# Railway Volumes Configuration

To enable persistent storage on Railway (so images don't disappear):

## Option 1: Add Volume via Railway Dashboard

1. Go to your Railway project
2. Click on your service
3. Navigate to "Variables" tab
4. Scroll down to "Volumes"
5. Click "New Volume"
6. Configure:
   ```
   Mount Path: /app/public/temp
   Size: 1GB (or adjust based on needs)
   ```
7. Click "Add" and redeploy

## Option 2: Add Volume via railway.json

Create `railway.json` in your project root:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "numReplicas": 1,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  },
  "volumes": [
    {
      "mountPath": "/app/public/temp",
      "name": "loom-frames-storage"
    }
  ]
}
```

## Important Notes

- **Volumes are persistent** across deployments
- Each replica has its own volume (not shared)
- If you scale to multiple replicas, images might not be accessible across instances
- Consider using a CDN/cloud storage for production with multiple replicas

## Why Volumes Help

Without volumes:
- Railway uses ephemeral filesystem
- Files created at runtime disappear after container restart
- Images in `/public/temp/` vanish between requests

With volumes:
- Files persist across deployments and restarts
- Images remain accessible via file URLs
- No need for base64 encoding (saves bandwidth/storage)

## Cost

Railway volumes are charged separately:
- $0.25/GB/month
- 1GB volume = ~$0.25/month
- Free tier includes some volume storage

## After Adding Volume

1. Redeploy your app
2. Railway will mount the volume at `/app/public/temp`
3. Images will persist and be accessible via URLs
4. You can still use IndexedDB as a frontend optimization
