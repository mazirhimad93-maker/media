# Architecture

```text
                          ALCHEMIC SOCIAL HUB
                                  │
                  ┌───────────────┼────────────────┐
                  │               │                │
              Connector        Social Inbox     Analytics
                  │               │                │
            content_accounts     │       post_metrics_snapshots
                  │               │                │
          Distributor/Clipper     │        content_history
                  │               │                │
             published posts ─────┼────────────────┘
                                  │
                           social_contacts
                                  │
                       social_conversations
                                  │
                          social_messages
                                  │
                         social_outbox
                                  │
                             n8n worker
                                  │
                         Instagram Send API

Existing Email Outreach Supabase
        │
        └──── server-side READ ONLY ────> Unified Inbox
```

## Why it stays separate from Outreach

The Outreach Engine has its own n8n sequence/send/reply lifecycle. Rewriting it to share a physical database with the content system would add risk without adding value.

The Social Hub therefore unifies **the interface and attribution**, not the deployment/runtime of every system.

## Attribution

A content post can be traced through existing IDs:

```text
clip_variants.id
  → content_assets.clip_variant_id
  → content_history.asset_id
  → content_history.external_post_id
  → post_metrics_snapshots.history_id
  → social_conversations.source_history_id
  → growth_events.history_id
```

Tracked links can additionally map clicks directly to a content history row, asset, campaign and connected account.
