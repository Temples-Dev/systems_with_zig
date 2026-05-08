from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("curriculum", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Resource",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=200)),
                ("url", models.URLField()),
                ("description", models.TextField(blank=True)),
                (
                    "resource_type",
                    models.CharField(
                        choices=[("video", "Video"), ("playlist", "Playlist"), ("article", "Article"), ("docs", "Documentation")],
                        default="video",
                        max_length=20,
                    ),
                ),
                ("topic", models.CharField(max_length=100)),
                ("is_featured", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "added_by",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "module",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="resources",
                        to="curriculum.module",
                    ),
                ),
            ],
            options={"ordering": ["-is_featured", "-created_at"]},
        ),
    ]
