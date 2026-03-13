// src/ui/icons.ts
// Módulo central de iconos para ARUME.
// Reexporta todos los iconos usados en la app y define alias/fallbacks
// para evitar errores de "X is not defined" si cambian nombres entre versiones.

// Reexports directos desde lucide-react (los más usados en tu app)
export {
  // Navegación / Dashboard
  LayoutDashboard,
  SplitSquareHorizontal,
  CalendarDays,

  // Finanzas / KPIs
  Wallet,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Scale,
  PieChart,
  Receipt,
  Calculator,
  RefreshCw,
  FileText,

  // Banco / Empresa / Unidades de negocio
  Building2,
  Hotel,
  ShoppingBag,
  Users,

  // Estados / Alertas
  AlertCircle,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  WifiOff,
  Loader2,
  X,

  // Acciones / Inputs
  Search,
  Plus,
  Upload,
  Import,
  Camera,

  // Navegación secundaria
  ChevronLeft,
  ChevronRight,

  // Stock / Menús
  ChefHat,
  Package,
  Zap,
  TableProperties,

  // Configuración
  Settings,

  // Documentos / Logística
  Truck,
} from 'lucide-react';

// 📦 Alias/Fallbacks globales
// Si en algún sitio del código aparece <FileSpreadsheet /> (y tu versión de lucide-react no lo trae),
// lo sustituimos de forma segura por <FileText /> para que no crashee la vista.
import { FileText } from 'lucide-react';
export const FileSpreadsheet = FileText;
