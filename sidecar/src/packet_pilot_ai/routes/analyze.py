"""Analyze endpoint for packet analysis queries."""

import sys
from fastapi import APIRouter, HTTPException

from ..models.schemas import AnalyzeRequest, AnalyzeResponse
from ..services.ai_agent import analyze_packets, AIServiceError
from ..services.rust_bridge import get_frames, get_frame_details

router = APIRouter()


def log(msg: str):
    """Print and flush log message."""
    print(f"[ANALYZE] {msg}", flush=True)
    sys.stdout.flush()


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    """Analyze packets based on user query and context."""
    log(f"Received analyze request: query='{request.query[:50]}...'")
    try:
        # Gather context data from Rust
        context_data = {}

        # Get details of selected packet if any
        if request.context.selected_packet_id:
            log(f"Getting details for packet {request.context.selected_packet_id}")
            details = await get_frame_details(request.context.selected_packet_id)
            if details:
                context_data["selected_packet"] = details

        # Get visible frames for context
        if request.context.visible_range:
            start = request.context.visible_range.get("start", 0)
            end = request.context.visible_range.get("end", 100)
            limit = min(end - start, 50)  # Cap at 50 frames for context
            log(f"Getting frames {start}-{end} (limit {limit})")
            frames = await get_frames(skip=start, limit=limit)
            if frames:
                context_data["visible_frames"] = frames

        # Call AI agent for analysis
        log("Calling AI agent...")
        result = await analyze_packets(
            query=request.query,
            context=request.context,
            packet_data=context_data,
            history=request.conversation_history,
            model=request.model,
        )

        log(f"AI response received: {result.message[:100]}...")
        return result

    except AIServiceError as e:
        log(f"AIServiceError: {e.user_message}")
        raise HTTPException(status_code=400, detail=e.user_message)
    except Exception as e:
        log(f"Unexpected error: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
