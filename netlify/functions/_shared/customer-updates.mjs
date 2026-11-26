export function appendCustomerUpdate(item, text, at) {
  return [...(Array.isArray(item.customerUpdates) ? item.customerUpdates : []), { at, text }].slice(-20);
}

export function customerUpdatesView(item) {
  return (Array.isArray(item.customerUpdates) ? item.customerUpdates : [])
    .map((entry) => ({
      at: String(entry?.at ?? "").trim().slice(0, 40),
      text: String(entry?.text ?? "").trim().slice(0, 1200),
    }))
    .filter((entry) => entry.text);
}
