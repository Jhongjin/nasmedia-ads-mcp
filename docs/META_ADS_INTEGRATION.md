# Meta Ads integration

## Architecture

The application deliberately uses the Meta Marketing API as a server-only data source. A system-user access token and app secret never enter a browser bundle or JSON response.

```text
Dashboard / Assistant UI
        |                         (Server Action for AI)
GET /api/dashboard/accounts ----------------------------+
        |                                                 |
        +--> src/lib/meta-marketing.ts --> bounded system-user pool
                                                   |
                                      appsecret_proof + one Bearer token per bucket
                                                   |
                                        src/lib/agent-service.ts
                                                   |
                                             OpenRouter / AI SDK
```

The official remote Ads MCP endpoint is not part of this runtime path. A prior
direct service-credential attempt did not establish a usable connection, but
that result does not determine the partner-provided remote MCP entitlement
flow. The operator reports that the partner route requires no separate new
company authentication. Before use, AdMate still needs one approved,
read-only, account-scoped entitlement probe behind the future policy-and-audit
gate; repeated credential retries are not a fallback strategy.

## Required server environment

Set these only on the server or deployment platform. Do not use a `NEXT_PUBLIC_` prefix.

| Name | Purpose |
| --- | --- |
| `META_SYSTEM_USER_CONNECTIONS_JSON` | Preferred JSON registry of bounded system-user connection IDs and their server-only access tokens |
| `META_SYSTEM_USER_ACCESS_TOKEN` | Temporary legacy single-system-user fallback; remove after the JSON registry cutover |
| `META_APP_SECRET` | Server-only Meta app secret; computes `appsecret_proof` and exchanges the one-time personal-access inventory code |
| `OPENROUTER_API_KEY` | Company-approved LLM provider credential |
| `OPENROUTER_MODEL` | OpenRouter model identifier |
| `NASMEDIA_ENTRA_TENANT_ID` | Microsoft Entra tenant ID that owns the operator app registration |
| `NASMEDIA_ENTRA_CLIENT_ID` | Entra app registration client ID |
| `NASMEDIA_ENTRA_CLIENT_SECRET` | Entra app registration client secret, stored only in the host secret store |
| `NASMEDIA_APP_ORIGIN` | Exact app origin used to construct the registered Entra callback URL |
| `NASMEDIA_ALLOWED_ENTRA_SUBJECTS` | Preferred comma-separated exact Entra object IDs allowed to obtain an operator session; takes precedence over the legacy email-domain setting |
| `NASMEDIA_ALLOWED_EMAIL_DOMAIN` | Legacy exact company email domain allowed to obtain an operator session; use only when `NASMEDIA_ALLOWED_ENTRA_SUBJECTS` is unset |
| `NASMEDIA_SESSION_SECRET` | High-entropy secret used to sign the short-lived HttpOnly operator session |
| `META_APP_ID` | Meta app ID used only for the operator-initiated personal-access inventory check |
| `META_LOGIN_CONFIG_ID` | Approved Meta Login configuration ID for the inventory check |
| `META_OAUTH_REDIRECT_URI` | Preferred exact Meta Login callback URL for the personal-access inventory check; `META_REDIRECT_URI` is a temporary fallback |
| `META_OAUTH_STATE_SECRET` | High-entropy secret that binds the short-lived Meta OAuth state to the current company SSO subject |
| `META_CONTROL_PLANE_SUPABASE_URL` | AdMate-Data-Core server-only URL for the recent-spend selection ledger |
| `META_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY` | Server-only Data-Core secret key for the selection ledger; never exposed to the browser |
| `META_ACCOUNT_IDENTIFIER_ENCRYPTION_KEY` | 32-byte base64url key that encrypts and HMAC-links account references in the selection ledger |

The dashboard uses a real Microsoft Entra OIDC authorization-code flow with PKCE. It never accepts a shared password or manufactures a local sign-in. For an individual Microsoft account or a non-company tenant, configure `NASMEDIA_ALLOWED_ENTRA_SUBJECTS` with the exact Entra object ID of each approved operator and leave `NASMEDIA_ALLOWED_EMAIL_DOMAIN` unset. When the subject allowlist is present, an email-domain match cannot authorize a session. Until every Entra/session variable above is configured, the protected dashboard, account API, assistant Server Action, and legacy Meta OAuth initializer remain fail-closed.

Use the preferred connection registry only in the deployment platform's encrypted server-side environment store. The example is deliberately non-functional; never place real tokens in source control, browser configuration, or chat.

```json
[
  { "id": "meta-system-user-01", "accessToken": "<server-secret>" },
  { "id": "meta-system-user-02", "accessToken": "<server-secret>" }
]
```

The registry accepts one to 64 unique connection IDs. It rejects malformed input, duplicate IDs, and an empty pool before a Graph request is attempted. The legacy variable is read only when the preferred JSON registry is absent, so cutover can be staged without a service gap.

Register exactly this redirect URI in the Entra app registration, using the same HTTPS origin configured in `NASMEDIA_APP_ORIGIN`:

```text
https://<approved-origin>/api/auth/entra/callback
```

The sign-in callback validates the OIDC issuer, audience, nonce, tenant ID, and either an exact allowed subject or the legacy allowed email domain before issuing an eight-hour, HttpOnly, Secure-in-production, SameSite=Lax session cookie. The session holds only a subject identifier, tenant identifier, and operator role; no email address, Meta credential, or provider token is placed in the browser session.

Register the personal-access inventory callback as an exact URI in the Meta Login configuration. In production it must use the approved HTTPS origin:

```text
https://<approved-origin>/api/auth/meta/inventory/callback
```

The `/meta-access-check` screen is an operator-initiated, read-only diagnostic for a human Meta administrator account. It exchanges the returned code and keeps the personal OAuth token only in server memory for the same request. When `ads_read` is granted, it checks whether each accessible account recorded spend greater than zero for the rolling six-month UTC date window. It stores neither the OAuth token, account name, raw account ID, raw Insights response, nor spend amount. The Data-Core selection ledger retains only encrypted account references, keyed hashes, an `active`/`inactive`/`unknown` outcome, aggregate counts, and append-only audit events for 30 days. A failed or ambiguous Insights read becomes `unknown` and is excluded from automatic connection candidates. Its signed result cookie is bound to the current operator subject, lasts 15 minutes, and contains only aggregate count, permission booleans, expiry bucket, and a normalized result. The check has no campaign, budget, creative, asset, or permission mutation path.

## Meta data handling

- Graph API version lives in the single `META_GRAPH_VERSION` constant and is currently `v25.0`.
- Every request sends the selected system-user Bearer token and HMAC-SHA256 `appsecret_proof`.
- The account list is queried independently for each configured system-user connection. Each discovered account is bound internally to its originating connection before an Insights request is made, so one system user's token is never used to read another bucket's account.
- A duplicate account visible through two connections, or more than 300 returned ad accounts from one connection, fails closed as a topology error. Connection IDs and token values are never sent to the UI, API, or assistant model.
- `/me/adaccounts` requests 100 accounts per page and follows cursors only far enough to prove the 300-account safety bound. The API response includes `truncated: true` when the safety page cap is reached.
- Recent-spend selection uses bounded Graph batch reads of `Insights.spend` for the same personal-admin OAuth request. The personal OAuth token does not enter the database or a browser response. Accounts with no usable response are classified `unknown`, never treated as active.
- The selection ledger is isolated in the existing AdMate-Data-Core `openclaw` schema with RLS enabled, no `anon` or `authenticated` grants, and a `service_role`-only append-only audit event table. This is selection evidence only; it does not grant a Meta asset or enable an MCP account policy.
- Dashboard reads use `cache: "no-store"`; a manual refresh must represent a fresh Meta query rather than an ambiguous persistent cache result.
- `business{id,name}`, account status, currency, and `amount_spent` are requested in the list request. This avoids an N+1 account detail request.
- `amount_spent` is the AdAccount cumulative-spend field, not an Insights period metric. Meta returns this account field as an integer in the account-currency minor unit. The UI determines the currency fraction digits through `Intl.NumberFormat` before formatting, and displays `-` for a missing or unsafe value. It never substitutes zero.

## MCP account governance

`/mcp-account-governance` is an Entra SSO-protected, read-only operator view.
It lists only the account fields already approved for the dashboard and provides
search and pagination locally in the browser. It does not reveal system-user
connection identifiers, account identifiers, tokens, or Meta Business Suite
asset assignments.

The screen intentionally shows `관리 기준 미설정` until a durable, server-side
policy ledger and audit trail are selected. It must not use browser storage,
Vercel memory, or a temporary file to make an account look enabled or disabled.
Those options would disappear on refresh or deployment and could be mistaken for
an actual operational control.

The displayed 300 value is a **total asset assignment** limit per system user,
not a guaranteed ad-account capacity. The topology card calls the multiplication
an “account-only nominal ceiling” and never presents it as an available capacity.
The actual decision needs the current per-system-user allocation of accounts,
pages, pixels, catalogs, and other assets. See
[META_MCP_ACCOUNT_GOVERNANCE.md](./META_MCP_ACCOUNT_GOVERNANCE.md) for the
staged control-plane plan and the explicit approval gate before any Meta
connection or asset-assignment change.

`/mcp-account-governance/readiness` is a separate Entra SSO-protected
server-rendered readiness page for the preflight stage. It reads only the
server-side configuration shape (pool mode and count) and the local policy
readiness state. It does not call Graph, enumerate accounts or assets, display
connection IDs or tokens, store a decision, or modify a Meta Business Suite
assignment. This allows the operational team to confirm that the deployment is
prepared before authorizing the first account-scoped, read-only probe.

The field availability is based on Meta's official Business SDK AdAccount examples, including the `amount_spent` field: [facebook-business-sdk Python read example](https://github.com/facebook/facebook-python-business-sdk).

## Security and operational limits

- API responses contain only display-safe account fields and normalized error categories. They omit credentials, `appsecret_proof`, internal upstream messages, and stacks.
- Calls time out after 15 seconds. Network, permission, configuration, and upstream failures render separately in the dashboard.
- Topology failures render separately from Meta permission failures. An operator must correct the system-user asset assignment rather than retrying a potentially ambiguous read.
- Operator visual verification on 2026-07-29 confirmed that Meta Business Suite rejects an assignment above 300 total assets for one system user. This is an assignment boundary, not a Graph API pagination limit. Pages, pixels, catalogs, and other assets consume the same allocation; 4,000 ad accounts therefore require at least 14 system-user buckets and potentially more after non-account assets are counted.
- Current scopes are read-only. No campaign, creative, budget, or account mutation is implemented.
- The AI Server Action validates prompt length and only returns answer text. It calls the extracted server-only OpenRouter service, so Meta credentials and OpenRouter credentials are not sent to the client. No `AGENT_TEST_SECRET` registration is required.
- The former `/api/agent-test` test route was removed. Internal operators use `/assistant` directly, avoiding a separate secret-managed test endpoint.
- Application authentication is enforced inside the Dashboard page, `/api/dashboard/accounts`, the assistant Server Action, and the legacy Meta OAuth initializer. `src/proxy.ts` also rejects unauthenticated direct API requests before rendering. The source-level checks are intentional because Next.js Proxy is only an optimistic front boundary and cannot replace authorization inside Server Functions.
