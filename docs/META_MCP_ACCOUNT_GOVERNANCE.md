# Meta Ads MCP account governance

Updated: 2026-08-02
Status: read-only foundation and fail-closed policy-ledger boundary implemented; durable policy and Meta topology changes are not started.

## Goal

Enable operators to use Meta Ads MCP across the company-approved advertising
accounts without repeatedly changing a connected account, while making the
following independently auditable:

- whether an account is available through a configured server-side connection;
- whether the company has enabled that account for MCP use;
- who changed that policy, when, and why;
- whether the configured system-user topology can safely support the intended
  account scope.

This is a policy-control problem in addition to a Meta credential problem. A
dashboard toggle alone must never assign a Meta asset, create a token, or grant
campaign permissions.

## Current, implemented boundary

The protected `/mcp-account-governance` page:

- requires the same company Entra SSO session as the dashboard and assistant;
- reads the existing server-side Meta account inventory only;
- displays a safe account projection with search and pagination;
- has no account-level write action;
- treats every account as `관리 기준 미설정` until a durable policy ledger is
  connected;
- does not expose account IDs, system-user identifiers, access tokens, app
  secrets, or asset-assignment details.

The companion `/mcp-account-governance/readiness` page is also Entra
SSO-protected but intentionally does **not** call Graph or enumerate the live
inventory. It reports only the server-side connection-pool shape, capacity
assumption, policy-ledger readiness, and policy-administrator readiness. This
allows a safe deployment/configuration preflight before the first scoped
read-only provider probe.

When the live account inventory is unavailable, misconfigured, or stops at the
safe per-system-user page cap, the page does not pretend that a partial list is
complete. It keeps the account table and policy state unavailable, but still
shows the local aggregate topology checker so an SSO operator can prepare the
system-user plan before any Meta credential or asset decision is made.

`src/lib/meta-mcp-account-policy-ledger.ts` is a server-only fail-closed port
for the future policy ledger. Until a transactional store and immutable audit
event adapter are selected, it returns no account policies and rejects policy
writes. It does not use an environment value, a local file, browser storage,
or a hidden in-memory toggle. This prevents an operator from mistaking a UI
choice for a saved and enforced MCP permission.

`src/lib/meta-mcp-account-policy-gate.ts` is the pure capability gate a future
account-scoped MCP tool must call *before* resolving an account or invoking
Meta. It denies every request while the ledger is unconfigured, denies a
disabled/unconfigured account, requires durable audit events, and permits only
the initial `analysis_read` scope. It always blocks `campaign_write`.

`src/lib/server/meta-mcp-account-capability-request.ts` is the next server-only
preflight shared by Compass, Sentinel, and Foresight. It requires a server-side
operator authorization result, an account-scope authorization result, and the
enabled policy ledger before a future provider adapter may resolve an account.
It produces only a consumer/read-intent decision and the
`sanitized_account_analysis_only` response contract. It never returns an
account ID, Meta credential, raw provider response, or campaign-write path.

The existing internal dashboard/AI workspace is a separate, pre-existing
server-side Graph read implementation. It must not be represented as an
account-policy-managed official remote MCP connection until a future tool path
uses the policy gate and the approved ledger. No current Graph or campaign
behavior was changed by this foundation work.

The page and its underlying helpers are intentionally not a replacement for
Meta Business Suite. They cannot modify a campaign, budget, creative, account
permission, token, or asset assignment.

## Capacity interpretation

Meta Business Suite currently rejects a system user that exceeds 300 **total
assigned assets**. Advertising accounts share this boundary with pages, pixels,
catalogs, and other assets. Therefore:

```text
2,000 example advertising accounts / 300 = 7
```

is only the account-only theoretical minimum. It is not a deployable topology
or an operational guarantee. The real target requires allocation headroom for
other asset types and must be calculated from an approved inventory snapshot.

The application keeps a separate Graph read guard of 300 accounts per configured
system-user connection. This prevents an ambiguous account list from being used
for an Insight read. It is a fail-closed safety bound, not evidence that the
Meta asset allocation is complete.

For a configured multi-user pool, each system user's pagination remains serial
and subject to that 300-account guard. Up to four system-user reads are
processed concurrently, preserving deterministic result ordering while avoiding
an unbounded fan-out or a long single-pool-at-a-time wait at company-wide
scale. This is a read-performance boundary only; it does not alter provider
permissions, assign assets, or activate MCP policy.

`assessMetaMcpVerifiedTopology` is the companion aggregate-only assessment
contract for the eventual operator inventory step. For each system-user slot it
accepts only counts of advertising accounts, pages, pixels, catalogs, other
assets, and the reported total. It rejects mismatched totals and incomplete or
duplicate slots, and calculates remaining headroom only after every configured
system-user slot has been reported. It neither reads Meta nor stores the
inventory, and it intentionally has no account IDs, asset names, or credentials
in its input or output.

The governance page exposes this calculation as a browser-only aggregate
inventory checker. It begins with an eight-slot, 2,000-account example but lets
the operator replace that value with the approved all-company target within the
current conservative 64-slot planning boundary. An operator can enter counts
already confirmed in Meta Business Suite and compare the calculated total with
Meta's displayed aggregate. The form deliberately does not accept account
names, account IDs, asset IDs, tokens, or any free-form provider content; it
makes no request and does not persist, transmit, or enable anything. It is an
aid for the Stage 2 discussion, not an inventory import or authorization
control.

## All-company capacity planning

The governance page initially displays a conservative, read-only 2,000-account
example. It is **not** a maximum company scope and must be replaced with the
aggregate count of every approved Nasmedia-linked advertising account before an
operational allocation is approved:

- the account-only theoretical minimum is seven system-user buckets at 300;
- the recommended planning budget is 250 advertising accounts per bucket,
  reserving 50 total-asset slots for pages, pixels, catalogs, and growth;
- that yields eight system-user buckets and 2,000 planned advertising-account
  slots.

This is not a claim of available capacity. It does not assign an asset, create
a system user, set a connection, alter an MCP policy, or enable campaign
capabilities. The per-system-user aggregate asset inventory must be verified
before this scenario can become a deployment plan.

The server-only connection registry is bounded at 64 company-managed
system-user slots. At the conservative 250-account budget, the local planner
can model up to 16,000 advertising accounts while retaining 50 total-asset
slots per system user. The account-only theoretical maximum is 19,200, but it
assumes no pages, pixels, catalogs, or other assets and is therefore not an
operational plan. The application does not configure slots automatically; the
limit only prevents the software configuration from silently imposing a smaller
scope once the company has made its actual allocation decision.

## Required policy ledger before enabling account-level controls

The policy ledger must be server-side and transactional. It can be placed in
the eventual AdMate control-plane data store after the wider database
architecture decision; no new database is selected by this document.

The current proposal is to use the existing AdMate-Data-Core project as the
control plane, subject to a read-only schema and access-control preflight. The
proposal and its explicit non-goals are recorded in
[META_MCP_CONTROL_PLANE_STORAGE_DECISION.md](./META_MCP_CONTROL_PLANE_STORAGE_DECISION.md).

Minimum logical fields:

| Field | Purpose |
| --- | --- |
| internal account key | joins the approved inventory without exposing it to the browser |
| MCP state | `enabled` or `disabled` |
| effective scope | read-only question/analysis capability initially; future write capabilities remain separate |
| decision reason | structured operational reason, not an unbounded raw note |
| policy version | supports optimistic concurrency and rollback |
| changed by / changed at | server-derived SSO audit attribution |
| review due | forces periodic permission and relevance review |

Every policy change needs a server-side authorization check, immutable audit
event, and an explicit distinction between “MCP policy enabled” and “Meta asset
permission granted.” A policy change may only alter the local allowlist; it
must not call the Meta API to change access.

The policy-management administrator role is independent from ordinary company
SSO access. `meta-mcp-policy-administration.ts` is a server-only, default-deny
boundary for a future explicit Entra subject allowlist. Until that allowlist is
configured and the durable ledger exists, a user may inspect the safe
readiness view but cannot change a policy.

## Staged path

1. **Read-only foundation — complete**
   - SSO-protected inventory view, topology math that clearly states its
     account-only assumption, and no transient toggles.
2. **Topology decision — requires operator discussion**
   - collect only aggregate counts for each system user: advertising accounts,
     pages, pixels, catalogs, other assets, and remaining headroom;
   - decide the number of company-managed system-user buckets needed for the
     actual target scope;
   - decide whether a personal-admin OAuth inventory is used only as a
     short-lived diagnostic, never as the persistent service credential.
3. **Policy ledger — fail-closed contract implemented; requires data-store decision**
   - create the server-side ledger and audit event schema in the selected
     AdMate control-plane database;
   - introduce authorized, reviewed enable/disable actions that change the
     ledger only;
   - keep all Meta campaign mutation capabilities disabled.
4. **Read-only MCP capability gate**
   - resolve the requested account through the enabled policy ledger and the
     implemented read-only capability gate;
   - supply only the minimum sanitized performance/structure data required to
     Compass, Sentinel, or Foresight;
   - log capability use without passing credentials or raw provider payloads to
     an LLM.
5. **Any campaign write capability — separate future approval**
   - requires capability-by-capability design, verification, change preview,
   approval, and rollback. It is intentionally outside this plan.

The provider-neutral remote-adapter capability contract is maintained in
[META_MCP_REMOTE_ADAPTER_CONTRACT.md](./META_MCP_REMOTE_ADAPTER_CONTRACT.md).

## Decision checkpoint for the Commander and company operator

Before stage 2 starts, confirm all of the following in a joint discussion:

1. target account scope (all company-approved accounts versus a controlled
   cohort);
2. current count of system users and aggregate total asset allocation per user;
3. ownership/rotation process for server-side system-user credentials;
4. initial MCP permissions: reporting and campaign-question analysis only;
5. the AdMate database selected for the policy ledger and audit events;
6. whether the official remote Meta Ads MCP can authenticate with the chosen
   company-controlled flow without reducing coverage or auditability.

No account is enabled, disabled, assigned, or re-authorized until this
checkpoint is explicitly approved. This is the point at which the user asked
to be brought back into the discussion.

## Validation boundary

The current implementation validates deterministic account-policy projection
and topology arithmetic locally. It does not call Meta, query a database,
persist a policy, index data, or deploy a production configuration.
