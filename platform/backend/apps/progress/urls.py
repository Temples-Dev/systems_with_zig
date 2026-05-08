from django.urls import path
from .views import (
    ModuleProgressListView, ObjectiveCheckUpdateView,
    ExerciseAttemptCreateView, EditorSnapshotView,
    UserStatsView, ObjectiveToggleView,
    ModuleProgressUpsertView, ModuleObjectiveStatusView,
    ExercisePassView, ExercisePassStatusView, ExerciseNoteView,
)

urlpatterns = [
    path("modules/", ModuleProgressListView.as_view()),
    path("modules/<slug:slug>/", ModuleProgressUpsertView.as_view()),
    path("modules/<slug:slug>/objectives/", ModuleObjectiveStatusView.as_view()),
    path("objectives/toggle/", ObjectiveToggleView.as_view()),
    path("objectives/<int:pk>/", ObjectiveCheckUpdateView.as_view()),
    path("attempts/", ExerciseAttemptCreateView.as_view()),
    path("snapshots/<int:exercise_id>/", EditorSnapshotView.as_view()),
    path("stats/", UserStatsView.as_view()),
    path("exercises/<int:exercise_id>/pass/", ExercisePassView.as_view()),
    path("exercises/modules/<slug:slug>/", ExercisePassStatusView.as_view()),
    path("notes/<int:exercise_id>/", ExerciseNoteView.as_view()),
]
