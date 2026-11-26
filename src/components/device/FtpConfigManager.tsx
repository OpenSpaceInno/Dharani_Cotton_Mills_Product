import React, { useState, useEffect } from 'react';
import { FolderGit2, Plus, RefreshCw, Trash2, Edit3, CheckCircle, Activity, Star, AlertCircle, Shield, HardDrive, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FtpDeviceConfig } from '@/types/deviceConfig';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export const FtpConfigManager: React.FC = () => {
  const [ftpConfigs, setFtpConfigs] = useState<FtpDeviceConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<FtpDeviceConfig | null>(null);
  const [isTestingInDialog, setIsTestingInDialog] = useState(false);
  const [formData, setFormData] = useState({
    name: 'Cloud FTP Camera Storage',
    host: 'ftp.activitsol.com',
    port: 2121,
    username: 'demo',
    password: 'Password@123',
    remote_dir: '/Dharani',
    secure: false,
    passive: true,
    is_active: false,
    status: 'online' as 'online' | 'offline' | 'standby',
    purpose: 'anpr_snapshots' as 'anpr_snapshots' | 'cloud_backup' | 'logs',
  });

  const fetchConfigs = async () => {
    try {
      setLoading(true);
      const data = await api.getFtpConfigs();
      setFtpConfigs(Array.isArray(data) ? data : []);
    } catch (err: any) {
      toast.error('Failed to load FTP configurations: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const handleOpenAdd = () => {
    setEditingConfig(null);
    setFormData({
      name: 'New FTP Server Profile',
      host: 'ftp.activitsol.com',
      port: 2121,
      username: 'demo',
      password: 'Password@123',
      remote_dir: '/Dharani',
      secure: false,
      passive: true,
      is_active: ftpConfigs.length === 0,
      status: 'online',
      purpose: 'anpr_snapshots',
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (cfg: FtpDeviceConfig) => {
    setEditingConfig(cfg);
    setFormData({
      name: cfg.name,
      host: cfg.host,
      port: Number(cfg.port) || 2121,
      username: cfg.username,
      password: cfg.password || 'Password@123',
      remote_dir: cfg.remote_dir || '/Dharani',
      secure: Boolean(cfg.secure),
      passive: cfg.passive !== false,
      is_active: Boolean(cfg.is_active),
      status: cfg.status || 'online',
      purpose: cfg.purpose || 'anpr_snapshots',
    });
    setIsDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.host || !formData.username) {
      toast.error('Host and Username are required.');
      return;
    }

    try {
      if (editingConfig) {
        await api.updateFtpConfig(editingConfig.id, formData);
        toast.success(`FTP configuration ${formData.name} updated!`);
      } else {
        await api.createFtpConfig(formData);
        toast.success(`FTP profile ${formData.name} added!`);
      }
      setIsDialogOpen(false);
      fetchConfigs();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save FTP profile.');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to remove FTP profile "${name}"?`)) return;
    try {
      await api.deleteFtpConfig(id);
      toast.success(`FTP profile ${name} removed.`);
      fetchConfigs();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete FTP profile.');
    }
  };

  const handleActivate = async (id: string, name: string) => {
    try {
      await api.activateFtpConfig(id);
      toast.success(`${name} set as primary active FTP channel!`);
      fetchConfigs();
    } catch (err: any) {
      toast.error('Failed to activate FTP channel: ' + err.message);
    }
  };

  const handleTestConnection = async (cfg: FtpDeviceConfig) => {
    try {
      setTestingId(cfg.id);
      const res = await api.testFtpProfile({
        host: cfg.host,
        port: cfg.port,
        username: cfg.username,
        password: cfg.password || 'Password@123',
        secure: cfg.secure,
        remote_dir: cfg.remote_dir,
      });

      setTestResults(prev => ({
        ...prev,
        [cfg.id]: {
          success: res.success,
          message: res.message || (res.success ? 'FTP connection successful' : (res.error || 'Failed')),
        }
      }));

      if (res.success) {
        toast.success(res.message || `FTP connection to ${cfg.host} verified!`);
      } else {
        toast.error(res.error || 'FTP Connection failed');
      }
    } catch (err: any) {
      setTestResults(prev => ({
        ...prev,
        [cfg.id]: {
          success: false,
          message: err.message,
        }
      }));
      toast.error('FTP test failed: ' + err.message);
    } finally {
      setTestingId(null);
    }
  };

  const handleTestInDialog = async () => {
    try {
      setIsTestingInDialog(true);
      const res = await api.testFtpProfile({
        host: formData.host,
        port: formData.port,
        username: formData.username,
        password: formData.password,
        secure: formData.secure,
        remote_dir: formData.remote_dir,
      });
      if (res.success) {
        toast.success(res.message || 'FTP Connection test succeeded!');
      } else {
        toast.error(res.error || 'FTP Connection failed');
      }
    } catch (err: any) {
      toast.error('Test error: ' + err.message);
    } finally {
      setIsTestingInDialog(false);
    }
  };

  const formatPurpose = (p: string) => {
    switch (p) {
      case 'anpr_snapshots': return 'ANPR Camera Snapshots';
      case 'cloud_backup': return 'Cloud Database & Slip Backup';
      case 'logs': return 'System Diagnostic Logs';
      default: return p;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card p-4 rounded-xl border border-border">
        <div>
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <FolderGit2 className="h-5 w-5 text-primary" />
            FTP Server Profiles & Snapshot Storage
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure central FTP / SFTP servers for camera plate snapshots, remote backups, and watcher poll paths.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchConfigs} disabled={loading} className="text-xs">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={handleOpenAdd} className="text-xs">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add FTP Profile
          </Button>
        </div>
      </div>

      {/* Grid of FTP Profiles */}
      {loading && ftpConfigs.length === 0 ? (
        <div className="flex items-center justify-center p-12 text-muted-foreground text-sm">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading FTP servers...
        </div>
      ) : ftpConfigs.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <p className="text-sm text-muted-foreground mb-3">No FTP configurations found.</p>
          <Button size="sm" onClick={handleOpenAdd}>
            <Plus className="h-4 w-4 mr-1.5" /> Add FTP Server
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ftpConfigs.map((cfg) => {
            const isActive = Boolean(cfg.is_active);
            const isTesting = testingId === cfg.id;
            const res = testResults[cfg.id];

            return (
              <Card
                key={cfg.id}
                className={`border transition-all flex flex-col justify-between ${
                  isActive ? 'border-primary shadow-sm bg-primary/[0.02]' : 'border-border hover:border-primary/40'
                }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                        isActive ? 'bg-primary text-primary-foreground font-bold' : 'bg-muted text-muted-foreground'
                      }`}>
                        <HardDrive className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                          {cfg.name}
                          {isActive && (
                            <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px] px-1.5 py-0 flex items-center gap-1">
                              <Star className="h-3 w-3 fill-primary" /> Active Channel
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="text-xs mt-0.5 font-mono">
                          {cfg.host}:{cfg.port}
                        </CardDescription>
                      </div>
                    </div>

                    <Badge
                      className={
                        cfg.status === 'online'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[11px]'
                          : 'bg-muted text-muted-foreground text-[11px]'
                      }
                    >
                      {cfg.status.toUpperCase()}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pt-0">
                  <div className="grid grid-cols-3 gap-2 text-xs bg-muted/40 p-2.5 rounded-lg border border-border/50">
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground block">User</span>
                      <span className="font-mono font-medium text-foreground">{cfg.username}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Remote Folder</span>
                      <span className="font-mono font-medium text-foreground">{cfg.remote_dir || '/'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Security</span>
                      <span className="font-medium text-foreground">{cfg.secure ? 'FTPS (TLS)' : 'Standard FTP'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] bg-background">
                      {formatPurpose(cfg.purpose)}
                    </Badge>
                    {Boolean(cfg.passive) && (
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        Passive Mode
                      </Badge>
                    )}
                  </div>

                  {res && (
                    <div
                      className={`text-xs p-2 rounded flex items-center gap-2 ${
                        res.success
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                          : 'bg-destructive/10 text-destructive border border-destructive/20'
                      }`}
                    >
                      {res.success ? <CheckCircle className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
                      <span className="truncate">{res.message}</span>
                    </div>
                  )}

                  <div className="pt-2 border-t border-border flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestConnection(cfg)}
                        disabled={isTesting}
                        className="text-xs h-8"
                      >
                        <Activity className={`h-3.5 w-3.5 mr-1.5 ${isTesting ? 'animate-spin text-primary' : 'text-primary'}`} />
                        {isTesting ? 'Testing...' : 'Test FTP'}
                      </Button>

                      {!isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleActivate(cfg.id, cfg.name)}
                          className="text-xs h-8 text-primary hover:bg-primary/10"
                        >
                          <Star className="h-3.5 w-3.5 mr-1" /> Set Active
                        </Button>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenEdit(cfg)}
                        className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Edit3 className="h-3.5 w-3.5 mr-1" /> Edit
                      </Button>
                      {!isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(cfg.id, cfg.name)}
                          className="h-8 px-2.5 text-xs text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle className="text-base font-bold flex items-center gap-2">
                <FolderGit2 className="h-5 w-5 text-primary" />
                {editingConfig ? 'Edit FTP Configuration' : 'Add FTP Server Profile'}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Configure remote FTP/SFTP server credentials for camera ANPR snapshot synchronization.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3.5 py-4 text-xs">
              <div className="space-y-1">
                <Label className="text-xs">Profile Name</Label>
                <Input
                  placeholder="e.g. Central Cloud Storage"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="h-8 text-xs"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs">FTP Host / Server IP</Label>
                  <Input
                    placeholder="ftp.activitsol.com"
                    value={formData.host}
                    onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                    required
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Port</Label>
                  <Input
                    type="number"
                    placeholder="2121"
                    value={formData.port}
                    onChange={(e) => setFormData({ ...formData, port: Number(e.target.value) })}
                    required
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Username</Label>
                  <Input
                    placeholder="demo"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    required
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Password</Label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Remote Directory</Label>
                  <Input
                    placeholder="/Dharani"
                    value={formData.remote_dir}
                    onChange={(e) => setFormData({ ...formData, remote_dir: e.target.value })}
                    className="h-8 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Usage Purpose</Label>
                  <Select
                    value={formData.purpose}
                    onValueChange={(val: any) => setFormData({ ...formData, purpose: val })}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="anpr_snapshots">ANPR Snapshots</SelectItem>
                      <SelectItem value="cloud_backup">Cloud Database Backup</SelectItem>
                      <SelectItem value="logs">Diagnostic Logs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <Label className="text-xs cursor-pointer" htmlFor="ftps-secure">
                    Use FTPS Secure (TLS Encryption)
                  </Label>
                  <Switch
                    id="ftps-secure"
                    checked={formData.secure}
                    onCheckedChange={(c) => setFormData({ ...formData, secure: c })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-xs cursor-pointer" htmlFor="ftp-passive">
                    Enable Passive Mode (PASV)
                  </Label>
                  <Switch
                    id="ftp-passive"
                    checked={formData.passive}
                    onCheckedChange={(c) => setFormData({ ...formData, passive: c })}
                  />
                </div>
              </div>

              <div className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTestInDialog}
                  disabled={isTestingInDialog || !formData.host}
                  className="w-full text-xs h-8"
                >
                  <Activity className={`h-3.5 w-3.5 mr-1.5 ${isTestingInDialog ? 'animate-spin' : ''}`} />
                  {isTestingInDialog ? 'Testing Credentials...' : 'Test Connection Now'}
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setIsDialogOpen(false)} className="text-xs">
                Cancel
              </Button>
              <Button type="submit" size="sm" className="text-xs">
                {editingConfig ? 'Save FTP Profile' : 'Register Profile'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
