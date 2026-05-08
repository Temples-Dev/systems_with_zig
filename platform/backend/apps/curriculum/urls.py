from django.urls import path
from .views import SectionListView, ModuleDetailView, ModuleContentView, SearchView, ExerciseUpdateView

urlpatterns = [
    path("sections/", SectionListView.as_view()),
    path("modules/<slug:slug>/", ModuleDetailView.as_view()),
    path("modules/<slug:slug>/content/", ModuleContentView.as_view()),
    path("search/", SearchView.as_view()),
    path("exercises/<int:exercise_id>/", ExerciseUpdateView.as_view()),
]
