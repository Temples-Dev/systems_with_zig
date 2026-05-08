from django.db import models


class Section(models.Model):
    number = models.PositiveSmallIntegerField(unique=True)
    title = models.CharField(max_length=200)
    slug = models.SlugField(max_length=200, unique=True)

    class Meta:
        ordering = ["number"]

    def __str__(self):
        return f"Section {self.number}: {self.title}"


class Module(models.Model):
    section = models.ForeignKey(Section, on_delete=models.CASCADE, related_name="modules")
    number = models.PositiveSmallIntegerField(unique=True)
    title = models.CharField(max_length=200)
    slug = models.SlugField(max_length=200, unique=True)
    content_file = models.CharField(max_length=200, help_text="Relative path to markdown file")
    order = models.PositiveSmallIntegerField()
    is_capstone = models.BooleanField(default=False)

    class Meta:
        ordering = ["number"]

    def __str__(self):
        return f"Module {self.number}: {self.title}"


class LearningObjective(models.Model):
    module = models.ForeignKey(Module, on_delete=models.CASCADE, related_name="objectives")
    text = models.TextField()
    order = models.PositiveSmallIntegerField()

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return f"M{self.module.number} obj {self.order}"


class Exercise(models.Model):
    class Type(models.TextChoices):
        IMPLEMENTATION = "implementation", "Implementation"
        OBSERVATION = "observation", "Observation"
        ANALYSIS = "analysis", "Analysis"

    module = models.ForeignKey(Module, on_delete=models.CASCADE, related_name="exercises")
    title = models.CharField(max_length=200)
    description = models.TextField()
    exercise_type = models.CharField(max_length=20, choices=Type.choices)
    order = models.PositiveSmallIntegerField()
    is_required = models.BooleanField(default=True)
    starter_code = models.TextField(blank=True)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return f"M{self.module.number} - {self.title}"
