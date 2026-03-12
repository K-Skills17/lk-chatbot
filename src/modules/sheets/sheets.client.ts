import { logger } from '../../utils/logger';

/**
 * Google Sheets client using Service Account authentication.
 *
 * Setup (one-time):
 * 1. Go to https://console.cloud.google.com → Create project → Enable Google Sheets API
 * 2. Create a Service Account → Download JSON key file
 * 3. Set GOOGLE_SHEETS_CLIENT_EMAIL and GOOGLE_SHEETS_PRIVATE_KEY env vars from the JSON key
 * 4. In your Google Sheet, click "Share" and add the service account email as Editor
 * 5. Copy the Sheet ID from the URL and save it in tenant.bookingConfig.googleSheets.sheetId
 *
 * That's it — no OAuth consent screen, no redirect URIs, no user login.
 */

// Lazy-load googleapis to avoid slow startup
function getGoogle() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('googleapis').google as typeof import('googleapis').google;
}

export interface SheetsConfig {
  sheetId: string;
  sheetName?: string; // defaults to "Leads"
}

interface LeadRow {
  date: string;
  name: string;
  phone: string;
  email?: string;
  leadScore: number;
  leadStatus: string;
  source?: string;
  qualificationData?: string;
  notes?: string;
}

export class SheetsClient {
  private sheets: any;
  private spreadsheetId: string;
  private sheetName: string;

  constructor(config: SheetsConfig) {
    const google = getGoogle();

    const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;

    if (!clientEmail || !privateKey) {
      throw new Error(
        'GOOGLE_SHEETS_CLIENT_EMAIL and GOOGLE_SHEETS_PRIVATE_KEY must be set. ' +
        'Create a Service Account at https://console.cloud.google.com and download the JSON key.',
      );
    }

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
    this.spreadsheetId = config.sheetId;
    this.sheetName = config.sheetName ?? 'Leads';
  }

  /** Ensure the header row exists, creating it if needed */
  async ensureHeaders(): Promise<void> {
    try {
      const res = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${this.sheetName}!A1:I1`,
      });

      const existing = res.data.values?.[0];
      if (existing && existing.length > 0) return; // Headers already exist
    } catch (err: any) {
      // Sheet tab might not exist — try to create it
      if (err.code === 400 || err.message?.includes('Unable to parse range')) {
        logger.info({ sheetName: this.sheetName }, 'Sheet tab not found, will write headers');
      }
    }

    const headers = [
      'Data', 'Nome', 'Telefone', 'Email', 'Score',
      'Status', 'Origem', 'Dados de Qualificação', 'Notas',
    ];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `${this.sheetName}!A1:I1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });

    logger.info('Sheet headers created');
  }

  /** Append a lead row to the sheet */
  async appendLead(lead: LeadRow): Promise<void> {
    const row = [
      lead.date,
      lead.name,
      lead.phone,
      lead.email ?? '',
      lead.leadScore,
      lead.leadStatus,
      lead.source ?? '',
      lead.qualificationData ?? '',
      lead.notes ?? '',
    ];

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${this.sheetName}!A:I`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    logger.debug({ phone: lead.phone }, 'Lead appended to Google Sheet');
  }
}

/**
 * Build a SheetsClient for a tenant if configured.
 * Returns null if Google Sheets is not set up.
 */
export function getSheetsClient(bookingConfig: any): SheetsClient | null {
  const sheetId = bookingConfig?.googleSheets?.sheetId;
  if (!sheetId) return null;

  if (!process.env.GOOGLE_SHEETS_CLIENT_EMAIL || !process.env.GOOGLE_SHEETS_PRIVATE_KEY) {
    logger.warn('Google Sheets configured for tenant but service account env vars are missing');
    return null;
  }

  return new SheetsClient({
    sheetId,
    sheetName: bookingConfig.googleSheets.sheetName,
  });
}
