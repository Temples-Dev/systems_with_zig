from django.contrib import admin
from .models import Section, Module, LearningObjective, Exercise

admin.site.register(Section)
admin.site.register(Module)
admin.site.register(LearningObjective)
admin.site.register(Exercise)
