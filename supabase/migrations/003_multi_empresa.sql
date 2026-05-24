-- ============================================================
-- MIGRACIÓN 003: Multi-empresa (Arume + RACO)
-- ============================================================
-- Ejecutar en Supabase SQL Editor (dashboard.supabase.com)
-- ANTES de desplegar la nueva versión de la app
-- ============================================================

-- 1. Crear tabla de empresas
CREATE TABLE IF NOT EXISTS empresas (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  nombre_corto TEXT NOT NULL,
  sociedad TEXT NOT NULL,
  cif TEXT,
  direccion TEXT,
  color TEXT NOT NULL DEFAULT '#4f46e5',
  activa BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Insertar las dos empresas
INSERT INTO empresas (id, nombre, nombre_corto, sociedad, cif, color)
VALUES
  ('arume', 'Arume Sake Bar', 'ARUME', 'Arume Sake Bar SL', '', '#4f46e5'),
  ('raco',  'Raco Blanquerna', 'RACO',  'Raco Blanquerna SL', '', '#059669')
ON CONFLICT (id) DO NOTHING;

-- 3. Añadir columna empresa_id a arume_data
ALTER TABLE arume_data ADD COLUMN IF NOT EXISTS empresa_id TEXT REFERENCES empresas(id);

-- 4. Marcar datos existentes como Arume
UPDATE arume_data SET empresa_id = 'arume' WHERE empresa_id IS NULL;

-- 5. Hacer NOT NULL después de migrar
ALTER TABLE arume_data ALTER COLUMN empresa_id SET NOT NULL;

-- 6. Índice único: una fila por empresa
CREATE UNIQUE INDEX IF NOT EXISTS idx_arume_data_empresa ON arume_data(empresa_id);

-- 7. Crear fila vacía para RACO (si no existe)
INSERT INTO arume_data (id, empresa_id, data, version)
SELECT
  (SELECT COALESCE(MAX(id), 0) + 1 FROM arume_data),
  'raco',
  '{"config":{"objetivoMensual":30000}}'::jsonb,
  1
WHERE NOT EXISTS (SELECT 1 FROM arume_data WHERE empresa_id = 'raco');

-- 8. RLS: permitir acceso a ambas filas (mismo usuario autenticado)
-- Si ya tienes RLS activado en arume_data, actualiza las policies:
-- DROP POLICY IF EXISTS "arume_data_select" ON arume_data;
-- CREATE POLICY "arume_data_select" ON arume_data FOR SELECT USING (auth.role() = 'authenticated');
-- CREATE POLICY "arume_data_update" ON arume_data FOR UPDATE USING (auth.role() = 'authenticated');
-- CREATE POLICY "arume_data_insert" ON arume_data FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ✅ Migración completada. La app ahora filtra por empresa_id en vez de id=1.
