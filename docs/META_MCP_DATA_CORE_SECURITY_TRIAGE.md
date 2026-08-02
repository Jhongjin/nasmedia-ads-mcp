# AdMate-Data-Core security triage for Meta Ads MCP

**Status:** read-only assessment and migration prerequisite. No database
objects, grants, policies, functions, application data, Meta accounts, or
credentials were changed.

**Assessment date:** 2026-08-02

## Scope and decision

This note separates existing AdMate-Data-Core advisor findings from the future
Meta Ads MCP control plane. It is deliberately aggregate-only: it identifies
the owning surface and remediation class, not account data or application-row
contents.

The result supports keeping the future MCP policy ledger in
AdMate-Data-Core, but only in a new non-Data-API `control_plane` schema. It
does not authorize creating that schema yet.

## Read-only advisory snapshot

The security advisor reported high-priority RLS findings concentrated in
existing `public` and OpenClaw-related objects. Compass and Sentinel-related
schemas had no high-priority RLS finding in this aggregate review, but have
function-hardening warnings.

| Surface | Finding class | Required owner action | MCP effect |
| --- | --- | --- | --- |
| `public` | RLS disabled or policy/RLS mismatch | Inventory each affected object, define its intended API role, enable RLS and pair it with least-privilege grants and tested policies | Blocks production policy-ledger write until owner and remediation plan are recorded |
| OpenClaw-related | Security-definer view / function surface | Verify whether the view needs invoker semantics or no browser access; restrict grants and test the owning workflow | Separate from MCP migration; must not be carried into the control schema |
| Compass / Sentinel-related | Mutable function search path and callable privileged-function warnings | Each owning product reviews function definitions, fixed `search_path`, invoker/definer requirement, and explicit execute grants | Does not grant MCP access; fix in owner changes, not MCP migration |
| Storage | Public listing warning | Confirm whether listing is intentional for each public bucket; otherwise make bucket/object policy non-public | No MCP dependency |
| Auth | Leaked-password protection disabled | Identity owner decides and tests enforcement/rollout | No MCP dependency |
| Extensions | Installed in `public` warning | Verify extension relocation is supported before any change; do not move extensions blindly | No MCP dependency |

## Required migration guardrails

When the MCP ledger migration is approved, it must satisfy all of these
conditions:

1. Create `control_plane` as a private schema; do not add it to Data API
   exposed schemas and do not create a `public` compatibility view.
2. Revoke schema and object access from `PUBLIC`, `anon`, and
   `authenticated`; application access is server-only and separately
   allowlisted.
3. Enable RLS on ledger tables as defence in depth. The migration supplies no
   permissive browser policy and no blanket authenticated-user policy.
4. Do not create a `SECURITY DEFINER` helper. If an internal database function
   is later unavoidable, it requires a separate review with a fixed
   `search_path`, minimal grants, and negative access tests.
5. Store only pseudonymous account-routing and policy/audit metadata. Tokens,
   raw Meta responses, raw mail, source documents, and customer-facing
   campaign data remain outside this schema.
6. Run the security advisor after the non-production migration and test: anon
   denied, authenticated denied, ordinary SSO user denied, allowlisted server
   path allowed, and audit event append succeeds.

## Ownership and sequencing

1. Assign a remediation owner and an expected behavior to each existing
   high-priority finding; do not apply a global RLS switch.
2. Implement and validate existing surface fixes in their owning product
   changes. In particular, do not mix Compass, Sentinel, or OpenClaw behavior
   changes into the MCP ledger migration.
3. Prepare the private control-plane migration against a non-production
   environment, with no real account inventory or provider call.
4. Re-run security advisors and record a sanitized result.
5. After explicit production-migration approval, create the schema and leave
   all MCP account capabilities fail-closed until a durable policy and audit
   path passes negative-access tests.

## Why this remains the preferred database layout

Data-Core already acts as the regional shared data foundation for Compass and
Sentinel-related workloads. A private control-plane schema keeps MCP audit and
policy records close to those services while avoiding a new Supabase project,
extra credential boundary, and duplicated operational data. DAT remains the
separate restricted workflow and mail-derived store.

### Capacity note

The read-only performance advisor shows a separate maintenance backlog in
existing Compass and `public` surfaces, primarily index and policy-evaluation
findings. That is important product-owner work, but it is not evidence that a
small transactional MCP registry and append-only policy audit log need their
own database project.

The control-plane migration should create its own lookup and audit indexes from
day one, keep audit payloads minimal, and retain no raw provider data. Revisit
the dedicated-project decision only if an observed regional-residency rule,
resource quota, recovery objective, or sustained ledger workload makes the
private schema insufficient.
