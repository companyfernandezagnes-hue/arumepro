import { AppData } from '../types';

export class NotificationService {
  /**
   * Envía una alerta al webhook de n8n para que este la procese y la envíe a Telegram
   */
  static async sendAlert(data: AppData, message: string, type: 'INFO' | 'WARNING' | 'CRITICAL' = 'INFO') {
    const n8nUrl = data.config.n8nUrlIA; // Usamos el mismo webhook de IA o uno específico si existiera
    
    if (!n8nUrl) {
      console.warn("⚠️ No hay URL de n8n configurada para alertas.");
      return;
    }

    try {
      const payload = {
        type: 'NOTIFICATION',
        alertType: type,
        message: message,
        timestamp: new Date().toISOString(),
        restaurant: data.config.empresa || 'Arume ERP',
        telegramToken: data.config.telegramToken,
        telegramChatId: data.config.telegramChatId
      };

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
      
      await this.sendAlert(data, message, 'WARNING');
    }
  }

  /**
   * Notifica un cierre de caja con descuadre
   */
  static async notifyCajaDescuadre(data: AppData, fecha: string, descuadre: number) {
    if (Math.abs(descuadre) > 5) { // Solo si el descuadre es mayor a 5€
      const message = `⚠️ *DESCUADRE DE CAJA*\n\nFecha: ${fecha}\nImporte: ${descuadre.toFixed(2)}€\n\nRevisar cierres de hoy.`;
      await this.sendAlert(data, message, 'WARNING');
    }
  }
}
