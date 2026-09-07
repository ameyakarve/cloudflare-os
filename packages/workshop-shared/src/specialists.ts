/** Trusted deployment configuration. Absent configuration disables delegation. */
export interface DeploymentSpecialists {
  /** Configuration schema version. */
  version: 1;
  /** Deployment-owned, domain-neutral-to-the-kernel specialist definitions. */
  profiles: SpecialistProfile[];
}

/** A bounded agent with deployment-owned instructions and explicit intent capabilities. */
export interface SpecialistProfile {
  /** Stable identifier, unique within the deployment. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Trusted system instructions; never supplied by the coordinator. */
  instructions: string;
  /** Available mutually exclusive capability sets. */
  intents: SpecialistIntent[];
  /** Maximum model turns, 1–12. */
  maxTurns: number;
}

/** One task scope. Only these methods of existing chat gatekeeper bindings are callable. */
export interface SpecialistIntent {
  /** Stable identifier within a profile. */
  id: string;
  /** Task selection guidance for the coordinator. */
  description: string;
  /** Chat binding name to allowed top-level RPC method names. No capability-valued results. */
  bindings: Record<string, string[]>;
}

/** Runtime-owned evidence; not an agent assertion or a reusable grant of authority. */
export interface SpecialistRecord {
  /** Workspace-local opaque record identifier. */
  id: string;
  /** Root execution identifier, independent of quota-policy availability. */
  rootId: string;
  /** Originating coordinator chat. */
  rootChatId: number;
  /** Child chat, present for delegation, code and method-call records. */
  childChatId?: number;
  /** Containing delegation/code record. */
  parentId?: string;
  /** Record category. */
  kind: 'root' | 'delegation' | 'code' | 'call';
  /** Prepared is durable before dispatch; unknown must never be replayed automatically. */
  status: 'prepared' | 'running' | 'completed' | 'failed' | 'unknown' | 'pending-approval';
  /** Creation time in milliseconds since epoch. */
  createdAt: number;
  /** Last host update time in milliseconds since epoch. */
  updatedAt: number;
  /** Frozen selected profile. */
  profileId?: string;
  /** Frozen selected intent. */
  intentId?: string;
  /** Required method permissions; informational, never authority on reuse. */
  bindings?: Record<string, string[]>;
  /** Coordinator task, executed JavaScript, or JSON method arguments, at most 32 Ki characters. */
  source?: string;
  /** Bounded host-captured output or final child text, at most 16 Ki characters. */
  result?: string;
  /** Whether the result was truncated. */
  truncated?: boolean;
  /** Binding method for a call record. */
  method?: string;
  /** Canonical workspace action IDs captured by the host (not supplied by a model). */
  actionIds?: number[];
  /** More than 128 captured action references; outcome is unknown and needs canonical reconciliation. */
  actionIdsTruncated?: boolean;
  /** Existing quota run ID, when the deployment enables quota enforcement. */
  usageRunId?: string;
  /** Original quota deadline; child execution never extends this. */
  expiresAt?: number;
}
