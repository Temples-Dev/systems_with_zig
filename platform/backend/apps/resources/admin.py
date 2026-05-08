from django.contrib import admin
from .models import Resource


@admin.register(Resource)
class ResourceAdmin(admin.ModelAdmin):
    list_display = ("title", "resource_type", "topic", "module", "is_featured", "created_at")
    list_filter = ("resource_type", "topic", "is_featured")
    search_fields = ("title", "description", "topic")
    autocomplete_fields = ("module",)
