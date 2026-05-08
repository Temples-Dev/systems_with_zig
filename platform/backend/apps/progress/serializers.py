from rest_framework import serializers
from .models import ModuleProgress, ObjectiveCheck, ExerciseAttempt, EditorSnapshot


class ModuleProgressSerializer(serializers.ModelSerializer):
    module_slug = serializers.CharField(source="module.slug", read_only=True)
    module_number = serializers.IntegerField(source="module.number", read_only=True)

    class Meta:
        model = ModuleProgress
        fields = ("id", "module_slug", "module_number", "state", "started_at", "completed_at", "time_spent_seconds")
        read_only_fields = ("started_at", "completed_at")


class ObjectiveCheckSerializer(serializers.ModelSerializer):
    class Meta:
        model = ObjectiveCheck
        fields = ("id", "objective", "checked", "checked_at")
        read_only_fields = ("checked_at",)


class ExerciseAttemptSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExerciseAttempt
        fields = ("id", "exercise", "code", "passed", "score", "feedback", "hints_used", "created_at")
        read_only_fields = ("passed", "score", "feedback", "created_at")


class EditorSnapshotSerializer(serializers.ModelSerializer):
    class Meta:
        model = EditorSnapshot
        fields = ("exercise", "code", "updated_at")
        read_only_fields = ("updated_at",)
