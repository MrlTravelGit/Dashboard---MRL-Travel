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

// Protected route component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}



// App routes with auth context available
function AppRoutes() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
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
      <Route path="/empresas" element={<ProtectedRoute><CompaniesPage /></ProtectedRoute>} />
      <Route path="/funcionarios" element={<ProtectedRoute><EmployeesPage /></ProtectedRoute>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

<Route
  path="/empresas"
  element={
    <ProtectedRoute>
      <AdminRoute>
        <CompaniesPage />
      </AdminRoute>
    </ProtectedRoute>
  }
/>

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
