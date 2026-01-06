# Bundle sharkd for Windows distribution
# Downloads Wireshark portable and extracts sharkd.exe with dependencies

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$OutputDir = Join-Path $ProjectRoot "src-tauri\binaries"
$LibsDir = Join-Path $OutputDir "sharkd-libs"
$Target = "x86_64-pc-windows-msvc"

# Wireshark version to download
$WiresharkVersion = "4.4.2"
$WiresharkZipUrl = "https://2.na.dl.wireshark.org/win64/Wireshark-$WiresharkVersion-x64.zip"

$TempDir = Join-Path $env:TEMP "wireshark-bundle-$WiresharkVersion"
$ZipPath = Join-Path $TempDir "wireshark.zip"
$ExtractDir = Join-Path $TempDir "extracted"

Write-Host "Bundling sharkd for Windows..."
Write-Host "Wireshark version: $WiresharkVersion"

# Create directories
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
New-Item -ItemType Directory -Force -Path $LibsDir | Out-Null
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

# Download Wireshark zip if not already cached
if (-not (Test-Path $ZipPath)) {
    Write-Host "Downloading Wireshark $WiresharkVersion..."
    Write-Host "URL: $WiresharkZipUrl"

    try {
        # Use TLS 1.2 for HTTPS
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

        $ProgressPreference = 'SilentlyContinue'  # Faster download
        Invoke-WebRequest -Uri $WiresharkZipUrl -OutFile $ZipPath -UseBasicParsing
        $ProgressPreference = 'Continue'
    }
    catch {
        Write-Error "Failed to download Wireshark: $_"
        Write-Host ""
        Write-Host "Alternative: Install Wireshark manually from https://www.wireshark.org/download.html"
        Write-Host "Then copy sharkd.exe to: $OutputDir\sharkd-$Target.exe"
        exit 1
    }

    Write-Host "Download complete: $((Get-Item $ZipPath).Length / 1MB) MB"
} else {
    Write-Host "Using cached download: $ZipPath"
}

# Extract the zip
if (-not (Test-Path $ExtractDir)) {
    Write-Host "Extracting Wireshark..."
    Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force
}

# Find sharkd.exe in the extracted files
$SharkdPath = Get-ChildItem -Path $ExtractDir -Recurse -Filter "sharkd.exe" -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $SharkdPath) {
    Write-Error "sharkd.exe not found in Wireshark distribution"
    Write-Host "Contents of extract directory:"
    Get-ChildItem -Path $ExtractDir -Recurse -Depth 2 | Select-Object FullName
    exit 1
}

Write-Host "Found sharkd at: $($SharkdPath.FullName)"
$WiresharkDir = $SharkdPath.DirectoryName

# Copy sharkd.exe with target suffix
$DestSharkd = Join-Path $OutputDir "sharkd-$Target.exe"
Copy-Item $SharkdPath.FullName $DestSharkd -Force
Write-Host "Copied: $DestSharkd"

# List of DLLs that sharkd typically needs
# These are the core Wireshark libraries
$RequiredDlls = @(
    "libwireshark.dll",
    "libwiretap.dll",
    "libwsutil.dll",
    "libglib-2.0-0.dll",
    "libgmodule-2.0-0.dll",
    "libpcre2-8-0.dll",
    "libintl-8.dll",
    "libgcc_s_seh-1.dll",
    "libwinpthread-1.dll",
    "libzstd.dll",
    "libspeexdsp-1.dll",
    "libsmi-2.dll",
    "libsnappy.dll",
    "liblz4.dll",
    "liblzma-5.dll",
    "libopus-0.dll",
    "libsbc-1.dll",
    "libspandsp-2.dll",
    "libbrotlidec.dll",
    "libbrotlicommon.dll",
    "libcares-2.dll",
    "libgcrypt-20.dll",
    "libgpg-error-0.dll",
    "libgnutls-30.dll",
    "libhogweed-6.dll",
    "libnettle-8.dll",
    "libgmp-10.dll",
    "libiconv-2.dll",
    "libp11-kit-0.dll",
    "libffi-8.dll",
    "libtasn1-6.dll",
    "libnghttp2-14.dll",
    "libssh.dll",
    "libxml2-2.dll",
    "zlib1.dll"
)

Write-Host ""
Write-Host "Copying DLL dependencies..."
$CopiedCount = 0
$MissingDlls = @()

foreach ($dll in $RequiredDlls) {
    $dllPath = Join-Path $WiresharkDir $dll
    if (Test-Path $dllPath) {
        Copy-Item $dllPath $LibsDir -Force
        $CopiedCount++
    } else {
        $MissingDlls += $dll
    }
}

# Also copy any other DLLs in the Wireshark directory (catch-all)
$AllDlls = Get-ChildItem -Path $WiresharkDir -Filter "*.dll" -ErrorAction SilentlyContinue
foreach ($dll in $AllDlls) {
    $destPath = Join-Path $LibsDir $dll.Name
    if (-not (Test-Path $destPath)) {
        Copy-Item $dll.FullName $destPath -Force
        $CopiedCount++
    }
}

Write-Host "Copied $CopiedCount DLLs to $LibsDir"

if ($MissingDlls.Count -gt 0) {
    Write-Host ""
    Write-Host "Note: Some expected DLLs were not found (may not be needed):"
    $MissingDlls | ForEach-Object { Write-Host "  - $_" }
}

# Calculate total size
$TotalSize = 0
Get-ChildItem -Path $OutputDir -Recurse | ForEach-Object { $TotalSize += $_.Length }
$TotalSizeMB = [math]::Round($TotalSize / 1MB, 2)

Write-Host ""
Write-Host "Bundle complete!"
Write-Host "  sharkd binary: $DestSharkd"
Write-Host "  Dependencies:  $LibsDir\"
Write-Host "  Total size:    $TotalSizeMB MB"
Write-Host ""
Write-Host "Note: The Tauri app will need to add sharkd-libs to PATH or copy DLLs alongside sharkd."
