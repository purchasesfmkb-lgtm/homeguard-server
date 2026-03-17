# HomeGuard Signaling Server

This is the signaling server for HomeGuard Monitor - a personal security monitoring system.

## Deployment

This server is configured for Railway deployment.

### Environment Variables

No environment variables required. Railway automatically sets the `PORT` variable.

### Local Development

```bash
bun install
bun run index.ts
```

Server will run on port 3003 (or PORT environment variable).

## Usage

1. Deploy this service to Railway
2. Note your Railway URL (e.g., https://your-app.railway.app)
3. Update the URL in:
   - Android App: `PreferenceManager.kt`
   - Web Dashboard: `page.tsx`
