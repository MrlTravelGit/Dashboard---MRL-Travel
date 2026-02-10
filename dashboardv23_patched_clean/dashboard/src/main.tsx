import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

import { supabase } from '@/integrations/supabase/client';

(window as any).supabase = supabase;

createRoot(document.getElementById("root")!).render(<App />);
