# Dashboard implementation

## Components and flow

| Layer | Responsibility |
| --- | --- |
| `src/lib/meta-marketing.ts` | Server-only Graph API client, pagination, timeout, sanitized error categories |
| `src/lib/meta-account-status.ts` | Type-safe account-status mapping and `UNKNOWN(code)` fallback |
| `src/app/api/dashboard/accounts/route.ts` | No-store display DTO for the account dashboard |
| `src/components/dashboard/dashboard-client.tsx` | Fetch lifecycle, simultaneous filters, client pagination, and KPI calculations |
| `src/components/dashboard/*` | Filter controls, accessible table, status badges, skeleton and cards |
| `src/lib/agent-service.ts` | Shared OpenRouter + AI SDK tool-calling service |
| `src/app/assistant/actions.ts` | Validated server-only handoff from the AI UI to the agent service |

The client loads data on entry and when the operator chooses **새로고침**. Search, status, and business filters apply together to the loaded response; 25 rows are rendered per page to keep a 300-account response manageable without a new API request for every keystroke.

## States

- Loading: table skeleton and disabled refresh button.
- Empty: a dedicated filter-result message.
- Permission: a clear permission/token state from Meta errors.
- Network: a retryable connection state.
- Configuration/upstream: a non-sensitive Meta integration state.
- Pagination cap: a visible warning when the cursor safety cap is reached.

Status codes are presented as labels. A code not in the typed map is retained as `UNKNOWN(code)`, preserving information rather than incorrectly calling it inactive.

## Cache decision

The dashboard is an internal operations surface where freshness is more important than a stale fast response. The Meta client and API route use `no-store`, and the route is configured `force-dynamic`. This follows the current Next.js 16 route-handler model: GET handlers are not cached by default, while the explicit response header and fetch option make the intention robust and visible.

## Verification

```bash
npm run lint
npm run build
```

For a configured local run:

```bash
npm run dev
```

Then open `/`, test a name/ID search plus a status and business filter together, change page, and use **새로고침**. Open `/assistant` and submit an account-and-date-specific query. Validate that a missing date receives a clarifying answer rather than an invented date range.

Do not paste credentials into a shell command, browser field, screenshot, issue, or test fixture.
