export type AppRoute =
  | 'home'
  | 'workforce-journey'
  | 'agentic-transaction'
  | 'data-byok'
  | 'resilience-tabletop';

export type ExecutionMode = 'sandbox' | 'live-contract';

export type JourneyStage = 1 | 2 | 3;

export type AgentPersona = 'erp-operator' | 'support-agent';

export type ErpProcessStage = 'credit' | 'order' | 'fulfillment' | 'invoice' | 'cash';

export type ErpRecordStatus = 'BLOCKED' | 'PROCESSING' | 'RELEASED';

export interface ErpExceptionRecord {
  sys_id: string;
  order_id: string;
  customer_id: string;
  customer_name: string;
  process: ErpProcessStage;
  amount_usd: number;
  credit_limit_usd: number;
  current_exposure_usd: number;
  risk_tier: 'LOW' | 'MEDIUM' | 'HIGH';
  days_past_due: number;
  current_status: ErpRecordStatus;
  correlation_id: string;
  aws_request_id: string;
  ai_justification: string;
  updated_at: string;
  updated_by: string;
}

export interface TokenExchangeBundle {
  correlation_id: string;
  traceparent: string;
  user_email: string;
  persona: AgentPersona;
  inbound_auth0_jwt: {
    header: Record<string, string>;
    payload: Record<string, unknown>;
    raw_token_preview: string;
    stripped_at_frontdoor: boolean;
  };
  okta_id_jag_jwt: {
    header: Record<string, string>;
    payload: Record<string, unknown>;
    raw_jwt: string;
    sha256_fingerprint: string;
  };
  gcp_oidc_token: {
    service_account: string;
    audience: string;
    payload: Record<string, unknown>;
  };
  aws_sts_session: {
    assumed_role_arn: string;
    session_name: string;
    access_key_id: string;
    expiration: string;
    invariants_verified: string[];
  };
  status: 'VALIDATED' | 'ATTACK_BLOCKED';
  error_code?: string;
  error_detail?: string;
}

export interface McpEvaluationResult {
  correlation_id: string;
  traceparent: string;
  jsonrpc_request: {
    jsonrpc: '2.0';
    id: string;
    method: 'tools/call';
    params: {
      name: string;
      arguments: Record<string, unknown>;
      _meta: {
        persona: AgentPersona;
        correlation_id: string;
        traceparent: string;
      };
    };
  };
  jsonrpc_response: Record<string, unknown>;
  rbac_status: 'PASS' | 'DENY';
  dlp_status: 'PASS' | 'BLOCK';
  dlp_matched_rule?: string;
  hitl_status: 'AUTO_APPROVED' | 'PENDING_HUMAN_APPROVAL' | 'N/A';
  hitl_ticket_id?: string;
  overall_decision: 'ALLOWED' | 'DENIED_RBAC' | 'DENIED_DLP' | 'ESCALATED_HITL';
}

export interface ServiceNowAuditEvent {
  event_id: string;
  timestamp: string;
  process: ErpProcessStage;
  order_id: string;
  source_table: string;
  event_type: 'BUTTON' | 'BEDROCK_RESULT' | 'CALLBACK' | 'SECURITY_BLOCK';
  correlation_id: string;
  aws_request_id: string;
  http_status: number;
  decision: string;
  actor: string;
  note: string;
}

export interface SysAuditEntry {
  sys_id: string;
  timestamp: string;
  tablename: string;
  documentkey: string;
  fieldname: string;
  oldvalue: string;
  newvalue: string;
  user: string;
}

export interface TelemetryLogEntry {
  id: string;
  timestamp: string;
  stage: JourneyStage;
  layer: 'OKTA_ID_JAG' | 'GCP_AWS_OBO' | 'MCP_GOVERNANCE' | 'SERVICENOW_BEDROCK' | 'HITL_CALLBACK' | 'STATE_RESET';
  severity: 'INFO' | 'SUCCESS' | 'WARN' | 'CRITICAL';
  title: string;
  correlation_id: string;
  traceparent: string;
  aws_request_id?: string;
  payload: Record<string, unknown>;
}

export interface PlaygroundState {
  initialized_at: string;
  last_weekly_reset_utc: string;
  next_weekly_reset_utc: string;
  mode: ExecutionMode;
  active_stage: JourneyStage;
  persona: AgentPersona;
  selected_order_id: string;
  active_erp_tab: ErpProcessStage;
  correlation_id: string;
  traceparent: string;
  token_bundle: TokenExchangeBundle | null;
  mcp_result: McpEvaluationResult | null;
  bedrock_sigv4_inspection: {
    endpoint: string;
    model_id: string;
    canonical_headers: Record<string, string>;
    authorization_header_masked: string;
    aws_request_id: string;
    advisory_summary: string;
    http_status: number;
  } | null;
  erp_records: ErpExceptionRecord[];
  sn_audit_events: ServiceNowAuditEvent[];
  sys_audit_log: SysAuditEntry[];
  telemetry_stream: TelemetryLogEntry[];
}

export interface ObservabilitySpan {
  id: string;
  traceparent: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  session_id: string;
  method: string;
  path: string;
  status: number;
  latency_ms: number;
  timestamp: string;
  otlp_export: 'configured' | 'in-lab-only';
  redacted_auth_header: string | null;
  redaction_applied: boolean;
  execution_origin: 'cloudflare-edge' | 'browser-webcrypto-fallback';
  response_summary: Record<string, unknown>;
}

export type WorkforceJourneyPersonaId =
  | 'alex-chen'
  | 'sarah-lin'
  | 'jordan-patel'
  | 'maya-lin'
  | 'marcus-chen'
  | 'priya-nair';

export type WorkforceJourneyRole = 'Viewer' | 'Payment Creator' | 'Audit Approver';

export interface WorkforceJourneyScimRecord {
  schemas: string[];
  id: string;
  userName: string;
  displayName: string;
  department: string;
  active: boolean;
  status: 'ACTIVE' | 'REVOKED';
  roles: string[];
  active_jtis: string[];
  provisioned_at: string;
  revoked_at?: string;
  idp_adapter: string;
  entra_oid?: string;
  privileged_group_active?: boolean;
  graph_request_id?: string;
}

export interface WorkforceJourneyDecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export type WorkforceJourneyJitRequestStatus = 'PENDING' | 'APPROVED' | 'DENIED';

export type WorkforceJourneyJitDecisionAction = 'approve' | 'deny' | 'grant_permanent';

export interface WorkforceJourneyJitRequestRecord {
  request_id: string;
  session_id: string;
  status: WorkforceJourneyJitRequestStatus;
  requester: {
    sub: string;
    email: string;
    name: string;
    department: string;
    base_roles: string[];
    session_jti: string;
    entra_oid?: string;
  };
  requested_roles: string[];
  requested_scope: 'admin:temp';
  justification: string;
  ttl_seconds: number;
  sod_check: {
    rule_id: 'SOD-FIN-001';
    status: 'PASS';
    checked_at: string;
  };
  idp_mode: 'edge-webcrypto' | 'entra-external-id';
  created_at: string;
  decided_at?: string;
  decided_by?: string;
  decision_reason?: string;
  jit_jti?: string;
}

export interface WorkforceJourneyJitSubmitData {
  status?: 'PENDING' | string;
  error?: string;
  code?: string;
  rule_id?: string;
  policy?: string;
  message?: string;
  request_id?: string;
  sod_status?: 'PASS' | 'FAIL' | string;
  ttl_seconds?: number;
  kv_ttl_seconds?: number;
  max_ttl_seconds?: number;
  requested_ttl_seconds?: number;
  conflicting_roles?: string[];
  existing_roles?: string[];
  requested_roles?: string[];
  storage?: string;
  idp_mode?: string;
  request?: WorkforceJourneyJitRequestRecord;
}

export interface WorkforceJourneyJitDecisionData {
  status?: 'JIT_GRANTED' | 'JIT_DENIED' | string;
  error?: string;
  code?: string;
  policy?: string;
  rule_id?: string;
  message?: string;
  request_id?: string;
  approved_by?: string;
  approved_by_name?: string;
  denied_by?: string;
  denied_by_name?: string;
  reason?: string;
  justification?: string;
  expires_in?: number;
  jit_jwt?: string;
  decoded_claims?: WorkforceJourneyDecodedJwt;
  scim_record?: WorkforceJourneyScimRecord | null;
  idp_mode?: string;
  storage?: string;
  external_sync?: string;
  graph_request_id?: string;
  pam_api_status?: string;
  request?: WorkforceJourneyJitRequestRecord;
}

