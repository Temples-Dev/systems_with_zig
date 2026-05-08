from rest_framework import serializers
from .models import Section, Module, LearningObjective, Exercise


class LearningObjectiveSerializer(serializers.ModelSerializer):
    class Meta:
        model = LearningObjective
        fields = ("id", "text", "order")


class ExerciseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Exercise
        fields = ("id", "title", "description", "exercise_type", "order", "is_required", "starter_code")


class ModuleSerializer(serializers.ModelSerializer):
    objectives = LearningObjectiveSerializer(many=True, read_only=True)
    exercises = ExerciseSerializer(many=True, read_only=True)

    class Meta:
        model = Module
        fields = ("id", "number", "title", "slug", "order", "is_capstone", "objectives", "exercises")


class ModuleListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Module
        fields = ("id", "number", "title", "slug", "order", "is_capstone")


class SectionSerializer(serializers.ModelSerializer):
    modules = ModuleListSerializer(many=True, read_only=True)

    class Meta:
        model = Section
        fields = ("id", "number", "title", "slug", "modules")
