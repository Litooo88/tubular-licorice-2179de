export interface Env {
  DB: D1Database;
  CALLFLOW_KV: KVNamespace;
  ELKS_USERNAME: string;
  ELKS_PASSWORD: string;
  ELKS_FROM_NUMBER: string;
  SMS_SENDER?: string;
  ELKS_WEBHOOK_SECRET?: string;
  ELKS_ALLOWED_IPS?: string;
  REQUIRE_ELKS_SIGNATURE?: string;
  SEBASTIAN_NUMBER: string;
  WORKSHOP_NUMBER: string;
  ADMIN_KEY?: string;
  APPS_SCRIPT_WEBHOOK_URL?: string;
  INTRO_MP3_URL: string;
  HOLD_MUSIC_MP3_URL: string;
  VOICEMAIL_PROMPT_MP3_URL: string;
  OFFICE_HOURS_PROMPT_MP3_URL: string;
}

export interface ElksPayload {
  callid?: string;
  id?: string;
  from?: string;
  to?: string;
  direction?: string;
  created?: string;
  result?: string;
  why?: string;
  state?: string;
  duration?: string;
  actions?: string;
  wav?: string;
}

export interface CallLogRow {
  timestamp?: string;
  callid: string;
  caller_e164: string;
  duration_s?: number | null;
  answered_by?: "sebastian" | "workshop" | "voicemail" | "missed" | null;
  status: "started" | "answered" | "missed" | "voicemail" | "rejected" | "route";
  ivr_choice?: "1" | "2" | "default" | "outside_hours" | null;
  recording_url?: string | null;
}

export type Operator = "sebastian" | "sebastian-fallback" | "workshop";
