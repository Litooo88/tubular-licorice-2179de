// Gallrar den centrala SMS-loggen (sms-log): poster äldre än 12 månader tas
// bort. Kunddata ska inte ligga kvar längre än den behövs.

import { pruneSmsLog } from "./_shared/comm-log.mjs";

export default async () => {
  const removed = await pruneSmsLog().catch((e) => { console.error("comm-log-prune", e?.message); return -1; });
  console.log("comm-log-prune", removed);
  return new Response(String(removed));
};

export const config = { schedule: "35 3 * * *" };
