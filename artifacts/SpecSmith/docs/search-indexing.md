# Search indexing operations

SpecSmith has two deliberately separate search workflows. Neither promises or
records that a search engine indexed a page merely because a request succeeded.

## 1. IndexNow notifications

`.github/workflows/notify-indexnow.yml` runs once a day and can also be run
manually. It builds the canonical sitemap, selects new or meaningfully changed
URLs, validates that every selected URL belongs to `specsmithpc.com` and still
exists in the sitemap, then sends one IndexNow request.

The IndexNow key is public by protocol. Its matching verification file is
`public/3b2b270931b45edfe57324016c9aa24c.txt`. No Bing account credential is
available to this workflow.

For a bounded priority pass, dispatch **Notify IndexNow of changed pages**, type
`notify`, and choose `priority-20`. That mode sends exactly the 20 highest-value
canonical pages (or every page when the sitemap has fewer than 20), ordered by
the same editorial route priorities used by the Google queue. Reserve `all` for
initial setup. Normal scheduled runs use `changed` and do nothing when no
canonical URL needs a notification.

An HTTP success means the notification was accepted. It does not establish
that Bing crawled, indexed, or ranked the URL.

## 2. Google and Bing read-only audit

`.github/workflows/search-indexing-audit.yml` is manual only. It reads:

- Google Search Console page metrics for the previous 28 complete days;
- Google URL Inspection status for canonical sitemap URLs;
- Bing crawl, query, page, sitemap/feed, and URL-submission-quota diagnostics.

It writes JSON plus a short Markdown report outside the checkout. The Google
manual-request queue excludes already indexed URLs and technical blockers, then
orders the remaining URLs using observed impressions/clicks and the importance
of core product pages. It does **not** call Google's restricted Indexing API and
cannot press the Search Console `Request indexing` control.

### Google setup

1. Create a Google Cloud service account and enable the **Google Search Console
   API** for its project.
2. In Search Console, add the service account's `client_email` as a user of the
   `specsmithpc.com` property. Full user access is sufficient; ownership is not
   required by this workflow.
3. Add the complete downloaded service-account JSON as the GitHub Actions
   secret `GOOGLE_SEARCH_CONSOLE_SERVICE_ACCOUNT_JSON`.
4. Optionally add repository variable `GOOGLE_SEARCH_CONSOLE_SITE_URL`. The
   default is `sc-domain:specsmithpc.com`.

The OAuth token requests only the `webmasters.readonly` scope.

### Bing setup

1. In Bing Webmaster Tools, open **Settings → API Access → API Key**.
2. Generate the key and save it as GitHub Actions secret
   `BING_WEBMASTER_API_KEY`.

Do not put either credential in a commit, issue, screenshot, workflow input, or
chat message.

### Running the audit

Dispatch **Search indexing audit**, type `audit`, and select a queue size. The
default is 20. The artifact contains:

- `search-indexing-audit.json` — complete machine-readable evidence;
- `search-indexing-audit.md` — the manual Google request queue and technical
  blockers.

Use the queue to request indexing for a small number of important URLs through
Search Console. Fix anything in the technical-blocker table first. Repeatedly
requesting hundreds of unchanged pages is not an indexing strategy.
