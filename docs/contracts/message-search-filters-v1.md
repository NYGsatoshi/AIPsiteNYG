# Message search and quick-filter contract v1

Status: Issue #359 implementation candidate.

## Purpose

The Messages landing page provides an immediately discoverable way to find
authorized Message text and to reduce the currently loaded authorized
conversation list to high-frequency attention states.

These are deliberately two explicit scopes:

- **Search messages** calls the existing server-authorized Search API and
  renders Message matches.
- **Conversation filters** use the `unreadCount` and `hasMention` values from
  the existing authorized Conversation list response.

Issue #367 owns compound advanced Message-result filters such as sender, date,
read status, and attachment state. This contract does not imply those semantics.

## Search request and projection

The browser sends one bounded request after an explicit submit:

```http
GET /api/search?q={trimmedQuery}&type=Message&page=1&pageSize=50
```

The query must contain at least two trimmed characters and the input is capped
at 120 characters. The browser does not use `type=All`, does not infer a
Workspace authorization scope, and does not calculate a server result total.

Before rendering an item, the browser requires:

- `type` to be the canonical numeric or string Message discriminator;
- a UUID Message ID;
- a non-empty conversation title;
- an internal `/conversations/{conversationUuid}` route.

The browser rebuilds the route from the validated Conversation UUID. When that
Conversation is also in the authorized list projection, it uses the already
mapped channel or DM route. Arbitrary API routes are never rendered. Snippets
and author display names come only from the authorized Search response and are
bounded again before display. Failures show fixed client-owned text and never
render response detail.

The backend remains authoritative. Its Message query applies the shared,
depth-bounded readable-Conversation relation before ordering and limiting. The
frontend validation is defense in depth and is not authorization.

## Quick conversation filters

Version 1 provides two independent, combinable toggles:

- `Unread`: `unreadCount > 0`;
- `@Me`: `hasMention === true`.

Both values already cross the canonical Conversation list authorization
boundary. The browser does not fetch a wider list, derive mention state from
Message bodies, or expose counts outside the returned list. Search matches and
the filtered conversation list remain visibly separate so a local list filter
is never misrepresented as a server-side Message-result filter.

Every applied query or quick filter appears as a removable condition chip.
Users can remove one condition, clear the conversation filters, or clear all
conditions. A zero-result state retains the conversation list and offers both
Change search and Clear all paths.

## Responsive and accessibility behavior

- Desktop renders the search and quick-filter controls expanded.
- At 640 CSS pixels and below, one native button opens the controls and moves
  focus to the search input.
- Escape closes the mobile controls and returns focus to their trigger.
- Search, filters, removable conditions, recovery actions, and results use
  native form, button, link, heading, list, and live-status semantics.
- Applied toggles expose `aria-pressed`; active conditions are textual and do
  not rely on color.

Conditions exist only for the current rendered Messages view. This version
does not store query text or result snippets in local/session storage or URLs.

## Attachment exclusion

There is intentionally no `Has file` filter. Canonical Message attachment
ownership and persistence are unresolved under the active BE-004 finding, and
the current composer explicitly disables attachments. Adding an attachment
filter now would invent semantics and could make incomplete or unauthorized
metadata appear authoritative.

## Non-goals

- attachment, sender, date-range, or read-status Message-result filtering;
- saved filters, URL replay, result highlighting, pagination, or infinite scroll;
- search-result totals beyond the validated rendered page;
- changing Search, Conversation, attachment, tenant, or authorization contracts;
- implementing any contract owned by Issues #340 or #357.
