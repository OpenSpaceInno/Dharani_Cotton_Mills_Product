export interface User {
  id: string;
  username: string;
  name: string;
  email: string;
  roleId: string;
  roleName: string;
  phone?: string;
  department?: string;
  shift?: string;
  status: 'active' | 'inactive' | 'suspended';
  avatar?: string;
  lastLogin?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  color: string;
  modules: string[];
  permissions: string[];
  isSystem: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthSession {
  user: User;
  role: Role;
  token: string;
  expiresAt: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  token: string;
  user: User;
  role: Role;
  message?: string;
}

export const DEMO_USERS = [
  { username: 'superadmin', name: 'Super Administrator', roleName: 'Super Admin', roleId: 'super_admin', defaultPass: 'superadmin123', color: 'red', department: 'Executive Management / IT' },
  { username: 'admin', name: 'Arjun', roleName: 'Plant Head / Admin', roleId: 'admin', defaultPass: 'Admin@123', color: 'purple', department: 'Plant Management' },
  { username: 'weighbridge.op', name: 'Akhil', roleName: 'Weighbridge Scale', roleId: 'weighbridge_operator', defaultPass: 'scale123', color: 'blue', department: 'Weighbridge Operations' },
  { username: 'gate.security', name: 'Mahesh', roleName: 'Gate Security', roleId: 'gate_operator', defaultPass: 'gate123', color: 'emerald', department: 'Security & Gate Control' },
];

/**
 * Checks if the user/role has Administrator or Super Admin privileges.
 */
export function isAdminRole(user: User | null | undefined, role: Role | null | undefined): boolean {
  const roleId = String(role?.id || user?.roleId || '').toLowerCase();
  const roleName = String(role?.name || user?.roleName || '').toLowerCase();
  const username = String(user?.username || '').toLowerCase();
  const perms = Array.isArray(role?.permissions) ? role.permissions : [];

  return (
    roleId === 'super_admin' ||
    roleId === 'superadmin' ||
    roleId === 'admin' ||
    username === 'superadmin' ||
    username === 'admin' ||
    roleName.includes('super admin') ||
    roleName.includes('plant head') ||
    roleName.includes('plant manager') ||
    perms.includes('all:manage') ||
    perms.includes('config:manage')
  );
}

/**
 * Checks if the given role has a specific permission.
 * 'all:manage' grants universal access.
 * Super Admin has universal access to all privileges.
 */
export function hasPermission(role: Role | null | undefined, permission: string): boolean {
  if (!role) return false;
  const roleId = (role.id || '').toLowerCase();
  const roleName = (role.name || '').toLowerCase();
  const perms = Array.isArray(role.permissions) ? role.permissions : [];

  if (
    roleId === 'super_admin' ||
    roleId === 'superadmin' ||
    roleName.includes('super admin') ||
    perms.includes('all:manage')
  ) {
    return true;
  }

  return perms.includes(permission);
}

/**
 * Checks if the given role can access a specific route pathname.
 * Root dashboard '/' is always accessible if authenticated.
 * Super Admin has access to all modules and routes unconditionally.
 * All other roles (including Plant Head / Admin) are strictly governed by their configured modules list.
 */
export function canAccessRoute(role: Role | null | undefined, path: string): boolean {
  if (!role) return false;
  if (path === '/' || path === '/login') return true;

  const roleId = (role.id || '').toLowerCase();
  const roleName = (role.name || '').toLowerCase();
  const perms = Array.isArray(role.permissions) ? role.permissions : [];

  // Super Admin or roles with explicit 'all:manage' master privilege have unrestricted access
  if (
    roleId === 'super_admin' ||
    roleId === 'superadmin' ||
    roleName.includes('super admin') ||
    perms.includes('all:manage')
  ) {
    return true;
  }

  // Exact match or alias match for routes configured in role.modules
  const mods = Array.isArray(role.modules) ? role.modules : [];
  return mods.some(mod => {
    if (mod === path) return true;
    if (mod === '/settings' && (path === '/company-settings' || path.startsWith('/settings'))) return true;
    if (mod === '/company-settings' && (path === '/settings' || path.startsWith('/company-settings'))) return true;
    if (mod !== '/' && path.startsWith(mod)) return true;
    return false;
  });
}
