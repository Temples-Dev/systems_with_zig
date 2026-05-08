from django.conf import settings
from django.db.models import Q
from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import Section, Module, Exercise
from .serializers import SectionSerializer, ModuleSerializer


class SectionListView(generics.ListAPIView):
    queryset = Section.objects.prefetch_related("modules")
    serializer_class = SectionSerializer
    permission_classes = [permissions.IsAuthenticated]


class ModuleDetailView(generics.RetrieveAPIView):
    queryset = Module.objects.prefetch_related("objectives", "exercises")
    serializer_class = ModuleSerializer
    permission_classes = [permissions.IsAuthenticated]
    lookup_field = "slug"


class ModuleContentView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug):
        try:
            module = Module.objects.get(slug=slug)
        except Module.DoesNotExist:
            return Response({"error": "not found"}, status=404)

        path = settings.CONTENT_DIR / module.content_file
        try:
            content = path.read_text(encoding="utf-8")
        except (IOError, OSError):
            return Response({"error": "content file not available"}, status=404)

        return Response({"content": content, "title": module.title, "number": module.number})


class ExerciseUpdateView(APIView):
    permission_classes = [permissions.IsAdminUser]

    def patch(self, request, exercise_id):
        try:
            exercise = Exercise.objects.get(pk=exercise_id)
        except Exercise.DoesNotExist:
            return Response({"error": "not found"}, status=404)

        for field in ("title", "description", "starter_code"):
            if field in request.data:
                setattr(exercise, field, request.data[field])
        exercise.save()

        return Response({
            "id": exercise.id,
            "title": exercise.title,
            "description": exercise.description,
            "starter_code": exercise.starter_code,
        })


class SearchView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        q = request.query_params.get("q", "").strip()
        if len(q) < 2:
            return Response([])

        modules = (
            Module.objects
            .filter(title__icontains=q)
            .distinct()[:6]
        )
        exercises = (
            Exercise.objects
            .filter(Q(title__icontains=q) | Q(description__icontains=q))
            .select_related("module")[:8]
        )

        results = [
            {
                "type": "module",
                "id": m.id,
                "title": m.title,
                "slug": m.slug,
                "number": m.number,
            }
            for m in modules
        ]
        results += [
            {
                "type": "exercise",
                "id": ex.id,
                "title": ex.title,
                "module_slug": ex.module.slug,
                "module_title": ex.module.title,
                "module_number": ex.module.number,
            }
            for ex in exercises
        ]
        return Response(results[:12])
