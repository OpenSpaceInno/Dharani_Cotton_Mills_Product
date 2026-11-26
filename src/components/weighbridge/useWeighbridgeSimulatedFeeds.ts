import { useEffect, useRef, useCallback } from 'react';

interface FeedsOptions {
  videoRefs: React.MutableRefObject<(HTMLVideoElement | null)[]>;
  vehicleRegNo?: string;
  currentWeight?: number;
  transactionNo?: number;
  companyName?: string;
}

export function useWeighbridgeSimulatedFeeds({
  videoRefs,
  vehicleRegNo = 'KA 04 MM 9123',
  currentWeight = 0,
  transactionNo = 1,
  companyName = 'DHARANI COTTON MILLS',
}: FeedsOptions) {
  const animFrameRefs = useRef<(number | null)[]>([null, null, null]);
  const canvasesRef = useRef<(HTMLCanvasElement | null)[]>([null, null, null]);
  const streamsRef = useRef<(MediaStream | null)[]>([null, null, null]);
  const activeSlotsRef = useRef<boolean[]>([false, false, false]);

  const vehicleRegNoRef = useRef(vehicleRegNo);
  vehicleRegNoRef.current = vehicleRegNo;
  const currentWeightRef = useRef(currentWeight);
  currentWeightRef.current = currentWeight;

  const stopFeed = useCallback((index: number) => {
    activeSlotsRef.current[index] = false;
    if (animFrameRefs.current[index]) {
      cancelAnimationFrame(animFrameRefs.current[index]!);
      animFrameRefs.current[index] = null;
    }
    if (streamsRef.current[index]) {
      streamsRef.current[index]?.getTracks().forEach((t) => t.stop());
      streamsRef.current[index] = null;
    }
    const video = videoRefs.current[index];
    if (video && video.srcObject) {
      video.srcObject = null;
    }
  }, [videoRefs]);

  const stopAllFeeds = useCallback(() => {
    [0, 1, 2].forEach(stopFeed);
  }, [stopFeed]);

  const startFeed = useCallback((index: number) => {
    const video = videoRefs.current[index];
    if (!video) return;

    // Do not restart if already running or if video is playing physical HLS stream
    if (activeSlotsRef.current[index] && video.srcObject) return;
    activeSlotsRef.current[index] = true;

    if (!canvasesRef.current[index]) {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 400;
      canvasesRef.current[index] = c;
    }

    const canvas = canvasesRef.current[index]!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;

    const render = () => {
      if (!activeSlotsRef.current[index]) return;
      frame++;
      const now = new Date();
      const timeStr = now.toLocaleDateString('en-GB') + ' ' + now.toLocaleTimeString();
      const livePlate = vehicleRegNoRef.current || (index === 0 ? 'KA 04 MM 9123' : (index === 1 ? 'MH 12 RN 4501' : 'TN 15 MF 2815'));
      const liveWeight = currentWeightRef.current > 0 ? currentWeightRef.current : 24580;

      ctx.clearRect(0, 0, 640, 400);

      if (index === 0) {
        // ================= SLOT 0: CAM 1 (GATE 1 ENTRY & ANPR) =================
        // Sky & yard
        const sky = ctx.createLinearGradient(0, 0, 0, 160);
        sky.addColorStop(0, '#0f172a');
        sky.addColorStop(1, '#1e293b');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, 640, 160);

        // Factory Silos
        ctx.fillStyle = '#020617';
        ctx.fillRect(50, 40, 50, 120);
        ctx.fillRect(115, 30, 50, 130);
        ctx.fillRect(180, 50, 45, 110);
        ctx.beginPath();
        ctx.arc(75, 40, 25, Math.PI, 0);
        ctx.arc(140, 30, 25, Math.PI, 0);
        ctx.arc(202, 50, 22.5, Math.PI, 0);
        ctx.fill();

        // Asphalt roadway
        ctx.fillStyle = '#1c1917';
        ctx.beginPath();
        ctx.moveTo(220, 160);
        ctx.lineTo(420, 160);
        ctx.lineTo(600, 400);
        ctx.lineTo(40, 400);
        ctx.closePath();
        ctx.fill();

        // Yellow road safety curbs
        ctx.fillStyle = '#eab308';
        ctx.fillRect(30, 385, 25, 15);
        ctx.fillRect(585, 385, 25, 15);

        // Road lane center line
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 3;
        ctx.setLineDash([16, 12]);
        ctx.lineDashOffset = -(frame * 1.5) % 28;
        ctx.beginPath();
        ctx.moveTo(320, 160);
        ctx.lineTo(320, 400);
        ctx.stroke();
        ctx.setLineDash([]);

        // Approaching Truck with ANPR
        const cycle = frame % 360;
        let truckY = 220;
        let truckScale = 1.0;
        if (cycle < 180) {
          const p = cycle / 180;
          truckScale = 0.65 + p * 0.35;
          truckY = 180 + p * 55;
        } else {
          truckScale = 1.0;
          truckY = 235;
        }

        ctx.save();
        ctx.translate(320, truckY);
        ctx.scale(truckScale, truckScale);

        // Blue Cabin
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(-70, -60, 140, 50);
        ctx.fillStyle = '#0369a1';
        ctx.fillRect(-65, -85, 130, 26);
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(-55, -80, 110, 20);

        // Mixer Drum
        ctx.fillStyle = '#e2e8f0';
        ctx.beginPath();
        ctx.ellipse(0, -95, 52, 26, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 3;
        const dAngle = (frame * 0.08) % (Math.PI * 2);
        ctx.beginPath();
        ctx.arc(0, -95, 26, dAngle, dAngle + Math.PI);
        ctx.stroke();

        // Grill & headlights
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(-50, -25, 100, 18);
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(-65, -24, 12, 10);
        ctx.fillRect(53, -24, 12, 10);

        // Bumper
        ctx.fillStyle = '#334155';
        ctx.fillRect(-75, -6, 150, 14);

        // License Plate
        const pw = 96;
        const ph = 22;
        const px = -pw / 2;
        const py = 10;
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px, py, pw, ph);
        ctx.fillStyle = '#1d4ed8';
        ctx.fillRect(px, py, 11, ph);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 6px monospace';
        ctx.fillText('IND', px + 1, py + 14);

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(livePlate, px + 54, py + 15);

        // Green ANPR Scanner Bounding Box
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        ctx.strokeRect(px - 6, py - 4, pw + 12, ph + 8);

        // Corner ticks
        const cl = 6;
        ctx.beginPath();
        ctx.moveTo(px - 6, py - 4 + cl); ctx.lineTo(px - 6, py - 4); ctx.lineTo(px - 6 + cl, py - 4);
        ctx.moveTo(px + pw + 6 - cl, py - 4); ctx.lineTo(px + pw + 6, py - 4); ctx.lineTo(px + pw + 6, py - 4 + cl);
        ctx.moveTo(px - 6, py + ph + 4 - cl); ctx.lineTo(px - 6, py + ph + 4); ctx.lineTo(px - 6 + cl, py + ph + 4);
        ctx.moveTo(px + pw + 6 - cl, py + ph + 4); ctx.lineTo(px + pw + 6, py + ph + 4); ctx.lineTo(px + pw + 6, py + ph + 4 - cl);
        ctx.stroke();

        ctx.restore();

      } else if (index === 1) {
        // ================= SLOT 1: CAM 2 (DECK & SCALE OVERHEAD) =================
        // Scale house background
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 640, 400);

        // Concrete Pit & Steel Platform Deck
        ctx.fillStyle = '#334155';
        ctx.fillRect(60, 110, 520, 210);

        // Steel Plate checkered lines
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.5;
        for (let x = 80; x < 570; x += 40) {
          ctx.beginPath();
          ctx.moveTo(x, 110);
          ctx.lineTo(x, 320);
          ctx.stroke();
        }

        // Yellow/Black Safety Striped Curbs
        const curbPatternW = 20;
        for (let i = 0; i < 26; i++) {
          ctx.fillStyle = (i % 2 === 0) ? '#eab308' : '#0f172a';
          ctx.fillRect(60 + i * curbPatternW, 96, curbPatternW, 14);
          ctx.fillRect(60 + i * curbPatternW, 320, curbPatternW, 14);
        }

        // 4 Load Cell Sensors
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(80, 120, 12, 12);
        ctx.fillRect(548, 120, 12, 12);
        ctx.fillRect(80, 298, 12, 12);
        ctx.fillRect(548, 298, 12, 12);

        // Truck sitting on the platform
        ctx.fillStyle = '#0369a1';
        ctx.fillRect(150, 150, 320, 120);

        // Truck Cabin (Right side)
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(400, 145, 90, 130);
        ctx.fillStyle = '#64748b';
        ctx.fillRect(440, 160, 40, 100); // Windshield from top view

        // Cargo load (Raw Cotton / Aggregates)
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(170, 165, 220, 90);
        ctx.fillStyle = '#cbd5e1';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('RAW COTTON / DISPATCH', 280, 215);

        // Scale Indicator HUD Stamp on Screen
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(190, 345, 260, 40);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1;
        ctx.strokeRect(190, 345, 260, 40);
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 18px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`SCALE: ${liveWeight.toLocaleString()} KG (STABLE)`, 320, 372);

      } else {
        // ================= SLOT 2: CAM 3 (PLATFORM 2 / EXIT REAR) =================
        // Background plant yard
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, 640, 170);

        // Scale 2 Concrete Ramp
        ctx.fillStyle = '#262626';
        ctx.beginPath();
        ctx.moveTo(180, 170);
        ctx.lineTo(460, 170);
        ctx.lineTo(620, 400);
        ctx.lineTo(20, 400);
        ctx.closePath();
        ctx.fill();

        // Platform 2 Deck
        ctx.fillStyle = '#404040';
        ctx.fillRect(120, 200, 400, 160);

        // Yellow Guide Rail
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(110, 195, 10, 170);
        ctx.fillRect(520, 195, 10, 170);

        // Rear of Truck
        ctx.fillStyle = '#0284c7';
        ctx.fillRect(200, 210, 240, 120);

        // Tail Lights
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(210, 290, 24, 12);
        ctx.fillRect(406, 290, 24, 12);

        // Rear License Plate
        ctx.fillStyle = '#fef08a';
        ctx.fillRect(270, 285, 100, 22);
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(270, 285, 100, 22);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(livePlate, 320, 301);

        // Rear ANPR Target Box
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 2;
        ctx.strokeRect(264, 280, 112, 32);
      }

      // Universal Camera HUD Header
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(0, 0, 640, 36);

      // Camera Title
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'left';
      const camTitles = ['CAM 01: GATE 1 ENTRY (ANPR)', 'CAM 02: SCALE PLATFORM 1 (OVERHEAD)', 'CAM 03: PLATFORM 2 (EXIT CHUTE)'];
      ctx.fillText(camTitles[index] || `CAM 0${index + 1}`, 15, 22);

      // Live Timestamp
      ctx.fillStyle = '#f8fafc';
      ctx.font = '11px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(timeStr, 625, 22);

      // Live Stream Badge (Bottom Left)
      ctx.fillStyle = 'rgba(16, 185, 129, 0.85)';
      ctx.fillRect(15, 368, 125, 22);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('● RTSP LIVE 1080P', 77, 383);

      animFrameRefs.current[index] = requestAnimationFrame(render);
    };

    render();

    // Pipe canvas stream directly into video element
    try {
      // @ts-ignore
      const stream = canvas.captureStream ? canvas.captureStream(25) : null;
      if (stream) {
        streamsRef.current[index] = stream;
        video.srcObject = stream;
        video.play().catch(() => {});
      }
    } catch (e) {
      console.warn('Canvas stream capture error:', e);
    }
  }, [videoRefs]);

  const startAllFeeds = useCallback(() => {
    [0, 1, 2].forEach(startFeed);
  }, [startFeed]);

  useEffect(() => {
    // Automatically start simulation feeds on all slots
    const timer = setTimeout(() => {
      startAllFeeds();
    }, 100);

    return () => {
      clearTimeout(timer);
      stopAllFeeds();
    };
  }, [startAllFeeds, stopAllFeeds]);

  return {
    startFeed,
    stopFeed,
    startAllFeeds,
    stopAllFeeds,
  };
}
