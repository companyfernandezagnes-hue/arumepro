import { AppData } from '../types';

export class NotificationService {
  /**
   * Envía una alerta directamente a Telegram via Bot API
   */
  static async sendAlert(
    data: AppData,
    message: string,
    type: 'INFO' | 'WARNING' | 'CRITICAL' = 'INFO',
    actionButton?: { text: string, url: string }
  ) {
    const token = data.config.telegramToken;
    const chatId = data.config.telegramChatId;

    if (!token || !chatId) {
      console.warn("⚠️ No hay token/chatId de Telegram configurados para alertas.");
      return;
    }

    try {
      const icon = type === 'CRITICAL' ? '🔴' : type === 'WARNING' ? '🟡' : 'ℹ️';
      const restaurant = data.config.empresa || 'Arume ERP';
      const text = `${icon} *${restaurant}*\n\n${message}`;

      const payload: any = {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_notification: type === 'INFO',
      };

      // Si le pasamos un botón, lo convertimos en un Inline Keyboard de Telegram
      if (actionButton) {
        payload.reply_markup = {
          inline_keyboard: [[actionButton]]
        };
      }

      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error('Error enviando notificación a Telegram');

      console.log(`✅ Notificación [${type}] enviada con éxito via Telegram API.`);
    } catch (error) {
      console.error("❌ Error en NotificationService:", error);
    }
  }

  /**
   * Verifica stocks críticos y envía alertas automáticas
   */
  static async checkCriticalStock(data: AppData) {
    const criticalItems = data.ingredientes.filter(i => i.stock <= i.min);

    if (criticalItems.length > 0) {
      const message = `🚨 *ALERTA DE STOCK CRÍTICO*\n\nHay ${criticalItems.length} productos bajo mínimos:\n` +
        criticalItems.slice(0, 5).map(i => `- ${i.n}: ${i.stock} ${i.unit}`).join('\n') +
        (criticalItems.length > 5 ? `\n...y ${criticalItems.length - 5} más.` : '');

      const appUrl = data.config.appUrl || 'https://tu-erp.com';
      await this.sendAlert(data, message, 'WARNING', {
        text: "📦 Abrir Lista de la Compra",
        url: `${appUrl}/?tab=inventario`
      });
    }
  }

  /**
   * Notifica un cierre de caja con descuadre
   */
  static async notifyCajaDescuadre(data: AppData, fecha: string, descuadre: number) {
    if (Math.abs(descuadre) > 5) { // Solo si el descuadre es mayor a 5€
      const icon = descuadre > 0 ? '🟢' : '🔴';
      const warningText = descuadre > 0 ? 'Sobran' : 'Faltan';

      const message = `${icon} *DESCUADRE DE CAJA DETECTADO*\n\n` +
                      `📅 Fecha: ${fecha}\n` +
                      `💸 Importe: *${descuadre > 0 ? '+' : ''}${descuadre.toFixed(2)}€* (${warningText})\n\n` +
                      `La IA detectó una diferencia entre el ticket y el sobre físico. Revísalo.`;

      const appUrl = data.config.appUrl || 'https://tu-erp.com';
      await this.sendAlert(data, message, 'WARNING', {
        text: "🔍 Revisar Arqueo en la App",
        url: `${appUrl}/?tab=cajas`
      });
    }
  }
}
