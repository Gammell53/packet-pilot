# Bundle sharkd for Windows distribution.
# Produces canonical Tauri binary names and copies the exact DLL names
# required by sharkd imports when possible.

param(
    [string]$SharkdPath = "",
    [string]$WiresharkDir = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$OutputDir = Join-Path $ProjectRoot "src-tauri\binaries"
$LibsDir = Join-Path $OutputDir "wireshark-libs"
$Target = "x86_64-pc-windows-msvc"

$PossibleWiresharkDirs = @(
    "C:\Program Files\Wireshark",
    "C:\Program Files (x86)\Wireshark",
    "$env:ProgramFiles\Wireshark"
)

$AliasMap = @{
    "libglib-2.0-0.dll"     = @("glib-2.0-0.dll")
    "libgmodule-2.0-0.dll"  = @("gmodule-2.0-0.dll")
    "libgthread-2.0-0.dll"  = @("gthread-2.0-0.dll")
    "libpcre2-8-0.dll"      = @("pcre2-8.dll")
    "libcares-2.dll"        = @("cares.dll")
    "liblzma-5.dll"         = @("liblzma.dll")
    "libbrotlicommon.dll"   = @("brotlicommon.dll")
    "libbrotlidec.dll"      = @("brotlidec.dll")
    "libsnappy.dll"         = @("snappy.dll")
    "libzstd.dll"           = @("zstd.dll")
    "liblz4.dll"            = @("lz4.dll")
    "libopus-0.dll"         = @("opus.dll")
}

function Get-ObjdumpPath {
    $candidates = @(
        "objdump.exe",
        "C:\msys64\ucrt64\bin\objdump.exe",
        "C:\msys64\mingw64\bin\objdump.exe"
    )

    foreach ($candidate in $candidates) {
        $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($cmd) {
            return $cmd.Source
        }

        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

function Get-ImportedDlls {
    param(
        [string]$BinaryPath,
        [string]$ObjdumpPath
    )

    if (-not $ObjdumpPath -or -not (Test-Path $BinaryPath)) {
        return @()
    }

    try {
        $output = & $ObjdumpPath -p $BinaryPath 2>$null
        if (-not $output) {
            return @()
        }

        return @(
            $output |
                Select-String -Pattern '^\s*DLL Name:\s+(.+)$' |
                ForEach-Object { $_.Matches[0].Groups[1].Value.Trim() } |
                Where-Object { $_ -and $_.ToLower().EndsWith('.dll') } |
                Select-Object -Unique
        )
    } catch {
        return @()
    }
}

function Is-SystemDll {
    param([string]$Name)

    $n = $Name.ToLowerInvariant()
    return $n.StartsWith("api-ms-win-") -or
           $n -eq "kernel32.dll" -or
           $n -eq "ws2_32.dll" -or
           $n -eq "ntdll.dll" -or
           $n -eq "ucrtbase.dll" -or
           $n -eq "vcruntime140.dll" -or
           $n -eq "vcruntime140_1.dll" -or
           $n -eq "msvcp140.dll"
}

function Find-Dependency {
    param(
        [string]$DllName,
        [string[]]$SearchDirs
    )

    foreach ($dir in $SearchDirs) {
        $direct = Join-Path $dir $DllName
        if (Test-Path $direct) {
            return @{ Source = $direct; DestName = $DllName }
        }

        if ($AliasMap.ContainsKey($DllName)) {
            foreach ($alias in $AliasMap[$DllName]) {
                $aliasPath = Join-Path $dir $alias
                if (Test-Path $aliasPath) {
                    return @{ Source = $aliasPath; DestName = $DllName }
                }
            }
        }
    }

    return $null
}

Write-Host "Bundling sharkd for Windows..."

# Resolve Wireshark location if not provided.
if (-not $WiresharkDir) {
    foreach ($path in $PossibleWiresharkDirs) {
        if (Test-Path (Join-Path $path "sharkd.exe")) {
            $WiresharkDir = $path
            break
        }
    }
}

# Resolve sharkd path.
if (-not $SharkdPath) {
    if ($WiresharkDir) {
        $candidate = Join-Path $WiresharkDir "sharkd.exe"
        if (Test-Path $candidate) {
            $SharkdPath = $candidate
        }
    }
}

if (-not $SharkdPath -or -not (Test-Path $SharkdPath)) {
    Write-Error "sharkd.exe not found. Pass -SharkdPath or install Wireshark."
    exit 1
}

if (-not $WiresharkDir) {
    $WiresharkDir = Split-Path -Parent $SharkdPath
}

Write-Host "Using sharkd: $SharkdPath"
Write-Host "Using Wireshark dir: $WiresharkDir"

$SearchDirs = @(
    $WiresharkDir,
    "C:\msys64\ucrt64\bin",
    "C:\msys64\mingw64\bin"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

# Create output directories.
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
New-Item -ItemType Directory -Force -Path $LibsDir | Out-Null

# Canonical runtime names expected by Tauri + backend resolver.
$DestCanonical = Join-Path $OutputDir "sharkd-$Target.exe"
$DestWrapper = Join-Path $OutputDir "sharkd-wrapper-$Target.exe"
$DestLegacy = Join-Path $OutputDir "sharkd.exe"

Copy-Item $SharkdPath $DestCanonical -Force
Copy-Item $SharkdPath $DestWrapper -Force
Copy-Item $SharkdPath $DestLegacy -Force

Write-Host "Copied binaries:"
Write-Host "  $DestCanonical"
Write-Host "  $DestWrapper"
Write-Host "  $DestLegacy"

$ObjdumpPath = Get-ObjdumpPath
if ($ObjdumpPath) {
    Write-Host "Using objdump: $ObjdumpPath"
} else {
    Write-Host "objdump not found; falling back to broad DLL copy"
}

$CopiedDlls = New-Object System.Collections.Generic.HashSet[string]
$MissingDlls = New-Object System.Collections.Generic.HashSet[string]

$InitialDlls = Get-ImportedDlls -BinaryPath $DestCanonical -ObjdumpPath $ObjdumpPath

if ($InitialDlls.Count -gt 0) {
    $Queue = New-Object System.Collections.Generic.Queue[string]
    foreach ($dll in $InitialDlls) {
        if (-not (Is-SystemDll $dll)) {
            $Queue.Enqueue($dll)
        }
    }

    while ($Queue.Count -gt 0) {
        $dll = $Queue.Dequeue()
        if ($CopiedDlls.Contains($dll)) {
            continue
        }

        $dep = Find-Dependency -DllName $dll -SearchDirs $SearchDirs
        if (-not $dep) {
            $MissingDlls.Add($dll) | Out-Null
            continue
        }

        $destPath = Join-Path $OutputDir $dep.DestName
        Copy-Item $dep.Source $destPath -Force
        $CopiedDlls.Add($dll) | Out-Null

        foreach ($child in (Get-ImportedDlls -BinaryPath $destPath -ObjdumpPath $ObjdumpPath)) {
            if (-not (Is-SystemDll $child) -and -not $CopiedDlls.Contains($child)) {
                $Queue.Enqueue($child)
            }
        }
    }

    foreach ($dll in $InitialDlls) {
        if ((-not (Is-SystemDll $dll)) -and (-not (Test-Path (Join-Path $OutputDir $dll)))) {
            $MissingDlls.Add($dll) | Out-Null
        }
    }
} else {
    # Fallback: copy all Wireshark DLLs when import inspection is unavailable.
    Get-ChildItem -Path $WiresharkDir -Filter "*.dll" -ErrorAction SilentlyContinue | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $OutputDir $_.Name) -Force
        $CopiedDlls.Add($_.Name) | Out-Null
    }
}

if ($MissingDlls.Count -gt 0) {
    Write-Host ""
    Write-Host "Missing required DLLs:" -ForegroundColor Red
    foreach ($dll in $MissingDlls) {
        Write-Host "  - $dll"
    }
    Write-Error "Windows sharkd bundle is incomplete."
    exit 1
}

# Keep placeholder folder used by cross-platform resource config.
$Placeholder = Join-Path $LibsDir ".gitkeep"
if (-not (Test-Path $Placeholder)) {
    New-Item -ItemType File -Force -Path $Placeholder | Out-Null
}

Write-Host ""
Write-Host "Bundle complete."
Write-Host "Copied DLL count: $($CopiedDlls.Count)"

$TotalSize = 0
Get-ChildItem -Path $OutputDir -Recurse | ForEach-Object { $TotalSize += $_.Length }
$TotalSizeMB = [math]::Round($TotalSize / 1MB, 2)
Write-Host "Total bundle size: $TotalSizeMB MB"

Write-Host ""
Write-Host "=== Bundled files ==="
Get-ChildItem $OutputDir | ForEach-Object { Write-Host $_.Name }
