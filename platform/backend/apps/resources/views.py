from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import Resource
from .serializers import ResourceSerializer


class ResourceListCreateView(generics.ListCreateAPIView):
    serializer_class = ResourceSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [permissions.IsAdminUser()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        qs = Resource.objects.select_related("added_by", "module")
        topic = self.request.query_params.get("topic")
        rtype = self.request.query_params.get("type")
        module_id = self.request.query_params.get("module")
        featured = self.request.query_params.get("featured")
        if topic:
            qs = qs.filter(topic__iexact=topic)
        if rtype:
            qs = qs.filter(resource_type=rtype)
        if module_id:
            qs = qs.filter(module_id=module_id)
        if featured == "true":
            qs = qs.filter(is_featured=True)
        return qs

    def perform_create(self, serializer):
        serializer.save(added_by=self.request.user)


class ResourceDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Resource.objects.select_related("added_by", "module")
    serializer_class = ResourceSerializer

    def get_permissions(self):
        if self.request.method == "GET":
            return [permissions.IsAuthenticated()]
        return [permissions.IsAdminUser()]


class TopicListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        topics = (
            Resource.objects.values_list("topic", flat=True)
            .distinct()
            .order_by("topic")
        )
        return Response(sorted(set(t.lower() for t in topics)))
