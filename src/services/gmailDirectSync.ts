// ==========================================
// 📧 gmailDirectSync.ts — Gmail sync directo via API
// Usa Gmail REST API con OAuth2 desde el navegador
// ==========================================

const STORAGE_KEY_TOKEN = 'arume_gmail_token';
const STORAGE_KEY_CLIENT = 'arume_gmail_client_id';
const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me';
const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify';

// ── Tipos ──

export interface GmailAttachment {
  filename: string;
  mimeType: string;
  base64: string;   // contenido del archivo
  size: number;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  attachments: GmailAttachment[];
}

export interface GmailToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  email?: string;
}

export interface GmailSyncResult {
  emails: GmailMessage[];
  total: number;
  pdfs: number;
  error?: string;
}

// ── Servicio Principal ──

export class GmailDirectSync {

  // ── Auth ──

  static getClientId(): string {
    return localStorage.getItem(STORAGE_KEY_CLIENT) || '';
  }

  static setClientId(clientId: string): void {
    localStorage.setItem(STORAGE_KEY_CLIENT, clientId.trim());
  }

  static getToken(): GmailToken | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_TOKEN);
      if (!stored) return null;
      return JSON.parse(stored);
    } catch { return null; }
  }

  static saveToken(token: GmailToken): void {
    localStorage.setItem(STORAGE_KEY_TOKEN, JSON.stringify(token));
  }

  static clearToken(): void {
    localStorage.removeItem(STORAGE_KEY_TOKEN);
  }

  static isAuthenticated(): boolean {
    const token = GmailDirectSync.getToken();
    if (!token) return false;
    return token.expires_at > Date.now();
  }

  /**
   * Inicia el flujo OAuth2 con Google.
   * Abre un popup para que el usuario autorice acceso a Gmail.
   * Requiere un Google Cloud Client ID configurado.
   */
  static async authorize(): Promise<GmailToken | null> {
    const clientId = GmailDirectSync.getClientId();
    if (!clientId) {
      throw new Error('NO_CLIENT_ID');
    }

    return new Promise((resolve, reject) => {
      // Construir URL de autorización
      const redirectUri = window.location.origin;
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'token');
      authUrl.searchParams.set('scope', SCOPES);
      authUrl.searchParams.set('prompt', 'consent');
      authUrl.searchParams.set('include_granted_scopes', 'true');

      // Abrir popup
      const popup = window.open(
        authUrl.toString(),
        'gmail_auth',
        'width=500,height=700,left=200,top=100'
      );

      if (!popup) {
        reject(new Error('POPUP_BLOCKED'));
        return;
      }

      // Polling para detectar cuando el popup vuelve con el token
      const interval = setInterval(() => {
        try {
          if (popup.closed) {
            clearInterval(interval);
            const token = GmailDirectSync.getToken();
            resolve(token);
            return;
          }

          const popupUrl = popup.location.href;
          if (popupUrl.startsWith(redirectUri)) {
            clearInterval(interval);

            // Extraer token del hash
            const hash = popup.location.hash.substring(1);
            const params = new URLSearchParams(hash);
            const accessToken = params.get('access_token');
            const expiresIn = parseInt(params.get('expires_in') || '3600');

            popup.close();

            if (accessToken) {
              const token: GmailToken = {
                access_token: accessToken,
                expires_at: Date.now() + expiresIn * 1000,
              };
              GmailDirectSync.saveToken(token);
              // Fetch user email
              GmailDirectSync._fetchProfile(accessToken).then(email => {
                if (email) {
                  token.email = email;
                  GmailDirectSync.saveToken(token);
                }
              });
              resolve(token);
            } else {
              resolve(null);
            }
          }
        } catch {
          // Cross-origin — ignorar hasta que vuelva a nuestro dominio
        }
      }, 500);

      // Timeout de 2 minutos
      setTimeout(() => {
        clearInterval(interval);
        if (!popup.closed) popup.close();
        resolve(null);
      }, 120_000);
    });
  }

  private static async _fetchProfile(token: string): Promise<string | null> {
    try {
      const res = await fetch(`${GMAIL_API}/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.emailAddress || null;
    } catch { return null; }
  }

  // ── Fetch de emails ──

  /**
   * Busca emails no leídos con adjuntos PDF en Gmail.
   * Devuelve los mensajes con sus PDFs extraídos en base64.
   */
  static async fetchNewEmails(maxResults = 20): Promise<GmailSyncResult> {
    const token = GmailDirectSync.getToken();
    if (!token || token.expires_at < Date.now()) {
      return { emails: [], total: 0, pdfs: 0, error: 'Token expirado — re-autoriza Gmail' };
    }

    const headers = { Authorization: `Bearer ${token.access_token}` };

    try {
      // 1. Listar mensajes no leídos con adjuntos
      const query = 'is:unread has:attachment filename:pdf';
      const listRes = await fetch(
        `${GMAIL_API}/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
        { headers }
      );

      if (listRes.status === 401) {
        GmailDirectSync.clearToken();
        return { emails: [], total: 0, pdfs: 0, error: 'Token inválido — re-autoriza Gmail' };
      }

      if (!listRes.ok) {
        return { emails: [], total: 0, pdfs: 0, error: `Error Gmail API: ${listRes.status}` };
      }

      const listData = await listRes.json();
      const messageIds: string[] = (listData.messages || []).map((m: any) => m.id);

      if (messageIds.length === 0) {
        return { emails: [], total: 0, pdfs: 0 };
      }

      // 2. Obtener cada mensaje completo
      const emails: GmailMessage[] = [];
      let totalPdfs = 0;

      for (const msgId of messageIds) {
        try {
          const msg = await GmailDirectSync._fetchFullMessage(msgId, headers);
          if (msg && msg.attachments.length > 0) {
            emails.push(msg);
            totalPdfs += msg.attachments.length;
          }
        } catch (err) {
          console.warn(`[GmailSync] Error fetching message ${msgId}:`, err);
        }
      }

      return { emails, total: emails.length, pdfs: totalPdfs };

    } catch (err: any) {
      return { emails: [], total: 0, pdfs: 0, error: err?.message || 'Error desconocido' };
    }
  }

  /**
   * Obtiene un mensaje completo con sus adjuntos PDF
   */
  private static async _fetchFullMessage(
    messageId: string,
    headers: Record<string, string>
  ): Promise<GmailMessage | null> {
    const res = await fetch(`${GMAIL_API}/messages/${messageId}?format=full`, { headers });
    if (!res.ok) return null;

    const data = await res.json();
    const hdrs = data.payload?.headers || [];
    const from = hdrs.find((h: any) => h.name === 'From')?.value || '';
    const subject = hdrs.find((h: any) => h.name === 'Subject')?.value || '';
    const dateStr = hdrs.find((h: any) => h.name === 'Date')?.value || '';

    // Extraer adjuntos PDF
    const attachments: GmailAttachment[] = [];
    await GmailDirectSync._extractPdfs(data.payload, messageId, headers, attachments);

    return {
      id: messageId,
      threadId: data.threadId,
      from,
      subject,
      date: GmailDirectSync._parseDate(dateStr),
      attachments,
    };
  }

  /**
   * Recorre recursivamente las partes del mensaje buscando PDFs
   */
  private static async _extractPdfs(
    part: any,
    messageId: string,
    headers: Record<string, string>,
    attachments: GmailAttachment[]
  ): Promise<void> {
    if (!part) return;

    // Si esta parte es un PDF con attachmentId, descargarlo
    if (
      part.filename &&
      part.filename.toLowerCase().endsWith('.pdf') &&
      part.body?.attachmentId
    ) {
      try {
        const attRes = await fetch(
          `${GMAIL_API}/messages/${messageId}/attachments/${part.body.attachmentId}`,
          { headers }
        );
        if (attRes.ok) {
          const attData = await attRes.json();
          // Gmail devuelve base64url, convertir a base64 estándar
          const base64 = (attData.data || '')
            .replace(/-/g, '+')
            .replace(/_/g, '/');
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType || 'application/pdf',
            base64,
            size: attData.size || 0,
          });
        }
      } catch (err) {
        console.warn(`[GmailSync] Error descargando adjunto ${part.filename}:`, err);
      }
    }

    // Recorrer sub-partes
    if (part.parts) {
      for (const subPart of part.parts) {
        await GmailDirectSync._extractPdfs(subPart, messageId, headers, attachments);
      }
    }
  }

  /**
   * Marca un mensaje como leído en Gmail
   */
  static async markAsRead(messageId: string): Promise<boolean> {
    const token = GmailDirectSync.getToken();
    if (!token) return false;

    try {
      const res = await fetch(`${GMAIL_API}/messages/${messageId}/modify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Helpers ──

  private static _parseDate(dateStr: string): string {
    try {
      const d = new Date(dateStr);
      return d.toISOString().split('T')[0];
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  }

  /**
   * Convierte los emails de Gmail al formato EmailDraft que usa InvoicesView
   */
  static toEmailDrafts(messages: GmailMessage[]): Array<{
    id: string;
    from: string;
    subject: string;
    date: string;
    hasAttachment: boolean;
    status: 'new';
    fileBase64: string;
    fileName: string;
  }> {
    const drafts: any[] = [];
    for (const msg of messages) {
      for (const att of msg.attachments) {
        drafts.push({
          id: `gmail-${msg.id}-${att.filename}`,
          from: msg.from,
          subject: msg.subject,
          date: msg.date,
          hasAttachment: true,
          status: 'new' as const,
          fileBase64: att.base64,
          fileName: att.filename,
        });
      }
    }
    return drafts;
  }
}
