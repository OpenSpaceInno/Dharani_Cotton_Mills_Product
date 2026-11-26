/**
 * Dharani Weighbridge Date & Time Formatting Utilities
 * Standard:
 * Date: DD-MM-YYYY (hyphen separated)
 * Time: HH:MM:SS (24-hour timestamp)
 */

export const formatToDDMMYYYY = (dateVal?: string | Date | null): string => {
  if (!dateVal || dateVal === '-') return '';
  const pad = (n: number | string) => String(n).padStart(2, '0');

  if (dateVal instanceof Date) {
    if (isNaN(dateVal.getTime())) return '';
    return `${pad(dateVal.getDate())}-${pad(dateVal.getMonth() + 1)}-${dateVal.getFullYear()}`;
  }

  const str = String(dateVal).trim();
  if (!str) return '';

  // Match DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyMatch) {
    return `${pad(dmyMatch[1])}-${pad(dmyMatch[2])}-${dmyMatch[3]}`;
  }

  // Match YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymdMatch) {
    return `${pad(ymdMatch[3])}-${pad(ymdMatch[2])}-${ymdMatch[1]}`;
  }

  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
    }
  } catch {}

  return str;
};

export const formatToHHMMSS = (timeVal?: string | Date | null): string => {
  if (!timeVal || timeVal === '-') return '';
  const pad = (n: number | string) => String(n).padStart(2, '0');

  if (timeVal instanceof Date) {
    if (isNaN(timeVal.getTime())) return '';
    return `${pad(timeVal.getHours())}:${pad(timeVal.getMinutes())}:${pad(timeVal.getSeconds())}`;
  }

  const str = String(timeVal).trim();
  if (!str) return '';

  // Match HH:mm:ss or HH:mm
  const timeMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (timeMatch) {
    return `${pad(timeMatch[1])}:${pad(timeMatch[2])}:${pad(timeMatch[3] || '00')}`;
  }

  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  } catch {}

  return str;
};

/**
 * Formats both Date and Timestamp strictly as DD-MM-YYYY HH:mm:ss
 */
export const formatReportDateTime = (
  dateVal?: string | Date | null,
  timeVal?: string | null,
  fallbackCreatedAt?: string | Date | null
): string => {
  const target = dateVal || fallbackCreatedAt;
  if (!target || target === '-') return '—';

  const d = formatToDDMMYYYY(target);
  if (!d) return '—';

  let t = '';
  if (timeVal && timeVal !== '-') {
    t = formatToHHMMSS(timeVal);
  } else if (typeof target === 'string') {
    const spaceIdx = target.indexOf(' ');
    const tIdx = target.indexOf('T');
    const sepIdx = spaceIdx !== -1 ? spaceIdx : tIdx;
    if (sepIdx !== -1) {
      t = formatToHHMMSS(target.substring(sepIdx + 1));
    }
  } else if (target instanceof Date) {
    t = formatToHHMMSS(target);
  }

  if (!t && fallbackCreatedAt) {
    t = formatToHHMMSS(fallbackCreatedAt);
  }

  return `${d} ${t || '00:00:00'}`;
};

export const getCurrentDateTimeStamp = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return { dateStr, timeStr };
};
