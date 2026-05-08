from django.urls import path
from .views import ResourceListCreateView, ResourceDetailView, TopicListView

urlpatterns = [
    path("", ResourceListCreateView.as_view()),
    path("topics/", TopicListView.as_view()),
    path("<int:pk>/", ResourceDetailView.as_view()),
]
