# Enabling Twilio SMS — required steps

**Status as of 2026-09-28: SMS is NOT live and Twilio is NOT configured.**
Zero `TWILIO_*` secrets are set in the Supabase project, and no SMS has ever been
sent (`schedule_notifications.provider_message_id` is null on every row; the only
channel ever used is `push`).

The two Twilio webhooks (`sms-inbound`, `sms-status`) now authenticate with Twilio's
native `X-Twilio-Signature` and **fail closed with 503 while `TWILIO_AUTH_TOKEN` is
absent**. That is deliberate and currently correct: it removes a fail-open hole where
any caller on the internet could forge STOP/START for any phone number, or forge
delivery status. It also means a real Twilio callback will be refused until the steps
below are done.

Nothing here is implemented. Do not do any of it as a side effect of another task.

## Before SMS can be switched on

1. **`TWILIO_ACCOUNT_SID`** — set as a Supabase Function secret.
2. **`TWILIO_AUTH_TOKEN`** — set as a Supabase Function secret. This is also the key
   the webhook signature is verified against, so the webhooks start working the moment
   it is set. Rotating it in Twilio requires updating it here in the same change, or
   both webhooks will 403.
3. **`TWILIO_FROM`** — either an E.164 number or a Messaging Service SID. The sending
   code already branches: a value starting with `MG` is sent as `MessagingServiceSid`,
   anything else as `From` (see `send-phone-code`, `process-notifications`).
4. **Twilio webhook URLs** — point the messaging service / number at:
   - inbound: `https://wscfpkaltajnrhiusoze.supabase.co/functions/v1/sms-inbound`
   - status callback: `https://wscfpkaltajnrhiusoze.supabase.co/functions/v1/sms-status`
5. **Verify the exact public callback URL used for signing.** Twilio signs the URL as
   configured, character for character, including any query string. The functions build
   the signed URL from `TWILIO_WEBHOOK_BASE_URL` (optional override) falling back to
   `SUPABASE_URL`, plus the request's own query string. If a custom domain is ever put
   in front of these endpoints, `TWILIO_WEBHOOK_BASE_URL` must be set to that exact
   origin or **every** callback will 403. No custom domain was chosen as of this note.
6. **Run a real signed-callback smoke test.** The signature construction is already
   verified against Twilio's published test vector in `test_twilio_signature.mjs`, but
   an end-to-end test with the live token has never been run, because the token does
   not exist yet. At minimum:
   - a genuinely signed inbound `HELP` reaches the HELP branch (no DB write),
   - a genuinely signed status callback for a nonexistent `MessageSid` is accepted and
     mutates nothing,
   - an unsigned and a wrong-signed request are both still refused.

## Related, deliberately not addressed

- **`TWILIO_WEBHOOK_SECRET` is dead.** It is no longer read by any function. Do not
  reintroduce a query-string secret; the header signature supersedes it.
- **`process-notifications` has no auth gate at all** (an anonymous POST returns 200).
  It only dispatches rows already queued and is cron-driven, so impact today is low —
  but it is the function that will actually spend Twilio money once SMS is live. It was
  explicitly out of scope for the webhook fix and needs its own slice.
