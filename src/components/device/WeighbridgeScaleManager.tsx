import React, { useState, useEffect } from 'react';
import { Scale, Plus, RefreshCw, Trash2, Edit3, CheckCircle, Activity, Star, StarOff, Cpu, Radio, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { WeighbridgeScaleDevice } from '@/types/deviceConfig';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export const WeighbridgeScaleManager: React.FC = () => {
  const [devices, setDevices] = useState<WeighbridgeScaleDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  const [liveWeight, setLiveWeight] = useState<number | null>(null);
  const [availablePorts, setAvailablePorts] = useState<string[]>(['COM1', 'COM2', 'COM3', 'COM4']);

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<WeighbridgeScaleDevice | null>(null);
  const [formData, setFormData] = useState({
    device_code: 'VMS',
    display_name: 'Ventek VMS-WB Digital Indicator',
    manufacturer: 'VENTEK',
    model: 'VMS-WB',
    serial_number: '168',
    capacity_kg: 50000,
    port: 'COM3',
    baud_rate: 2400,
    interface_type: 'RS232',
    data_bits: 8,
    stop_bits: 1,
    parity: 'none',
    mode: 'serial' as 'serial' | 'file_monitor' | 'tcp',
    file_path: 'C:\\Weighbridge\\live_weight.txt',
    tcp_host: '127.0.0.1',
    tcp_port: 4001,
    unit_type: 'Qtl',
  });

  const fetchDevices = async () => {
    try {
      setLoading(true);
      const data = await api.getWeighbridgeDevices();
      setDevices(Array.isArray(data) ? data : []);

      // Fetch live reading
      const live = await api.getLiveScaleWeight().catch(() => null);
      if (live && typeof live.weight === 'number') {
        setLiveWeight(live.weight);
      }
    } catch (err: any) {
      toast.error('Failed to load weighbridge devices: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  const handleOpenAdd = () => {
    setEditingDevice(null);
    setFormData({
      device_code: 'SCALE_02',
      display_name: 'Secondary Weighbridge Indicator',
      manufacturer: 'VENTEK',
      model: 'VMS-WB',
      serial_number: 'WB-002',
      capacity_kg: 60000,
      port: 'COM4',
      baud_rate: 2400,
      interface_type: 'RS232',
      data_bits: 8,
      stop_bits: 1,
      parity: 'none',
      mode: 'serial',
      file_path: 'C:\\Weighbridge\\live_weight.txt',
      tcp_host: '127.0.0.1',
      tcp_port: 4001,
      unit_type: 'kg',
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (dev: WeighbridgeScaleDevice) => {
    setEditingDevice(dev);
    setFormData({
      device_code: dev.device_code || 'VMS',
      display_name: dev.display_name,
      manufacturer: dev.manufacturer || 'VENTEK',
      model: dev.model || 'VMS-WB',
      serial_number: dev.serial_number || '',
      capacity_kg: Number(dev.capacity_kg) || 50000,
      port: dev.port || 'COM3',
      baud_rate: Number(dev.baud_rate) || 2400,
      interface_type: dev.interface_type || 'RS232',
      data_bits: Number(dev.data_bits) || 8,
      stop_bits: Number(dev.stop_bits) || 1,
      parity: dev.parity || 'none',
      mode: dev.mode || 'serial',
      file_path: dev.file_path || 'C:\\Weighbridge\\live_weight.txt',
      tcp_host: dev.tcp_host || '127.0.0.1',
      tcp_port: dev.tcp_port || 4001,
      unit_type: dev.unit_type || 'kg',
    });
    setIsDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingDevice) {
        await api.updateWeighbridgeDevice(editingDevice.id, formData);
        toast.success(`Weighbridge indicator ${formData.display_name} updated!`);
      } else {
        await api.createWeighbridgeDevice(formData);
        toast.success(`Weighbridge indicator ${formData.display_name} registered!`);
      }
      setIsDialogOpen(false);
      fetchDevices();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save indicator configuration.');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to remove indicator "${name}"?`)) return;
    try {
      await api.deleteWeighbridgeDevice(id);
      toast.success(`Scale indicator ${name} removed.`);
      fetchDevices();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete scale device.');
    }
  };

  const handleActivate = async (id: string, name: string) => {
    try {
      await api.activateWeighbridgeDevice(id);
      toast.success(`${name} is now the active primary weighbridge scale!`);
      fetchDevices();
    } catch (err: any) {
      toast.error('Failed to switch active indicator: ' + err.message);
    }
  };

  const handleTestConnection = async (dev: WeighbridgeScaleDevice) => {
    try {
      setTestingId(dev.id);
      const res = await api.testWeighbridgeDevice({
        port: dev.port,
        baudRate: dev.baud_rate,
      });

      if (res.allPorts && Array.isArray(res.allPorts)) {
        setAvailablePorts(res.allPorts);
      }

      setTestResult({
        id: dev.id,
        success: res.availableOnSystem,
        message: res.message || (res.availableOnSystem ? `Port ${dev.port} active & responding.` : `Port ${dev.port} not found on system.`),
      });

      if (res.availableOnSystem) {
        toast.success(`Scale indicator on ${dev.port} verified!`);
      } else {
        toast.warning(res.message);
      }
    } catch (err: any) {
      setTestResult({
        id: dev.id,
        success: false,
        message: 'Port test failed: ' + err.message,
      });
      toast.error(err.message);
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card p-4 rounded-xl border border-border">
        <div>
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Scale className="h-5 w-5 text-primary" />
            Weighbridge Scale Digital Indicators & Hardware Ports
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage Ventek / Avery electronic weighbridge indicators, RS232 COM ports, baud rates, and live indicator feeds.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {liveWeight !== null && (
            <div className="hidden md:flex items-center gap-1.5 px-3 py-1 bg-primary/10 rounded-lg border border-primary/20 text-xs">
              <span className="text-muted-foreground font-medium">Live Reading:</span>
              <span className="font-mono font-bold text-primary">{liveWeight.toLocaleString()} kg</span>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={fetchDevices} disabled={loading} className="text-xs">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={handleOpenAdd} className="text-xs">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Scale Device
          </Button>
        </div>
      </div>

      {/* Grid of Weighbridge Devices */}
      {loading && devices.length === 0 ? (
        <div className="flex items-center justify-center p-12 text-muted-foreground text-sm">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading scale indicators...
        </div>
      ) : devices.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <p className="text-sm text-muted-foreground mb-3">No weighbridge indicators configured.</p>
          <Button size="sm" onClick={handleOpenAdd}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Ventek / Avery Indicator
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {devices.map((dev) => {
            const isActive = Boolean(dev.is_active);
            const isTesting = testingId === dev.id;
            const res = testResult?.id === dev.id ? testResult : null;

            return (
              <Card
                key={dev.id}
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
                        <Scale className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                          {dev.display_name}
                          {isActive && (
                            <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px] px-1.5 py-0 flex items-center gap-1">
                              <Star className="h-3 w-3 fill-primary" /> Active Scale
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="text-xs mt-0.5">
                          {dev.manufacturer} {dev.model} · Serial #{dev.serial_number || 'N/A'}
                        </CardDescription>
                      </div>
                    </div>

                    <Badge
                      className={
                        dev.status === 'online'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[11px]'
                          : 'bg-muted text-muted-foreground text-[11px]'
                      }
                    >
                      {dev.status.toUpperCase()}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pt-0">
                  <div className="grid grid-cols-3 gap-2 text-xs bg-muted/40 p-2.5 rounded-lg border border-border/50">
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Port & Speed</span>
                      <span className="font-mono font-medium text-foreground">{dev.port} @ {dev.baud_rate} baud</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Interface</span>
                      <span className="font-medium text-foreground">{dev.interface_type} ({dev.mode})</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Capacity</span>
                      <span className="font-medium text-foreground">{Number(dev.capacity_kg).toLocaleString()} kg</span>
                    </div>
                  </div>

                  {res && (
                    <div
                      className={`text-xs p-2 rounded flex items-center gap-2 ${
                        res.success
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                      }`}
                    >
                      {res.success ? <CheckCircle className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
                      <span className="truncate">{res.message}</span>
                    </div>
                  )}

                  <div className="pt-2 border-t border-border flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestConnection(dev)}
                        disabled={isTesting}
                        className="text-xs h-8"
                      >
                        <Activity className={`h-3.5 w-3.5 mr-1.5 ${isTesting ? 'animate-spin text-primary' : 'text-primary'}`} />
                        {isTesting ? 'Testing...' : 'Probe Port'}
                      </Button>

                      {!isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleActivate(dev.id, dev.display_name)}
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
                        onClick={() => handleOpenEdit(dev)}
                        className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Edit3 className="h-3.5 w-3.5 mr-1" /> Edit
                      </Button>
                      {!isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(dev.id, dev.display_name)}
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
        <DialogContent className="max-w-lg">
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle className="text-base font-bold flex items-center gap-2">
                <Scale className="h-5 w-5 text-primary" />
                {editingDevice ? 'Edit Scale Configuration' : 'Register Weighbridge Scale'}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Configure serial communication parameters (RS232 / COM port) for weighbridge gross/tare weighments.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3.5 py-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Device Code</Label>
                  <Input
                    placeholder="e.g. VMS"
                    value={formData.device_code}
                    onChange={(e) => setFormData({ ...formData, device_code: e.target.value })}
                    required
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Display Name</Label>
                  <Input
                    placeholder="e.g. Main Scale Indicator"
                    value={formData.display_name}
                    onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                    required
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Serial COM Port</Label>
                  <Input
                    placeholder="COM3"
                    value={formData.port}
                    onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                    required
                    className="h-8 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Baud Rate</Label>
                  <Select
                    value={formData.baud_rate.toString()}
                    onValueChange={(val) => setFormData({ ...formData, baud_rate: Number(val) })}
                  >
                    <SelectTrigger className="h-8 text-xs font-mono">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1200">1200</SelectItem>
                      <SelectItem value="2400">2400 (Ventek)</SelectItem>
                      <SelectItem value="4800">4800</SelectItem>
                      <SelectItem value="9600">9600 (Avery/Standard)</SelectItem>
                      <SelectItem value="19200">19200</SelectItem>
                      <SelectItem value="115200">115200</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Max Capacity (kg)</Label>
                  <Input
                    type="number"
                    value={formData.capacity_kg}
                    onChange={(e) => setFormData({ ...formData, capacity_kg: Number(e.target.value) })}
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Manufacturer</Label>
                  <Input
                    value={formData.manufacturer}
                    onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Model</Label>
                  <Input
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Serial #</Label>
                  <Input
                    value={formData.serial_number}
                    onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Data Bits</Label>
                  <Select
                    value={formData.data_bits.toString()}
                    onValueChange={(val) => setFormData({ ...formData, data_bits: Number(val) })}
                  >
                    <SelectTrigger className="h-8 text-xs font-mono"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">7</SelectItem>
                      <SelectItem value="8">8</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Stop Bits</Label>
                  <Select
                    value={formData.stop_bits.toString()}
                    onValueChange={(val) => setFormData({ ...formData, stop_bits: Number(val) })}
                  >
                    <SelectTrigger className="h-8 text-xs font-mono"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1</SelectItem>
                      <SelectItem value="2">2</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Parity</Label>
                  <Select
                    value={formData.parity}
                    onValueChange={(val) => setFormData({ ...formData, parity: val })}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="even">Even</SelectItem>
                      <SelectItem value="odd">Odd</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Communication Mode</Label>
                <Select
                  value={formData.mode}
                  onValueChange={(val: any) => setFormData({ ...formData, mode: val })}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="serial">Direct Serial COM (Hardware COM Port)</SelectItem>
                    <SelectItem value="file_monitor">File Monitor (Live Weight Text File)</SelectItem>
                    <SelectItem value="tcp">TCP/IP Network Indicator</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.mode === 'file_monitor' && (
                <div className="space-y-1">
                  <Label className="text-xs">File Path</Label>
                  <Input
                    value={formData.file_path}
                    onChange={(e) => setFormData({ ...formData, file_path: e.target.value })}
                    className="h-8 text-xs font-mono"
                  />
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setIsDialogOpen(false)} className="text-xs">
                Cancel
              </Button>
              <Button type="submit" size="sm" className="text-xs">
                {editingDevice ? 'Save Configuration' : 'Register Indicator'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
