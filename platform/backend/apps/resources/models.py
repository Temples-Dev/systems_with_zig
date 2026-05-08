from django.db import models
from django.conf import settings


class Resource(models.Model):
    TYPES = [
        ("video", "Video"),
        ("playlist", "Playlist"),
        ("article", "Article"),
        ("docs", "Documentation"),
    ]

    title = models.CharField(max_length=200)
    url = models.URLField()
    description = models.TextField(blank=True)
    resource_type = models.CharField(max_length=20, choices=TYPES, default="video")
    topic = models.CharField(max_length=100)
    module = models.ForeignKey(
        "curriculum.Module",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="resources",
    )
    is_featured = models.BooleanField(default=False)
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        on_delete=models.SET_NULL,
        editable=False,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-is_featured", "-created_at"]

    def __str__(self):
        return self.title
