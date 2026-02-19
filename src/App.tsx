import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { BookingProvider } from "./contexts/BookingContext";
import HomePage from "./pages/HomePage";
import FlightsPage from "./pages/FlightsPage";
import HotelsPage from "./pages/HotelsPage";
import CarRentalsPage from "./pages/CarRentalsPage";
import BookingDetailsPage from "./pages/BookingDetailsPage";
import BookingsPage from "./pages/BookingsPage";
import CompaniesPage from "./pages/CompaniesPage";
import EmployeesPage from "./pages/EmployeesPage";
import LoginPage from "./pages/LoginPage";
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

// Protected route component - bloqueia se não autenticado
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isLoadingRole, isAdmin, appRole } = useAuth();

  // Aguarda carregar session e role
  // Estado para mostrar botão de reset após 10s (apenas admin)
  const [showReset, setShowReset] = React.useState(false);
  React.useEffect(() => {
    if (isLoading || isLoadingRole) {
      const timeout = setTimeout(() => setShowReset(true), 10000);
      return () => clearTimeout(timeout);
    } else {
      setShowReset(false);
    }
  }, [isLoading, isLoadingRole]);

  if (isLoading || isLoadingRole) {
    let lastKnownAdmin = false;
    try {
      lastKnownAdmin = localStorage.getItem("lastKnownAdmin") === "1";
    } catch {
      lastKnownAdmin = false;
    }

    const canShowReset = Boolean(isAdmin || appRole === "admin" || lastKnownAdmin);
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        {/* Botão só aparece para admin, após 10s de loading */}
        {showReset && canShowReset && (
          <div className="flex flex-col items-center mt-6">
            <button
              className="px-4 py-2 rounded bg-red-600 text-white font-semibold shadow hover:bg-red-700 transition-colors"
              onClick={async () => {
                const { resetSessionAndReload } = await import("@/utils/resetSession");
                resetSessionAndReload();
              }}
              type="button"
            >
              Reiniciar cookies e sessão
            </button>
            <span className="text-xs text-muted-foreground mt-2 text-center max-w-xs">
              Isso vai te deslogar e recarregar a página.
            </span>
          </div>
        )}
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Admin route component - bloqueia se não é admin
// Aguarda role estar carregada antes de redirecionar
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, appRole, isLoadingRole } = useAuth();

  // Aguarda role estar carregada
  // NÃO redireciona enquanto role está carregando
  if (isLoadingRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Após role estar carregada, verifica se é admin
  // isAdmin pode ser false ou appRole pode ser null - em ambos os casos, bloqueia
  const isUserAdmin = isAdmin || appRole === "admin";
  if (!isUserAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}



// App routes with auth context available
function AppRoutes() {
  const { user, isLoading, isLoadingRole } = useAuth();

  if (isLoading || isLoadingRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Routes>
      <Route 
        path="/login" 
        element={user ? <Navigate to="/" replace /> : <LoginPage />} 
      />
      <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
      <Route path="/reservas" element={<ProtectedRoute><BookingsPage /></ProtectedRoute>} />
      <Route path="/reservas/:id" element={<ProtectedRoute><BookingDetailsPage /></ProtectedRoute>} />
      <Route path="/voos" element={<ProtectedRoute><FlightsPage /></ProtectedRoute>} />
      <Route path="/hospedagens" element={<ProtectedRoute><HotelsPage /></ProtectedRoute>} />
      <Route path="/aluguel-carro" element={<ProtectedRoute><CarRentalsPage /></ProtectedRoute>} />
      <Route path="/empresas" element={<ProtectedRoute><AdminRoute><CompaniesPage /></AdminRoute></ProtectedRoute>} />
      <Route path="/funcionarios" element={<ProtectedRoute><AdminRoute><EmployeesPage /></AdminRoute></ProtectedRoute>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <AuthProvider>
          <BookingProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </BookingProvider>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
