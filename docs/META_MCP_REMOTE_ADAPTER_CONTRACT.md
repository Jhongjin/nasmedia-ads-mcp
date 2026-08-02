# Meta Ads MCP remote-adapter contract

**Status:** design contract only. No remote endpoint, provider tool, token,
account inventory, or campaign mutation is implemented by this document.

**Updated:** 2026-08-02

## Purpose

When Nasmedia receives the official Meta partner MCP connection details, add a
single server-side remote adapter that can serve Compass, Sentinel, and
Foresight without requiring planners to repeatedly switch a connected ad
account. The adapter must preserve AdMate's account-level policy, audit, and
data-minimization boundaries even if the partner connection does not require a
new AdMate-side Meta login screen.

The remote adapter is an operational data connector. It does not replace
Compass's reviewed evidence corpus or change the source hierarchy for policy
answers.

## Non-negotiable boundaries

- Do not infer an endpoint from a third-party MCP server or public blog.
- Do not put the connection address, connection credential, account routing
  key, or provider output in a browser bundle, prompt, client-side log, or
  saved chat transcript.
- Resolve exactly one internally approved account scope per request. A planner
  may choose an account in an authorised workflow, but no tool implicitly uses
  a personal administrator's full account visibility.
- Call `preflightMetaMcpAccountCapability` before the remote adapter resolves
  account routing or opens an MCP transport.
- Keep every capability read-only until a separate campaign-write design,
  preview, approver, rollback plan, and production approval exists.
- Record a minimal durable capability-audit event for allowed and denied
  execution. The audit contains no raw provider payload or raw user prompt.

## Read-only capability catalogue

The adapter maps the official server's discovered tool names to these internal
intent categories. The names below are AdMate capability categories, not a
claim about the official MCP's eventual tool names.

| Internal capability | Allowed consumers | Sanitised result shape | Initial use |
| --- | --- | --- | --- |
| `account_structure_read` | Compass, Sentinel, Foresight | campaign/ad-set/ad state counts and normalised status | setup questions and monitoring context |
| `delivery_performance_read` | Compass, Sentinel, Foresight | approved date range, requested metrics, aggregate rows, caveats | reporting and anomaly explanation |
| `delivery_diagnostic_read` | Sentinel, Compass | normalised delivery issue category and scope | alert triage and planner guidance |
| `creative_read` | Compass, Sentinel, Foresight | creative metadata and policy-safe diagnostic summary | creative review and planning context |
| `audience_read` | Compass, Foresight | audience category, availability, and aggregate size band only | targeting planning |
| `account_access_read` | Sentinel | boolean/normalised scope outcome only | connector-health diagnostics |

No catalogue item permits campaign creation, ad-set changes, budget changes,
creative upload, asset assignment, permission changes, or token management.

## Product integration

### Compass

Compass continues to answer policy and operational questions with official
media guidance first, then reviewed internal evidence. When a user explicitly
asks for an authorised account's current state, the remote adapter may supply a
separate labelled **current account data** section. It must not overwrite or
masquerade as an official policy source. The response should identify the date
range, aggregation level, and any missing data, then turn the result into a
short planner-oriented recommendation.

### Sentinel

Sentinel may request scheduled or alert-triggered `delivery_performance_read`
and `delivery_diagnostic_read` only for accounts enabled by the ledger. The
result becomes a normalised signal for the existing alert workflow; the raw MCP
response is not forwarded to Slack, Mattermost, email, or an LLM.

### Foresight

Foresight may consume approved aggregate performance and delivery data only
after its forecast input contract declares metric, date range, account scope,
freshness, and retention. It must not ingest account identifiers or raw
creative payloads into a general benchmark corpus.

## First entitlement probe

After the durable policy ledger is deployed and one account is explicitly
enabled for `analysis_read`, run exactly one official remote-MCP tool discovery
and one account-scoped read-only query. The result recorded for review is only:

1. transport/entitlement outcome category;
2. which internal capability category was available;
3. whether the requested account scope was honoured;
4. the response freshness bucket and normalised error category, if any; and
5. confirmation that the capability audit event was written.

Do not print or store tool arguments, account IDs, access tokens, endpoint
headers, raw provider payload, campaign data, or chain-of-thought-like model
content in the probe report.

## Expansion gate

Expand from the one-account probe to all company-approved accounts only when:

1. the verified system-user aggregate topology covers the chosen company
   scope;
2. the policy ledger and append-only audit event store pass their negative
   access tests;
3. the official tool discovery is recorded against the partner-provided
   endpoint and reviewed for read/write semantics;
4. account-level routing and scope tests prove that no request crosses into an
   unapproved account; and
5. Compass, Sentinel, and Foresight each pass their consumer-specific
   sanitisation and failure-mode checks.
