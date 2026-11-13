export type JobStatus = 'QUEUED' | 'DISPATCHED' | 'PRINTING' | 'ACK' | 'FAILED';

export type PayloadType = 'JSON_RECEIPT' | 'RAW_TEXT' | 'HTML';

export type PlanTier = 'STARTER' | 'GROWTH';

export type SubscriptionStatus =
  | 'ACTIVE'
  | 'TRIALING'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'PAUSED';

export type PaperWidthMm = 58 | 80;

export type MonthlyPriceCents = 2900 | 9900;

export interface Organization {
  id: string;
  name: string;
  plan_tier: PlanTier;
  subscription_status: SubscriptionStatus;
  paddle_customer_id: string | null;
  paddle_subscription_id: string | null;
  monthly_price_cents: MonthlyPriceCents;
  current_period_end: string | null;
  created_at: string;
}

export interface BillingEvent {
  id: string;
  event_id: string;
  org_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  processed_at: string;
}

export interface ApiKey {
  id: string;
  org_id: string;
  key_prefix: string;
  key_hash: string;
  last_used_at: string | null;
  created_at: string;
}

export interface ApiKeyWithMeta extends ApiKey {
  name: string;
}

export interface Printer {
  id: string;
  org_id: string;
  name: string;
  pairing_code: string | null;
  paper_width_mm: PaperWidthMm;
  is_online: boolean;
  last_seen_at: string | null;
  created_at: string;
}

export interface PrintJob {
  id: string;
  org_id: string;
  printer_id: string;
  idempotency_key: string;
  payload_type: PayloadType;
  payload: Record<string, unknown>;
  status: JobStatus;
  error_message: string | null;
  created_at: string;
  acked_at: string | null;
}

// Snake_case schema aliases matching schema.sql identifiers
export type job_status = JobStatus;
export type payload_type = PayloadType;
export type plan_tier = PlanTier;
export type subscription_status = SubscriptionStatus;
export type organizations = Organization;
export type billing_events = BillingEvent;
export type api_keys = ApiKey;
export type printers = Printer;
export type print_jobs = PrintJob;

export interface DispatchedJobFrame {
  type: 'DISPATCHED';
  job_id: string;
  printer_id: string;
  payload_type: PayloadType;
  payload: Record<string, unknown>;
  status: 'DISPATCHED';
  created_at: string;
}
