# Meta Ads MCP control-plane storage decision

**Status:** the read-only recent-spend selection ledger is applied in
AdMate-Data-Core. It is not an MCP policy ledger and does not enable any
account, change a Meta asset assignment, or permit campaign mutation.

**Decision date:** 2026-08-02

## Recommendation

Use the existing **AdMate-Data-Core** project as the future control-plane store
for Meta Ads MCP account policy, routing metadata, and audit events. Do not
create a new Supabase project for this first phase.

This is deliberately a control plane, not an all-data consolidation:

- it records which approved account may use which read-only MCP capability;
- it records the server-internal connection bucket and policy-review lifecycle;
- it keeps append-only audit evidence for policy and capability decisions;
- it does **not** store system-user tokens, raw Meta responses, raw campaign
  data, raw mail, or Compass source documents.

The existing DAT store remains the restricted home for DAT work, calendar, and
mail-derived records. Its data is not copied into the MCP ledger. Compass
source packets also retain their source-specific review and retention boundary.

## Why AdMate-Data-Core

The known Supabase project map shows AdMate-Data-Core in the paid main
organization and the same `ap-south-1` region as the Meta-oriented service
project. The other known stores are product-oriented or in `ap-northeast-2`;
the DAT project is a separate `ap-southeast-1` restricted workflow store.

For the planned ledger, writes are low-volume and transactional. A new project
would add a cross-project integration, credential boundary, and operating cost
without improving the first-phase security model. AdMate-Data-Core is the most
appropriate existing common control plane **provided that** its schema and
access controls pass the preflight below.

This is an architecture recommendation, not a blanket approval of every
existing Data-Core table, quota setting, extension, or RLS policy.

## Read-only preflight result (2026-08-02)

The AdMate-Data-Core project is available through the approved Supabase
connector. The project already separates product concerns into dedicated
application schemas, including Compass and Sentinel-related schemas; `public`
also contains existing application tables. There is no existing
`control_plane` schema, so a future MCP ledger can be isolated rather than
merged into a product schema.

This confirms the architectural fit for an additional server-only control
plane store in AdMate-Data-Core. The first applied component is a narrowly
scoped selection ledger in the canonical `openclaw` operational schema rather
than a new exposed schema:

- the read-only security advisor reports existing high-priority RLS findings
  and additional warnings in the current project;
- those findings are not caused by the proposed MCP ledger, but they must be
  triaged before production policy data is written there;
- the future schema must remain outside the Data API exposure list, have no
  browser grants, and be verified independently after migration.

No application rows, email-derived records, account identifiers, credentials,
or provider payloads were read during this preflight. The only database query
was aggregate schema inventory.

### Advisor triage boundary

The high-priority advisor findings are concentrated in pre-existing `public`
and OpenClaw-related surfaces. Compass and Sentinel-related schemas have no
high-priority RLS finding in this aggregate review, but do have function and
execution-surface warnings that need their own owner-led remediation.

Accordingly, this proposal does not treat an unrelated existing schema as
permission to bypass safety for the MCP ledger. Before the ledger receives any
production policy write:

1. assign and record owners for the existing high-priority findings;
2. create the ledger only in a new non-Data-API `control_plane` schema with
   zero browser grants;
3. run the advisor again and test the new schema's negative access cases; and
4. keep all existing application-schema remediations in their owning product
   changes rather than bundling them into the MCP migration.

The aggregate finding classes, ownership separation, and required migration
guardrails are recorded in
[Data-Core security triage](META_MCP_DATA_CORE_SECURITY_TRIAGE.md).

## Applied recent-spend selection boundary (2026-08-13)

The user approved the account-selection phase. The following three Data-Core
tables are now present under `openclaw`:

| Table | Purpose | Explicit exclusions |
| --- | --- | --- |
| `meta_active_account_scan_runs` | six-month spend filter window and aggregate outcomes | OAuth token, account name, raw provider response, spend amount |
| `meta_active_account_scan_items` | encrypted account reference, keyed hash, `active`/`inactive`/`unknown` result | raw account ID, token, name, raw Insights payload |
| `meta_active_account_scan_events` | append-only aggregate scan and provisioning audit event | identifiers, credentials, provider payload |

Every new table has RLS enabled and no `anon` or `authenticated` Data API
grant. The event table grants `service_role` only `SELECT` and `INSERT`; a
database trigger rejects update or delete. Item records expire after 30 days.
An account is a connection candidate only when Meta reported positive spend in
the six-month window; ambiguous and failed reads are `unknown` and excluded.
Provisioning audit events record only the result class, safe failure stage, and
aggregate candidate/pool counts; they never record a selected account, OAuth
token, system-user identifier, or Graph API response.

This changes only the selection-evidence phase. The subsequent account policy
ledger and provider capability gate remain fail-closed until their own review
and approval.

## Proposed MCP policy data boundary

Create a non-Data-API control schema (for example `control_plane`) with access
only from server-side code. The browser must never receive a service-role key,
system-user token, account identifier, or connection identifier.

| Logical table | Minimum purpose | Explicitly excluded |
| --- | --- | --- |
| `meta_mcp_account_registry` | internal account reference, encrypted or one-way external reference, route bucket key, lifecycle state | raw provider payloads, access tokens |
| `meta_mcp_account_policy` | read-only capability state, version, structured decision reason, review date | free-form sensitive notes, campaign-write enablement |
| `meta_mcp_policy_audit_event` | append-only actor pseudonym, policy version, action/result, timestamp, request correlation | credentials, raw prompt/mail/provider content |
| `meta_mcp_capability_audit_event` | allowed/denied capability decision and minimal execution metadata | Meta response body or campaign telemetry |

The account registry is separate from policy so a permission change can be
audited without rewriting identity/routing data. Policy transitions use
optimistic version checks. Audit inserts are append-only; neither a browser nor
an ordinary SSO user receives direct write access.

## Security model

1. Put the control schema outside the Data API exposure list. Do not create a
   public view as a shortcut for the operator screen.
2. Retain RLS as defence in depth on every exposed table. If a server-side
   function is ever necessary, keep it out of `public`, use invoker semantics
   by default, and grant only the smallest required role.
3. Resolve the designated company credential custodian and policy administrators
   from server-side allowlists; ordinary company SSO proves identity but does
   not permit policy mutation.
4. Encrypt or HMAC-link provider account references with server-held material;
   never render the registry key in an LLM prompt or a browser response.
5. Separate `analysis_read` from every mutation capability. Campaign creation,
   editing, budget changes, and asset assignment stay denied until their own
   review, preview, approval, and rollback path exists.

## Preflight before any migration

The following are required before adopting this recommendation:

1. Read-only schema and data-classification review of AdMate-Data-Core.
2. Confirm the selected schema is not exposed through the Data API and there is
   no inherited browser grant.
3. Confirm server-only credential storage and connection path from
   `nasmedia-ads-mcp` without copying secrets into `NEXT_PUBLIC_` variables.
4. Define retention, immutable-audit retention, backup/restore, and incident
   deletion rules with the data owner.
5. Produce a reversible migration, run database advisors, and execute a
   non-production schema test before production migration approval.

If the preflight finds a regional residency requirement, a hard tenant
separation rule, insufficient operational quota, or an existing Data-Core
access model that cannot be safely isolated, then create one dedicated
control-plane project. That is the only currently identified reason to add a
new database; it should not be created preemptively.

## Relation to the official remote Meta Ads MCP

The partner-provided remote MCP may remove the need for a new AdMate-side Meta
login flow. It does not replace the company control plane: AdMate still needs
to decide which internally approved account can be queried, by whom, for which
capability, and with what audit record.

As of 2026-08-02, an open-web check did not locate Meta primary documentation
that establishes a public remote endpoint, transport schema, or tool contract
for the reported partner MCP route. Search results include third-party MCP
wrappers, which are not an approved substitute. Do not hard-code or connect to
an endpoint inferred from those results. The future adapter must use the
company's partner-provided official connection details and preserve the same
account-policy gate described here.

Before an adapter is enabled, run one read-only entitlement probe against an
approved account and verify only aggregate outcomes: account-scope coverage,
read capability availability, normalized failure category, and audit event
creation. No campaign mutation, asset assignment, token printout, or raw
provider payload is allowed in that probe.

## Implementation sequence after approval

1. Approve AdMate-Data-Core after preflight, or choose a dedicated alternative.
2. Add and validate the private control-plane schema in a non-production path.
3. Replace the current fail-closed in-memory policy-ledger boundary with the
   server-only transactional implementation.
4. Enable only account-scoped `analysis_read` after a policy and audit record
   exist.
5. Add the remote-MCP adapter behind the same gate, then validate it with a
   single approved read-only account before expanding to the full approved
   inventory.
