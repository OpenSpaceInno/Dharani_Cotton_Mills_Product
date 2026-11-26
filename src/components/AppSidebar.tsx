import {
  LayoutDashboard,
  LogIn,
  Scale,
  Settings,
  Users,
  Building2,
  Camera,
  BarChart3
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useCompany } from "@/contexts/CompanyContext";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const operationsItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Gate Monitor", url: "/gate-monitor", icon: LogIn },
  { title: "Weighbridge", url: "/weighbridge", icon: Scale },
];

const reportItems = [
  { title: "Reports", url: "/reports", icon: BarChart3 },
];

const systemItems = [
  { title: "Device Config", url: "/device-config", icon: Camera },
  { title: "Company & Settings", url: "/settings", icon: Building2 },
  { title: "User & Role Security", url: "/users", icon: Users },
];

export function AppSidebar() {
  const { open } = useSidebar();
  const location = useLocation();
  const { canAccessRoute, role, hasPermission, user } = useAuth();
  const { company } = useCompany();

  // Filter items strictly based on role module permissions and superadmin privileges
  const isSuperAdmin =
    role?.id === "super_admin" ||
    role?.id === "superadmin" ||
    user?.roleId === "super_admin" ||
    user?.roleId === "superadmin" ||
    role?.name?.toLowerCase().includes("super admin") ||
    (Array.isArray(role?.permissions) && role?.permissions.includes("all:manage"));

  const visibleOperations = operationsItems.filter(item => isSuperAdmin || canAccessRoute(item.url));
  const visibleReports = reportItems.filter(item => isSuperAdmin || canAccessRoute(item.url));
  const visibleSystem = systemItems.filter(item => isSuperAdmin || canAccessRoute(item.url));

  return (
    <Sidebar className={open ? "w-64" : "w-16"} collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3.5">
        {open ? (
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl border border-amber-500/30 bg-slate-950/80 shrink-0 flex items-center justify-center shadow-sm p-1">
              <img
                src="/logo-icon.png"
                alt="Dharani Cotton Mills"
                className="max-h-full max-w-full object-contain drop-shadow"
              />
            </div>
            <div className="overflow-hidden">
              <h2 className="text-xs font-bold text-sidebar-foreground truncate" title={company.firmName}>
                {company.firmName || "Dharani Cotton Mills"}
              </h2>
              <p className="text-[10px] text-sidebar-foreground/70 truncate" title={company.plantName}>
                {company.plantCode || 'PLANT_001'} · {role ? role.name.split('/')[0] : 'Operations'}
              </p>
            </div>
          </div>
        ) : (
          <div className="h-10 w-10 rounded-xl border border-amber-500/30 bg-slate-950/80 flex items-center justify-center mx-auto shadow-sm p-1">
            <img src="/logo-icon.png" alt="Dharani Cotton Mills" className="max-h-full max-w-full object-contain drop-shadow" />
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        {visibleOperations.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className={!open ? "sr-only" : ""}>Operations</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleOperations.map((item) => {
                  const isItemActive = item.url === "/" ? location.pathname === "/" : location.pathname.startsWith(item.url);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={isItemActive}>
                        <NavLink
                          to={item.url}
                          end={item.url === "/"}
                          className={`hover:bg-sidebar-accent transition-colors ${
                            isItemActive
                              ? "bg-amber-500/15 text-amber-500 dark:text-amber-400 font-bold border-l-2 border-amber-500 shadow-xs"
                              : ""
                          }`}
                          activeClassName="bg-amber-500/15 text-amber-500 dark:text-amber-400 font-bold border-l-2 border-amber-500 shadow-xs"
                        >
                          <item.icon className={`h-4 w-4 ${isItemActive ? "text-amber-500 dark:text-amber-400" : ""}`} />
                          {open && <span>{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {visibleReports.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className={!open ? "sr-only" : ""}>Analytics & Reports</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleReports.map((item) => {
                  const isItemActive = location.pathname.startsWith(item.url);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={isItemActive}>
                        <NavLink
                          to={item.url}
                          className={`hover:bg-sidebar-accent transition-colors ${
                            isItemActive
                              ? "bg-amber-500/15 text-amber-500 dark:text-amber-400 font-bold border-l-2 border-amber-500 shadow-xs"
                              : ""
                          }`}
                          activeClassName="bg-amber-500/15 text-amber-500 dark:text-amber-400 font-bold border-l-2 border-amber-500 shadow-xs"
                        >
                          <item.icon className={`h-4 w-4 ${isItemActive ? "text-amber-500 dark:text-amber-400" : ""}`} />
                          {open && <span>{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {visibleSystem.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className={!open ? "sr-only" : ""}>System & Security</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visibleSystem.map((item) => {
                  const isItemActive = location.pathname.startsWith(item.url);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={isItemActive}>
                        <NavLink
                          to={item.url}
                          className={`hover:bg-sidebar-accent transition-colors ${
                            isItemActive
                              ? "bg-amber-500/15 text-amber-500 dark:text-amber-400 font-bold border-l-2 border-amber-500 shadow-xs"
                              : ""
                          }`}
                          activeClassName="bg-amber-500/15 text-amber-500 dark:text-amber-400 font-bold border-l-2 border-amber-500 shadow-xs"
                        >
                          <item.icon className={`h-4 w-4 ${isItemActive ? "text-amber-500 dark:text-amber-400" : ""}`} />
                          {open && <span>{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
