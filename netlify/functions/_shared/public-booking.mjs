// Publikt svar på en bokning. /api/bookings är avsiktligt öppen och kan träffas
// igen med enbart idempotensnyckeln (header, eller ett fingeravtryck av telefon
// + datum + tjänst + fordon). Därför får hela caseItem ALDRIG returneras: det
// skulle lämna ut interna noteringar, betalningsfält, timeline och ärende-id
// till den som kan upprepa en bokning. Kunden behöver bara veta att ärendet är
// registrerat och vilken bekräftelse som faktiskt gick iväg.

const clean = (value, max = 1200) => String(value || "").trim().slice(0, max);

export const publicDeliveryStatus = (caseItem = {}) => {
  const notifications = caseItem.notifications || {};
  const explicit = caseItem.customerDelivery || notifications.customerDelivery;
  const explicitStatus = clean(explicit?.status, 40);
  if (explicitStatus) {
    const label = clean(explicit?.label, 200);
    return label ? { status: explicitStatus, label } : { status: explicitStatus };
  }
  // Fältet customerDelivery har aldrig skrivits av bokningen, så bokningssidan
  // visade alltid det pessimistiska svaret "bekräftelsen gick inte iväg" — även
  // när både SMS och e-post var skickade. Härled det ärligt i stället.
  const wasRequested = (channel) => Boolean(channel) && channel.status !== "not_requested";
  const expected = [
    { name: "SMS", channel: notifications.sms },
    { name: "e-post", channel: notifications.customerEmail },
  ].filter((entry) => wasRequested(entry.channel));
  if (!expected.length) return { status: "missing" };
  const sent = expected.filter((entry) => entry.channel.status === "sent");
  if (sent.length === expected.length) return { status: "sent" };
  if (!sent.length) return { status: "missing" };
  return { status: "partial", label: `Bekräftelse via ${sent.map((entry) => entry.name).join(" och ")} är skickad` };
};

const publicChannelStatus = (channel) => ({ status: clean(channel?.status, 40) || "unknown" });

export const publicBookingCase = (caseItem = {}) => {
  const notifications = caseItem.notifications || {};
  return {
    status: clean(caseItem.status, 40) || "new",
    service: clean(caseItem.service, 240),
    preferredDate: clean(caseItem.preferredDate, 120) || null,
    customerDelivery: publicDeliveryStatus(caseItem),
    notifications: {
      sms: publicChannelStatus(notifications.sms),
      customerEmail: publicChannelStatus(notifications.customerEmail),
      staffSms: publicChannelStatus(notifications.staffSms),
      calendar: publicChannelStatus(notifications.calendar),
    },
  };
};
