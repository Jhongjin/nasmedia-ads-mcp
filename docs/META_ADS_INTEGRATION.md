# Meta Ads integration

## Architecture

The application deliberately uses the Meta Marketing API as a server-only data source. A system-user access token and app secret never enter a browser bundle or JSON response.

```text
Dashboard / Assistant UI
        |                         (Server Action for AI)
GET /api/dashboard/accounts ----------------------------+
        |                                                 |
        +--> src/lib/meta-marketing.ts --> Graph API v25.0
                                                   |
                                      appsecret_proof + Bearer token
                                                   |
                                        src/lib/agent-service.ts
                                                   |
                                             OpenRouter / AI SDK
```

The official remote Ads MCP endpoint is not part of this runtime path. Its system-user Bearer-token 401 is an existing limitation; retrying it is not a fallback strategy.

## Required server environment

Set these only on the server or deployment platform. Do not use a `NEXT_PUBLIC_` prefix.

| Name | Purpose |
| --- | --- |
| `META_SYSTEM_USER_ACCESS_TOKEN` | System user token with `ads_read` and required asset access |
| `META_APP_SECRET` | Used only to compute `appsecret_proof` |
| `OPENROUTER_API_KEY` | Company-approved LLM provider credential |
| `OPENROUTER_MODEL` | OpenRouter model identifier |
| `NASMEDIA_OPERATOR_NAME` | Optional display-only operator label until session integration exists |

The dashboard must be deployed behind the company identity-aware proxy or a real application session before it is exposed beyond the internal network. This repository does not manufacture a login session. Consequently the visible logout control remains disabled until that session integration is supplied.

## Meta data handling

- Graph API version lives in the single `META_GRAPH_VERSION` constant and is currently `v25.0`.
- Every request sends both the system-user Bearer token and HMAC-SHA256 `appsecret_proof`.
- `/me/adaccounts` requests 100 accounts per page and follows cursors to completion, capped at 20 pages (2,000 accounts) to prevent an infinite loop. The API response includes `truncated: true` when that cap is reached.
- Dashboard reads use `cache: "no-store"`; a manual refresh must represent a fresh Meta query rather than an ambiguous persistent cache result.
- `business{id,name}`, account status, currency, and `amount_spent` are requested in the list request. This avoids an N+1 account detail request.
- `amount_spent` is the AdAccount cumulative-spend field, not an Insights period metric. Meta returns this account field as an integer in the account-currency minor unit. The UI determines the currency fraction digits through `Intl.NumberFormat` before formatting, and displays `-` for a missing or unsafe value. It never substitutes zero.

The field availability is based on Meta's official Business SDK AdAccount examples, including the `amount_spent` field: [facebook-business-sdk Python read example](https://github.com/facebook/facebook-python-business-sdk).

## Security and operational limits

- API responses contain only display-safe account fields and normalized error categories. They omit credentials, `appsecret_proof`, internal upstream messages, and stacks.
- Calls time out after 15 seconds. Network, permission, configuration, and upstream failures render separately in the dashboard.
- Current scopes are read-only. No campaign, creative, budget, or account mutation is implemented.
- The AI Server Action validates prompt length and only returns answer text. It calls the extracted server-only OpenRouter service, so Meta credentials and OpenRouter credentials are not sent to the client. No `AGENT_TEST_SECRET` registration is required.
- The former `/api/agent-test` test route was removed. Internal operators use `/assistant` directly, avoiding a separate secret-managed test endpoint.
- Before public exposure, add application authentication/authorization inside the Server Action and protect `/api/dashboard/accounts` at the deployment edge. This is an explicit deployment requirement, not a simulated login state.
