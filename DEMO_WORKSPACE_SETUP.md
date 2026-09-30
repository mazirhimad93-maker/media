# Alchemic Media — Sample Workspace Setup

This creates a polished, read-only sample workspace for sales demos. The workspace is explicitly marked **Sample data** so synthetic performance is never represented as a real client result.

## What gets seeded

- Workspace: **Northstar Growth**
- 3 sample channels: Instagram, YouTube, TikTok
- 1 content/distribution campaign
- 3 long-form source jobs
- 9 rendered/approved clips
- 9 published posts
- 10-day performance curves per post
- ~882K synthetic views
- ~2.4K tracked link clicks
- 10 synthetic lead conversations
- booked-call conversations with a non-live Zoom demo URL
- qualified/booked/client lead states

Sample video previews use public testing/open sample media. No third-party creator performance is presented as Alchemic/client performance.

## 1. Run the database migration

Run:

```text
sql/007_DEMO_WORKSPACE_SUPPORT.sql
```

on the same Supabase project used by Alchemic Media.

## 2. Deploy current main

The deployment must include:

- `netlify/functions/demo-bootstrap.mjs`
- the `/api/demo/bootstrap` redirect
- demo read-only workspace protection
- the **Sample data** header badge

## 3. Bootstrap / reset the sample account

The endpoint is admin-only. Use the same value already stored in Netlify as `CONNECTOR_ADMIN_TOKEN`.

PowerShell example:

```powershell
$ADMIN = "PASTE_YOUR_CONNECTOR_ADMIN_TOKEN_LOCALLY"

$body = @{
  email = "demo@alchemic.media"
  password = "AlchemicDemo!2026"
  full_name = "Alex Morgan"
  workspace_name = "Northstar Growth"
  workspace_slug = "northstar-growth-sample"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "https://tranquil-treacle-3ccbf6.netlify.app/api/demo/bootstrap" `
  -Headers @{ "x-connector-admin-token" = $ADMIN } `
  -ContentType "application/json" `
  -Body $body
```

Do not paste the admin token into chat, source control, or the public demo account.

Re-running the same request resets the sample workspace back to the canonical demo dataset.

## 4. Public demo login

After bootstrap:

```text
Email: demo@alchemic.media
Password: AlchemicDemo!2026
```

The sample workspace is read-only for normal authenticated users. Prospects can browse Dashboard, Clipping, Campaigns, Content, Inbox, Leads and Channels without changing the seeded dataset.

## Notes

- The fixed public demo password is acceptable only because the workspace is intentionally shared and server-side read-only.
- Do not reuse this password for any internal/admin account.
- Zoom links in sample conversations are intentionally non-live demo links.
- The workspace header displays **Sample data** with a tooltip explaining that performance and conversations are synthetic examples.
