import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

import { supabase } from '@/integrations/supabase/client';
import { initLifecycleDebug } from '@/hooks/useLifecycleDebug';

(window as any).supabase = supabase;

// Ativa diagnóstico de lifecycle (visibilitychange, focus, pageshow, etc.)
// Só loga quando VITE_DEBUG_LIFECYCLE=true no .env / .env.local
initLifecycleDebug();

createRoot(document.getElementById("root")!).render(<App />);
