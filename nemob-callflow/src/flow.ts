import type { ElksPayload, Env, Operator } from "./types";

function withParams(url: URL, params: Record<string, string | undefined>) {
  Object.entries(params).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  return url.toString();
}

export function callId(payload: ElksPayload, url: URL): string {
  return payload.callid || payload.id || url.searchParams.get("callid") || crypto.randomUUID();
}

export function caller(payload: ElksPayload, url: URL): string {
  return payload.from || url.searchParams.get("from") || "unknown";
}

export function ivrChoice(payload: ElksPayload, url: URL): "1" | "2" | "default" | "outside_hours" | null {
  const value = payload.result || url.searchParams.get("ivr_choice");
  if (value === "1" || value === "2" || value === "outside_hours") return value;
  if (value === "failed" || payload.why === "noinput") return "default";
  return null;
}

export function introIvr(env: Env, reqUrl: URL, payload: ElksPayload) {
  const base = reqUrl.origin;
  const params = { callid: callId(payload, reqUrl), from: caller(payload, reqUrl) };
  return {
    ivr: env.INTRO_MP3_URL,
    digits: 1,
    timeout: 8,
    repeat: 1,
    "1": withParams(new URL("/route/lennart", base), { ...params, ivr_choice: "1" }),
    "2": withParams(new URL("/route/sebastian", base), { ...params, ivr_choice: "2" }),
    next: withParams(new URL("/route/from-ivr", base), params)
  };
}

export function outsideHoursVoicemail(env: Env, reqUrl: URL, payload: ElksPayload) {
  return {
    play: env.OFFICE_HOURS_PROMPT_MP3_URL,
    next: withParams(new URL("/record", reqUrl.origin), {
      callid: callId(payload, reqUrl),
      from: caller(payload, reqUrl),
      ivr_choice: "outside_hours"
    })
  };
}

export function holdThenDial(env: Env, reqUrl: URL, operator: Operator, payload: ElksPayload) {
  return {
    play: env.HOLD_MUSIC_MP3_URL,
    next: withParams(new URL(`/dial/${operator}`, reqUrl.origin), {
      callid: callId(payload, reqUrl),
      from: caller(payload, reqUrl),
      ivr_choice: String(ivrChoice(payload, reqUrl) || reqUrl.searchParams.get("ivr_choice") || "default")
    })
  };
}

export function dial(env: Env, reqUrl: URL, operator: Operator, payload: ElksPayload) {
  const isSebastian = operator === "sebastian" || operator === "sebastian-fallback";
  const number = isSebastian ? env.SEBASTIAN_NUMBER : env.LENNART_NUMBER;
  const callid = callId(payload, reqUrl);
  const from = caller(payload, reqUrl);
  const ivr = String(ivrChoice(payload, reqUrl) || reqUrl.searchParams.get("ivr_choice") || "default");
  const nextPath = operator === "lennart" ? "/dial/sebastian-fallback" : "/voicemail";
  const attempt = isSebastian ? "sebastian" : "lennart";

  return {
    connect: number,
    callerid: env.ELKS_FROM_NUMBER,
    timeout: 25,
    next: withParams(new URL(nextPath, reqUrl.origin), { callid, from, ivr_choice: ivr }),
    whenhangup: withParams(new URL("/event/hangup", reqUrl.origin), {
      callid,
      from,
      ivr_choice: ivr,
      attempt
    })
  };
}

export function voicemailPrompt(env: Env, reqUrl: URL, payload: ElksPayload) {
  return {
    play: env.VOICEMAIL_PROMPT_MP3_URL,
    next: withParams(new URL("/record", reqUrl.origin), {
      callid: callId(payload, reqUrl),
      from: caller(payload, reqUrl),
      ivr_choice: String(ivrChoice(payload, reqUrl) || reqUrl.searchParams.get("ivr_choice") || "default")
    })
  };
}

export function recordVoicemail(reqUrl: URL, payload: ElksPayload) {
  return {
    record: withParams(new URL("/event/voicemail-saved", reqUrl.origin), {
      callid: callId(payload, reqUrl),
      from: caller(payload, reqUrl),
      ivr_choice: String(ivrChoice(payload, reqUrl) || reqUrl.searchParams.get("ivr_choice") || "default")
    }),
    timelimit: 90,
    silencedetection: "no"
  };
}
