# 🤖 Arume Agent — Edge Function autónoma

Este agente corre **24/7 en Supabase** cada 30 minutos. Revisa la data de
Arume PRO y envía alertas a Telegram cuando hay algo urgente, aunque tú no
tengas la app abierta.

## Qué vigila

- 📦 **Stock bajo** — productos bajo mínimo
- 💸 **Pagos vencidos** — facturas con fecha de vencimiento pasada
- 🚨 **Saldo banco** — alerta si < 1.000€ o negativo
- ⚠️ **Facturas duplicadas** — mismo proveedor+nº+total
- 📈 **Precios anómalos** — subidas >15% en proveedores
- 📋 **AEAT pendiente** — modelos del trimestre pasado sin presentar

## Horario

Corre cada 30 minutos. Silencio nocturno 23:00-07:00 (hora España).
Briefing de "todo OK" por la mañana (8-9h) si no hay alertas.

---

## 🚀 Despliegue (hazlo UNA vez)

### 1. Instalar Supabase CLI si no la tienes

```bash
# macOS
brew install supabase/tap/supabase

# O con npm
npm install -g supabase
```

### 2. Login + link al proyecto

```bash
supabase login
# Abre el navegador y autoriza

cd /Users/agnescompanyfernandez/Downloads/arumepro-main
supabase link --project-ref <TU_PROJECT_REF>
# Tu PROJECT_REF está en: Supabase Dashboard → Settings → General → Reference ID
```

### 3. Desplegar la función

```bash
supabase functions deploy arume-agent
```

Ya está desplegada, pero **todavía no se ejecuta sola**. Hay que activar
el cron.

### 4. Activar el cron (una sola vez)

Ve a tu Supabase Dashboard → SQL Editor → pega esto y ejecuta:

```sql
-- Activar extensiones necesarias (solo primera vez)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Programar la ejecución cada 30 minutos
select cron.schedule(
  'arume-agent-30min',
  '*/30 * * * *',  -- cada 30 minutos
  $$
  select net.http_post(
    url := 'https://<TU_PROJECT_REF>.supabase.co/functions/v1/arume-agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <TU_SERVICE_ROLE_KEY>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

Reemplaza `<TU_PROJECT_REF>` y `<TU_SERVICE_ROLE_KEY>` con tus valores
(Dashboard → Settings → API).

### 5. Verificar que funciona

En la tabla `cron.job` de Supabase verás el job programado. En `cron.job_run_details`
verás las ejecuciones. Y en **2-30 minutos** te llegará el primer mensaje
al Telegram.

### 6. Ajustar (opcional)

- **Cambiar frecuencia**: `'*/15 * * * *'` (cada 15 min), `'0 * * * *'` (cada hora)
- **Detener**: `select cron.unschedule('arume-agent-30min');`
- **Ver log**: `select * from cron.job_run_details order by start_time desc limit 10;`

---

## ¿Problemas?

- **No llega nada a Telegram**: revisa que `telegramToken` y `telegramChatId`
  estén guardados en el config (Ajustes → Telegram). Sin ellos el agente
  no sabe a quién escribir.
- **Error en cron.job_run_details**: probablemente la función no está
  desplegada, o el service_role_key es incorrecto.
- **Spam de alertas**: baja la frecuencia a `'0 * * * *'` (1 vez por hora)
  o añade tu propia lógica de deduplicación.
