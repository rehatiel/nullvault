/**
 * NullVault — QR Code module
 *
 * Wraps the `qrcode` npm package to generate a standards-compliant SVG.
 *
 * IMPORTANT: QR code spec (ISO/IEC 18004) requires DARK modules on a LIGHT
 * background. Inverted colour schemes (light on dark) are rejected by the
 * majority of phone camera apps. We always render black on white here; the
 * surrounding UI provides a white padded border via CSS so the code sits
 * cleanly in the dark card without losing scannability.
 */

'use strict';

const QRCode = require('qrcode');

/**
 * Returns a Promise that resolves to a valid, phone-scannable SVG string.
 * Always black modules on white background per QR spec.
 */
async function toSVG(url) {
  return QRCode.toString(url, {
    type:                 'svg',
    errorCorrectionLevel: 'M',
    margin:               4,        // quiet zone: 4 modules as per spec minimum
    color: {
      dark:  '#000000',  // modules  — must be dark
      light: '#ffffff',  // background — must be light
    },
  });
}

module.exports = { toSVG };
