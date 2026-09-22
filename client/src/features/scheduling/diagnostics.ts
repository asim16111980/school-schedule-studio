import type { SchedulingConfig, Assignment } from './model';
import { dailyLimitFor, studyDaysFor, teacherGapLimitFor } from './constraints';

export type DiagnosticSeverity = 'hard' | 'warning' | 'info';
export type DiagnosticAction = { id: string; label: string; reason: string };
export type DiagnosticIssue = {
  id: string;
  severity: DiagnosticSeverity;
  title: string;
  detail: string;
  impact: number;
  action?: DiagnosticAction;
};

const capacityForClass = (config: SchedulingConfig, className: string) =>
  dailyLimitFor(config, className) * studyDaysFor(config, className).length;

const effectiveRequirements = (config: SchedulingConfig) => config.requirements ?? [];

export function diagnoseSchedule(config: SchedulingConfig, assignments: Assignment[] = []): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];
  const requirements = effectiveRequirements(config);

  for (const className of config.classes) {
    const required = requirements.filter(r => r.className === className).reduce((sum, r) => sum + Math.max(0, Math.floor(r.weeklyLessons)), 0);
    const capacity = capacityForClass(config, className);
    if (required > capacity) {
      issues.push({
        id: `class-capacity-${className}`,
        severity: 'hard', impact: required - capacity,
        title: `سعة الفصل ${className} غير كافية`,
        detail: `المطلوب ${required} حصة أسبوعياً، بينما السعة الحالية ${capacity}. زد أيام الدراسة أو الحد اليومي، أو خفّض المتطلبات بمقدار ${required - capacity}.`,
        action: { id: 'increase-class-capacity', label: 'زيادة سعة الفصل', reason: 'فتح مساحة زمنية إضافية للحصص.' },
      });
    }
    if (!studyDaysFor(config, className).length) {
      issues.push({ id: `no-days-${className}`, severity: 'hard', impact: 1, title: `الفصل ${className} بلا أيام دراسة`, detail: 'لا توجد أي أيام مسموحة لهذا الفصل، لذلك لا يمكن وضع أي حصة.', action: { id: 'restore-study-days', label: 'استعادة أيام الدراسة', reason: 'السماح للمحرك بالبحث في أيام الأسبوع.' } });
    }
  }

  const teachers = new Set(config.requirements?.map(r => r.teacher).filter(Boolean) ?? []);
  for (const teacher of teachers) {
    const required = requirements.filter(r => r.teacher === teacher).reduce((sum, r) => sum + Math.max(0, Math.floor(r.weeklyLessons)), 0);
    const unavailable = config.teacherAvailability?.[teacher]?.unavailable?.length ?? 0;
    const totalSlots = config.days.length * config.timeSlots.length;
    const available = Math.max(0, totalSlots - unavailable);
    if (required > available) {
      issues.push({ id: `teacher-capacity-${teacher}`, severity: 'hard', impact: required - available, title: `نصاب ${teacher} يتجاوز الإتاحة`, detail: `المطلوب ${required} حصة مقابل ${available} خانة متاحة فقط بعد استبعاد عدم الإتاحة.`, action: { id: 'review-teacher-availability', label: 'مراجعة الإتاحة', reason: 'تقليل الخانات الممنوعة أو توزيع النصاب.' } });
    }
    const gapViolations = config.days.filter(day => teacherGapLimitFor(config, teacher, day) === 0 && assignments.filter(a => a.teacher === teacher && a.day === day).length >= 3).length;
    if (gapViolations > 0) issues.push({ id: `teacher-gaps-${teacher}`, severity: 'warning', impact: gapViolations, title: `سياسة الفراغات للمعلم ${teacher} شديدة`, detail: `الحد الحالي للفراغات = 0 في ${gapViolations} أيام فيها ثلاث حصص أو أكثر. قد يقل عدد الحلول كثيراً.`, action: { id: 'relax-teacher-gaps', label: 'تخفيف الفراغات', reason: 'السماح بمرونة أكبر في ترتيب حصص المعلم.' } });
  }

  for (const requirement of requirements) {
    const maxPerDay = requirement.maxPerDay ?? 1;
    const availableDays = studyDaysFor(config, requirement.className).length;
    if (requirement.consecutive && requirement.weeklyLessons > maxPerDay) {
      issues.push({
        id: `consecutive-daily-limit-${requirement.id ?? `${requirement.className}-${requirement.subject}-${requirement.teacher}`}`,
        severity: 'hard',
        impact: requirement.weeklyLessons - maxPerDay,
        title: `كتلة ${requirement.subject} تتعارض مع الحد اليومي`,
        detail: `الحصص المتتالية تحتاج أن تقع في يوم واحد، لكن الحد اليومي للمادة هو ${maxPerDay} بينما المطلوب ${requirement.weeklyLessons}.`,
        action: { id: 'relax-consecutive-daily-limit', label: 'رفع الحد اليومي', reason: 'السماح بوضع كتلة الحصص المتتالية في يوم واحد.' },
      });
    }
    if (maxPerDay * availableDays < requirement.weeklyLessons) {
      issues.push({ id: `subject-frequency-${requirement.id ?? `${requirement.className}-${requirement.subject}-${requirement.teacher}`}`, severity: 'hard', impact: requirement.weeklyLessons - maxPerDay * availableDays, title: `تكرار ${requirement.subject} للفصل ${requirement.className} غير ممكن`, detail: `المطلوب ${requirement.weeklyLessons} حصص، لكن الحد ${maxPerDay} يومياً عبر ${availableDays} أيام يسمح بـ ${maxPerDay * availableDays} فقط.`, action: { id: 'relax-subject-daily-limit', label: 'رفع الحد اليومي', reason: 'السماح بأكثر من حصة للمادة في بعض الأيام.' } });
    }
    if (requirement.preferredDays?.length && requirement.preferredDays.every(day => !studyDaysFor(config, requirement.className).includes(day))) {
      issues.push({ id: `preference-days-${requirement.id ?? requirement.subject}`, severity: 'warning', impact: 1, title: `تفضيلات ${requirement.subject} خارج أيام الدراسة`, detail: `كل الأيام المفضلة للمادة غير متاحة للفصل ${requirement.className}، لذلك سيكسر المحرك التفضيل الناعم.`, action: { id: 'review-preferred-days', label: 'مراجعة التفضيلات', reason: 'جعل التفضيلات متوافقة مع أيام الدراسة.' } });
    }
    if (requirement.room && !config.roomAvailability?.[requirement.room] && !assignments.some(a => a.room === requirement.room)) {
      issues.push({ id: `room-definition-${requirement.room}`, severity: 'warning', impact: 1, title: `القاعة ${requirement.room} غير معرفة بالكامل`, detail: 'المتطلب يشير إلى قاعة لا تظهر لها سياسة إتاحة صريحة. راجع تعريف القاعة قبل التوليد.', action: { id: 'review-room', label: 'مراجعة القاعة', reason: 'التأكد من توفر المورد.' } });
    }
  }

  const roomLoads = new Map<string, number>();
  assignments.forEach(a => { if (a.room) roomLoads.set(a.room, (roomLoads.get(a.room) ?? 0) + 1); });
  for (const [room, load] of roomLoads) {
    const unavailable = config.roomAvailability?.[room]?.length ?? 0;
    if (unavailable >= config.days.length * config.timeSlots.length) issues.push({ id: `room-blocked-${room}`, severity: 'hard', impact: load, title: `القاعة ${room} محجوزة بالكامل`, detail: `لديها ${unavailable} خانات عدم إتاحة، بينما الجدول الحالي يستخدمها في ${load} حصص.`, action: { id: 'free-room', label: 'فتح القاعة', reason: 'إزالة فترات عدم الإتاحة غير الضرورية.' } });
  }

  if (!requirements.length) issues.push({ id: 'no-requirements', severity: 'info', impact: 0, title: 'وضع المنهج لا يحتوي متطلبات أسبوعية', detail: 'لن يستطيع المحرك استنتاج الحصص الأسبوعية الجديدة. يمكنك إدخال المتطلبات أو الاستمرار باستخدام الحصص الحالية.', action: { id: 'add-requirements', label: 'إضافة متطلبات', reason: 'تحديد عدد الحصص الأسبوعية لكل مادة.' } });

  return issues.sort((a, b) => ({ hard: 0, warning: 1, info: 2 }[a.severity] - ({ hard: 0, warning: 1, info: 2 }[b.severity]) || b.impact - a.impact));
}
