const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, 'icon.png');
const icoPath = path.join(__dirname, 'icon.ico');

if (!fs.existsSync(pngPath)) {
  console.error("Error: icon.png not found in " + __dirname);
  process.exit(1);
}

try {
  const pngBuffer = fs.readFileSync(pngPath);

  // PNG dimensions are stored in IHDR chunk at offset 16 (width) and 20 (height)
  // These are 4-byte big-endian integers
  const width = pngBuffer.readUInt32BE(16);
  const height = pngBuffer.readUInt32BE(20);

  // Create 6-byte ICO Header
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved (always 0)
  header.writeUInt16LE(1, 2); // Resource Type (1 = Icon)
  header.writeUInt16LE(1, 4); // Number of images (1)

  // Create 16-byte Directory Entry
  const dirEntry = Buffer.alloc(16);
  dirEntry.writeUInt8(width >= 256 ? 0 : width, 0);   // Width (0 means 256)
  dirEntry.writeUInt8(height >= 256 ? 0 : height, 1); // Height (0 means 256)
  dirEntry.writeUInt8(0, 2);                          // Color palette (0 = no palette)
  dirEntry.writeUInt8(0, 3);                          // Reserved
  dirEntry.writeUInt16LE(1, 4);                       // Color planes (1)
  dirEntry.writeUInt16LE(32, 6);                      // Bits per pixel (32-bit alpha transparency)
  dirEntry.writeUInt32LE(pngBuffer.length, 8);        // Size of the raw PNG data
  dirEntry.writeUInt32LE(22, 12);                     // Offset to image data (header 6 + entry 16 = 22)

  // Concatenate header, directory entry, and raw PNG data
  const icoBuffer = Buffer.concat([header, dirEntry, pngBuffer]);
  fs.writeFileSync(icoPath, icoBuffer);
  
  console.log(`Successfully converted ${width}x${height} PNG to alpha-transparent ICO at: ${icoPath}`);
} catch (err) {
  console.error("Failed to convert icon: " + err.message);
  process.exit(1);
}
