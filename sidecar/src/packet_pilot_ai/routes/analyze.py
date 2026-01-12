"""Analyze endpoint for packet analysis queries."""

import json
import sys
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..models.schemas import AnalyzeRequest, AnalyzeResponse
from ..services.ai_agent import analyze_packets, stream_analyze_packets, AIServiceError
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


@router.post("/analyze/stream")
async def analyze_stream(request: AnalyzeRequest):
    """Stream analyze packets - returns Server-Sent Events with text chunks.

    Supports tool calling: when the AI needs to search packets or use other tools,
    it will execute them and continue streaming the response.

    SSE format: data: {"text": "chunk"}\n\n
    Final event: data: [DONE]\n\n
    Error event: data: {"error": "message"}\n\n
    """
    log(f"Received streaming analyze request: query='{request.query[:50]}...'")

    async def generate():
        try:
            # Gather context data from Rust (same as non-streaming)
            context_data = {}

            if request.context.selected_packet_id:
                log(f"Getting details for packet {request.context.selected_packet_id}")
                details = await get_frame_details(request.context.selected_packet_id)
                if details:
                    context_data["selected_packet"] = details

            if request.context.visible_range:
                start = request.context.visible_range.get("start", 0)
                end = request.context.visible_range.get("end", 100)
                limit = min(end - start, 50)
                log(f"Getting frames {start}-{end} (limit {limit})")
                frames = await get_frames(skip=start, limit=limit)
                if frames:
                    context_data["visible_frames"] = frames

            # Stream the AI response
            log("Starting AI stream...")
            async for chunk in stream_analyze_packets(
                query=request.query,
                context=request.context,
                packet_data=context_data,
                history=request.conversation_history,
                model=request.model,
            ):
                yield f"data: {json.dumps({'text': chunk})}\n\n"

            log("Stream complete")
            yield "data: [DONE]\n\n"

        except AIServiceError as e:
            log(f"AIServiceError during stream: {e.user_message}")
            yield f"data: {json.dumps({'error': e.user_message})}\n\n"
        except (BlockingIOError, ConnectionResetError, BrokenPipeError) as e:
            # Client disconnected - this is normal, just stop streaming
            log(f"Client disconnected during stream: {type(e).__name__}")
            return
        except GeneratorExit:
            # Client closed connection - normal behavior
            log("Stream cancelled by client")
            return
        except Exception as e:
            log(f"Unexpected error during stream: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()
            try:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
            except Exception:
                pass  # Client already disconnected

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )
