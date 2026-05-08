from rest_framework import generics, permissions
from rest_framework.views import APIView
from rest_framework.response import Response
from django.utils import timezone
from .models import ModuleProgress, ObjectiveCheck, ExerciseAttempt, EditorSnapshot, ExerciseNote
from .serializers import (
    ModuleProgressSerializer,
    ObjectiveCheckSerializer,
    ExerciseAttemptSerializer,
    EditorSnapshotSerializer,
)

# ── Exercise pass persistence ─────────────────────────────────────────────────


class ModuleProgressListView(generics.ListAPIView):
    serializer_class = ModuleProgressSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return ModuleProgress.objects.filter(user=self.request.user).select_related("module")


class ObjectiveCheckUpdateView(generics.UpdateAPIView):
    serializer_class = ObjectiveCheckSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return ObjectiveCheck.objects.filter(user=self.request.user)


class ExerciseAttemptCreateView(generics.CreateAPIView):
    serializer_class = ExerciseAttemptSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class EditorSnapshotView(generics.RetrieveUpdateAPIView):
    serializer_class = EditorSnapshotSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        exercise_id = self.kwargs["exercise_id"]
        obj, _ = EditorSnapshot.objects.get_or_create(
            user=self.request.user,
            exercise_id=exercise_id,
            defaults={"code": ""},
        )
        return obj


class UserStatsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from apps.curriculum.models import Module
        user = request.user
        total = Module.objects.count()
        qs = ModuleProgress.objects.filter(user=user)
        started = qs.filter(state__in=['in_progress', 'complete']).count()
        completed = qs.filter(state='complete').count()
        obj_checked = ObjectiveCheck.objects.filter(user=user, checked=True).count()
        ex_passed = ExerciseAttempt.objects.filter(user=user, passed=True).count()
        last = qs.filter(state__in=['in_progress', 'complete']).order_by('-started_at').select_related('module').first()
        last_module = None
        if last:
            last_module = {
                'slug': last.module.slug,
                'title': last.module.title,
                'number': last.module.number,
                'state': last.state,
            }
        achievements = []
        if ExerciseAttempt.objects.filter(user=user).exists():
            achievements.append('first_run')
        if ex_passed > 0:
            achievements.append('first_pass')
        if completed > 0:
            achievements.append('first_module')
        if total > 0 and completed == total:
            achievements.append('all_modules')

        return Response({
            'total_modules': total,
            'modules_started': started,
            'modules_completed': completed,
            'objectives_checked': obj_checked,
            'exercises_passed': ex_passed,
            'completion_pct': round((completed / total * 100) if total else 0),
            'last_module': last_module,
            'achievements': achievements,
        })


class ObjectiveToggleView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        objective_id = request.data.get('objective_id')
        checked = request.data.get('checked', True)
        obj, created = ObjectiveCheck.objects.get_or_create(
            user=request.user,
            objective_id=objective_id,
            defaults={'checked': checked, 'checked_at': timezone.now() if checked else None},
        )
        if not created:
            obj.checked = checked
            obj.checked_at = timezone.now() if checked else None
            obj.save()
        return Response({'id': obj.id, 'objective_id': objective_id, 'checked': obj.checked})


class ModuleProgressUpsertView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, slug):
        from apps.curriculum.models import Module
        try:
            module = Module.objects.get(slug=slug)
        except Module.DoesNotExist:
            return Response({'error': 'not found'}, status=404)

        state = request.data.get('state', 'in_progress')
        obj, created = ModuleProgress.objects.get_or_create(
            user=request.user,
            module=module,
            defaults={'state': state, 'started_at': timezone.now()},
        )
        if not created:
            if state == 'complete' and obj.state != 'complete':
                obj.completed_at = timezone.now()
            obj.state = state
            obj.save()
        return Response({'module_slug': slug, 'state': obj.state})


class ModuleObjectiveStatusView(APIView):
    """Returns which objectives are checked for a given module."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug):
        from apps.curriculum.models import Module
        try:
            module = Module.objects.get(slug=slug)
        except Module.DoesNotExist:
            return Response({'error': 'not found'}, status=404)

        checks = ObjectiveCheck.objects.filter(
            user=request.user,
            objective__module=module,
        ).values('objective_id', 'checked')
        return Response({c['objective_id']: c['checked'] for c in checks})


class ExerciseNoteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, exercise_id):
        note, _ = ExerciseNote.objects.get_or_create(
            user=request.user,
            exercise_id=exercise_id,
            defaults={'content': ''},
        )
        return Response({'content': note.content})

    def patch(self, request, exercise_id):
        note, _ = ExerciseNote.objects.get_or_create(
            user=request.user,
            exercise_id=exercise_id,
            defaults={'content': ''},
        )
        note.content = request.data.get('content', note.content)
        note.save()
        return Response({'content': note.content})


class ExercisePassView(APIView):
    """Record a passing attempt; auto-complete the module when all required exercises pass."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, exercise_id):
        from apps.curriculum.models import Exercise
        try:
            exercise = Exercise.objects.select_related('module').get(pk=exercise_id)
        except Exercise.DoesNotExist:
            return Response({'error': 'not found'}, status=404)

        code = request.data.get('code', '')

        ExerciseAttempt.objects.update_or_create(
            user=request.user,
            exercise=exercise,
            defaults={'code': code, 'passed': True, 'score': 1.0},
        )

        module = exercise.module
        required_ids = set(
            module.exercises.filter(is_required=True).values_list('id', flat=True)
        )
        passed_ids = set(
            ExerciseAttempt.objects.filter(
                user=request.user,
                exercise_id__in=required_ids,
                passed=True,
            ).values_list('exercise_id', flat=True)
        )
        module_complete = bool(required_ids) and required_ids <= passed_ids

        if module_complete:
            mp, _ = ModuleProgress.objects.get_or_create(
                user=request.user,
                module=module,
                defaults={
                    'state': ModuleProgress.State.COMPLETE,
                    'started_at': timezone.now(),
                    'completed_at': timezone.now(),
                },
            )
            if mp.state != ModuleProgress.State.COMPLETE:
                mp.state = ModuleProgress.State.COMPLETE
                mp.completed_at = timezone.now()
                mp.save()

        return Response({'passed': True, 'module_complete': module_complete})


class ExercisePassStatusView(APIView):
    """Which exercises in a module have a passing attempt for the current user."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug):
        from apps.curriculum.models import Module
        try:
            module = Module.objects.get(slug=slug)
        except Module.DoesNotExist:
            return Response({'error': 'not found'}, status=404)

        passed_ids = ExerciseAttempt.objects.filter(
            user=request.user,
            exercise__module=module,
            passed=True,
        ).values_list('exercise_id', flat=True)

        return Response({str(eid): True for eid in passed_ids})
