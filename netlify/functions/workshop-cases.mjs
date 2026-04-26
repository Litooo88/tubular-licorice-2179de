import { getStore } from "@netlify/blobs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const clean = (value, max = 1200) => String(value || "").trim().slice(0, max);
const numberOrNull = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const normalized = Number(String(value).replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(normalized) ? normalized : null;
};

const STAFF = {
  lennart: { key: "lennart", name: "Lennart", role: "Golv, mottagning och snabba jobb", phone: "072-260 77 53" },
  sebastian: { key: "sebastian", name: "Sebastian", role: "Tung felsokning, batteri och elsystem", phone: "070-024 33 19" },
};

const PAYMENT_STATUSES = new Set(["unpaid", "invoice_ready", "invoiced", "paid"]);
const PAYMENT_METHODS = new Set(["swish", "card", "cash", "invoice", "bank", "other"]);

const requireAdmin = (request) => {
  const expected = process.env.ADMIN_TOKEN || globalThis.Netlify?.env?.get?.("ADMIN_TOKEN");
  const provided = request.headers.get("x-admin-token") || "";

  if (!expected) {
    return { ok: false, response: json({ error: "ADMIN_TOKEN saknas i Netlify miljo variabler." }, 503) };
  }

  if (provided !== expected) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }

  return { ok: true };
};

const loadCase = async (store, id) => store.get(id, { type: "json" });

export default async (request, context) => {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;

  const store = getStore({ name: "workshop-cases", consistency: "strong" });
  const id = context.params?.id;

  if (request.method === "GET") {
    if (id) {
      const item = await loadCase(store, id);
      return item ? json(item) : json({ error: "Not found" }, 404);
    }

    const { blobs } = await store.list();
    const cases = [];

    for (const blob of blobs) {
      const item = await loadCase(store, blob.key);
      if (item) cases.push(item);
    }

    cases.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));

    return json({
      cases,
      totals: {
        active: cases.filter((item) => !["done", "archived"].includes(item.status)).length,
        value: cases.reduce((sum, item) => sum + Number(item.estimatedValue || 0), 0),
      },
    });
  }

  if (request.method === "PATCH") {
    if (!id) return json({ error: "Missing case id" }, 400);

    const current = await loadCase(store, id);
    if (!current) return json({ error: "Not found" }, 404);

    const body = await request.json();
    const now = new Date().toISOString();
    const currentPayment = current.payment || {};

    const nextCompletion = {
      ...(current.completion || {}),
      totalCost:
        body.totalCost === undefined ? current.completion?.totalCost ?? null : numberOrNull(body.totalCost),
      workSummary:
        body.workSummary === undefined ? current.completion?.workSummary || "" : clean(body.workSummary, 3000),
      pickupSummary:
        body.pickupSummary === undefined ? current.completion?.pickupSummary || "" : clean(body.pickupSummary, 1600),
      readyAt:
        body.readyAt === undefined ? current.completion?.readyAt || null : clean(body.readyAt, 80) || null,
      customerNotifiedAt:
        body.customerNotifiedAt === undefined
          ? current.completion?.customerNotifiedAt || null
          : clean(body.customerNotifiedAt, 80) || null,
      customerNotifiedVia:
        body.customerNotifiedVia === undefined
          ? current.completion?.customerNotifiedVia || ""
          : clean(body.customerNotifiedVia, 80),
      updatedAt: now,
    };

    const requestedPaymentStatus =
      body.paymentStatus === undefined ? currentPayment.status || "unpaid" : clean(body.paymentStatus, 40) || "unpaid";
    const requestedPaymentMethod =
      body.paymentMethod === undefined ? currentPayment.method || "" : clean(body.paymentMethod, 40) || "";

    const nextPayment = {
      ...currentPayment,
      status: PAYMENT_STATUSES.has(requestedPaymentStatus) ? requestedPaymentStatus : currentPayment.status || "unpaid",
      method:
        PAYMENT_METHODS.has(requestedPaymentMethod)
          ? requestedPaymentMethod
          : requestedPaymentMethod
            ? currentPayment.method || ""
            : "",
      amount:
        body.paymentAmount === undefined
          ? currentPayment.amount ?? current.completion?.totalCost ?? null
          : numberOrNull(body.paymentAmount),
      reference:
        body.paymentReference === undefined ? currentPayment.reference || "" : clean(body.paymentReference, 160),
      paidAt: body.paidAt === undefined ? currentPayment.paidAt || null : clean(body.paidAt, 80) || null,
      fortnoxCustomerNumber:
        body.fortnoxCustomerNumber === undefined
          ? currentPayment.fortnoxCustomerNumber || ""
          : clean(body.fortnoxCustomerNumber, 80),
      fortnoxInvoiceNumber:
        body.fortnoxInvoiceNumber === undefined
          ? currentPayment.fortnoxInvoiceNumber || ""
          : clean(body.fortnoxInvoiceNumber, 80),
      updatedAt: now,
    };

    if (nextPayment.status === "paid" && !nextPayment.paidAt) {
      nextPayment.paidAt = now;
    }

    const next = {
      ...current,
      updatedAt: now,
      status: clean(body.status, 40) || current.status,
      preferredDate: body.preferredDate === undefined ? current.preferredDate : clean(body.preferredDate, 120) || null,
      discountCode: body.discountCode === undefined ? current.discountCode : clean(body.discountCode, 40) || null,
      preferredContactTime:
        body.preferredContactTime === undefined ? current.preferredContactTime : clean(body.preferredContactTime, 80) || null,
      contactMethod: body.contactMethod === undefined ? current.contactMethod : clean(body.contactMethod, 40) || "phone",
      logistics: body.logistics === undefined ? current.logistics : clean(body.logistics, 80) || "dropoff",
      intakeAt: body.intakeAt === undefined ? current.intakeAt : clean(body.intakeAt, 80) || null,
      promisedAt: body.promisedAt === undefined ? current.promisedAt : clean(body.promisedAt, 80) || null,
      estimatedValue: body.estimatedValue === undefined ? current.estimatedValue : Number(body.estimatedValue || 0),
      priority: body.priority === undefined ? current.priority : clean(body.priority, 40) || "normal",
      service: body.service === undefined ? current.service : clean(body.service, 160) || current.service,
      message: body.message === undefined ? current.message : clean(body.message, 3000),
      customer: {
        ...(current.customer || {}),
        name: body.customerName === undefined ? current.customer?.name : clean(body.customerName, 140),
        phone: body.customerPhone === undefined ? current.customer?.phone : clean(body.customerPhone, 80),
        email: body.customerEmail === undefined ? current.customer?.email : clean(body.customerEmail, 180),
      },
      vehicle: {
        ...(current.vehicle || {}),
        model: body.vehicleModel === undefined ? current.vehicle?.model : clean(body.vehicleModel, 180),
      },
      completion: nextCompletion,
      payment: nextPayment,
    };

    if (body.assignedTo) {
      const assignee = clean(body.assignedTo, 40);
      next.assignedTo = assignee === "sebastian" ? STAFF.sebastian : STAFF.lennart;
    }

    if (body.status === "ready" && !next.completion.readyAt) {
      next.completion.readyAt = now;
    }

    if (body.note) {
      next.notes = [...(current.notes || []), { at: now, text: clean(body.note) }];
    }

    const timeline = [...(current.timeline || [])];
    if (body.note) {
      timeline.push({ at: now, event: `Uppdaterad: ${clean(body.note, 160)}` });
    } else if (body.status !== undefined) {
      timeline.push({ at: now, event: `Status andrad till ${next.status}` });
    }

    const paymentTouched =
      body.paymentStatus !== undefined ||
      body.paymentMethod !== undefined ||
      body.paymentAmount !== undefined ||
      body.paymentReference !== undefined ||
      body.paidAt !== undefined ||
      body.fortnoxCustomerNumber !== undefined ||
      body.fortnoxInvoiceNumber !== undefined;
    const readyNotificationTouched = body.customerNotifiedAt !== undefined || body.customerNotifiedVia !== undefined;

    if (paymentTouched) {
      timeline.push({
        at: now,
        event: `Betalning: ${nextPayment.status}${nextPayment.amount !== null && nextPayment.amount !== undefined ? ` ${nextPayment.amount} kr` : ""}${nextPayment.method ? ` via ${nextPayment.method}` : ""}`,
      });
    }

    if (readyNotificationTouched && nextCompletion.customerNotifiedAt) {
      timeline.push({
        at: nextCompletion.customerNotifiedAt,
        event: `Klartext skickad till kund${nextCompletion.customerNotifiedVia ? ` via ${nextCompletion.customerNotifiedVia}` : ""}.`,
      });
    }

    next.timeline = timeline;

    await store.setJSON(id, next);
    return json({ ok: true, case: next });
  }

  if (request.method === "DELETE") {
    if (!id) return json({ error: "Missing case id" }, 400);

    const current = await loadCase(store, id);
    if (!current) return json({ error: "Not found" }, 404);

    await store.delete(id);
    return json({ ok: true, deleted: id });
  }

  return json({ error: "Method not allowed" }, 405);
};

export const config = {
  path: ["/api/cases", "/api/cases/:id"],
};
