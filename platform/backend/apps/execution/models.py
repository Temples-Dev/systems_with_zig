import secrets
from django.db import models
from django.conf import settings


class ExecutionRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        RUNNING = "running", "Running"
        COMPLETE = "complete", "Complete"
        TIMEOUT = "timeout", "Timeout"
        ERROR = "error", "Error"

    class Mode(models.TextChoices):
        DEBUG = "debug", "Debug"
        RELEASE_FAST = "release_fast", "ReleaseFast"
        TEST = "test", "Test"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="executions")
    code = models.TextField(blank=True)
    files = models.JSONField(default=list, blank=True)  # [{path, content}] for multi-file projects
    mode = models.CharField(max_length=20, choices=Mode.choices, default=Mode.DEBUG)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    stdout = models.TextField(blank=True)
    stderr = models.TextField(blank=True)
    exit_code = models.IntegerField(null=True, blank=True)
    duration_ms = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.email} exec {self.id} ({self.status})"


class SharedSnippet(models.Model):
    slug = models.CharField(max_length=12, unique=True, db_index=True)
    files = models.JSONField()  # [{path, content}]
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = secrets.token_urlsafe(8)[:8]
        super().save(*args, **kwargs)

    def __str__(self):
        return f"snippet:{self.slug}"
