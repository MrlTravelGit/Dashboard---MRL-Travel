import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { BookingProvider } from "./contexts/BookingContext";
import CashbackPage from "./pages/CashbackPage";
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
import { LoadingGate } from "@/components/LoadingGate";

// QueryClient estável — criado uma única vez fora do componente para nunca ser recriado
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Desabilita refetch automático ao focar a janela — evita flood de requests ao trocar de aba
      refetchOnWindowFocus: false,
    },
  },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading, authReady } = useAuth();

  // Bloqueia apenas durante bootstrap (sessão sendo recuperada).
  // NÃO bloqueia em isLoadingRole — evita unmount de rotas durante retry de admin check.
  if (!authReady || isLoading) {
    return <LoadingGate label="Carregando..." />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, appRole, isLoadingRole, authReady } = useAuth();

  // isAdmin === null significa "ainda verificando" — não redireciona prematuramente
  if (!authReady || isLoadingRole || isAdmin === null) {
    return <LoadingGate label="Carregando permissões..." />;
  }

  const isUserAdmin = isAdmin === true || appRole === "admin";
  if (!isUserAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { user } = useAuth();

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
      <Route path="/cashback" element={<ProtectedRoute><CashbackPage /></ProtectedRoute>} />
      <Route path="/empresas" element={<ProtectedRoute><AdminRoute><CompaniesPage /></AdminRoute></ProtectedRoute>} />
      <Route path="/funcionarios" element={<ProtectedRoute><EmployeesPage /></ProtectedRoute>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  // BrowserRouter está no topo, FORA dos providers de auth/booking.
  // Isso garante que trocar de aba (TOKEN_REFRESHED no Supabase) não cause
  // remount do Router e consequente reset do estado de navegação/formulários.
  <BrowserRouter>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <TooltipProvider>
          <AuthProvider>
            <BookingProvider>
              <Toaster />
              <Sonner />
              <AppRoutes />
            </BookingProvider>
          </AuthProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </BrowserRouter>
);

export default App;
