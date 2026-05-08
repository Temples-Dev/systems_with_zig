from rest_framework import serializers
from .models import Resource


class ResourceSerializer(serializers.ModelSerializer):
    added_by_username = serializers.CharField(source="added_by.username", read_only=True, default=None)
    module_title = serializers.CharField(source="module.title", read_only=True, default=None)

    class Meta:
        model = Resource
        fields = (
            "id", "title", "url", "description", "resource_type",
            "topic", "module", "module_title", "is_featured",
            "added_by_username", "created_at",
        )
        read_only_fields = ("id", "added_by_username", "module_title", "created_at")
