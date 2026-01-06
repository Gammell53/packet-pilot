# Build script for PacketPilot AI sidecar (Windows)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "Building PacketPilot AI sidecar..."

# Activate virtual environment if it exists
$VenvActivate = Join-Path $ScriptDir ".venv\Scripts\Activate.ps1"
if (Test-Path $VenvActivate) {
    Write-Host "Activating virtual environment..."
    & $VenvActivate
}

# Ensure PyInstaller is installed
Write-Host "Ensuring PyInstaller is installed..."
pip install pyinstaller --quiet

# Build the executable
Write-Host "Running PyInstaller..."
pyinstaller --clean --noconfirm packet-pilot-ai.spec

# Copy to the Tauri binaries directory
$TauriBinDir = Join-Path $ScriptDir "..\src-tauri\binaries"
if (-not (Test-Path $TauriBinDir)) {
    New-Item -ItemType Directory -Force -Path $TauriBinDir | Out-Null
}

$Target = "x86_64-pc-windows-msvc"
$BinaryName = "packet-pilot-ai-${Target}.exe"
$SourcePath = Join-Path $ScriptDir "dist\packet-pilot-ai.exe"
$DestPath = Join-Path $TauriBinDir $BinaryName

if (Test-Path $SourcePath) {
    Copy-Item $SourcePath $DestPath -Force
    Write-Host ""
    Write-Host "Built successfully: $DestPath"
    $Size = (Get-Item $DestPath).Length / 1MB
    Write-Host "Binary size: $([math]::Round($Size, 2)) MB"
} else {
    Write-Error "Build failed: $SourcePath not found"
    exit 1
}
