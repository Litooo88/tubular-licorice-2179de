// Mappar Nordic-briefens råa JSON till en visningsmodell där varje fält
// uttryckligen är { present, value }. Saknat fält => present:false och UI:t
// visar "Data saknas" — aldrig ett falskt noll. Ett äkta 0 från källan
// visas som 0.

const field = (value, validate) => {
  if (value === undefined || value === null) return { present: false, value: null };
  if (validate && !validate(value)) return { present: false, value: null };
  return { present: true, value };
};

const isCount = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

export const mapBrief = (raw) => {
  if (!raw || typeof raw !== "object") {
    return { valid: false };
  }

  const bookings = Array.isArray(raw.todays_bookings) ? raw.todays_bookings : undefined;
  const openJobs = Array.isArray(raw.open_jobs) ? raw.open_jobs : undefined;

  // Äldsta öppna jobbet: open_jobs kommer sorterat på days_open (fallande).
  // Skilj på "listan saknas" (Data saknas) och "listan är tom" (0 öppna jobb).
  let oldestOpenJob;
  if (openJobs === undefined) {
    oldestOpenJob = { present: false, value: null };
  } else {
    const withAge = openJobs.filter((job) => job && Number.isFinite(job.days_open));
    oldestOpenJob = { present: true, value: withAge[0] || null };
  }

  return {
    valid: true,
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : null,
    todaysBookings: field(bookings),
    openJobsCount: field(openJobs === undefined ? undefined : openJobs.length, isCount),
    oldestOpenJob,
    overdueOffersCount: field(raw.overdue_offers_count, isCount),
    unpaidInvoicesCount: field(raw.unpaid_invoices_count, isCount),
    weekRevenueSek: field(raw.week_revenue_sek, isCount),
    newBookingsSinceYesterday: field(raw.new_bookings_since_yesterday, isCount),
  };
};
