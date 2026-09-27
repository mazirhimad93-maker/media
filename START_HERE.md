# Start here

1. **Do not touch the email Outreach database.** This package has no email migration.
2. Open `sql/001_social_hub.sql` and run it only on the content/distributor Supabase project.
3. Deploy this folder as a new Netlify site.
4. Add `.env.example` values in the new site's environment settings.
5. Configure Meta webhook callback to `/api/meta/webhook` and the verify token.
6. Open the new Social Hub and reconnect/upgrade each Instagram account once.
7. Import both n8n workflows, add the two n8n environment variables in `n8n/README.md`, test them manually, then activate.
8. Run **Sync metrics** from the Social Hub.
9. Send a test DM to a connected Instagram account. It should appear in Unified Inbox.
10. Reply from the Social Hub. It should queue, n8n should dispatch it, and the outbound message should appear in the same thread.
11. Leave a comment on a connected account's post. It should appear as a comment message; your first reply from the Social Hub will queue as a private reply to that comment.

If the optional Outreach bridge variables are configured, email replies will appear in the same inbox as read-only items. Nothing in this package writes back to email campaigns, sequences, leads, or conversation history.
