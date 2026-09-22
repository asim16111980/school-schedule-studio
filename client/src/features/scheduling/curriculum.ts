import type { SubjectRequirement } from "./model";

export type CurriculumSubject = {
  name: string;
  weekly: number;
};

/** Build weekly lesson variables from class/subject curriculum data. */
export function buildCurriculumRequirements(
  classes: string[],
  subjects: CurriculumSubject[],
  teacherBySubject: Record<string, string>,
): SubjectRequirement[] {
  return classes.flatMap((className) => subjects.flatMap((subject) => {
    const teacher = teacherBySubject[subject.name];
    if (!teacher || subject.weekly <= 0) return [];
    return [{
      className,
      subject: subject.name,
      teacher,
      weeklyLessons: Math.floor(subject.weekly),
      maxPerDay: 1,
      minGapBetweenSameSubject: subject.weekly >= 4 ? 0 : 1,
    }];
  }));
}
