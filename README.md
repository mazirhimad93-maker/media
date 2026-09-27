> **Current Media UI**
>
> Temporary workspace password: `alchemic2026`
>
> The current UI includes Dashboard, Clipping, Content & Distribution, Inbox placeholder, Leads, and Channels.
> Clipping reads the existing `clip_variants` + `content_assets` tables. Content reads the real `content_publish_queue`, including `external_post_url`.
> New content assets are held from publishing until **Approve Publishing** is clicked in the Clipping page.
>
> For the current Clipper/Distributor database, run the updated all-in-one migration:
>
> `sql/001_social_hub.sql`
>
> The old migration bug that referenced `content_history.external_post_url` has been removed. Published URLs come from `content_publish_queue.external_post_url`.
>
# Alchemic Social Hub v1

A separate deployable platform that combines:

- the existing **Clipper / Distributor** content lineage;
- published-post performance (views, likes, comments, shares, saves);
- Instagram comments and DMs in one social inbox;
- manual social replies through an n8n outbox worker;
- comment → private-DM replies for lead-generation CTAs;
- tracked links and click attribution;
- social contacts / leads and conversion events;
- an optional **read-only** view of replies from the existing Email Outreach Engine.

## Important boundary

This package **does not migrate, alter, or write to the email Outreach database**.

The existing email platform remains separate. If you add `OUTREACH_SUPABASE_URL` and `OUTREACH_SUPABASE_SERVICE_ROLE_KEY` to this new deployment, the Social Hub reads recent human email replies server-side and displays them as read-only conversations. There are no email mutations in the code.

All new SQL in `sql/001_social_hub.sql` targets the **content / clipper / distributor database** only.

## Existing systems this reuses

The build was based on the existing `alchemic-channel-connector` lineage and current Distributor contract:

- `content_accounts`
- `content_campaigns`
- `content_distribution_pools`
- `content_distribution_pool_accounts`
- `content_publish_queue`
- `content_assets`
- `content_history`
- `post_metrics_snapshots`
- `campaign_sources`
- `clip_variants`
- `clip_control_jobs`
- `clip_control_variants`

The recovered connector functions were:

- `netlify/functions/_shared.mjs`
- `oauth-start.mjs`
- `oauth-instagram-callback.mjs`
- `oauth-youtube-callback.mjs`
- `connector-data.mjs`
- `refresh-instagram-tokens.mjs`

This package upgrades the Instagram OAuth request from publish-only permissions to:

```text
instagram_business_basic
instagram_business_content_publish
instagram_business_manage_messages
instagram_business_manage_comments
```

Existing connected Instagram accounts therefore need to click **Connect / upgrade Instagram** once to grant the inbox/comment scopes.

## What the UI contains

### Overview

Shows:

- total views;
- social conversations;
- content-attributed leads;
- human email replies (read-only bridge);
- pending manual social replies;
- platform performance;
- top published content.

### Unified Inbox

Shows social and email replies together.

- Social conversation: fully interactive manual reply.
- Email reply: read-only by design so the Outreach Engine is untouched.
- Instagram comment: first manual reply is queued as a private reply to the comment, which can start the DM flow.
- Instagram DM: normal direct reply.

### Content Performance

Uses the existing content lineage:

```text
clip_variant
  → content_asset
  → content_history / published post
  → post_metrics_snapshots
  → social conversation
  → lead / tracked click
```

### Connected Accounts

Reuses the existing Distributor `content_accounts` rows. One Instagram account can now expose capabilities for publishing + comments + inbox + webhooks rather than being connected twice.

## Deploy

### 1. Apply SQL to the content/distributor Supabase project

Run:

```text
sql/001_social_hub.sql
```

Do **not** run it on the email Outreach project.

Then run the read-only checks in:

```text
sql/VERIFY_ONLY.sql
```

### 2. Create a NEW Netlify project

Deploy this folder as its own site, for example:

```text
alchemic-social-hub
```

Settings:

- Build command: none
- Publish directory: `public`
- Functions directory: `netlify/functions`

Add all environment variables from `.env.example`.

### 3. Existing connector credentials

Reuse the same Google and Meta apps already used by the Distributor. Do not create a new Meta app per Instagram account.

Update the Meta app with the new deployment callback URLs shown by the Social Hub.

### 4. Meta webhook

Set the Instagram webhook callback to:

```text
https://YOUR-NEW-SOCIAL-HUB.netlify.app/api/meta/webhook
```

Use exactly the same value as `META_WEBHOOK_VERIFY_TOKEN` for the Meta verify token.

Subscribe to at least:

```text
messages
messaging_postbacks
comments
mentions
```

The Instagram OAuth callback also attempts the account-level `/subscribed_apps` registration after a successful connection.

### 5. Reauthorize Instagram accounts

Open the new Social Hub → Connected Accounts → **Connect / upgrade Instagram**.

This refreshes the token with messaging/comment permissions while preserving the same `content_accounts` platform identity.

### 6. Import n8n workflows

Import:

- `n8n/ALCHEMIC_SOCIAL_OUTBOX_DISPATCHER_V1.json`
- `n8n/ALCHEMIC_SOCIAL_METRICS_SYNC_V1.json`

Follow `n8n/README.md`, test each workflow manually, then activate them.

## Current platform support

### Instagram

v1 supports:

- existing Distributor publishing account reuse;
- inbound DM webhooks;
- inbound comment webhooks;
- manual DM replies;
- manual private replies from comments;
- tracked conversations and contacts;
- media performance snapshots.

### YouTube

v1 supports:

- existing publishing connection;
- post/video view, like and comment metrics;
- content performance attribution.

It does not try to turn YouTube into a DM inbox because YouTube does not expose a comparable creator DM surface.

### Facebook and TikTok

The schema is already platform-neutral, so these can be added without changing the inbox data model. TikTok Business Messaging API requires its own Business Messaging access/authorization and account capability checks. It is intentionally not faked into this v1 package.

## No AI

There is no LLM in the social-reply path.

```text
Human types reply
  → social_outbox
  → n8n dispatcher
  → Instagram Send API
  → social_messages
```

AI can be added later as a suggestion layer without changing the message transport.
