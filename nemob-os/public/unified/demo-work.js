/* Synthetic fixtures until the ring list and suggestion contracts are available. */
export const demoContacts = [
  { id: "anna", name: "Anna Exempel", phone: "+46000000001", reference: "DEMO-104", received: "I dag 09.12",
    requested: "Efter kl. 13", status: "Väntar på återkoppling", last: "Nova tog emot samtalet kl. 09.12",
    next: "Ring och stäm av modell och felbeskrivning." },
  { id: "amir", name: "Amir Exempel", phone: "+46000000002", reference: "DEMO-108", received: "I dag 08.46",
    requested: "Före lunch", booked: "Torsdag kl. 16.30", status: "Tid bekräftad", last: "Bokning bekräftad via SMS kl. 08.52",
    next: "Stäm av om kunden har fler frågor inför inlämningen." },
  { id: "liv", name: "Liv Exempel", phone: "+46000000003", received: "I går 17.35", status: "Ny kontakt",
    next: "Fråga vad kunden behöver hjälp med." },
];

export const demoSuggestions = [
  { id: "callback", source: "Kundkontakt", title: "Följ upp ett missat samtal", minutes: 10,
    reason: "Kunden önskar återkoppling efter lunch.", next: "Stäm av fordonets modell och vad som behöver åtgärdas." },
  { id: "booking", source: "Bokning", title: "Granska en bokningsförfrågan", minutes: 15,
    reason: "Önskad tid finns och inväntar bekräftelse.", next: "Kontrollera verkstadens kalender." },
  { id: "workshop", source: "Verkstadsärende", title: "Kontrollera status på en reservdel", minutes: 20,
    reason: "Arbetet väntar på en del.", next: "Kontrollera leveransbeskedet." },
  { id: "mail", source: "E-post", title: "Granska en offertförfrågan", minutes: 15,
    reason: "En exempeltråd saknar dokumenterat svar.", next: "Läs förfrågan och bedöm vad som behöver kompletteras." },
];
