#!/usr/bin/env node
/**
 * Pre-build verification script for sharkd bundling
 * Run before tauri build to catch missing binaries early
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BINARIES_DIR = path.join(__dirname, '..', 'src-tauri', 'binaries');

// Platform-specific binary names
const PLATFORMS = {
  'linux-x64': 'sharkd-x86_64-unknown-linux-gnu',
  'linux-arm64': 'sharkd-aarch64-unknown-linux-gnu',
  'darwin-x64': 'sharkd-x86_64-apple-darwin',
  'darwin-arm64': 'sharkd-aarch64-apple-darwin',
  'win32-x64': 'sharkd-x86_64-pc-windows-msvc.exe',
};

// Required DLLs for Windows (subset - main ones)
const WINDOWS_DLLS = [
  'libgcc_s_seh-1.dll',
  'libstdc++-6.dll',
  'libwinpthread-1.dll',
  'libglib-2.0-0.dll',
];

function getPlatformKey() {
  const platform = process.platform;
  const arch = process.arch;
  return `${platform}-${arch}`;
}

function checkBinaryExists(binaryName) {
  const binaryPath = path.join(BINARIES_DIR, binaryName);
  return fs.existsSync(binaryPath);
}

function checkSystemSharkd() {
  try {
    if (process.platform === 'win32') {
      const paths = [
        'C:\\Program Files\\Wireshark\\sharkd.exe',
        'C:\\Program Files (x86)\\Wireshark\\sharkd.exe',
      ];
      return paths.some(p => fs.existsSync(p));
    } else {
      execSync('which sharkd', { stdio: 'pipe' });
      return true;
    }
  } catch {
    return false;
  }
}

function main() {
  console.log('🦈 Verifying sharkd availability...\n');
  
  const platformKey = getPlatformKey();
  const expectedBinary = PLATFORMS[platformKey];
  
  if (!expectedBinary) {
    console.warn(`⚠️  Unknown platform: ${platformKey}`);
    console.warn('   Build may fail if sharkd is not available.\n');
    process.exit(0);
  }

  console.log(`Platform: ${platformKey}`);
  console.log(`Expected binary: ${expectedBinary}\n`);

  // Check for bundled binary
  const hasBundled = checkBinaryExists(expectedBinary);
  console.log(`Bundled sharkd: ${hasBundled ? '✅ Found' : '❌ Not found'}`);

  // Check for system sharkd
  const hasSystem = checkSystemSharkd();
  console.log(`System sharkd:  ${hasSystem ? '✅ Found' : '❌ Not found'}`);

  // Windows-specific DLL check
  if (platformKey === 'win32-x64' && hasBundled) {
    console.log('\nChecking Windows DLLs:');
    let missingDlls = [];
    for (const dll of WINDOWS_DLLS) {
      const exists = checkBinaryExists(dll);
      console.log(`  ${dll}: ${exists ? '✅' : '❌'}`);
      if (!exists) missingDlls.push(dll);
    }
    if (missingDlls.length > 0) {
      console.warn(`\n⚠️  Missing DLLs: ${missingDlls.join(', ')}`);
      console.warn('   Windows build may fail at runtime.\n');
    }
  }

  // Final verdict
  console.log('\n' + '='.repeat(50));
  
  if (hasBundled) {
    console.log('✅ Ready for production build (bundled sharkd found)');
    process.exit(0);
  } else if (hasSystem) {
    console.log('✅ Ready for development build (system sharkd found)');
    console.log('⚠️  Production builds require bundled sharkd');
    process.exit(0);
  } else {
    console.error('❌ BUILD WILL FAIL: No sharkd available!');
    console.error('\nTo fix:');
    console.error('1. Install Wireshark (includes sharkd)');
    console.error('   - Linux: sudo apt install wireshark-common');
    console.error('   - macOS: brew install wireshark');
    console.error('   - Windows: Download from wireshark.org');
    console.error('\n2. Or place sharkd binary in src-tauri/binaries/');
    console.error(`   Expected: ${expectedBinary}`);
    process.exit(1);
  }
}

main();
