from django.contrib import admin
from django.urls import path, include
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/curriculum/", include("apps.curriculum.urls")),
    path("api/progress/", include("apps.progress.urls")),
    path("api/execution/", include("apps.execution.urls")),
    path("api/resources/", include("apps.resources.urls")),
    # API docs — schema at /api/schema/, Swagger UI at /
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
]
