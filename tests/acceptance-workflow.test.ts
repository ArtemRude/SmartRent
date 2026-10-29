import assert from "node:assert/strict";
import { test } from "node:test";
import { runRentalWorkflow } from "../scripts/acceptance/rental-workflow.mjs";

const PROJECT = "https://euuyvfidarhpeqeeheuu.supabase.co";
const uuid = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
type Operation = { status: string; value?: unknown };
type Workflow = {
  operations: Record<string, Operation>;
  refs: Record<string, string>;
  cleanup?: { status: string; listing_id?: string; code?: string };
};
type Listing = {
  id: string;
  public_id: string;
  property_id: string;
  status: string;
  revision: number;
  draft: Record<string, unknown>;
  published_snapshot?: Record<string, unknown>;
};

// A deliberately small SDK double: it supports drafting/publication and fails
// the applicant operation. Unexpected later writes always fail the test.
function fixture(
  options: {
    wrongPrincipal?: boolean;
    externalConnection?: boolean;
    failPublishResponse?: boolean;
    failPause?: boolean;
    foreignPublishedMarker?: boolean;
  } = {},
) {
  const runId = uuid(1);
  const users = Object.fromEntries(
    ["owner", "tenant", "manager"].map((role, index) => [
      role,
      {
        id: uuid(index + 3),
        email: `acceptance-${runId}-${role}@example.invalid`,
        app_role: role === "owner" ? "owner" : "tenant",
      },
    ]),
  );
  const state = {
    version: 1,
    run_id: runId,
    project_url: PROJECT,
    users,
    property: { id: uuid(2), owner_id: users.owner.id, name: `ТЕСТ ПРИЁМКИ ${runId}` },
    membership_id: uuid(6),
    workflow: undefined as Workflow | undefined,
  };
  const property = { ...state.property, status: "active" };
  let listing: Listing | null = null;
  const writes: { name: string; args: Record<string, unknown> }[] = [];
  const snapshots: (typeof state)[] = [];
  const reports: { stage: string; status: string; code?: string }[] = [];
  const clients = Object.fromEntries(
    ["owner", "tenant", "manager"].map((role) => [
      role,
      {
        supabaseUrl: PROJECT,
        auth: {
          getUser: async () => ({
            data: {
              user: {
                ...users[options.wrongPrincipal && role === "tenant" ? "owner" : role],
                email_confirmed_at: "2026-01-01T00:00:00Z",
              },
            },
          }),
        },
        from(table: string) {
          assert(["properties", "lease_agreements"].includes(table), `Unexpected table ${table}`);
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            single: async () => ({ data: { ...property }, error: null }),
            then(resolve: (value: unknown) => unknown) {
              return Promise.resolve({ data: [], error: null }).then(resolve);
            },
          };
        },
        async rpc(name: string, args: Record<string, unknown> = {}) {
          if (name === "telegram_overview")
            return {
              data: {
                connection: options.externalConnection ? { username: "external" } : null,
                pending: null,
                deliveries: [],
              },
            };
          if (name === "team_overview")
            return {
              data: {
                members: [
                  {
                    id: state.membership_id,
                    owner_id: users.owner.id,
                    user_id: users.manager.id,
                    role: "manager",
                    status: "active",
                    property_ids: [property.id],
                  },
                ],
                workspaces: [{ id: property.id }],
              },
            };
          if (name === "property_hub")
            return {
              data: {
                listings: listing ? [structuredClone(listing)] : [],
                applications: [],
              },
            };
          if (name === "save_property_listing") {
            assert.equal(role, "owner");
            assert.equal(args.p_property_id, property.id);
            writes.push({ name, args: structuredClone(args) });
            listing = {
              id: uuid(7),
              public_id: uuid(8),
              property_id: property.id,
              status: "draft",
              revision: (listing?.revision ?? 0) + 1,
              draft: args.p_values as Record<string, unknown>,
            };
            return { data: listing.id };
          }
          if (name === "act_on_property_listing") {
            assert.equal(role, "owner");
            assert(listing);
            assert.equal(args.p_id, listing.id);
            assert.equal(args.p_revision, listing.revision);
            writes.push({ name, args: structuredClone(args) });
            if (args.p_action === "publish") {
              listing.status = "published";
              listing.revision++;
              listing.published_snapshot = { ...listing.draft };
              if (options.foreignPublishedMarker) listing.published_snapshot.title = "Real listing";
              // Models a committed publish whose HTTP response is lost.
              if (options.failPublishResponse)
                return { error: { code: "NETWORK_LOST", message: "sensitive body" } };
              return { data: listing.id };
            }
            assert.equal(args.p_action, "pause");
            assert.equal(
              snapshots.at(-1)?.workflow?.cleanup?.status,
              "pending",
              "Pause intent must be persisted before I/O",
            );
            if (options.failPause) return { error: { code: "40001", message: "sensitive body" } };
            listing.status = "paused";
            listing.revision++;
            return { data: listing.id };
          }
          if (name === "public_listing") {
            assert(listing);
            return {
              data: {
                public_id: listing.public_id,
                published_at: "2026-01-01T00:00:00Z",
                details: listing.published_snapshot,
                can_apply: true,
              },
            };
          }
          if (name === "apply_to_listing") {
            writes.push({ name, args: structuredClone(args) });
            return { error: { code: "23514", message: "sensitive body" } };
          }
          assert.fail(`Unexpected RPC ${name}`);
        },
        storage: {
          from(bucket: string) {
            return {
              upload: async (path: string, bytes: Buffer, settings: { upsert: boolean }) => {
                assert.equal(role, "owner");
                assert.equal(bucket, "listing-photos");
                assert.equal(settings.upsert, false);
                assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
                writes.push({ name: "upload", args: { bucket, path } });
                return { data: { path } };
              },
            };
          },
        },
      },
    ]),
  );
  return {
    state,
    clients,
    writes,
    snapshots,
    reports,
    property,
    saveState: async () => {
      snapshots.push(structuredClone(state));
    },
    report: async (value: { stage: string; status: string; code?: string }) => {
      reports.push(value);
    },
    listing: () => listing,
  };
}

test("publication requires explicit boolean true and resume does not duplicate drafts/uploads", async () => {
  const context = fixture();
  const outcome = await runRentalWorkflow({ ...context, allowPublicListing: "true" });
  assert.equal(outcome.status, "awaiting_public_listing_approval");
  assert.deepEqual(
    context.writes.map((w) => w.name),
    ["save_property_listing", "upload", "save_property_listing"],
  );
  assert.equal(context.listing()?.status, "draft");
  await runRentalWorkflow(context);
  assert.equal(context.writes.length, 3);
});

test("an uncertain checkpoint prevents another business write", async () => {
  const context = fixture();
  await runRentalWorkflow(context);
  context.state.workflow!.operations.listing_photo_attach = { status: "pending" };
  await assert.rejects(runRentalWorkflow(context), { code: "RECONCILIATION_REQUIRED" });
  assert.equal(context.writes.length, 3);
  assert.equal(context.state.workflow!.cleanup?.status, "not_public");
});

test("foreign fixture, wrong principal and external Telegram connection fail before writes", async () => {
  const foreign = fixture();
  foreign.property.owner_id = uuid(99);
  await assert.rejects(runRentalWorkflow(foreign), { stage: "fixture_property_guard" });
  assert.equal(foreign.writes.length, 0);
  for (const options of [{ wrongPrincipal: true }, { externalConnection: true }]) {
    const context = fixture(options);
    await assert.rejects(runRentalWorkflow(context));
    assert.equal(context.writes.length, 0);
  }
});

test("failure after publication pauses only the fixture and preserves original error/checkpoint", async () => {
  const context = fixture();
  await assert.rejects(runRentalWorkflow({ ...context, allowPublicListing: true }), {
    stage: "candidate_apply",
    code: "23514",
  });
  assert.equal(context.listing()?.status, "paused");
  assert.equal(context.state.workflow!.operations.candidate_apply.status, "uncertain");
  assert.equal(context.state.workflow!.cleanup?.status, "paused");
  assert.equal(context.snapshots.at(-1)?.workflow?.cleanup?.status, "paused");
  assert.equal(context.writes.filter((w) => w.args.p_action === "pause").length, 1);
  assert.equal(context.writes.filter((w) => w.name === "apply_to_listing").length, 1);
  await assert.rejects(runRentalWorkflow({ ...context, allowPublicListing: true }), {
    code: "RECONCILIATION_REQUIRED",
  });
  assert.equal(context.writes.filter((w) => w.name === "apply_to_listing").length, 1);
  assert(!JSON.stringify(context.reports).includes("sensitive body"));
});

test("a lost publish response is reconciled by pausing, without retrying publication", async () => {
  const context = fixture({ failPublishResponse: true });
  await assert.rejects(runRentalWorkflow({ ...context, allowPublicListing: true }), {
    stage: "listing_publish",
    code: "NETWORK_LOST",
  });
  assert.equal(context.listing()?.status, "paused");
  assert.equal(context.state.workflow!.cleanup?.status, "paused");
  assert.equal(context.writes.filter((w) => w.args.p_action === "publish").length, 1);
});

test("cleanup failure is persisted as manual_required, preserving business error and refusing retries", async () => {
  const context = fixture({ failPause: true });
  await assert.rejects(runRentalWorkflow({ ...context, allowPublicListing: true }), {
    stage: "candidate_apply",
    code: "23514",
  });
  assert.equal(context.listing()?.status, "published");
  assert.equal(context.state.workflow!.cleanup?.status, "manual_required");
  assert.equal(context.state.workflow!.cleanup?.code, "40001");
  assert.equal(context.snapshots.at(-1)?.workflow?.cleanup?.status, "manual_required");
  await assert.rejects(runRentalWorkflow({ ...context, allowPublicListing: true }), {
    code: "RECONCILIATION_REQUIRED",
  });
  assert.equal(context.writes.filter((w) => w.args.p_action === "pause").length, 1);
});

test("cleanup refuses to pause a published snapshot without the exact test marker", async () => {
  const context = fixture({ foreignPublishedMarker: true });
  await assert.rejects(runRentalWorkflow({ ...context, allowPublicListing: true }), {
    stage: "public_listing_visible",
  });
  assert.equal(context.state.workflow!.cleanup?.status, "manual_required");
  assert.equal(context.writes.filter((w) => w.args.p_action === "pause").length, 0);
});
