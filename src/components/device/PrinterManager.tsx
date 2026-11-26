import React, { useState, useEffect } from 'react';
import { Printer, Plus, RefreshCw, Trash2, Edit3, CheckCircle, FileText, Star, StarOff, Check } from 'lucide-react';
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
import { PrinterDevice } from '@/types/deviceConfig';
import { useCompany } from '@/contexts/CompanyContext';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export const PrinterManager: React.FC = () => {
  const { refreshCompany } = useCompany();
  const [printers, setPrinters] = useState<PrinterDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);

  // Dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState<PrinterDevice | null>(null);
  const [formData, setFormData] = useState({
    name: 'Primary Slip Printer',
    model: 'Epson TM-T82X / POS-80',
    type: 'thermal_80mm' as 'thermal_80mm' | 'dot_matrix' | 'laser_a4' | 'laser_a5',
    connection_type: 'system' as 'system' | 'network_tcp' | 'usb' | 'serial',
    ip_address: '',
    port: 9100,
    paper_size: '80mm Roll',
    copies: 1,
    auto_print_on_completion: false,
    print_qr_code: true,
    print_images: true,
    is_default: false,
    status: 'online' as 'online' | 'offline' | 'standby',
    notes: '',
  });

  const fetchPrinters = async () => {
    try {
      setLoading(true);
      const data = await api.getPrinters();
      setPrinters(Array.isArray(data) ? data : []);
    } catch (err: any) {
      toast.error('Failed to load printers: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrinters();
  }, []);

  const handleOpenAdd = () => {
    setEditingPrinter(null);
    setFormData({
      name: 'New Receipt Printer',
      model: 'Thermal POS-80',
      type: 'thermal_80mm',
      connection_type: 'system',
      ip_address: '',
      port: 9100,
      paper_size: '80mm Roll',
      copies: 1,
      auto_print_on_completion: false,
      print_qr_code: true,
      print_images: true,
      is_default: printers.length === 0,
      status: 'online',
      notes: '',
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (prn: PrinterDevice) => {
    setEditingPrinter(prn);
    setFormData({
      name: prn.name,
      model: prn.model || 'Standard Slip Printer',
      type: prn.type || 'thermal_80mm',
      connection_type: prn.connection_type || 'system',
      ip_address: prn.ip_address || '',
      port: Number(prn.port) || 9100,
      paper_size: prn.paper_size || '80mm Roll',
      copies: Number(prn.copies) || 1,
      auto_print_on_completion: Boolean(prn.auto_print_on_completion),
      print_qr_code: Boolean(prn.print_qr_code),
      print_images: Boolean(prn.print_images),
      is_default: Boolean(prn.is_default),
      status: prn.status || 'online',
      notes: prn.notes || '',
    });
    setIsDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingPrinter) {
        await api.updatePrinter(editingPrinter.id, formData);
        toast.success(`Printer ${formData.name} updated successfully!`);
      } else {
        await api.createPrinter(formData);
        toast.success(`Printer ${formData.name} added!`);
      }
      setIsDialogOpen(false);
      fetchPrinters();
      refreshCompany();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save printer.');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to remove printer "${name}"?`)) return;
    try {
      await api.deletePrinter(id);
      toast.success(`Printer ${name} removed.`);
      fetchPrinters();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete printer.');
    }
  };

  const handleSetDefault = async (id: string, name: string) => {
    try {
      await api.setDefaultPrinter(id);
      toast.success(`${name} set as primary slip printer.`);
      fetchPrinters();
    } catch (err: any) {
      toast.error('Failed to update default printer: ' + err.message);
    }
  };

  const handleTestPrint = async (prn: PrinterDevice) => {
    try {
      setTestingId(prn.id);
      const res = await api.testPrinter(prn.id);
      toast.success(res.message || `Test docket sent to ${prn.name}!`);
    } catch (err: any) {
      toast.error('Test print failed: ' + err.message);
    } finally {
      setTestingId(null);
    }
  };

  const formatPrinterType = (type: string) => {
    switch (type) {
      case 'thermal_80mm': return 'Thermal POS (80mm/3")';
      case 'dot_matrix': return 'Dot Matrix Continuous (Epson LX)';
      case 'laser_a4': return 'Laser / Desktop (A4 Full)';
      case 'laser_a5': return 'Laser / Inkjet (A5 Half)';
      default: return type;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-card p-4 rounded-xl border border-border">
        <div>
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary" />
            Weighbridge Slip & Ticket Printers
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage thermal POS receipt rolls, dot matrix continuous stationery, default copies, and auto-print triggers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchPrinters} disabled={loading} className="text-xs">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={handleOpenAdd} className="text-xs">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Printer
          </Button>
        </div>
      </div>

      {/* Grid of Printers */}
      {loading && printers.length === 0 ? (
        <div className="flex items-center justify-center p-12 text-muted-foreground text-sm">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading printers...
        </div>
      ) : printers.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <p className="text-sm text-muted-foreground mb-3">No printers configured yet.</p>
          <Button size="sm" onClick={handleOpenAdd}>
            <Plus className="h-4 w-4 mr-1.5" /> Add First Printer
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {printers.map((prn) => {
            const isDefault = Boolean(prn.is_default);
            const isTesting = testingId === prn.id;

            return (
              <Card
                key={prn.id}
                className={`border transition-all flex flex-col justify-between ${
                  isDefault ? 'border-primary shadow-sm bg-primary/[0.02]' : 'border-border hover:border-primary/40'
                }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                        isDefault ? 'bg-primary text-primary-foreground font-bold' : 'bg-muted text-muted-foreground'
                      }`}>
                        <Printer className="h-5 w-5" />
                      </div>
                      <div>
                        <CardTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                          {prn.name}
                          {isDefault && (
                            <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px] px-1.5 py-0 flex items-center gap-1">
                              <Star className="h-3 w-3 fill-primary" /> Default Slip Printer
                            </Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="text-xs mt-0.5">
                          {prn.model || 'Weighbridge Printer'} · {formatPrinterType(prn.type)}
                        </CardDescription>
                      </div>
                    </div>

                    <Badge
                      className={
                        prn.status === 'online'
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-[11px]'
                          : 'bg-muted text-muted-foreground text-[11px]'
                      }
                    >
                      {prn.status.toUpperCase()}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pt-0">
                  <div className="grid grid-cols-3 gap-2 text-xs bg-muted/40 p-2.5 rounded-lg border border-border/50">
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Interface</span>
                      <span className="font-medium text-foreground capitalize">
                        {prn.connection_type === 'network_tcp' ? `TCP ${prn.ip_address || 'IP'}` : prn.connection_type}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Paper Size</span>
                      <span className="font-medium text-foreground">{prn.paper_size || '80mm'}</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Copies</span>
                      <span className="font-medium text-foreground">{prn.copies || 1} Copy</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {Boolean(prn.auto_print_on_completion) && (
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        Auto-print on 2nd Weight
                      </Badge>
                    )}
                    {Boolean(prn.print_qr_code) && (
                      <Badge variant="outline" className="text-[10px]">
                        QR Code Verification
                      </Badge>
                    )}
                    {Boolean(prn.print_images) && (
                      <Badge variant="outline" className="text-[10px]">
                        ANPR Plate Image
                      </Badge>
                    )}
                  </div>

                  <div className="pt-2 border-t border-border flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestPrint(prn)}
                        disabled={isTesting}
                        className="text-xs h-8"
                      >
                        <FileText className={`h-3.5 w-3.5 mr-1.5 ${isTesting ? 'animate-spin' : ''}`} />
                        {isTesting ? 'Sending...' : 'Test Docket'}
                      </Button>

                      {!isDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSetDefault(prn.id, prn.name)}
                          className="text-xs h-8 text-primary hover:bg-primary/10"
                        >
                          <Star className="h-3.5 w-3.5 mr-1" /> Make Default
                        </Button>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenEdit(prn)}
                        className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Edit3 className="h-3.5 w-3.5 mr-1" /> Edit
                      </Button>
                      {!isDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(prn.id, prn.name)}
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
                <Printer className="h-5 w-5 text-primary" />
                {editingPrinter ? 'Edit Printer Settings' : 'Add Slip Printer'}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Configure slip printer destination, paper type, and automatic docket triggers.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3.5 py-4 text-xs">
              <div className="space-y-1">
                <Label className="text-xs">Printer Name</Label>
                <Input
                  placeholder="e.g. Weighbridge Window POS Printer"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="h-8 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Printer Type</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(val: any) => setFormData({ ...formData, type: val })}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="thermal_80mm">Thermal POS (80mm / 3")</SelectItem>
                      <SelectItem value="dot_matrix">Dot Matrix (Epson LX-310)</SelectItem>
                      <SelectItem value="laser_a4">Laser / Inkjet (A4 Full)</SelectItem>
                      <SelectItem value="laser_a5">Laser / Inkjet (A5 Half)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Connection</Label>
                  <Select
                    value={formData.connection_type}
                    onValueChange={(val: any) => setFormData({ ...formData, connection_type: val })}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">Windows Default Spooler</SelectItem>
                      <SelectItem value="network_tcp">Network TCP/IP (Port 9100)</SelectItem>
                      <SelectItem value="usb">Direct USB Hardware</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {formData.connection_type === 'network_tcp' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Printer IP Address</Label>
                    <Input
                      placeholder="192.168.0.200"
                      value={formData.ip_address}
                      onChange={(e) => setFormData({ ...formData, ip_address: e.target.value })}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Port (Default 9100)</Label>
                    <Input
                      type="number"
                      value={formData.port}
                      onChange={(e) => setFormData({ ...formData, port: Number(e.target.value) })}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Paper Format</Label>
                  <Input
                    value={formData.paper_size}
                    onChange={(e) => setFormData({ ...formData, paper_size: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Copies to Print</Label>
                  <Select
                    value={formData.copies.toString()}
                    onValueChange={(val) => setFormData({ ...formData, copies: Number(val) })}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 Copy (Driver / Customer)</SelectItem>
                      <SelectItem value="2">2 Copies (Mill + Driver)</SelectItem>
                      <SelectItem value="3">3 Copies (Audit + Mill + Driver)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex items-center justify-between">
                  <Label className="text-xs cursor-pointer" htmlFor="auto-print">
                    Auto-print slip on 2nd weight completion
                  </Label>
                  <Switch
                    id="auto-print"
                    checked={formData.auto_print_on_completion}
                    onCheckedChange={(c) => setFormData({ ...formData, auto_print_on_completion: c })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-xs cursor-pointer" htmlFor="qr-code">
                    Include QR Code on weighment slip
                  </Label>
                  <Switch
                    id="qr-code"
                    checked={formData.print_qr_code}
                    onCheckedChange={(c) => setFormData({ ...formData, print_qr_code: c })}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-xs cursor-pointer" htmlFor="print-images">
                    Include camera vehicle snapshot on slip
                  </Label>
                  <Switch
                    id="print-images"
                    checked={formData.print_images}
                    onCheckedChange={(c) => setFormData({ ...formData, print_images: c })}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setIsDialogOpen(false)} className="text-xs">
                Cancel
              </Button>
              <Button type="submit" size="sm" className="text-xs">
                {editingPrinter ? 'Save Printer' : 'Register Printer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
