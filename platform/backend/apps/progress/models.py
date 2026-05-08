from django.db import models
from django.conf import settings


class ModuleProgress(models.Model):
    class State(models.TextChoices):
        LOCKED = "locked", "Locked"
        AVAILABLE = "available", "Available"
        IN_PROGRESS = "in_progress", "In Progress"
        COMPLETE = "complete", "Complete"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="module_progress")
    module = models.ForeignKey("curriculum.Module", on_delete=models.CASCADE, related_name="progress")
    state = models.CharField(max_length=20, choices=State.choices, default=State.LOCKED)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    time_spent_seconds = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = ("user", "module")

    def __str__(self):
        return f"{self.user.email} - M{self.module.number} ({self.state})"


class ObjectiveCheck(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    objective = models.ForeignKey("curriculum.LearningObjective", on_delete=models.CASCADE)
    checked = models.BooleanField(default=False)
    checked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ("user", "objective")


class ExerciseAttempt(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="attempts")
    exercise = models.ForeignKey("curriculum.Exercise", on_delete=models.CASCADE, related_name="attempts")
    code = models.TextField()
    passed = models.BooleanField(default=False)
    score = models.FloatField(default=0.0)
    feedback = models.JSONField(default=dict)
    hints_used = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.email} - {self.exercise.title} ({'pass' if self.passed else 'fail'})"


class EditorSnapshot(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    exercise = models.ForeignKey("curriculum.Exercise", on_delete=models.CASCADE)
    code = models.TextField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "exercise")


class ExerciseNote(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    exercise = models.ForeignKey("curriculum.Exercise", on_delete=models.CASCADE)
    content = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "exercise")
