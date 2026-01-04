"""Analyze endpoint for packet analysis queries."""

from fastapi import APIRouter, HTTPException

from ..models.schemas import AnalyzeRequest, AnalyzeResponse
from ..services.ai_agent import analyze_packets
from ..services.rust_bridge import get_frames, get_frame_details

router = APIRouter()


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest) -> AnalyzeResponse:
    """Analyze packets based on user query and context."""
    try:
        # Gather context data from Rust
        context_data = {}

        # Get details of selected packet if any
        if request.context.selected_packet_id:
            details = await get_frame_details(request.context.selected_packet_id)
            if details:
                context_data["selected_packet"] = details

        # Get visible frames for context
        if request.context.visible_range:
            start = request.context.visible_range.get("start", 0)
            end = request.context.visible_range.get("end", 100)
            limit = min(end - start, 50)  # Cap at 50 frames for context
            frames = await get_frames(skip=start, limit=limit)
            if frames:
                context_data["visible_frames"] = frames

        # Call AI agent for analysis
        result = await analyze_packets(
            query=request.query,
            context=request.context,
            packet_data=context_data,
            history=request.conversation_history,
        )

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
