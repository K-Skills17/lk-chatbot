import axios, { AxiosInstance } from 'axios';
import { evolutionConfig } from '../../config/evolution';
import { logger } from '../../utils/logger';

export interface EvolutionInstance {
  instanceName: string;
  instanceId: string;
  status: string;
}

export interface SendTextPayload {
  number: string;
  text: string;
  delay?: number; // ms delay before sending (simulate typing)
}

export interface SendButtonPayload {
  number: string;
  title: string;
  description: string;
  footer?: string;
  buttons: Array<{ buttonText: string; buttonId: string }>;
}

export interface SendListPayload {
  number: string;
  title: string;
  description: string;
  buttonText: string;
  footerText?: string;
  sections: Array<{
    title: string;
    rows: Array<{ title: string; description?: string; rowId: string }>;
  }>;
}

/**
 * Evolution API v2 client wrapper.
 * Docs: https://doc.evolution-api.com/v2
 */
export class EvolutionClient {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: evolutionConfig.baseUrl,
      headers: {
        apikey: evolutionConfig.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });
  }

  // ─── Instance Management ─────────────────────────────────

  /** Quick health check — hits root endpoint with a short timeout */
  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const { data } = await this.http.get('/', { timeout: 5_000 });
      return { ok: true, detail: data?.version ?? 'reachable' };
    } catch (err: any) {
      return { ok: false, detail: err?.message };
    }
  }

  /** Create a new WhatsApp instance for a tenant */
  async createInstance(instanceName: string): Promise<EvolutionInstance> {
    const { data } = await this.http.post('/instance/create', {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      webhook: {
        enabled: true,
        url: evolutionConfig.webhookUrl,
        headers: { apikey: evolutionConfig.apiKey },
        webhookByEvents: false,
        webhookBase64: false,
        events: [
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'CONNECTION_UPDATE',
          'QRCODE_UPDATED',
        ],
      },
    });

    logger.info({ instanceName }, 'Evolution instance created');
    return data;
  }

  /** Get connection status of an instance */
  async getInstanceStatus(instanceName: string): Promise<{ state: string }> {
    const { data } = await this.http.get(
      `/instance/connectionState/${instanceName}`,
    );
    // Evolution API v2 nests the state: { instance: { state: "open" } }
    const state = data?.instance?.state ?? data?.state ?? 'unknown';
    return { state };
  }

  /** Connect instance (triggers QR code) */
  async connectInstance(instanceName: string): Promise<{ code: string; base64: string }> {
    const { data } = await this.http.get(`/instance/connect/${instanceName}`);
    // Normalize: Evolution v2 may return flat or nested under a key
    const code = data?.code ?? data?.pairingCode ?? '';
    const base64 = data?.base64 ?? data?.qrcode?.base64 ?? '';
    logger.info({ instanceName, hasCode: !!code, hasBase64: !!base64 }, 'Connect instance response');
    return { code, base64 };
  }

  /** Disconnect / logout instance */
  async logoutInstance(instanceName: string): Promise<void> {
    await this.http.delete(`/instance/logout/${instanceName}`);
    logger.info({ instanceName }, 'Evolution instance logged out');
  }

  /** Delete instance entirely — short timeout so caller is not blocked if Evolution is unreachable */
  async deleteInstance(instanceName: string): Promise<void> {
    await this.http.delete(`/instance/delete/${instanceName}`, { timeout: 5_000 });
    logger.info({ instanceName }, 'Evolution instance deleted');
  }

  /** List all instances */
  async listInstances(): Promise<EvolutionInstance[]> {
    const { data } = await this.http.get('/instance/fetchInstances');
    return data;
  }

  // ─── Messaging ───────────────────────────────────────────

  /** Send a plain text message */
  async sendText(instanceName: string, payload: SendTextPayload): Promise<any> {
    const { data } = await this.http.post(
      `/message/sendText/${instanceName}`,
      {
        number: payload.number,
        text: payload.text,
        delay: payload.delay ?? 1500, // default 1.5s delay
      },
    );

    logger.debug({ instanceName, to: payload.number }, 'Text message sent');
    return data;
  }

  /** Send interactive button message */
  async sendButtons(instanceName: string, payload: SendButtonPayload): Promise<any> {
    const { data } = await this.http.post(
      `/message/sendButtons/${instanceName}`,
      payload,
    );
    return data;
  }

  /** Send interactive list message */
  async sendList(instanceName: string, payload: SendListPayload): Promise<any> {
    const { data } = await this.http.post(
      `/message/sendList/${instanceName}`,
      payload,
    );
    return data;
  }

  /** Send a media message (image, document, audio) */
  async sendMedia(
    instanceName: string,
    number: string,
    mediaType: 'image' | 'document' | 'audio' | 'video',
    mediaUrl: string,
    caption?: string,
  ): Promise<any> {
    const { data } = await this.http.post(
      `/message/sendMedia/${instanceName}`,
      {
        number,
        mediatype: mediaType,
        media: mediaUrl,
        caption,
      },
    );
    return data;
  }

  // ─── Webhook Configuration ──────────────────────────────

  /** Set webhook URL for an instance */
  async setWebhook(instanceName: string, webhookUrl: string): Promise<void> {
    // Evolution API v2 requires the payload wrapped under a "webhook" key
    await this.http.post(`/webhook/set/${instanceName}`, {
      webhook: {
        enabled: true,
        url: webhookUrl,
        headers: { apikey: evolutionConfig.apiKey },
        webhookByEvents: false,
        webhookBase64: false,
        events: [
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'CONNECTION_UPDATE',
        ],
      },
    });

    logger.info({ instanceName, webhookUrl }, 'Webhook configured');
  }
}

// Singleton
export const evolutionClient = new EvolutionClient();
