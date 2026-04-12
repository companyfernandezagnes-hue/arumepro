<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Arume Pro

App de gestión integral (caja, tesorería, compras, stock, facturación,
marketing y IA) para Arume. Stack: **React 19 + TypeScript + Vite 6 +
Tailwind 4 + Supabase + Gemini**.

View your app in AI Studio: https://ai.studio/apps/128ddadf-5aad-461f-b747-bf62d8301534

## Requisitos

- Node.js 20 o superior
- Una cuenta de Supabase con el esquema de Arume ya creado
- (Opcional pero recomendado) una API key de Google Gemini

## Instalación

1. Instala dependencias:
   ```bash
   npm install
   ```

2. Crea un archivo `.env` en la raíz basado en `.env.example` y rellena
   **únicamente** las variables de Supabase:
   ```env
   VITE_SUPABASE_URL="https://tu-proyecto.supabase.co"
   VITE_SUPABASE_ANON_KEY="eyJhbGci..."
   APP_URL="http://localhost:3000"
   ```

3. Arranca el servidor de desarrollo:
   ```bash
   npm run dev
   ```
   Se levanta en [http://localhost:3000](http://localhost:3000).

## ⚠️ Cómo configurar Gemini y el resto de IAs

**IMPORTANTE:** las claves de IA **NO** se ponen en `.env`. El código las
lee de `localStorage` porque cada usuario introduce la suya dentro de la
app. Si pones la clave en `.env` no se usará.

Para configurarlas:

1. Abre la app (`npm run dev`) y entra con tu PIN.
2. Pulsa el icono de **Ajustes** (engranaje) en la barra superior.
3. En la sección **IAs** pega tu clave de Gemini (y, si quieres, también
   las de Groq, Cerebras, DeepSeek o Mistral — la app hace fallback
   automático entre ellas).
4. Pulsa **Guardar**.

Proveedores soportados en `src/services/aiProviders.ts`:

| Proveedor | Uso principal | Cómo obtener clave |
|-----------|---------------|--------------------|
| 🔵 Gemini   | Visión (imágenes + PDFs)   | https://aistudio.google.com/apikey |
| 🟢 Groq     | Texto rápido + Whisper voz | https://console.groq.com/keys |
| 🟣 Cerebras | Texto ultrarrápido         | https://cloud.cerebras.ai |
| 🔷 DeepSeek | Análisis largo             | https://platform.deepseek.com |
| 🇪🇺 Mistral  | Backup europeo de visión   | https://console.mistral.ai |

## Scripts

| Script | Qué hace |
|--------|----------|
| `npm run dev`     | Arranca el servidor Express + Vite en `:3000` |
| `npm run build`   | Build de producción (output en `dist/`) |
| `npm run preview` | Sirve el build de producción |
| `npm run lint`    | `tsc --noEmit` — type check sin generar archivos |
| `npm run clean`   | Borra `dist/` |
