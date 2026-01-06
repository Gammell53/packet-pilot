# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec file for PacketPilot AI sidecar."""

import sys
from pathlib import Path

block_cipher = None

# Get the sidecar source directory
sidecar_src = Path("src")

a = Analysis(
    [str(sidecar_src / "packet_pilot_ai" / "__main__.py")],
    pathex=[str(sidecar_src)],
    binaries=[],
    datas=[],
    hiddenimports=[
        # FastAPI and dependencies
        "fastapi",
        "fastapi.middleware",
        "fastapi.middleware.cors",
        "starlette",
        "starlette.middleware",
        "starlette.middleware.cors",
        "starlette.routing",
        "starlette.responses",
        "starlette.requests",
        "starlette.exceptions",
        # Uvicorn
        "uvicorn",
        "uvicorn.config",
        "uvicorn.main",
        "uvicorn.server",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.http.httptools_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.logging",
        # HTTP libraries
        "httpx",
        "httpcore",
        "h11",
        "anyio",
        "anyio._backends",
        "anyio._backends._asyncio",
        "sniffio",
        # Pydantic
        "pydantic",
        "pydantic.main",
        "pydantic_core",
        # SSE
        "sse_starlette",
        "sse_starlette.sse",
        # OpenAI
        "openai",
        "openai._client",
        "openai.resources",
        # Our app modules
        "packet_pilot_ai",
        "packet_pilot_ai.server",
        "packet_pilot_ai.routes",
        "packet_pilot_ai.routes.analyze",
        "packet_pilot_ai.routes.filter",
        "packet_pilot_ai.services",
        "packet_pilot_ai.services.ai_agent",
        "packet_pilot_ai.services.rust_bridge",
        "packet_pilot_ai.models",
        "packet_pilot_ai.models.schemas",
        # Standard library
        "email.mime.text",
        "multiprocessing",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="packet-pilot-ai",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,  # Keep console for debugging; set to False for release
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
