import React, { useState } from 'react';
import { 
  Camera, 
  Scale, 
  Printer, 
  FolderGit2, 
  Settings2, 
  Database
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

import { CameraManager } from '@/components/device/CameraManager';
import { WeighbridgeScaleManager } from '@/components/device/WeighbridgeScaleManager';
import { PrinterManager } from '@/components/device/PrinterManager';
import { FtpConfigManager } from '@/components/device/FtpConfigManager';
import { SyncMonitorPanel } from '@/components/device/SyncMonitorPanel';

export default function DeviceConfig() {
  const [activeTab, setActiveTab] = useState('cameras');

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Settings2 className="h-6 w-6 text-primary" />
            Device & Hardware Configuration Hub
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Centrally manage and test connected IP cameras, digital weighbridge scale indicators, thermal/matrix slip printers, and FTP storage.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="px-2.5 py-1 text-xs font-mono bg-card text-foreground border-border flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Hardware Controller Active
          </Badge>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-2 md:grid-cols-5 w-full h-auto p-1 bg-muted/60 border border-border rounded-xl">
          <TabsTrigger
            value="cameras"
            className="flex items-center justify-center gap-2 py-2.5 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-lg text-xs sm:text-sm font-semibold transition-all"
          >
            <Camera className="h-4 w-4 text-blue-500" />
            <span>Cameras (ANPR & CCTV)</span>
          </TabsTrigger>

          <TabsTrigger
            value="weighbridge"
            className="flex items-center justify-center gap-2 py-2.5 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-lg text-xs sm:text-sm font-semibold transition-all"
          >
            <Scale className="h-4 w-4 text-emerald-500" />
            <span>Weighbridge Indicator</span>
          </TabsTrigger>

          <TabsTrigger
            value="printers"
            className="flex items-center justify-center gap-2 py-2.5 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-lg text-xs sm:text-sm font-semibold transition-all"
          >
            <Printer className="h-4 w-4 text-purple-500" />
            <span>Slip Printers</span>
          </TabsTrigger>

          <TabsTrigger
            value="ftp"
            className="flex items-center justify-center gap-2 py-2.5 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-lg text-xs sm:text-sm font-semibold transition-all"
          >
            <FolderGit2 className="h-4 w-4 text-amber-500" />
            <span>FTP Server Profiles</span>
          </TabsTrigger>

          <TabsTrigger
            value="sync"
            className="flex items-center justify-center gap-2 py-2.5 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-lg text-xs sm:text-sm font-semibold transition-all"
          >
            <Database className="h-4 w-4 text-cyan-500" />
            <span>DB Sync Monitor</span>
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Cameras */}
        <TabsContent value="cameras" className="mt-0 focus-visible:outline-none">
          <CameraManager />
        </TabsContent>

        {/* Tab 2: Weighbridge Scale */}
        <TabsContent value="weighbridge" className="mt-0 focus-visible:outline-none">
          <WeighbridgeScaleManager />
        </TabsContent>

        {/* Tab 3: Printers */}
        <TabsContent value="printers" className="mt-0 focus-visible:outline-none">
          <PrinterManager />
        </TabsContent>

        {/* Tab 4: FTP */}
        <TabsContent value="ftp" className="mt-0 focus-visible:outline-none">
          <FtpConfigManager />
        </TabsContent>

        {/* Tab 5: Database Synchronization Monitoring */}
        <TabsContent value="sync" className="mt-0 focus-visible:outline-none">
          <SyncMonitorPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
