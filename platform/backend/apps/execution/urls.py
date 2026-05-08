from django.urls import path
from .views import ExecutionCreateView, ExecutionStreamView, ShareCreateView, ShareDetailView

urlpatterns = [
    path("run/", ExecutionCreateView.as_view()),
    path("stream/", ExecutionStreamView.as_view()),
    path("share/", ShareCreateView.as_view()),
    path("share/<str:slug>/", ShareDetailView.as_view()),
]
