import json
import os
import queue as queue_module
import subprocess
import tempfile
import threading
import time

from datetime import timedelta
from django.http import StreamingHttpResponse
from django.utils import timezone
from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import ExecutionRequest, SharedSnippet
from .serializers import ExecutionRequestSerializer

TIMEOUT_SECONDS = 30


class ExecutionCreateView(generics.CreateAPIView):
    serializer_class = ExecutionRequestSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        instance = serializer.save(user=self.request.user, status=ExecutionRequest.Status.RUNNING)
        self._run(instance)

    def _run(self, instance: ExecutionRequest):
        start = time.monotonic()
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                cmd = self._build_command(instance, tmpdir)
                if cmd is None:
                    return  # error already saved

                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=TIMEOUT_SECONDS,
                    cwd=tmpdir,
                )

            instance.stdout = result.stdout
            instance.stderr = result.stderr
            instance.exit_code = result.returncode
            instance.status = ExecutionRequest.Status.COMPLETE

        except subprocess.TimeoutExpired:
            instance.status = ExecutionRequest.Status.TIMEOUT
            instance.stderr = f"Execution timed out after {TIMEOUT_SECONDS}s."
        except Exception as e:
            instance.status = ExecutionRequest.Status.ERROR
            instance.stderr = str(e)
        finally:
            instance.duration_ms = int((time.monotonic() - start) * 1000)
            instance.completed_at = timezone.now()
            instance.save()

    def _build_command(self, instance: ExecutionRequest, tmpdir: str):
        files = instance.files or []

        if files:
            # Multi-file project mode
            has_build_zig = False
            for f in files:
                rel = f["path"].lstrip("/")
                dest = os.path.join(tmpdir, rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, "w") as fp:
                    fp.write(f["content"])
                if rel == "build.zig":
                    has_build_zig = True

            if has_build_zig:
                step = "test" if instance.mode == ExecutionRequest.Mode.TEST else "run"
                return ["zig", "build", step]

            # No build.zig — find first .zig entry point
            for candidate in ("src/main.zig", "main.zig"):
                p = os.path.join(tmpdir, candidate)
                if os.path.exists(p):
                    break
            else:
                p = next(
                    (os.path.join(tmpdir, f["path"].lstrip("/")) for f in files if f["path"].endswith(".zig")),
                    None,
                )
            if not p:
                instance.status = ExecutionRequest.Status.ERROR
                instance.stderr = "No .zig source files found in project."
                instance.duration_ms = 0
                instance.completed_at = timezone.now()
                instance.save()
                return None

            verb = "test" if instance.mode == ExecutionRequest.Mode.TEST else "run"
            return ["zig", verb, p]

        else:
            # Legacy single-file mode
            src = os.path.join(tmpdir, "main.zig")
            with open(src, "w") as f:
                f.write(instance.code or "")
            verb = "test" if instance.mode == ExecutionRequest.Mode.TEST else "run"
            flags = ["-Doptimize=ReleaseFast"] if instance.mode == ExecutionRequest.Mode.RELEASE_FAST else []
            return ["zig", verb, src] + flags


class ExecutionStreamView(APIView):
    """SSE endpoint — streams build/run output line-by-line as it arrives."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        files = request.data.get("files", [])
        mode_str = request.data.get("mode", "debug")

        def event_stream():
            q = queue_module.Queue()
            start = time.monotonic()
            proc = None

            try:
                with tempfile.TemporaryDirectory() as tmpdir:
                    has_build_zig = False
                    for f in files:
                        rel = f["path"].lstrip("/")
                        dest = os.path.join(tmpdir, rel)
                        os.makedirs(os.path.dirname(dest), exist_ok=True)
                        with open(dest, "w") as fp:
                            fp.write(f["content"])
                        if rel == "build.zig":
                            has_build_zig = True

                    if has_build_zig:
                        step = "test" if mode_str == "test" else "run"
                        cmd = ["zig", "build", step]
                    else:
                        entry = None
                        for candidate in ("src/main.zig", "main.zig"):
                            p = os.path.join(tmpdir, candidate)
                            if os.path.exists(p):
                                entry = p
                                break
                        if entry is None:
                            for f in files:
                                if f["path"].endswith(".zig"):
                                    entry = os.path.join(tmpdir, f["path"].lstrip("/"))
                                    break
                        if entry is None:
                            yield f"data: {json.dumps({'type': 'error', 'text': 'No .zig source found'})}\n\n"
                            return
                        verb = "test" if mode_str == "test" else "run"
                        cmd = ["zig", verb, entry]

                    proc = subprocess.Popen(
                        cmd,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                        cwd=tmpdir,
                    )

                    def _reader(stream, kind):
                        for line in stream:
                            q.put((kind, line.rstrip("\n")))
                        q.put((kind, None))

                    t_out = threading.Thread(target=_reader, args=(proc.stdout, "stdout"), daemon=True)
                    t_err = threading.Thread(target=_reader, args=(proc.stderr, "stderr"), daemon=True)
                    t_out.start()
                    t_err.start()

                    done_count = 0
                    while done_count < 2:
                        try:
                            kind, text = q.get(timeout=TIMEOUT_SECONDS)
                        except queue_module.Empty:
                            proc.kill()
                            yield f"data: {json.dumps({'type': 'error', 'text': 'Execution timed out'})}\n\n"
                            return
                        if text is None:
                            done_count += 1
                        else:
                            yield f"data: {json.dumps({'type': kind, 'text': text})}\n\n"

                    t_out.join()
                    t_err.join()
                    proc.wait(timeout=5)
                    duration_ms = int((time.monotonic() - start) * 1000)
                    yield f"data: {json.dumps({'type': 'done', 'exit_code': proc.returncode, 'duration_ms': duration_ms})}\n\n"

            except Exception as e:
                if proc:
                    proc.kill()
                yield f"data: {json.dumps({'type': 'error', 'text': str(e)})}\n\n"

        response = StreamingHttpResponse(event_stream(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response


class ShareCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        files = request.data.get("files", [])
        if not files:
            return Response({"error": "files required"}, status=400)
        snippet = SharedSnippet.objects.create(files=files)
        return Response({"slug": snippet.slug})


class ShareDetailView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request, slug):
        try:
            snippet = SharedSnippet.objects.get(slug=slug)
        except SharedSnippet.DoesNotExist:
            return Response({"error": "not found"}, status=404)
        if snippet.created_at < timezone.now() - timedelta(days=7):
            snippet.delete()
            return Response({"error": "expired"}, status=404)
        return Response({"files": snippet.files, "created_at": snippet.created_at})
