# Live channels and comments

The deployed frontend at `https://playful-rugelach-4b19a4.netlify.app/` matched this repository's `main` frontend before these changes. Production channel tokens, account inventory and post counts could not be inspected because the available browser was signed out and the connected Supabase projects did not include the recorded media project. Do not switch the site's existing database to an unrelated accessible project.

## Changes

- Manual metrics sync fetches fresh posts immediately, and automatic per-post sampling runs hourly. Instagram Insights failures preserve the previous measured snapshot and show a warning. Published Instagram container IDs can be resolved to live media IDs using the post permalink.
- Content has a live channel feed with 30 recent posts per page, fetched from Instagram media or a YouTube channel's uploads playlist. It includes posts published outside this app. Counts are per-post lifetime totals, not daily reach or channel-wide totals. Missing counts display as unavailable. This separate feed does not attribute external posts to campaigns or mix them into campaign charts.
- Inbox has Messages and Comments tabs, unread indicators, channel/status/search filters, older-comment pagination, individual public replies, and a selected batch of up to 20 replies. A review lists each recipient, sending channel, and message before posting. Replies are sent one request at a time, with per-comment delivery results.
- Replies use `POST /{ig-comment-id}/replies` or YouTube `comments.insert`. The backend verifies workspace/channel ownership and uses conditional durable claims to prevent concurrent duplicate replies. Uncertain delivery is blocked until the native thread is checked; it is never automatically retried.
- DM follow-up controls and filters are removed, and the old route rejects new drafts. The signed-in app removes old `metadata.follow_up` fields in workspace-scoped batches while preserving conversations, CRM stages and messaging-policy metadata. No DM window restrictions are relaxed.
- Existing TRAINING comment-to-private-DM automations remain: these are separate from retired DM follow-up drafts.

## Deployment and permissions

Deploy this commit to the **existing** Netlify project. Publish directory remains `public`; functions remain `netlify/functions`. Existing environment variables and the existing Supabase backend remain in use. `@netlify/blobs` is already pinned and used by the app. The new account-scoped comments cache/read markers/delivery claims use private site-wide stores; no SQL migration is required. Moving to another Netlify project does not carry those stores over.

Configure the new Google OAuth Web application:

- Authorized JavaScript origin: `https://playful-rugelach-4b19a4.netlify.app`
- Authorized redirect URI: `https://playful-rugelach-4b19a4.netlify.app/oauth/youtube/callback`
- Enable YouTube Data API v3 and YouTube Analytics API.
- Set that client's `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the existing Netlify project's environment, and redeploy. Keep credentials out of source and chat.
- Keep `CONNECTOR_PUBLIC_URL=https://playful-rugelach-4b19a4.netlify.app` for other connector consumers. OAuth callbacks derive the origin from the actual request to avoid an old URL.
- Reconnect each YouTube channel once to grant `youtube.upload`, `youtube.readonly`, `youtube.force-ssl` and `yt-analytics.readonly`. The callback records actual returned grants; it does not assume the requested grants succeeded. Reconnect requires selecting the same existing YouTube channel and preserves its publishing assignment.
- Instagram needs its existing publishing/message/comment permissions plus `instagram_business_manage_insights`. Use the channel's Reconnect action if counts or replies report missing access.

Public comment replies are independent of Instagram's ordinary 24-hour DM window. A public comment does not reopen the DM window. Only say “check your DM” when the relevant DM was actually delivered. YouTube Shorts comments and descriptions do not make external URLs clickable; use a channel profile link or a related-video CTA instead.

## Verification

Run `npm ci`, `npm run check`, and `npm test`. Tests cover native channel activity, comment pagination, permissions, channel ownership, concurrency and ambiguous delivery, metrics freshness, preservation of views when Insights fails, removal of follow-up metadata, and existing messaging/media behavior.

After deployment, sign in to the real workspace, refresh one Instagram channel and one YouTube channel, compare a post's counts against native Insights/YouTube, load older comments, and send one reviewed reply on a known test comment. No public test comments were sent during development. Live verification and OAuth consent remain pending until production access is available.
