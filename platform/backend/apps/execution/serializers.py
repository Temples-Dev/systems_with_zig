from rest_framework import serializers
from .models import ExecutionRequest


class ExecutionRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExecutionRequest
        fields = (
            "id", "code", "files", "mode",
            "status", "stdout", "stderr", "exit_code", "duration_ms",
            "created_at", "completed_at",
        )
        read_only_fields = (
            "status", "stdout", "stderr", "exit_code",
            "duration_ms", "created_at", "completed_at",
        )
