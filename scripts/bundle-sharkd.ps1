# Bundle sharkd for Windows distribution
# Installs Wireshark via Chocolatey and copies sharkd.exe with dependencies

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$OutputDir = Join-Path $ProjectRoot "src-tauri\binaries"
$LibsDir = Join-Path $OutputDir "sharkd-libs"
$Target = "x86_64-pc-windows-msvc"

Write-Host "Bundling sharkd for Windows..."

# Create directories
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
New-Item -ItemType Directory -Force -Path $LibsDir | Out-Null

# Check if Wireshark is already installed
$WiresharkDir = $null
$PossiblePaths = @(
    "C:\Program Files\Wireshark",
    "C:\Program Files (x86)\Wireshark",
    "$env:ProgramFiles\Wireshark"
)

foreach ($path in $PossiblePaths) {
    if (Test-Path (Join-Path $path "sharkd.exe")) {
        $WiresharkDir = $path
        Write-Host "Found existing Wireshark installation at: $WiresharkDir"
        break
    }
}

# Install Wireshark via Chocolatey if not found
if (-not $WiresharkDir) {
    Write-Host "Wireshark not found. Installing via Chocolatey..."

    # Check if choco is available
    if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
        Write-Error "Chocolatey is not installed. Please install Wireshark manually."
        exit 1
    }

    # Install Wireshark (includes sharkd)
    choco install wireshark -y --no-progress

    # Find the installation
    foreach ($path in $PossiblePaths) {
        if (Test-Path (Join-Path $path "sharkd.exe")) {
            $WiresharkDir = $path
            break
        }
    }

    if (-not $WiresharkDir) {
        Write-Error "Wireshark installation failed or sharkd.exe not found"
        exit 1
    }

    Write-Host "Wireshark installed at: $WiresharkDir"
}

$SharkdPath = Join-Path $WiresharkDir "sharkd.exe"
if (-not (Test-Path $SharkdPath)) {
    Write-Error "sharkd.exe not found at: $SharkdPath"
    exit 1
}

Write-Host "Found sharkd at: $SharkdPath"

# Copy sharkd.exe with target suffix
$DestSharkd = Join-Path $OutputDir "sharkd-$Target.exe"
Copy-Item $SharkdPath $DestSharkd -Force
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
