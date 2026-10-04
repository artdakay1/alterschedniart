// src/lib/qr/generate-qr.ts
import QRCode from 'qrcode';

export interface QrCodeOptions {
  width?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
}

/**
 * Generates a base64 Data URL (PNG) for the provided public timetable URL.
 */
export async function generateQrDataUrl(
  url: string,
  options?: QrCodeOptions
): Promise<string> {
  const width = options?.width || 360;
  const margin = options?.margin || 2;
  const dark = options?.darkColor || '#0f172a'; // slate-900
  const light = options?.lightColor || '#ffffff';

  return await QRCode.toDataURL(url, {
    width,
    margin,
    color: {
      dark,
      light,
    },
    errorCorrectionLevel: 'M',
  });
}

/**
 * Generates an SVG string for the provided public timetable URL.
 */
export async function generateQrSvg(
  url: string,
  options?: QrCodeOptions
): Promise<string> {
  const margin = options?.margin || 2;
  const dark = options?.darkColor || '#0f172a';
  const light = options?.lightColor || '#ffffff';

  return await QRCode.toString(url, {
    type: 'svg',
    margin,
    color: {
      dark,
      light,
    },
    errorCorrectionLevel: 'M',
  });
}
