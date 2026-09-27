# n8n workflows

Import both JSON files into the same n8n instance that already runs the Distributor. They are intentionally **inactive** on import.

Set these environment variables on the n8n container/host:

```bash
ALCHEMIC_SOCIAL_HUB_URL=https://YOUR-NEW-SOCIAL-HUB.netlify.app
ALCHEMIC_SOCIAL_HUB_ADMIN_TOKEN=THE_SAME_VALUE_AS_CONNECTOR_ADMIN_TOKEN
```

Then restart n8n so `$env` can see them.

## ALCHEMIC SOCIAL OUTBOX DISPATCHER V1

Runs once per minute. It calls the Social Hub's protected dispatcher, which atomically claims pending rows from `social_outbox`, sends them with the OAuth token already stored in `content_accounts`, writes successful outbound messages into `social_messages`, and updates the conversation.

No AI is involved. You type the reply in the Social Hub UI.

For Instagram:
- normal DM replies use the official Instagram Messages endpoint;
- if the newest inbound item is a comment, the UI queues the first response as a **private reply** tied to that comment, allowing the comment → DM workflow;
- after the person replies in DM, normal conversation messaging is used.

## ALCHEMIC SOCIAL METRICS SYNC V1

Runs hourly. It refreshes metrics for recent published posts and appends snapshots to the existing `post_metrics_snapshots` table. YouTube uses `videos.list(part=statistics)`. Instagram collects basic media counts and attempts supported Reel insight metrics individually.

You can also run either workflow manually before activation to verify it.
