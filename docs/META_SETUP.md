# Meta / Instagram setup

The existing Distributor connector only requested publishing scopes. The Social Hub requests the same publishing access plus messaging and comment management.

Required Instagram Login scopes:

```text
instagram_business_basic
instagram_business_content_publish
instagram_business_manage_messages
instagram_business_manage_comments
```

Callback URL:

```text
https://YOUR-SITE.netlify.app/oauth/instagram/callback
```

Webhook URL:

```text
https://YOUR-SITE.netlify.app/api/meta/webhook
```

Use `META_WEBHOOK_VERIFY_TOKEN` as the verify token in Meta.

Subscribe the app/webhook to messages and comments. The connector additionally attempts the per-account `subscribed_apps` call for each account after OAuth.

## Messaging behavior

Normal Instagram messages can only be sent within platform messaging rules. The Social Hub does not attempt cold unsolicited DMs.

When a webhook came from a comment, the Social Hub can queue the first response as a private reply tied to that comment. If the user replies to that DM, the normal conversation flow continues.

## App mode / access

Testing with app-role accounts is different from production access. For real followers/customers, make sure the Meta app is Live and that the required permissions/access review and business verification are complete for your use case.
