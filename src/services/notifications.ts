import { AppData } from '../types';

export class NotificationService {
  /**
   * Envía una alerta al webhook de n8n para que este la procese y la envíe a Telegram
   */
  static async sendAlert(
    data: AppData, 
    message: string, 
    type: 'INFO' | 'WARNING' | 'CRITICAL' = 'INFO',
    actionButton?: { text: string, url: string } // 🚀 MEJORA VIP: Soporte para botones en Telegram
  ) {
    const n8nUrl = data.config.n8nUrlIA; // Usamos el mismo webhook de IA o uno específico si existiera
    
    if (!n8nUrl) {
      console.warn("⚠️ No hay URL de n8n configurada para alertas.");
      return;
    }

    try {
      const payload: any = {
        type: 'NOTIFICATION',
        alertType: type,
        message: message,
        timestamp: new Date().toISOString(),
        restaurant: data.config.empresa || 'Arume ERP',
        telegramChatId: data.config.telegramChatId
      };

      // 🚀 MEJORA VIP: Si le pasamos un botón, n8n lo convertirá en un "Inline Keyboard" de Telegram
      if (actionButton) {
        payload.replyMarkup = {
          inline_keyboard: [[actionButton]]
        };
      }

      const response = await fetch(n8nUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error('Error enviando notificación a n8n');
      
      console.log(`✅ Notificación [${type}] enviada con éxito.`);
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
      
      // 🚀 AÑADIDO: Botón directo al inventario
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
      // 🚀 MEJORA: Hacemos el texto más visual indicando si falta o sobra dinero
      const icon = descuadre > 0 ? '🟢' : '🔴';
      const warningText = descuadre > 0 ? 'Sobran' : 'Faltan';
      
      const message = `${icon} *DESCUADRE DE CAJA DETECTADO*\n\n` +
                      `📅 Fecha: ${fecha}\n` +
                      `💸 Importe: *${descuadre > 0 ? '+' : ''}${descuadre.toFixed(2)}€* (${warningText})\n\n` +
                      `La IA detectó una diferencia entre el ticket y el sobre físico. Revísalo.`;
      
      // 🚀 AÑADIDO: Botón directo a la caja problemática
      const appUrl = data.config.appUrl || 'https://tu-erp.com';
      await this.sendAlert(data, message, 'WARNING', { 
        text: "🔍 Revisar Arqueo en la App", 
        url: `${appUrl}/?tab=cajas` 
      });
    }
  }
}
