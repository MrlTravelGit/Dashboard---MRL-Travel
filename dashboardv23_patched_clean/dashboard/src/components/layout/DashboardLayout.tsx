import { ReactNode, useState } from 'react';
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { ProfileMenu } from './ProfileMenu';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useBooking } from '@/contexts/BookingContext';
import { useAuth } from '@/contexts/AuthContext';
import { Settings, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { companySettings, updateCompanySettings } = useBooking();
  const { isAdmin } = useAuth();
  const [tempName, setTempName] = useState(companySettings.name);
  const [tempLogo, setTempLogo] = useState(companySettings.logo);
  const [isOpen, setIsOpen] = useState(false);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setTempLogo(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = () => {
    // Somente admin pode editar (empresas apenas visualizam).
    if (!isAdmin) {
      setIsOpen(false);
      return;
    }
    updateCompanySettings({ name: tempName, logo: tempLogo });
    setIsOpen(false);
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-16 border-b border-border bg-card flex items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="text-foreground" />
              <div className="flex items-center gap-3 min-w-0">
                {companySettings.logo ? (
                  <img src={companySettings.logo} alt="Logo" className="h-8 w-8 rounded-md object-cover" />
                ) : (
                  <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
                    <span className="text-primary-foreground font-bold text-sm">
                      {companySettings.name.charAt(0)}
                    </span>
                  </div>
                )}
                <h1 className="text-lg font-semibold text-foreground truncate max-w-[55vw] sm:max-w-none">{companySettings.name}</h1>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <ThemeToggle />
              {isAdmin ? (
                <Dialog open={isOpen} onOpenChange={setIsOpen}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <Settings className="h-5 w-5" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                <DialogHeader>
                  <DialogTitle>Configurações da Empresa</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="companyName">Nome da Empresa</Label>
                    <Input
                      id="companyName"
                      value={tempName}
                      onChange={(e) => setTempName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Logo da Empresa</Label>
                    <div className="flex items-center gap-4">
                      {tempLogo ? (
                        <img src={tempLogo} alt="Logo" className="h-16 w-16 rounded-lg object-cover" />
                      ) : (
                        <div className="h-16 w-16 rounded-lg bg-muted flex items-center justify-center">
                          <Upload className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <Button onClick={handleSave} className="w-full">
                    Salvar Alterações
                  </Button>
                </div>
                  </DialogContent>
                </Dialog>
              ) : null}
              
              <ProfileMenu />
            </div>
          </header>
          <main className="flex-1 p-4 sm:p-6 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
