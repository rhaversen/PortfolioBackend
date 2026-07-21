# Messenger/Instagram Conversation Archiver — Implementation Spec

## Purpose

Backend service that: (1) does an initial backfill of conversations/messages, (2) stores them in a local DB, (3) polls periodically to append new messages only, without re-fetching or duplicating existing data.

---

## 1. Auth / Required Keys

| Key                     | Source                                                                   | Notes                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PAGE_ACCESS_TOKEN`     | OAuth via Facebook Login for Business, or Graph API Explorer for testing | Must be issued by a user with `MESSAGING` or `MODERATE` task on the Page. Store server-side only, never client-exposed. Exchange short-lived token for a long-lived Page token (60-day, effectively non-expiring if the Page stays active). |
| `PAGE_ID`               | Meta Business Suite / Graph API `/me/accounts`                           | Target Page for conversations.                                                                                                                                                                                                              |
| `APP_ID` / `APP_SECRET` | Meta App Dashboard                                                       | Needed for OAuth token exchange and for generating long-lived tokens.                                                                                                                                                                       |
| `API_VERSION`           | e.g. `v21.0`                                                             | Pin a version; update deliberately.                                                                                                                                                                                                         |

Required permissions on the token:

- Messenger: `pages_manage_metadata`, `pages_read_engagement`, `pages_messaging`
- Instagram (optional): `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`
- Advanced Access required for conversations with users who have no role on the Page/app (requires App Review + Business Verification for Instagram).

Base URL: `https://graph.facebook.com/{API_VERSION}/`

---

## 2. Endpoints

### 2.1 List conversations

```
GET /{PAGE_ID}/conversations?platform={messenger|instagram}&fields=id,updated_time,is_owner&access_token={PAGE_ACCESS_TOKEN}
```

Returns array of `{id, updated_time}`. Paginate via `paging.next` cursor if present.

### 2.2 Find conversation with a specific user

```
GET /{PAGE_ID}/conversations?platform={platform}&user_id={USER_ID}&access_token={PAGE_ACCESS_TOKEN}
```

### 2.3 List message IDs in a conversation

```
GET /{CONVERSATION_ID}?fields=messages&access_token={PAGE_ACCESS_TOKEN}
```

Returns array of `{id, created_time}`. **Hard constraint: only the 20 most recent messages in a conversation are fetchable in detail via 2.4. Older message IDs returned here will 404/error if queried.**

### 2.4 Get message detail

```
GET /{MESSAGE_ID}?fields=id,created_time,from,to,message,reply_to&access_token={PAGE_ACCESS_TOKEN}
```

`reply_to` present only if the message is a reply; includes `is_self_reply` boolean.

### 2.5 Batch requests (use for 2.4 in bulk)

```
POST /
Params: access_token={PAGE_ACCESS_TOKEN}&batch=[
  {"method":"GET","relative_url":"{MESSAGE_ID_1}?fields=id,created_time,from,to,message,reply_to"},
  {"method":"GET","relative_url":"{MESSAGE_ID_2}?fields=id,created_time,from,to,message,reply_to"},
  ...
]
```

Batch max 50 sub-requests per call. Use this instead of N sequential GETs.

---

## 3. Data Model (storage)

```
conversations
  id              PK, string   (CONVERSATION-ID)
  platform        enum(messenger, instagram)
  peer_user_id    string       (the other party's scoped ID)
  peer_username   string, nullable
  last_synced_at  timestamp    (last time we polled this conversation)
  api_updated_time timestamp   (updated_time from API, used to detect new activity)
  is_owner        boolean, nullable
  download_selected boolean default false   (user's UI selection for which convos to keep polling)

messages
  id              PK, string   (MESSAGE-ID)
  conversation_id FK -> conversations.id
  created_time    timestamp
  from_id         string
  from_username   string
  to_id           string
  to_username     string
  body            text
  reply_to_mid    string, nullable
  is_self_reply   boolean, nullable
  fetched_at      timestamp    (when we pulled this record)
```

---

## 4. Backfill logic (initial load)

1. Call 2.1 for each platform, paginate fully, upsert into `conversations` (keyed by `id`).
2. For each conversation where `download_selected = true` (or all, if backfilling everything):
   a. Call 2.2/2.1 result already has conversation IDs — call 2.3 to get message ID list.
   b. Take up to the 20 IDs returned (API only exposes the 20 most recent regardless of list length — anything beyond will error if fetched).
   c. Batch-fetch details via 2.5 for those message IDs.
   d. Upsert each into `messages`, keyed by `id` (idempotent — safe to re-run).
   e. Set `conversations.last_synced_at = now()`, `api_updated_time = <value from 2.1>`.

---

## 5. Polling / incremental refresh logic

Run on a schedule (e.g. every 5–15 min via cron/worker).

```
for platform in [messenger, instagram]:
    convos = GET /{PAGE_ID}/conversations?platform=platform&fields=id,updated_time
    for convo in convos:
        stored = db.get(conversation, convo.id)

        if not stored:
            # brand new conversation — insert then do full sync per Section 4
            insert conversation row
            sync_messages(convo.id)
            continue

        if convo.updated_time <= stored.api_updated_time:
            # no new activity, skip — avoids wasted calls
            continue

        # activity detected, only need to check the most recent window
        sync_messages(convo.id)
        update stored.api_updated_time = convo.updated_time
        update stored.last_synced_at = now()


function sync_messages(conversation_id):
    message_ids = GET /{conversation_id}?fields=messages   # up to 20 most recent
    known_ids = db.query(messages where conversation_id = conversation_id).select(id)
    new_ids = message_ids - known_ids                       # set difference

    if new_ids is empty:
        return   # nothing new despite updated_time change (e.g. edit/reaction event)

    details = batch_fetch(new_ids)                           # via 2.5
    for msg in details:
        upsert into messages (idempotent on id)
```

### Key refresh rules

- **Never re-fetch messages already in the DB** — message content is immutable once sent, so `id` presence in `messages` table is sufficient dedup key. No need to re-GET detail for known IDs.
- **Change detection**: compare `updated_time` from the conversations list call against the last stored value before doing any per-message work — this avoids a message-list call for every conversation on every poll cycle.
- **Gap risk**: because only the 20 most recent messages are ever fetchable, if more than 20 messages arrive in a single polling interval, the oldest of that burst will be unreachable (API returns a "message deleted" style error for anything past the 20 most recent). Poll frequently enough relative to expected message volume per conversation to avoid gaps. If a gap is detected (new message's `reply_to` or sequence implies missing predecessor not in DB and not fetchable), log it as a known permanent gap — it cannot be backfilled after the fact.
- **New conversations**: detected when `convo.id` isn't yet in the `conversations` table; treat identically to backfill (Section 4).
- **Rate limits**: batch requests count against standard Graph API rate limits per Page/app; back off with exponential retry on HTTP 4xx/17 (rate limit) responses.
- **Pagination**: always follow `paging.next` on the conversations list call — Pages with many active threads will paginate.

---

## 6. Selection UI hook

`conversations.download_selected` is set by the frontend when a user chooses "keep downloading this one." The polling job should either:

- Poll all conversations but only persist messages for `download_selected = true` ones, or
- Filter the conversations list to `download_selected = true` before doing any per-conversation work (cheaper, recommended).

Either way, the initial conversation list + `updated_time` metadata (Section 4 step 1 / Section 5 top-level loop) should always be refreshed for **all** conversations, so the UI can show recency/preview even for threads not yet selected for full download.
