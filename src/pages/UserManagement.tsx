import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { User, Role } from '@/types/auth';
import { 
  Users, 
  ShieldCheck, 
  UserPlus, 
  Search, 
  CheckCircle, 
  Lock, 
  RefreshCw,
  Edit2,
  Trash2,
  Plus,
  Shield,
  KeyRound,
  FileText,
  AlertTriangle,
  UserCheck,
  UserX,
  Sliders,
  ChevronRight,
  Eye,
  EyeOff,
  Check
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

export const AVAILABLE_MODULES = [
  { id: '/', label: 'Dashboard', path: '/', description: 'Plant overview, operational metrics and KPIs' },
  { id: '/gate-monitor', label: 'Gate Monitor', path: '/gate-monitor', description: 'Live ANPR camera feeds, barrier detection and history' },
  { id: '/weighbridge', label: 'Weighbridge Terminal', path: '/weighbridge', description: 'Gross & Tare weighments, slip printing and cotton catalog' },
  { id: '/reports', label: 'Reports & Analytics', path: '/reports', description: 'Executive weighment register, supplier ledger, and commodity reports' },
  { id: '/device-config', label: 'Device Configuration', path: '/device-config', description: 'COM scale, RTSP cameras, FTP watcher and printers' },
  { id: '/settings', label: 'Company & Settings', path: '/settings', description: 'Firm details, plant address, print slip branding' },
  { id: '/users', label: 'User & Role Security (RBAC)', path: '/users', description: 'User provisioning, permissions and audit trails' },
];

export const AVAILABLE_PERMISSIONS = [
  { id: 'all:manage', label: 'Universal Superadmin Access', category: 'Security', description: 'Unrestricted master access across all system privileges, routes, and modules' },
  { id: 'weighbridge:operate', label: 'Weighment Capture', category: 'Weighbridge', description: 'Capture digital indicator tare and gross weights' },
  { id: 'weighbridge:print', label: 'Print Weigh Slips', category: 'Weighbridge', description: 'Generate and print thermal/laser weighment receipts' },
  { id: 'gate:view', label: 'Gate CCTV & ANPR', category: 'Gate Monitor', description: 'View live gate streams and automatic number plate logs' },
  { id: 'reports:export', label: 'Export Reports', category: 'Reports', description: 'Generate and export historical weighment slips & audits' },
  { id: 'config:manage', label: 'Device Configuration', category: 'System', description: 'Configure serial scale indicators, CCTV cameras & printers' },
  { id: 'users:manage', label: 'User Administration', category: 'Security', description: 'Provision, edit, and deactivate operator accounts' },
  { id: 'roles:manage', label: 'RBAC Security Matrix', category: 'Security', description: 'Modify permitted modules and functional privileges' },
  { id: 'override:approve', label: 'Override Approvals', category: 'Operations', description: 'Authorize scale tolerance overrides and manual entries' },
];

const ROLE_COLORS = [
  { name: 'Red', value: 'red', class: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 border-red-300' },
  { name: 'Purple', value: 'purple', class: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 border-purple-300' },
  { name: 'Blue', value: 'blue', class: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-300' },
  { name: 'Emerald', value: 'emerald', class: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300' },
  { name: 'Amber', value: 'amber', class: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-300' },
  { name: 'Rose', value: 'rose', class: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border-rose-300' },
  { name: 'Cyan', value: 'cyan', class: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300 border-cyan-300' },
];

export default function UserManagement() {
  const { user: currentUser, reloadSession } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [activeTab, setActiveTab] = useState<'users' | 'roles' | 'audit'>('users');

  // Dialog States - Users
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteUserDialogOpen, setDeleteUserDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Dialog States - Roles
  const [createRoleDialogOpen, setCreateRoleDialogOpen] = useState(false);
  const [editRoleDialogOpen, setEditRoleDialogOpen] = useState(false);
  const [deleteRoleDialogOpen, setDeleteRoleDialogOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);

  // Form States - User
  const [newUserData, setNewUserData] = useState({
    username: '',
    name: '',
    email: '',
    password: '',
    roleId: 'weighbridge_operator',
    department: 'Weighbridge Operations',
    shift: 'General Shift (08:00 - 18:00)',
    phone: '',
    status: 'active' as 'active' | 'inactive',
  });

  const [editUserData, setEditUserData] = useState({
    id: '',
    name: '',
    email: '',
    roleId: '',
    department: '',
    shift: '',
    phone: '',
    status: 'active' as 'active' | 'inactive' | 'suspended',
    newPassword: '',
  });

  // Form States - Role
  const [newRoleData, setNewRoleData] = useState({
    id: '',
    name: '',
    description: '',
    color: 'blue',
    modules: ['/', '/gate-monitor', '/weighbridge'],
    permissions: ['weighbridge:operate', 'weighbridge:print', 'gate:view'],
  });

  const [editRoleData, setEditRoleData] = useState({
    id: '',
    name: '',
    description: '',
    color: 'blue',
    modules: [] as string[],
    permissions: [] as string[],
  });

  const [showPassword, setShowPassword] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [u, r, logs] = await Promise.all([
        api.getUsers().catch(() => []),
        api.getRoles().catch(() => []),
        api.getAuditLogs({ limit: 40 }).catch(() => []),
      ]);
      const safeParse = (v: any): string[] => {
        if (Array.isArray(v)) return v;
        if (typeof v === 'string') {
          try {
            const parsed = JSON.parse(v);
            if (Array.isArray(parsed)) return parsed;
          } catch {}
        }
        return [];
      };
      const safeRoles = (Array.isArray(r) ? r : []).map((role) => ({
        ...role,
        modules: safeParse(role.modules),
        permissions: safeParse(role.permissions),
      }));
      setUsers(Array.isArray(u) ? u : []);
      setRoles(safeRoles);
      setAuditLogs(Array.isArray(logs) ? logs : []);
    } catch (err: any) {
      toast.error('Failed to load user and role datasets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // ----------------------------------------------------
  // USER CRUD HANDLERS
  // ----------------------------------------------------

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserData.username || !newUserData.name || !newUserData.email || !newUserData.password) {
      toast.error('Please fill in all required fields');
      return;
    }

    const selectedRoleObj = roles.find(r => r.id === newUserData.roleId);
    try {
      await api.createUser({
        ...newUserData,
        roleName: selectedRoleObj?.name || 'Weighbridge Scale',
      });
      toast.success(`Operator ${newUserData.name} created successfully`);
      setCreateDialogOpen(false);
      setNewUserData({
        username: '',
        name: '',
        email: '',
        password: '',
        roleId: roles[0]?.id || 'weighbridge_operator',
        department: 'Weighbridge Operations',
        shift: 'General Shift (08:00 - 18:00)',
        phone: '',
        status: 'active',
      });
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create user');
    }
  };

  const openEditUser = (user: User) => {
    setSelectedUser(user);
    setEditUserData({
      id: user.id,
      name: user.name,
      email: user.email,
      roleId: user.roleId,
      department: user.department || '',
      shift: user.shift || '',
      phone: user.phone || '',
      status: user.status,
      newPassword: '',
    });
    setEditDialogOpen(true);
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    const selectedRoleObj = roles.find(r => r.id === editUserData.roleId);
    const payload: any = {
      name: editUserData.name,
      email: editUserData.email,
      roleId: editUserData.roleId,
      roleName: selectedRoleObj?.name || selectedUser.roleName,
      department: editUserData.department,
      shift: editUserData.shift,
      phone: editUserData.phone,
      status: editUserData.status,
    };

    if (editUserData.newPassword.trim()) {
      payload.password = editUserData.newPassword.trim();
    }

    try {
      await api.updateUser(selectedUser.id, payload);
      toast.success(`User ${editUserData.name} updated successfully`);
      setEditDialogOpen(false);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update user');
    }
  };

  const handleToggleUserStatus = async (user: User) => {
    if (user.id === currentUser?.id) {
      toast.error('Cannot change the status of your currently active account');
      return;
    }
    const newStatus = user.status === 'active' ? 'inactive' : 'active';
    try {
      await api.updateUser(user.id, { status: newStatus });
      toast.success(`User ${user.name} marked as ${newStatus}`);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update user status');
    }
  };

  const openDeleteUser = (user: User) => {
    setSelectedUser(user);
    setDeleteUserDialogOpen(true);
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    if (selectedUser.id === currentUser?.id || selectedUser.username === 'admin' || selectedUser.username === 'superadmin' || selectedUser.id === 'USR-000' || selectedUser.id === 'USR-001') {
      toast.error('Cannot delete primary system Administrator or Super Administrator account');
      setDeleteUserDialogOpen(false);
      return;
    }

    try {
      await api.deleteUser(selectedUser.id);
      toast.success(`User ${selectedUser.name} deleted successfully`);
      setDeleteUserDialogOpen(false);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete user');
    }
  };

  // ----------------------------------------------------
  // ROLE CRUD HANDLERS
  // ----------------------------------------------------

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleData.name) {
      toast.error('Role name is required');
      return;
    }

    const roleId = newRoleData.id.trim() || newRoleData.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    try {
      await api.createRole({
        id: roleId,
        name: newRoleData.name.trim(),
        description: newRoleData.description,
        color: newRoleData.color,
        modules: newRoleData.modules,
        permissions: newRoleData.permissions,
      });
      toast.success(`Role "${newRoleData.name}" created successfully`);
      setCreateRoleDialogOpen(false);
      setNewRoleData({
        id: '',
        name: '',
        description: '',
        color: 'blue',
        modules: ['/', '/gate-monitor', '/weighbridge'],
        permissions: ['weighbridge:operate', 'weighbridge:print', 'gate:view'],
      });
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create role');
    }
  };

  const openEditRole = (role: Role) => {
    setSelectedRole(role);
    const parseList = (val: any): string[] => {
      if (Array.isArray(val)) return [...val];
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) return parsed;
        } catch {}
      }
      return [];
    };

    setEditRoleData({
      id: role.id,
      name: role.name,
      description: role.description || '',
      color: role.color || 'blue',
      modules: parseList(role.modules),
      permissions: parseList(role.permissions),
    });
    setEditRoleDialogOpen(true);
  };

  const handleUpdateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRole) return;

    try {
      await api.updateRole(selectedRole.id, {
        name: editRoleData.name.trim(),
        description: editRoleData.description,
        color: editRoleData.color,
        modules: Array.isArray(editRoleData.modules) ? editRoleData.modules : [],
        permissions: Array.isArray(editRoleData.permissions) ? editRoleData.permissions : [],
      });
      toast.success(`Role "${editRoleData.name}" privileges updated`);
      setEditRoleDialogOpen(false);
      fetchData();
      if (reloadSession) {
        await reloadSession();
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('rmc_auth_refresh'));
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to update role');
    }
  };

  const openDeleteRole = (role: Role) => {
    setSelectedRole(role);
    setDeleteRoleDialogOpen(true);
  };

  const handleDeleteRole = async () => {
    if (!selectedRole) return;
    const SYSTEM_ROLE_IDS = ['super_admin', 'superadmin', 'admin', 'weighbridge_operator', 'gate_operator'];
    if (SYSTEM_ROLE_IDS.includes(selectedRole.id) || selectedRole.isSystem) {
      toast.error('Core system security roles cannot be deleted.');
      setDeleteRoleDialogOpen(false);
      return;
    }
    try {
      await api.deleteRole(selectedRole.id);
      toast.success(`Role "${selectedRole.name}" deleted successfully`);
      setDeleteRoleDialogOpen(false);
      fetchData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete role');
    }
  };

  // Module & Permission Toggle Helpers
  const toggleModule = (modulePath: string, isEdit: boolean) => {
    if (isEdit) {
      setEditRoleData(prev => {
        const cur = Array.isArray(prev?.modules) ? prev.modules : [];
        return {
          ...prev,
          modules: cur.includes(modulePath)
            ? cur.filter(m => m !== modulePath)
            : [...cur, modulePath]
        };
      });
    } else {
      setNewRoleData(prev => {
        const cur = Array.isArray(prev?.modules) ? prev.modules : [];
        return {
          ...prev,
          modules: cur.includes(modulePath)
            ? cur.filter(m => m !== modulePath)
            : [...cur, modulePath]
        };
      });
    }
  };

  const togglePermission = (permId: string, isEdit: boolean) => {
    if (isEdit) {
      setEditRoleData(prev => {
        const cur = Array.isArray(prev?.permissions) ? prev.permissions : [];
        return {
          ...prev,
          permissions: cur.includes(permId)
            ? cur.filter(p => p !== permId)
            : [...cur, permId]
        };
      });
    } else {
      setNewRoleData(prev => {
        const cur = Array.isArray(prev?.permissions) ? prev.permissions : [];
        return {
          ...prev,
          permissions: cur.includes(permId)
            ? cur.filter(p => p !== permId)
            : [...cur, permId]
        };
      });
    }
  };

  // Filtered Users
  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.department && u.department.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesRole = roleFilter === 'all' || u.roleId === roleFilter;
    const matchesStatus = statusFilter === 'all' || u.status === statusFilter;
    return matchesSearch && matchesRole && matchesStatus;
  });

  const getRoleBadgeClass = (color?: string) => {
    const match = ROLE_COLORS.find(c => c.value === color);
    return match ? match.class : 'bg-primary/10 text-primary border-primary/20';
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            User & Role Security Access (RBAC)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage authenticated plant personnel, security roles, and granular module access across MySQL.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCreateRoleDialogOpen(true)}>
            <Shield className="h-4 w-4 mr-2 text-primary" />
            New Custom Role
          </Button>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Plant Operator
          </Button>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-medium">Total Registered Users</CardDescription>
            <CardTitle className="text-2xl font-bold text-foreground">{users.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground flex items-center gap-1">
            <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
            <span>{users.filter(u => u.status === 'active').length} Active in Plant</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-medium">Security Roles</CardDescription>
            <CardTitle className="text-2xl font-bold text-foreground">{roles.length}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            <span>{roles.filter(r => r.isSystem).length} System · {roles.filter(r => !r.isSystem).length} Custom</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-medium">Current Session</CardDescription>
            <CardTitle className="text-lg font-bold truncate text-primary">{currentUser?.name?.split('(')[0] || 'Administrator'}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground truncate">
            Role: <span className="font-semibold">{currentUser?.roleName || 'Plant Head / Admin'}</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-medium">Access Control Mode</CardDescription>
            <CardTitle className="text-lg font-bold text-emerald-500">Live MySQL RBAC</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Tables: <span className="font-mono text-[11px]">users, roles, audit_logs</span>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as any)} className="space-y-4">
        <TabsList className="grid w-full sm:w-auto grid-cols-3">
          <TabsTrigger value="users" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span>Personnel ({users.length})</span>
          </TabsTrigger>
          <TabsTrigger value="roles" className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            <span>Security Matrix ({roles.length})</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span>Audit Trail ({auditLogs.length})</span>
          </TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------- */}
        {/* TAB 1: USERS (PERSONNEL)                            */}
        {/* ---------------------------------------------------- */}
        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-semibold">Authorized Operators & Staff</CardTitle>
                  <CardDescription>Manage user credentials, operational roles, and access status</CardDescription>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative w-full sm:w-60">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search users..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-8 text-sm"
                    />
                  </div>
                  <Select value={roleFilter} onValueChange={setRoleFilter}>
                    <SelectTrigger className="w-full sm:w-40 text-sm">
                      <SelectValue placeholder="All Roles" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-32 text-sm">
                      <SelectValue placeholder="All Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-muted-foreground text-xs uppercase font-semibold">
                    <tr>
                      <th className="px-4 py-3">User & Contact</th>
                      <th className="px-4 py-3">Security Role</th>
                      <th className="px-4 py-3">Department & Shift</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Last Login</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                          No users matched your query. Click "Add Plant Operator" to create one.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((u) => {
                        const userRole = roles.find(r => r.id === u.roleId);
                        const isSelf = u.id === currentUser?.id;
                        const isPrimaryAdmin = u.username === 'admin' || u.id === 'USR-001';

                        return (
                          <tr key={u.id} className="hover:bg-muted/40 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="h-9 w-9 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary text-xs">
                                  {u.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                                    <span>{u.name}</span>
                                    {isSelf && (
                                      <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.2 rounded font-mono font-bold">
                                        You
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-muted-foreground font-mono">
                                    @{u.username} · {u.email}
                                  </div>
                                  {u.phone && (
                                    <div className="text-[11px] text-muted-foreground">📞 {u.phone}</div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <Badge variant="outline" className={`font-medium text-xs ${getRoleBadgeClass(userRole?.color)}`}>
                                {u.roleName || userRole?.name || u.roleId}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">
                              <div className="font-medium text-xs text-foreground">{u.department || 'Operations'}</div>
                              <div className="text-[11px] text-muted-foreground">{u.shift || 'General Shift'}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <Badge
                                  className={
                                    u.status === 'active'
                                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                      : 'bg-muted text-muted-foreground border-border'
                                  }
                                >
                                  {u.status.toUpperCase()}
                                </Badge>
                                {!isPrimaryAdmin && !isSelf && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                    onClick={() => handleToggleUserStatus(u)}
                                    title={u.status === 'active' ? 'Deactivate User' : 'Activate User'}
                                  >
                                    {u.status === 'active' ? <UserX className="h-3.5 w-3.5 text-amber-500" /> : <UserCheck className="h-3.5 w-3.5 text-emerald-500" />}
                                  </Button>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'Never'}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 px-2.5 text-xs gap-1"
                                  onClick={() => openEditUser(u)}
                                >
                                  <Edit2 className="h-3.5 w-3.5" />
                                  <span>Edit</span>
                                </Button>

                                {!isPrimaryAdmin && !isSelf && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-2 text-destructive hover:bg-destructive/10 border-destructive/30"
                                    onClick={() => openDeleteUser(u)}
                                    title="Delete User"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------- */}
        {/* TAB 2: ROLES & RBAC MATRIX                           */}
        {/* ---------------------------------------------------- */}
        <TabsContent value="roles" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">Configured Security Roles & Access Matrix</h2>
              <p className="text-xs text-muted-foreground">Assign route authorization and functional privileges to each role</p>
            </div>
            <Button size="sm" onClick={() => setCreateRoleDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Custom Role
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roles.map((r) => {
              const assignedCount = users.filter((u) => u.roleId === r.id).length;
              const isSystem = Boolean(r.isSystem);

              return (
                <Card key={r.id} className="border-border hover:border-primary/50 transition-colors flex flex-col justify-between shadow-sm">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={`text-xs font-mono font-bold ${getRoleBadgeClass(r.color)}`}>
                          {r.id}
                        </Badge>
                        {isSystem ? (
                          <Badge variant="secondary" className="text-[10px] uppercase font-semibold">
                            System
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] uppercase text-primary border-primary/30">
                            Custom
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs font-semibold text-muted-foreground">
                        {assignedCount} {assignedCount === 1 ? 'user' : 'users'}
                      </span>
                    </div>
                    <CardTitle className="text-base font-bold text-foreground">{r.name}</CardTitle>
                    <CardDescription className="text-xs line-clamp-2 mt-1 min-h-[32px]">{r.description || 'No description provided.'}</CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-3 pt-0 flex-1">
                    {/* Permitted Modules */}
                    <div>
                      <div className="text-[11px] uppercase font-semibold text-muted-foreground mb-1.5 tracking-wider flex items-center justify-between">
                        <span>Permitted Modules</span>
                        <span className="font-mono">{(Array.isArray(r.modules) ? r.modules : []).length}/{AVAILABLE_MODULES.length}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {AVAILABLE_MODULES.map((m) => {
                          const mods = Array.isArray(r.modules) ? r.modules : [];
                          const hasMod = mods.includes(m.path) || (m.path === '/' && mods.includes('/'));
                          return (
                            <span
                              key={m.id}
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                                hasMod
                                  ? 'bg-primary/10 text-primary border-primary/20 font-semibold'
                                  : 'bg-muted/40 text-muted-foreground/40 border-transparent line-through'
                              }`}
                              title={m.label}
                            >
                              {m.id === '/' ? '/dashboard' : m.id}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {/* Functional Privileges */}
                    <div>
                      <div className="text-[11px] uppercase font-semibold text-muted-foreground mb-1.5 tracking-wider flex items-center justify-between">
                        <span>Privileges ({(Array.isArray(r.permissions) ? r.permissions : []).length})</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(Array.isArray(r.permissions) ? r.permissions : []).map((p) => (
                          <Badge key={p} variant="secondary" className="text-[10px] font-mono py-0">
                            {p}
                          </Badge>
                        ))}
                        {(!Array.isArray(r.permissions) || r.permissions.length === 0) && (
                          <span className="text-xs text-muted-foreground italic">No functional privileges assigned</span>
                        )}
                      </div>
                    </div>
                  </CardContent>

                  <CardFooter className="pt-3 border-t border-border flex items-center justify-between">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5 text-xs font-semibold"
                      onClick={() => openEditRole(r)}
                    >
                      <Sliders className="h-3.5 w-3.5 text-primary" />
                      <span>Configure Permissions</span>
                    </Button>

                    {!isSystem && assignedCount === 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-2 h-8 w-8 text-destructive hover:bg-destructive/10"
                        onClick={() => openDeleteRole(r)}
                        title="Delete Role"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* ---------------------------------------------------- */}
        {/* TAB 3: AUDIT TRAIL                                   */}
        {/* ---------------------------------------------------- */}
        <TabsContent value="audit" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">Security & Access Audit Trail</CardTitle>
                  <CardDescription>Live log of authentication, credential changes, and RBAC actions</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={fetchData}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  Refresh Logs
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-muted-foreground text-xs uppercase font-semibold">
                    <tr>
                      <th className="px-4 py-3">Timestamp</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Module</th>
                      <th className="px-4 py-3">Entity Details</th>
                      <th className="px-4 py-3">Severity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                          No audit entries recorded yet.
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-muted/30">
                          <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">
                            {log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Just now'}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs font-bold text-foreground">
                            {log.action}
                          </td>
                          <td className="px-4 py-2.5 text-xs">
                            <Badge variant="outline" className="uppercase text-[10px]">
                              {log.module}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {log.details || log.entity_id || 'System event'}
                          </td>
                          <td className="px-4 py-2.5 text-xs">
                            <Badge
                              className={
                                log.severity === 'warning'
                                  ? 'bg-amber-500/20 text-amber-600 border-amber-500/30'
                                  : log.severity === 'error'
                                  ? 'bg-destructive/20 text-destructive border-destructive/30'
                                  : 'bg-primary/10 text-primary border-primary/20'
                              }
                            >
                              {(log.severity || 'info').toUpperCase()}
                            </Badge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ---------------------------------------------------- */}
      {/* DIALOG 1: ADD PLANT OPERATOR (CREATE USER)          */}
      {/* ---------------------------------------------------- */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleCreateUser}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-primary" />
                <span>Add Plant Operator</span>
              </DialogTitle>
              <DialogDescription>
                Provision a new operator profile with designated RBAC security role.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-4 text-sm">
              <div className="space-y-1">
                <Label htmlFor="create-fullname">Full Name *</Label>
                <Input
                  id="create-fullname"
                  placeholder="e.g. Anand Shinde"
                  value={newUserData.name}
                  onChange={(e) => setNewUserData({ ...newUserData, name: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="create-username">Username *</Label>
                  <Input
                    id="create-username"
                    placeholder="e.g. anand.wb"
                    value={newUserData.username}
                    onChange={(e) => setNewUserData({ ...newUserData, username: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="create-password">Password *</Label>
                  <div className="relative">
                    <Input
                      id="create-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="e.g. scale123"
                      value={newUserData.password}
                      onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="create-email">Email Address *</Label>
                <Input
                  id="create-email"
                  type="email"
                  placeholder="e.g. anand@dharanicotton.com"
                  value={newUserData.email}
                  onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="create-role">Security Role *</Label>
                <Select
                  value={newUserData.roleId}
                  onValueChange={(val) => setNewUserData({ ...newUserData, roleId: val })}
                >
                  <SelectTrigger id="create-role">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="create-dept">Department</Label>
                  <Input
                    id="create-dept"
                    placeholder="e.g. Weighbridge"
                    value={newUserData.department}
                    onChange={(e) => setNewUserData({ ...newUserData, department: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="create-phone">Phone</Label>
                  <Input
                    id="create-phone"
                    placeholder="+91 98200..."
                    value={newUserData.phone}
                    onChange={(e) => setNewUserData({ ...newUserData, phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="create-shift">Assigned Shift</Label>
                <Select
                  value={newUserData.shift}
                  onValueChange={(val) => setNewUserData({ ...newUserData, shift: val })}
                >
                  <SelectTrigger id="create-shift">
                    <SelectValue placeholder="Select shift" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="General Shift (08:00 - 18:00)">General Shift (08:00 - 18:00)</SelectItem>
                    <SelectItem value="Morning Shift (06:00 - 14:00)">Morning Shift (06:00 - 14:00)</SelectItem>
                    <SelectItem value="Evening Shift (14:00 - 22:00)">Evening Shift (14:00 - 22:00)</SelectItem>
                    <SelectItem value="Night Shift (22:00 - 06:00)">Night Shift (22:00 - 06:00)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Create Operator</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- */}
      {/* DIALOG 2: EDIT PLANT OPERATOR (UPDATE USER)          */}
      {/* ---------------------------------------------------- */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleUpdateUser}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Edit2 className="h-5 w-5 text-primary" />
                <span>Edit Plant Operator</span>
              </DialogTitle>
              <DialogDescription>
                Update operator contact details, security role, or reset password.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-4 text-sm">
              <div className="space-y-1">
                <Label htmlFor="edit-fullname">Full Name *</Label>
                <Input
                  id="edit-fullname"
                  value={editUserData.name}
                  onChange={(e) => setEditUserData({ ...editUserData, name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="edit-email">Email Address *</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editUserData.email}
                  onChange={(e) => setEditUserData({ ...editUserData, email: e.target.value })}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-role">Security Role</Label>
                  <Select
                    value={editUserData.roleId}
                    onValueChange={(val) => setEditUserData({ ...editUserData, roleId: val })}
                  >
                    <SelectTrigger id="edit-role">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="edit-status">Account Status</Label>
                  <Select
                    value={editUserData.status}
                    onValueChange={(val: any) => setEditUserData({ ...editUserData, status: val })}
                  >
                    <SelectTrigger id="edit-status">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="edit-dept">Department</Label>
                  <Input
                    id="edit-dept"
                    value={editUserData.department}
                    onChange={(e) => setEditUserData({ ...editUserData, department: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-phone">Phone</Label>
                  <Input
                    id="edit-phone"
                    value={editUserData.phone}
                    onChange={(e) => setEditUserData({ ...editUserData, phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="edit-shift">Assigned Shift</Label>
                <Select
                  value={editUserData.shift}
                  onValueChange={(val) => setEditUserData({ ...editUserData, shift: val })}
                >
                  <SelectTrigger id="edit-shift">
                    <SelectValue placeholder="Select shift" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="General Shift (08:00 - 18:00)">General Shift (08:00 - 18:00)</SelectItem>
                    <SelectItem value="Morning Shift (06:00 - 14:00)">Morning Shift (06:00 - 14:00)</SelectItem>
                    <SelectItem value="Evening Shift (14:00 - 22:00)">Evening Shift (14:00 - 22:00)</SelectItem>
                    <SelectItem value="Night Shift (22:00 - 06:00)">Night Shift (22:00 - 06:00)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1 pt-2 border-t border-border">
                <Label htmlFor="edit-newpass" className="text-muted-foreground flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5 text-primary" />
                  <span>Reset Password (leave blank to keep current)</span>
                </Label>
                <Input
                  id="edit-newpass"
                  type="password"
                  placeholder="Enter new password..."
                  value={editUserData.newPassword}
                  onChange={(e) => setEditUserData({ ...editUserData, newPassword: e.target.value })}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Save Changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- */}
      {/* DIALOG 3: DELETE USER CONFIRMATION                   */}
      {/* ---------------------------------------------------- */}
      <AlertDialog open={deleteUserDialogOpen} onOpenChange={setDeleteUserDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <span>Delete User Account</span>
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete operator <strong>{selectedUser?.name}</strong> (@{selectedUser?.username})?
              This action removes their login access immediately from the plant MySQL database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              Delete User
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------------------------------------------------- */}
      {/* DIALOG 4: CREATE CUSTOM ROLE                         */}
      {/* ---------------------------------------------------- */}
      <Dialog open={createRoleDialogOpen} onOpenChange={setCreateRoleDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleCreateRole}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                <span>Create Custom Security Role</span>
              </DialogTitle>
              <DialogDescription>
                Define a new role with specific operational module access and functional permissions.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="role-name">Role Name *</Label>
                  <Input
                    id="role-name"
                    placeholder="e.g. Shift Supervisor"
                    value={newRoleData.name}
                    onChange={(e) => setNewRoleData({ ...newRoleData, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="role-id">Role Identifier (Slug)</Label>
                  <Input
                    id="role-id"
                    placeholder="e.g. shift_supervisor"
                    value={newRoleData.id}
                    onChange={(e) => setNewRoleData({ ...newRoleData, id: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="role-desc">Role Description</Label>
                <Input
                  id="role-desc"
                  placeholder="e.g. Oversees scale operators and authorizes tolerance overrides"
                  value={newRoleData.description}
                  onChange={(e) => setNewRoleData({ ...newRoleData, description: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <Label>Theme Color</Label>
                <div className="flex items-center gap-2">
                  {ROLE_COLORS.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setNewRoleData({ ...newRoleData, color: c.value })}
                      className={`h-7 px-3 rounded-md text-xs font-semibold border transition-all ${
                        newRoleData.color === c.value ? 'ring-2 ring-primary ring-offset-2' : 'opacity-70 hover:opacity-100'
                      } ${c.class}`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Permitted Modules Checkboxes */}
              <div className="space-y-2 pt-2 border-t border-border">
                <Label className="font-semibold text-foreground">Permitted Modules ({(newRoleData.modules || []).length}/{AVAILABLE_MODULES.length})</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {AVAILABLE_MODULES.map((m) => {
                    const checked = (newRoleData.modules || []).includes(m.path);
                    return (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => toggleModule(m.path, false)}
                        className={`flex items-start gap-2.5 p-2 rounded-md border text-left cursor-pointer select-none transition-colors ${
                          checked ? 'bg-primary/5 border-primary/40 shadow-xs' : 'hover:bg-muted/40 border-border'
                        }`}
                      >
                        <div
                          className={`mt-0.5 h-4 w-4 shrink-0 rounded-sm border flex items-center justify-center transition-colors ${
                            checked
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'border-muted-foreground/40 bg-background'
                          }`}
                        >
                          {checked && <Check className="h-3 w-3 stroke-[3]" />}
                        </div>
                        <div>
                          <div className="font-medium text-xs text-foreground">{m.label}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">{m.path}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Functional Privileges Checkboxes */}
              <div className="space-y-2 pt-2 border-t border-border">
                <Label className="font-semibold text-foreground">Functional Privileges ({(newRoleData.permissions || []).length}/{AVAILABLE_PERMISSIONS.length})</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {AVAILABLE_PERMISSIONS.map((p) => {
                    const checked = (newRoleData.permissions || []).includes(p.id);
                    return (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => togglePermission(p.id, false)}
                        className={`flex items-start gap-2.5 p-2 rounded-md border text-left cursor-pointer select-none transition-colors ${
                          checked ? 'bg-primary/5 border-primary/40 shadow-xs' : 'hover:bg-muted/40 border-border'
                        }`}
                      >
                        <div
                          className={`mt-0.5 h-4 w-4 shrink-0 rounded-sm border flex items-center justify-center transition-colors ${
                            checked
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'border-muted-foreground/40 bg-background'
                          }`}
                        >
                          {checked && <Check className="h-3 w-3 stroke-[3]" />}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-xs text-foreground flex items-center justify-between">
                            <span>{p.label}</span>
                            <Badge variant="outline" className="text-[9px] py-0">{p.category}</Badge>
                          </div>
                          <div className="text-[11px] text-muted-foreground">{p.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateRoleDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Create Role</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- */}
      {/* DIALOG 5: EDIT ROLE & PERMISSIONS MATRIX            */}
      {/* ---------------------------------------------------- */}
      <Dialog open={editRoleDialogOpen} onOpenChange={setEditRoleDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleUpdateRole}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sliders className="h-5 w-5 text-primary" />
                <span>Configure RBAC Matrix: {selectedRole?.name}</span>
              </DialogTitle>
              <DialogDescription>
                Customize authorized routes and functional capabilities for this role.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4 text-sm">
              <div className="space-y-1">
                <Label htmlFor="edit-role-name">Role Name *</Label>
                <Input
                  id="edit-role-name"
                  value={editRoleData.name}
                  onChange={(e) => setEditRoleData({ ...editRoleData, name: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="edit-role-desc">Description</Label>
                <Input
                  id="edit-role-desc"
                  value={editRoleData.description}
                  onChange={(e) => setEditRoleData({ ...editRoleData, description: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <Label>Theme Color</Label>
                <div className="flex items-center gap-2">
                  {ROLE_COLORS.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setEditRoleData({ ...editRoleData, color: c.value })}
                      className={`h-7 px-3 rounded-md text-xs font-semibold border transition-all ${
                        editRoleData.color === c.value ? 'ring-2 ring-primary ring-offset-2' : 'opacity-70 hover:opacity-100'
                      } ${c.class}`}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Permitted Modules Checkboxes */}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <Label className="font-semibold text-foreground">Permitted Modules ({(editRoleData.modules || []).length}/{AVAILABLE_MODULES.length})</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px]"
                    onClick={() => {
                      if ((editRoleData.modules || []).length === AVAILABLE_MODULES.length) {
                        setEditRoleData(prev => ({ ...prev, modules: ['/'] }));
                      } else {
                        setEditRoleData(prev => ({ ...prev, modules: AVAILABLE_MODULES.map(m => m.path) }));
                      }
                    }}
                  >
                    {(editRoleData.modules || []).length === AVAILABLE_MODULES.length ? 'Deselect All' : 'Select All'}
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {AVAILABLE_MODULES.map((m) => {
                    const checked = (editRoleData.modules || []).includes(m.path);
                    return (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => toggleModule(m.path, true)}
                        className={`flex items-start gap-2.5 p-2 rounded-md border text-left cursor-pointer select-none transition-colors ${
                          checked ? 'bg-primary/5 border-primary/40 shadow-xs' : 'hover:bg-muted/40 border-border'
                        }`}
                      >
                        <div
                          className={`mt-0.5 h-4 w-4 shrink-0 rounded-sm border flex items-center justify-center transition-colors ${
                            checked
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'border-muted-foreground/40 bg-background'
                          }`}
                        >
                          {checked && <Check className="h-3 w-3 stroke-[3]" />}
                        </div>
                        <div>
                          <div className="font-medium text-xs text-foreground">{m.label}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">{m.path}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Functional Privileges Checkboxes */}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <Label className="font-semibold text-foreground">Functional Privileges ({(editRoleData.permissions || []).length}/{AVAILABLE_PERMISSIONS.length})</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[11px]"
                    onClick={() => {
                      if ((editRoleData.permissions || []).length === AVAILABLE_PERMISSIONS.length) {
                        setEditRoleData(prev => ({ ...prev, permissions: [] }));
                      } else {
                        setEditRoleData(prev => ({ ...prev, permissions: AVAILABLE_PERMISSIONS.map(p => p.id) }));
                      }
                    }}
                  >
                    {(editRoleData.permissions || []).length === AVAILABLE_PERMISSIONS.length ? 'Deselect All' : 'Select All'}
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {AVAILABLE_PERMISSIONS.map((p) => {
                    const checked = (editRoleData.permissions || []).includes(p.id);
                    return (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => togglePermission(p.id, true)}
                        className={`flex items-start gap-2.5 p-2 rounded-md border text-left cursor-pointer select-none transition-colors ${
                          checked ? 'bg-primary/5 border-primary/40 shadow-xs' : 'hover:bg-muted/40 border-border'
                        }`}
                      >
                        <div
                          className={`mt-0.5 h-4 w-4 shrink-0 rounded-sm border flex items-center justify-center transition-colors ${
                            checked
                              ? 'bg-primary border-primary text-primary-foreground'
                              : 'border-muted-foreground/40 bg-background'
                          }`}
                        >
                          {checked && <Check className="h-3 w-3 stroke-[3]" />}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-xs text-foreground flex items-center justify-between">
                            <span>{p.label}</span>
                            <Badge variant="outline" className="text-[9px] py-0">{p.category}</Badge>
                          </div>
                          <div className="text-[11px] text-muted-foreground">{p.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditRoleDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Save Privileges</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------------------------------------------------- */}
      {/* DIALOG 6: DELETE ROLE CONFIRMATION                   */}
      {/* ---------------------------------------------------- */}
      <AlertDialog open={deleteRoleDialogOpen} onOpenChange={setDeleteRoleDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <span>Delete Security Role</span>
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete custom role <strong>"{selectedRole?.name}"</strong> ({selectedRole?.id})?
              This action cannot be undone. System roles cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRole} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              Delete Role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
