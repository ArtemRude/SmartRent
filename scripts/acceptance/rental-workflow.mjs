import { randomUUID } from "node:crypto";

const PROJECT = "https://euuyvfidarhpeqeeheuu.supabase.co";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1kAAAAASUVORK5CYII=",
  "base64",
);
const day = (date = new Date()) => date.toISOString().slice(0, 10);
const shifted = (date, months = 0, days = 0) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  value.setUTCDate(value.getUTCDate() + days);
  return day(value);
};

function failure(stage, code = "ASSERTION_FAILED") {
  const error = new Error(`Acceptance workflow stopped: ${stage} (${code})`);
  error.code = code;
  error.stage = stage;
  return error;
}
function assert(condition, stage) {
  if (!condition) throw failure(stage);
}
function identifier(value, stage) {
  assert(typeof value === "string" && UUID.test(value), stage);
  return value;
}
async function result(query, stage) {
  const response = await query;
  if (response.error)
    throw failure(
      stage,
      /^[A-Za-z0-9_]{1,32}$/.test(response.error.code ?? "") ? response.error.code : "API_ERROR",
    );
  return response.data;
}

// A real, deliberately unsigned test artifact. It contains no personal data.
function testPdf(runId) {
  const content = `BT /F1 14 Tf 40 760 Td (ACCEPTANCE TEST ONLY - NOT A CONTRACT) Tj 0 -24 Td (No legal signature. No money transferred.) Tj 0 -24 Td (Run ${runId}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document);
}

/**
 * Real user-JWT API acceptance on one isolated fixture. No admin/SQL bypass.
 * Completed writes are reused; a pending/failed write requires reconciliation.
 * Public publication requires an explicit caller gate on every invocation.
 */
export async function runRentalWorkflow({
  clients,
  state,
  saveState,
  allowPublicListing = false,
  report = () => {},
}) {
  assert(
    state?.version === 1 && UUID.test(state.run_id ?? "") && state.project_url === PROJECT,
    "fixture_manifest",
  );
  assert(typeof saveState === "function", "fixture_persistence");
  const { owner, tenant, manager } = clients ?? {};
  assert(
    owner && tenant && manager && owner !== tenant && tenant !== manager && owner !== manager,
    "separate_clients",
  );
  const propertyId = identifier(state.property?.id, "fixture_property_id");
  const ownerId = identifier(state.users?.owner?.id, "fixture_owner_id");
  const tenantUserId = identifier(state.users?.tenant?.id, "fixture_tenant_user_id");
  const managerId = identifier(state.users?.manager?.id, "fixture_manager_id");
  assert(new Set([ownerId, tenantUserId, managerId]).size === 3, "distinct_fixture_users");
  assert(propertyId !== "9fa20c52-87d0-4f76-9fef-453a2b5b25b0", "protected_existing_property");
  const propertyName = `ТЕСТ ПРИЁМКИ ${state.run_id}`;
  const marker = `ТЕСТ ПРИЁМКИ — НЕ СДАЁТСЯ ${state.run_id}`;
  const note = `${marker}. Вымышленные данные, реальной аренды, работ и перевода денег нет.`;
  assert(
    state.property.owner_id === ownerId && state.property.name === propertyName,
    "fixture_property_identity",
  );
  identifier(state.membership_id, "fixture_membership_id");
  for (const [role, client] of Object.entries({ owner, tenant, manager })) {
    assert(client.supabaseUrl?.replace(/\/$/, "") === PROJECT, `project_${role}`);
    const expected = state.users[role];
    assert(
      expected.email === `acceptance-${state.run_id}-${role}@example.invalid`,
      `fixture_email_${role}`,
    );
    assert(expected.app_role === (role === "owner" ? "owner" : "tenant"), `fixture_role_${role}`);
    const auth = await client.auth.getUser();
    if (auth.error) throw failure(`auth_${role}`, "AUTH_ERROR");
    assert(
      auth.data.user?.id === expected.id &&
        auth.data.user?.email === expected.email &&
        auth.data.user.email_confirmed_at,
      `principal_${role}`,
    );
    const telegram = await result(client.rpc("telegram_overview"), `telegram_${role}`);
    assert(
      telegram &&
        !telegram.connection &&
        !telegram.pending &&
        Array.isArray(telegram.deliveries) &&
        telegram.deliveries.length === 0,
      `no_external_delivery_${role}`,
    );
  }
  const property = async () => {
    const p = await result(
      owner
        .from("properties")
        .select("id,owner_id,name,status")
        .eq("id", propertyId)
        .eq("owner_id", ownerId)
        .single(),
      "fixture_property_read",
    );
    assert(
      p?.id === propertyId && p.owner_id === ownerId && p.name === propertyName,
      "fixture_property_guard",
    );
    return p;
  };
  await property();
  const team = await result(manager.rpc("team_overview"), "fixture_team_scope");
  const membership = team?.members?.find((m) => m.id === state.membership_id);
  assert(
    membership?.owner_id === ownerId &&
      membership.user_id === managerId &&
      membership.role === "manager" &&
      membership.status === "active" &&
      membership.property_ids?.length === 1 &&
      membership.property_ids[0] === propertyId,
    "fixture_manager_membership",
  );
  assert(
    team.workspaces?.length === 1 && team.workspaces[0].id === propertyId,
    "fixture_manager_workspace_scope",
  );
  const hub = () => result(owner.rpc("property_hub", { p_property_id: propertyId }), "fixture_hub");
  if (!state.workflow) {
    const initial = await hub();
    assert(
      Array.isArray(initial?.listings) &&
        initial.listings.length === 0 &&
        Array.isArray(initial.applications) &&
        initial.applications.length === 0,
      "fixture_unused_recruitment",
    );
    const leases = await result(
      owner
        .from("lease_agreements")
        .select("id")
        .eq("property_id", propertyId)
        .eq("owner_id", ownerId),
      "fixture_unused_leases",
    );
    assert(leases.length === 0, "fixture_unused_leases");
    state.workflow = {
      version: 1,
      run_id: state.run_id,
      property_id: propertyId,
      owner_id: ownerId,
      operations: {},
      refs: {},
      status: "prepared",
    };
    await saveState();
  }
  const workflow = state.workflow;
  assert(
    workflow.version === 1 &&
      workflow.run_id === state.run_id &&
      workflow.property_id === propertyId &&
      workflow.owner_id === ownerId &&
      workflow.operations &&
      workflow.refs,
    "workflow_scope",
  );
  const refs = workflow.refs;
  const emit = async (stage, status, code) => {
    await report({ stage, status, ...(code ? { code } : {}) });
  };
  async function write(key, action) {
    const previous = workflow.operations[key];
    if (previous) {
      if (previous.status === "done") return previous.value;
      throw failure(key, "RECONCILIATION_REQUIRED");
    }
    await property();
    workflow.stage = key;
    workflow.operations[key] = { status: "pending", started_at: new Date().toISOString() };
    await saveState(); // Persist before I/O: process/network failure must not cause a blind retry.
    await emit(key, "running");
    try {
      const value = await action();
      workflow.operations[key] = {
        status: "done",
        value: value ?? null,
        completed_at: new Date().toISOString(),
      };
      await saveState();
      await emit(key, "passed");
      return value;
    } catch (error) {
      const code = /^[A-Za-z0-9_]{1,32}$/.test(error?.code ?? "") ? error.code : "OPERATION_FAILED";
      workflow.operations[key] = { status: "uncertain", code };
      workflow.status = "requires_reconciliation";
      await saveState();
      await emit(key, "stopped", code);
      throw failure(key, code);
    }
  }
  async function remember(name, value) {
    identifier(value, `reference_${name}`);
    assert(!refs[name] || refs[name] === value, `reference_changed_${name}`);
    refs[name] = value;
    await saveState();
    return value;
  }
  async function denied(key, operation) {
    return write(key, async () => {
      const response = await operation();
      assert(response.error?.code === "42501", `${key}_must_be_forbidden`);
      return { denied: true, code: "42501" };
    });
  }
  async function listing() {
    const h = await hub();
    const value = h.listings.find((entry) => entry.id === refs.listing_id);
    assert(
      value?.property_id === propertyId && value.draft?.title === marker,
      "fixture_listing_guard",
    );
    return value;
  }
  async function application() {
    const h = await hub();
    const value = h.applications.find((entry) => entry.id === refs.application_id);
    assert(
      value?.property_id === propertyId &&
        value.listing_id === refs.listing_id &&
        value.email === state.users.tenant.email,
      "fixture_application_guard",
    );
    return value;
  }
  const rpc = (client, name, args, stage) => result(client.rpc(name, args), stage);
  const upload = (client, bucket, path, body, contentType, stage) =>
    write(stage, async () => {
      await result(
        client.storage.from(bucket).upload(path, body, { contentType, upsert: false }),
        stage,
      );
      return { path };
    });
  try {
    await remember(
      "listing_id",
      await write("listing_draft", () =>
        rpc(
          owner,
          "save_property_listing",
          {
            p_property_id: propertyId,
            p_id: null,
            p_unit_id: null,
            p_revision: null,
            p_values: {
              title: marker,
              location: "Вымышленный тестовый адрес; объект не сдаётся",
              description: note,
              contact_name: "Тестовый оператор",
              monthly_rent: 1000,
              deposit: 0,
              area: 35,
              available_from: day(),
              photos: [],
            },
          },
          "listing_draft",
        ),
      ),
    );
    const listingPhoto = `${identifier((await listing()).public_id, "fixture_listing_public_id")}/acceptance-test.png`;
    await upload(owner, "listing-photos", listingPhoto, PNG, "image/png", "listing_photo_upload");
    await write("listing_photo_attach", async () => {
      const l = await listing();
      assert(l.status === "draft", "listing_draft_status");
      return rpc(
        owner,
        "save_property_listing",
        {
          p_property_id: propertyId,
          p_id: l.id,
          p_unit_id: null,
          p_revision: l.revision,
          p_values: { ...l.draft, photos: [listingPhoto] },
        },
        "listing_photo_attach",
      );
    });
    if (allowPublicListing !== true) {
      workflow.status =
        workflow.operations.fixture_archive?.status === "done"
          ? "completed"
          : workflow.operations.listing_publish
            ? "continuation_requires_public_listing_flag"
            : "awaiting_public_listing_approval";
      await saveState();
      await emit("public_listing", workflow.status);
      return { status: workflow.status, property_id: propertyId, listing_id: refs.listing_id };
    }
    await write("listing_publish", async () => {
      const l = await listing();
      assert(l.status === "draft" && l.draft.photos.length === 1, "listing_publish_precondition");
      return rpc(
        owner,
        "act_on_property_listing",
        { p_id: l.id, p_action: "publish", p_revision: l.revision },
        "listing_publish",
      );
    });
    await write("public_listing_visible", async () => {
      const l = await listing();
      const value = await rpc(
        tenant,
        "public_listing",
        { p_public_id: l.public_id },
        "public_listing_visible",
      );
      assert(
        value?.details?.title === marker &&
          value.can_apply === true &&
          Object.keys(value).every((key) =>
            ["public_id", "published_at", "details", "can_apply"].includes(key),
          ),
        "public_listing_marker",
      );
      assert(
        !JSON.stringify(value).includes(ownerId) &&
          !JSON.stringify(value).includes(state.users.owner.email),
        "public_listing_no_owner_identity",
      );
      return { visible: true };
    });
    await remember(
      "application_id",
      await write("candidate_apply", async () =>
        rpc(
          tenant,
          "apply_to_listing",
          {
            p_public_id: (await listing()).public_id,
            p_values: {
              name: `Вымышленный кандидат ${state.run_id}`,
              phone: "00000000000",
              message: note,
              consent: true,
            },
          },
          "candidate_apply",
        ),
      ),
    );
    for (const [action, values] of [
      [
        "schedule",
        {
          showing_at: new Date(Date.now() + 86400000).toISOString(),
          public_note: note,
          operator_note: note,
        },
      ],
      ["shortlist", { public_note: note, operator_note: note }],
    ]) {
      await write(`candidate_${action}`, async () => {
        const a = await application();
        const id = await rpc(
          manager,
          "act_on_rental_application",
          { p_id: a.id, p_action: action, p_revision: a.revision, p_values: values },
          `candidate_${action}`,
        );
        const updated = await application();
        assert(
          updated.status === (action === "schedule" ? "showing" : "shortlisted"),
          `candidate_${action}_assert`,
        );
        if (action === "schedule")
          assert(Date.parse(updated.showing_at) > Date.now(), "candidate_future_showing");
        return id;
      });
    }
    await denied("manager_cannot_accept_candidate", async () => {
      const a = await application();
      return manager.rpc("act_on_rental_application", {
        p_id: a.id,
        p_action: "accept",
        p_revision: a.revision,
        p_values: { start_date: day(), end_date: shifted(day(), 3), payment_due_day: 15 },
      });
    });
    await remember(
      "agreement_id",
      await write("candidate_accept", async () => {
        const a = await application();
        return rpc(
          owner,
          "act_on_rental_application",
          {
            p_id: a.id,
            p_action: "accept",
            p_revision: a.revision,
            p_values: {
              start_date: day(),
              end_date: shifted(day(), 3),
              payment_due_day: 15,
              public_note: note,
            },
          },
          "candidate_accept",
        );
      }),
    );
    async function agreement() {
      const a = await result(
        owner
          .from("lease_agreements")
          .select("*")
          .eq("id", refs.agreement_id)
          .eq("property_id", propertyId)
          .eq("owner_id", ownerId)
          .single(),
        "fixture_agreement",
      );
      assert(
        a?.id === refs.agreement_id && a.property_id === propertyId && a.owner_id === ownerId,
        "fixture_agreement_guard",
      );
      const t = await result(
        owner
          .from("tenants")
          .select("id,owner_id,user_id,email")
          .eq("id", a.tenant_id)
          .eq("owner_id", ownerId)
          .single(),
        "fixture_tenant",
      );
      assert(
        t?.user_id === tenantUserId && t.email === state.users.tenant.email,
        "fixture_tenant_guard",
      );
      if (refs.tenant_id) assert(refs.tenant_id === t.id, "fixture_tenant_reference");
      return a;
    }
    await remember("tenant_id", (await agreement()).tenant_id);
    await write("agreement_pending_signature", async () => {
      const a = await agreement();
      assert(a.status === "draft", "agreement_draft_status");
      const updated = await result(
        owner
          .from("lease_agreements")
          .update({ status: "pending_signature" })
          .eq("id", a.id)
          .eq("owner_id", ownerId)
          .eq("status", "draft")
          .select("id,status")
          .single(),
        "agreement_pending_signature",
      );
      assert(updated.status === "pending_signature", "agreement_pending_signature_assert");
      return updated;
    });
    const pdfPath = `${tenantUserId}/${refs.agreement_id}/acceptance-test-not-contract.pdf`;
    await upload(
      tenant,
      "lease-documents",
      pdfPath,
      testPdf(state.run_id),
      "application/pdf",
      "agreement_pdf_upload",
    );
    await write("agreement_tenant_accept", async () => {
      const a = await agreement();
      assert(a.status === "pending_signature", "agreement_signature_status");
      await rpc(
        tenant,
        "submit_tenant_agreement",
        {
          p_agreement_id: a.id,
          p_agreement_version: a.status_changed_at,
          p_document_path: pdfPath,
          p_photo_paths: [],
        },
        "agreement_tenant_accept",
      );
      const signed = await agreement();
      assert(signed.signed_document_file === pdfPath, "agreement_signature_path");
      return { version: a.status_changed_at, path: pdfPath };
    });
    await write("agreement_activate", async () => {
      const a = await agreement();
      assert(
        a.status === "pending_signature" && a.signed_document_file === pdfPath,
        "agreement_activate_precondition",
      );
      const updated = await result(
        owner
          .from("lease_agreements")
          .update({ status: "active" })
          .eq("id", a.id)
          .eq("owner_id", ownerId)
          .eq("status", "pending_signature")
          .select("id,status")
          .single(),
        "agreement_activate",
      );
      assert(updated.status === "active", "agreement_active_assert");
      return updated;
    });
    async function handover(kind) {
      const ref = `${kind}_handover_id`;
      await remember(
        ref,
        await write(`${kind}_draft`, async () => {
          const a = await agreement();
          assert(a.status === "active" && a.start_date <= day(), `${kind}_active_lease`);
          return rpc(
            owner,
            "save_lease_handover",
            {
              p_agreement_id: a.id,
              p_kind: kind,
              p_expected_revision: null,
              p_report: {
                inspection_date: day(),
                keys_count: 1,
                checklist: { condition: true, inventory: true, meters: true, keys: true },
                condition_note: note,
                meter_readings: "Тест: все показания 0; реальных счётчиков нет",
                deposit_received: 0,
                deductions: [],
                photos: [],
              },
            },
            `${kind}_draft`,
          );
        }),
      );
      const read = async () => {
        const h = await result(
          owner
            .from("lease_handovers")
            .select("*")
            .eq("id", refs[ref])
            .eq("agreement_id", refs.agreement_id)
            .single(),
          `${kind}_read`,
        );
        assert(
          h?.kind === kind &&
            h.agreement_id === refs.agreement_id &&
            Number(h.deposit_received) === 0,
          `${kind}_scope`,
        );
        return h;
      };
      for (const [action, client, expected, next] of [
        ["submit", owner, "draft", "pending"],
        ["confirm", tenant, "pending", "confirmed"],
        ...(kind === "move_out" ? [["complete", owner, "confirmed", "confirmed"]] : []),
      ]) {
        await write(`${kind}_${action}`, async () => {
          const h = await read();
          assert(
            h.status === expected && Number(h.refund_due) === 0,
            `${kind}_${action}_precondition`,
          );
          await rpc(
            client,
            "act_on_lease_handover",
            {
              p_handover_id: h.id,
              p_action: action,
              p_expected_revision: h.revision,
              p_note: note,
            },
            `${kind}_${action}`,
          );
          const after = await read();
          assert(
            after.status === next && (action !== "complete" || after.completed_at),
            `${kind}_${action}_assert`,
          );
          return { id: h.id, status: after.status, completed: Boolean(after.completed_at) };
        });
      }
    }
    await handover("move_in");
    await remember(
      "charge_id",
      await write("rent_charge_locate", async () => {
        await agreement();
        const rows = await result(
          owner
            .from("rent_charges")
            .select("id,amount,paid_amount,period_start")
            .eq("agreement_id", refs.agreement_id)
            .eq("owner_id", ownerId)
            .eq("charge_type", "rent")
            .order("period_start")
            .limit(1),
          "rent_charge_locate",
        );
        assert(
          rows.length === 1 && Number(rows[0].amount) === 1000 && Number(rows[0].paid_amount) === 0,
          "rent_charge_initial",
        );
        return rows[0].id;
      }),
    );
    const paymentValues = () => ({
      id: randomUUID(),
      charge_id: refs.charge_id,
      owner_id: ownerId,
      tenant_id: refs.tenant_id,
      amount: 100,
      paid_at: new Date(Date.now() - 1000).toISOString(),
      payment_method: "cash",
      receipt_file: null,
      note,
    });
    async function charge() {
      const c = await result(
        owner
          .from("rent_charges")
          .select("id,agreement_id,owner_id,tenant_id,amount,paid_amount,paid_at")
          .eq("id", refs.charge_id)
          .eq("agreement_id", refs.agreement_id)
          .eq("owner_id", ownerId)
          .single(),
        "fixture_charge",
      );
      assert(c?.tenant_id === refs.tenant_id && Number(c.amount) === 1000, "fixture_charge_guard");
      return c;
    }
    await denied("tenant_cannot_record_payment", async () => {
      await charge();
      return tenant.from("rent_payments").insert(paymentValues()).select("id").single();
    });
    await remember(
      "payment_id",
      await write("partial_rent_payment", async () => {
        await agreement();
        assert(Number((await charge()).paid_amount) === 0, "partial_payment_initial_balance");
        const payment = await result(
          owner.from("rent_payments").insert(paymentValues()).select("id,amount").single(),
          "partial_rent_payment",
        );
        const c = await result(
          owner
            .from("rent_charges")
            .select("id,paid_amount,paid_at")
            .eq("id", refs.charge_id)
            .eq("agreement_id", refs.agreement_id)
            .single(),
          "partial_rent_payment_assert",
        );
        assert(Number(c.paid_amount) === 100 && c.paid_at === null, "partial_payment_balance");
        return payment.id;
      }),
    );
    await remember(
      "request_id",
      await write("tenant_repair_request", async () => {
        const a = await agreement();
        assert(a.status === "active", "request_active_lease");
        const request = await result(
          tenant
            .from("requests")
            .insert({
              id: randomUUID(),
              tenant_id: refs.tenant_id,
              owner_id: ownerId,
              property_id: propertyId,
              unit_id: null,
              title: `${marker} ремонт`,
              description: note,
              category: "repair",
              status: "new",
            })
            .select("id,property_id,tenant_id")
            .single(),
          "tenant_repair_request",
        );
        assert(
          request.property_id === propertyId && request.tenant_id === refs.tenant_id,
          "request_scope",
        );
        return request.id;
      }),
    );
    await write("manager_request_in_progress", async () => {
      await agreement();
      const id = await rpc(
        manager,
        "act_on_team_property",
        {
          p_property_id: propertyId,
          p_action: "request_status",
          p_values: { request_id: refs.request_id, expected_status: "new", status: "in_progress" },
        },
        "manager_request_in_progress",
      );
      const workspace = await rpc(
        manager,
        "team_workspace",
        { p_property_id: propertyId },
        "manager_request_read",
      );
      assert(
        workspace.property?.id === propertyId &&
          workspace.requests?.some((r) => r.id === refs.request_id && r.status === "in_progress"),
        "manager_request_status_assert",
      );
      return id;
    });
    await remember(
      "contractor_id",
      await write("test_contractor", () =>
        rpc(
          owner,
          "save_repair_contractor",
          {
            p_owner_id: ownerId,
            p_id: null,
            p_revision: null,
            p_values: {
              name: `${marker} исполнитель`,
              specialty: "Вымышленные работы",
              phone: "",
              email: "",
              note,
              active: true,
            },
          },
          "test_contractor",
        ),
      ),
    );
    const jobValues = (contractorId = null) => ({
      title: `${marker} ремонт`,
      description: note,
      scheduled_date: day(),
      due_date: shifted(day(), 0, 2),
      contractor_id: contractorId,
      request_id: refs.request_id,
      estimate_items: [{ name: "Вымышленная тестовая работа", quantity: 1, unit_price: 200 }],
    });
    await remember(
      "job_id",
      await write("manager_repair_draft", () =>
        rpc(
          manager,
          "save_repair_job",
          { p_property_id: propertyId, p_id: null, p_revision: null, p_values: jobValues() },
          "manager_repair_draft",
        ),
      ),
    );
    async function job() {
      const overview = await rpc(owner, "repairs_overview", {}, "repair_overview");
      const value = overview?.jobs?.find((j) => j.id === refs.job_id);
      assert(
        value?.property_id === propertyId &&
          value.owner_id === ownerId &&
          value.request_id === refs.request_id &&
          value.title === `${marker} ремонт`,
        "repair_job_guard",
      );
      return value;
    }
    await write("owner_assign_contractor", async () => {
      const j = await job();
      const contractors = await rpc(owner, "repairs_overview", {}, "fixture_contractor_read");
      const contractor = contractors?.contractors?.find((c) => c.id === refs.contractor_id);
      assert(
        contractor?.owner_id === ownerId &&
          contractor.name === `${marker} исполнитель` &&
          !contractor.phone &&
          !contractor.email,
        "fixture_contractor_guard",
      );
      assert(j.status === "draft" && !j.contractor_id, "repair_assign_precondition");
      return rpc(
        owner,
        "save_repair_job",
        {
          p_property_id: propertyId,
          p_id: j.id,
          p_revision: j.revision,
          p_values: jobValues(refs.contractor_id),
        },
        "owner_assign_contractor",
      );
    });
    const repairAction = (client, action, j, values = {}) =>
      rpc(
        client,
        "act_on_repair_job",
        { p_id: j.id, p_action: action, p_revision: j.revision, p_values: values },
        `repair_${action}`,
      );
    await write("repair_submit", async () => {
      const j = await job();
      assert(
        j.status === "draft" && j.contractor_id === refs.contractor_id,
        "repair_submit_precondition",
      );
      return repairAction(manager, "submit", j);
    });
    await denied("manager_cannot_approve_repair", async () => {
      const j = await job();
      return manager.rpc("act_on_repair_job", {
        p_id: j.id,
        p_action: "approve",
        p_revision: j.revision,
        p_values: {},
      });
    });
    for (const [action, client, before, after] of [
      ["approve", owner, "pending", "approved"],
      ["start", manager, "approved", "in_progress"],
    ]) {
      await write(`repair_${action}`, async () => {
        const j = await job();
        assert(j.status === before, `repair_${action}_precondition`);
        await repairAction(client, action, j);
        assert((await job()).status === after, `repair_${action}_assert`);
        return { id: j.id, status: after };
      });
    }
    const repairPhoto = `${managerId}/${refs.job_id}/acceptance-test-result.png`;
    await upload(
      manager,
      "repair-result-photos",
      repairPhoto,
      PNG,
      "image/png",
      "repair_result_photo",
    );
    for (const [action, client, before, after, values] of [
      [
        "report",
        manager,
        "in_progress",
        "review",
        { actual_amount: 200, note, photos: [repairPhoto] },
      ],
      ["accept", owner, "review", "completed", {}],
    ]) {
      await write(`repair_${action}`, async () => {
        const j = await job();
        assert(j.status === before, `repair_${action}_precondition`);
        await repairAction(client, action, j, values);
        assert((await job()).status === after, `repair_${action}_assert`);
        return { id: j.id, status: after };
      });
    }
    await remember(
      "expense_id",
      await write("repair_unpaid_expense", async () => {
        const j = await job();
        assert(
          j.status === "completed" && !j.expense_id && Number(j.actual_amount) === 200,
          "repair_expense_precondition",
        );
        const expenseId = await repairAction(owner, "expense", j);
        // Expenses inherit ownership through their property; there is no owner_id column.
        await property();
        const expense = await result(
          owner
            .from("property_expenses")
            .select("id,property_id,status,planned_amount,paid_amount")
            .eq("id", expenseId)
            .eq("property_id", propertyId)
            .single(),
          "repair_expense_assert",
        );
        assert(
          expense.status === "planned" &&
            Number(expense.planned_amount) === 200 &&
            expense.paid_amount === null &&
            (await job()).expense_id === expenseId,
          "repair_expense_unpaid",
        );
        return expenseId;
      }),
    );
    await remember(
      "amendment_id",
      await write("amendment_draft", async () => {
        const a = await agreement();
        const nextMonth = shifted(`${day().slice(0, 7)}-01`, 1);
        return rpc(
          owner,
          "save_lease_amendment",
          {
            p_agreement_id: a.id,
            p_id: null,
            p_revision: null,
            p_values: {
              effective_from: nextMonth,
              monthly_payment: 1100,
              end_date: shifted(a.end_date, 1),
              note,
            },
          },
          "amendment_draft",
        );
      }),
    );
    const amendment = async () => {
      const value = await result(
        owner
          .from("lease_amendments")
          .select("*")
          .eq("id", refs.amendment_id)
          .eq("agreement_id", refs.agreement_id)
          .single(),
        "amendment_read",
      );
      assert(value?.agreement_id === refs.agreement_id && value.note === note, "amendment_scope");
      return value;
    };
    for (const [action, client, before, after] of [
      ["submit", owner, "draft", "pending"],
      ["accept", tenant, "pending", "accepted"],
    ]) {
      await write(`amendment_${action}`, async () => {
        await agreement();
        const m = await amendment();
        assert(m.status === before, `amendment_${action}_precondition`);
        await rpc(
          client,
          "act_on_lease_amendment",
          { p_id: m.id, p_action: action, p_revision: m.revision, p_note: note },
          `amendment_${action}`,
        );
        assert((await amendment()).status === after, `amendment_${action}_assert`);
        return { id: m.id, status: after };
      });
    }
    await write("amendment_schedule_assert", async () => {
      const a = await agreement();
      const m = await amendment();
      assert(a.end_date === m.end_date && m.status === "accepted", "amendment_terms_applied");
      const future = await result(
        owner
          .from("rent_charges")
          .select("id,amount,paid_amount")
          .eq("agreement_id", refs.agreement_id)
          .eq("charge_type", "rent")
          .gte("period_start", m.effective_from),
        "amendment_future_charges",
      );
      assert(
        future.length > 0 &&
          future.every((c) => Number(c.amount) === 1100 && Number(c.paid_amount) === 0),
        "amendment_future_rate",
      );
      assert(Number((await charge()).paid_amount) === 100, "amendment_preserves_partial_payment");
      return { future_rate: 1100, partial_payment_preserved: true };
    });
    await handover("move_out");
    await write("listing_pause_after_lease", async () => {
      assert((await agreement()).status === "completed", "archive_completed_lease");
      const l = await listing();
      // Candidate acceptance closes the listing as filled. The API deliberately
      // disallows pause on filled; do not republish just to manufacture a pause.
      if (l.status === "filled") {
        const publicValue = await rpc(
          tenant,
          "public_listing",
          { p_public_id: l.public_id },
          "filled_listing_hidden",
        );
        assert(publicValue === null, "filled_listing_not_public");
        return { id: l.id, status: "filled", publicly_visible: false };
      }
      if (l.status === "paused") return { id: l.id, status: "paused" };
      await rpc(
        owner,
        "act_on_property_listing",
        { p_id: l.id, p_action: "pause", p_revision: l.revision },
        "listing_pause_after_lease",
      );
      assert((await listing()).status === "paused", "listing_paused_assert");
      return { id: l.id, status: "paused" };
    });
    await write("fixture_archive", async () => {
      assert(
        (await agreement()).status === "completed" &&
          ["paused", "filled"].includes((await listing()).status),
        "fixture_archive_precondition",
      );
      const p = await property();
      assert(p.status === "active", "fixture_archive_expected_status");
      await rpc(
        owner,
        "set_catalog_property_status",
        { p_id: propertyId, p_expected: "active", p_status: "archived" },
        "fixture_archive",
      );
      assert((await property()).status === "archived", "fixture_archived_assert");
      return { id: propertyId, status: "archived" };
    });
    workflow.status = "completed";
    workflow.completed_at = new Date().toISOString();
    await saveState();
    await emit("rental_workflow", "passed_api_only_browser_acceptance_pending");
    return {
      status: workflow.status,
      property_id: propertyId,
      agreement_id: refs.agreement_id,
      checks: Object.keys(workflow.operations).length,
      browser_acceptance: "pending",
    };
  } catch (originalError) {
    // A failed business write is never retried. This separate, bounded cleanup
    // only hides a verified test advert; it cannot complete/archive a lease.
    try {
      if (!refs.listing_id) {
        workflow.cleanup = { status: "not_created" };
      } else {
        identifier(refs.listing_id, "cleanup_listing_id");
        await property();
        const l = await listing();
        if (l.status !== "published") {
          workflow.cleanup = { status: "not_public", listing_id: l.id };
        } else {
          assert(l.published_snapshot?.title === marker, "cleanup_published_marker");
          // A lost response to an earlier pause must be reconciled, not retried.
          assert(
            !workflow.cleanup ||
              workflow.cleanup.status === "not_public" ||
              workflow.cleanup.status === "not_created",
            "cleanup_no_uncertain_retry",
          );
          workflow.cleanup = { status: "pending", listing_id: l.id };
          await saveState();
          await rpc(
            owner,
            "act_on_property_listing",
            { p_id: l.id, p_action: "pause", p_revision: l.revision },
            "cleanup_listing_pause",
          );
          assert((await listing()).status === "paused", "cleanup_listing_paused_assert");
          workflow.cleanup = { status: "paused", listing_id: l.id };
        }
      }
      await saveState();
      await emit("failure_cleanup", workflow.cleanup.status);
    } catch (cleanupError) {
      const code = /^[A-Za-z0-9_]{1,32}$/.test(cleanupError?.code ?? "")
        ? cleanupError.code
        : "CLEANUP_FAILED";
      workflow.cleanup = {
        status: "manual_required",
        ...(refs.listing_id ? { listing_id: refs.listing_id } : {}),
        code,
      };
      // Keep the business error even when persistence/reporting itself fails.
      try {
        await saveState();
        await emit("failure_cleanup", "manual_required", code);
      } catch {
        /* Caller still receives the original failure. */
      }
    }
    throw originalError;
  }
}
