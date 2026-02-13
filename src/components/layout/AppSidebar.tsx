import { Home, Building2, Car, Package, Users, Plane, UserCheck } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';

const menuItems = [
  { title: 'Home', url: '/', icon: Home, adminOnly: false },
  { title: 'Reservas', url: '/reservas', icon: Package, adminOnly: false },
  { title: 'Voos', url: '/voos', icon: Plane, adminOnly: false },
  { title: 'Hospedagens', url: '/hospedagens', icon: Building2, adminOnly: false },
  { title: 'Aluguel de Carro', url: '/aluguel-carro', icon: Car, adminOnly: false },
  { title: 'Empresas', url: '/empresas', icon: Users, adminOnly: true },
  { title: 'Funcionários', url: '/funcionarios', icon: UserCheck, adminOnly: true },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const { isAdmin, appRole, isLoadingRole } = useAuth();
  const collapsed = state === 'collapsed';

  // Mostra opções admin quando:
  // - Não está carregando a role (isLoadingRole === false)
  // - E (isAdmin === true OU appRole === "admin")
  // 
  // Enquanto carrega: não mostra, para evitar carregar página admin e depois esconder
  const isUserAdmin = isAdmin || appRole === "admin";
  const canViewAdminItems = !isLoadingRole && isUserAdmin;

  const visibleMenuItems = menuItems.filter(item => !item.adminOnly || canViewAdminItems);

  return (
    <Sidebar className={collapsed ? 'w-14' : 'w-60'} collapsible="icon">
      <SidebarContent className="pt-4">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleMenuItems.map((item) => {
                const isActive = location.pathname === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <NavLink
                        to={item.url}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'hover:bg-accent text-foreground'
                        }`}
                      >
                        <item.icon className="h-5 w-5 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
