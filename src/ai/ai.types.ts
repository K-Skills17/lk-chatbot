// ── Provider Interface ──────────────────────────────────────

export interface AiProvider {
  chat(request: AiChatRequest): Promise<AiChatResponse>;
}

export interface AiChatRequest {
  systemPrompt: string;
  messages: AiMessage[];
  model: string;
  temperature: number;
  maxTokens?: number;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// ── Model Tier ──────────────────────────────────────────────

export type ModelTier = 'fast' | 'smart';

// ── Conversation State ──────────────────────────────────────

export type ConversationState =
  | 'greeting'
  | 'qualifying'
  | 'qualified'
  | 'booking'
  | 'awaiting_review'
  | 'closed';

// ── Concierge Stage (granular PT-BR stages) ─────────────────

export type ConciergeStage =
  | 'saudacao' | 'descoberta' | 'qualificacao' | 'valor'
  | 'agendamento' | 'encaminhamento' | 'encerramento';

// ── Conversation Context (stored in conversation.context JSON) ──

export interface ConversationContext {
  state: ConversationState;
  extractedData: Record<string, any>;
  qualificationComplete: boolean;
  lastSummary?: string;
  messageCount: number;
  pendingReviewId?: string; // Review ID when awaiting rating response
}

// ── AI Structured Response ──────────────────────────────────

export interface AiAction {
  replyText: string;
  nextState?: ConversationState;
  extractedData?: Record<string, any>;
  leadScore?: number;
  leadStatus?: 'new' | 'qualifying' | 'qualified' | 'booked' | 'lost';
  shouldEscalate?: boolean;
  qualificationReasoning?: string;
  bookingDate?: string; // ISO date string when AI confirms a booking
  bookingTime?: string; // HH:mm when AI confirms a booking
}

// ── Job Data (matches what webhook.handler.ts enqueues) ─────

export interface MessageJobData {
  tenantId: string;
  contactId: string;
  conversationId: string;
  phone: string;
  text: string | null;
  messageType: string;
  senderName: string | null;
  /** Present when messageType === 'image' — used to fetch full media from Evolution API */
  imageMessageKey?: { remoteJid: string; fromMe: boolean; id: string };
  /** MIME type reported by WhatsApp for the image (e.g. 'image/jpeg') */
  imageMimeType?: string;
  /** Base64 thumbnail included in the webhook payload (low-res fallback) */
  imageThumbnailBase64?: string;
}
