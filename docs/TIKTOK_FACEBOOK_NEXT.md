# Facebook + TikTok adapter notes

The v1 schema/UI are already platform-neutral, but the deployable sender is intentionally enabled only for Instagram because that is the connector whose OAuth lineage is already established in the current Distributor.

## TikTok

TikTok currently exposes a Business Messaging API with conversation/message retrieval, sending, webhooks, automatic messages, and Comment-to-Message. That is **not the same authorization product as ordinary video publishing**.

Before adding TikTok inbox sending, the TikTok developer app must have Business Messaging API access and the target Business Account must report messaging capability. Do not assume an existing publish token has the required Business Messaging scope.

Once authorized, add a TikTok adapter to `dispatch-social.mjs` and a TikTok webhook normalizer that writes to the same:

- `social_contacts`
- `social_conversations`
- `social_messages`
- `social_outbox`

No DB redesign is required.

## Facebook

Facebook Page Messenger uses Page authorization and `pages_messaging` rather than the Instagram Login token. Add a Facebook Page connector only after the Page token/scopes are authorized, then normalize Page messages into the same Social Hub tables.

Keeping the auth adapters separate prevents the current working Distributor credentials from being broken while still giving every platform one common inbox model.
