# Existing Outreach database security note

No changes are made by this package to the existing Outreach database.

During the build, the current Supabase advisor reported **31 public-schema tables with Row Level Security disabled** in the Outreach project, including core campaign, lead, conversation and CRM tables.

That means you should **not expose the Outreach anon/publishable key in this new frontend** as a shortcut.

This package avoids that problem by accessing the Outreach database only inside a Netlify Function using the server-side service-role key, and only with GET requests.

Do not blindly enable RLS on the existing Outreach tables without first designing policies: enabling RLS with no matching policies can immediately break the live Outreach application. Treat that as a separate hardening task after taking a backup / testing against the current app behavior.
