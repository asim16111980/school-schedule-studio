# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19 + TypeScript + Vite 7 + TailwindCSS 4
Express server (serves production build only)
Shared types in `shared/`

## Users

**Primary:** School principals and vice-principals in Arabic-speaking schools who create the master weekly timetable for all classes, teachers, and subjects.

**Secondary:** Academic affairs coordinators and department heads who manage teacher availability, subject requirements, and room allocations.

**Situation:** End-of-term or mid-year scheduling windows. User sits at a desktop/laptop, needs to produce a conflict-free weekly grid (5 days × 7 periods) for 10–30 classes, 20–50 teachers, across 6–10 subjects. Constraints are complex: teacher gaps, consecutive blocks, daily limits, room sharing, stage-specific study days.

## Product Purpose

Generate valid, optimized school timetables that satisfy all hard constraints (no collisions, teacher availability, stage limits) while minimizing soft penalties (gaps, load imbalance, repeated subjects). The product makes possible what is intractable manually: exploring millions of combinations in seconds and surfacing the best feasible schedule with unplaced lessons clearly identified.

**Success means:** A complete or near-complete timetable exported to PDF (Arabic RTL) and Excel, ready for printing and distribution to teachers and students.

## Positioning

The constraint-satisfaction engine is the differentiator. Neighboring products (spreadsheets, generic calendar tools, drag-drop timetablers) cannot:
- Guarantee hard-constraint satisfaction via MRV + forward checking + branch ordering
- Expand weekly curriculum requirements into individual lesson variables automatically
- Run CPU-intensive search off the main thread (Web Worker) keeping UI responsive
- Return the best partial solution with exact unplaced lessons when a full solution is impossible

## Operating Context

- **Workflow:** Define classes → Define teachers + availability → Define subjects + weekly lessons per class → Set constraints (gaps, consecutive blocks, daily limits) → Generate → Review conflicts → Manual adjust → Re-optimize → Export PDF/Excel
- **Environment:** Desktop browser (Chrome/Edge/Firefox), Arabic OS/browser locale
- **Artifacts produced:** Master timetable (class view, teacher view, subject view), PDF for printing, Excel for records
- **Data lifecycle:** All state in localStorage (17 keys), debounced saves, backup/restore via JSON, no cloud sync

## Capabilities and Constraints

| Capability | Status |
|------------|--------|
| Class/teacher/subject CRUD | ✅ |
| Teacher availability matrix (day × slot) | ✅ |
| Stage daily slots & study days | ✅ |
| Teacher gap limits (per day) + slot limits | ✅ |
| Room availability | ✅ |
| Curriculum mode (weekly requirements → lessons) | ✅ |
| Solver: MRV + forward checking + multi-start | ✅ |
| Web Worker off main thread | ✅ |
| PDF export (Arabic via html2canvas) | ✅ |
| Excel export (xlsx) | ✅ |
| Backup/restore with Zod validation | ✅ |
| Dark/light theme | ✅ |
| Undo (last assignments) | ✅ |

**Technical constraints:**
- No backend database — all persistence localStorage
- Web Worker requires HTTPS or localhost (secure context)
- PDF generation requires `html2canvas` DOM capture (not jsPDF text)
- Arabic font: Noto Kufi Arabic (loaded via Google Fonts or local)
- Minimum font sizes: 12–14px for Arabic readability (fixed from 7–9px)

**Undecided / open:**
- Multi-user / collaborative editing
- Cloud sync / account system
- Mobile-responsive timetable view (current: desktop-first)
- Print-specific CSS for PDF (currently html2canvas capture)

## Brand Commitments

- **Name:** School Schedule Studio (مدرسة جدولة الاستوديو — Arabic name TBD)
- **Voice:** Professional, precise, Arabic-first. Technical but accessible to non-technical admins.
- **Assets:** Noto Kufi Arabic font. No logo yet. Favicon uses generic school icon.
- **Color palette:** Subject-coded (Math=purple, Arabic=teal, Science=orange, English=pink, Social=blue, Activity=gold) — semantic, not decorative.

## Evidence on Hand

- Working scheduler with 16 passing tests (1 pre-existing flaky test unrelated to recent changes)
- Real constraint solver implementation in `client/src/features/scheduling/solver.ts`
- PDF export tested with Arabic content
- localStorage schema with 17 keys documented in code
- No marketing copy, testimonials, case studies, or press — future work must not fabricate these

## Product Principles

1. **Constraints over preferences** — Hard constraints are never violated; soft penalties are minimized transparently.
2. **Arabic-first, not Arabic-later** — RTL, font, numeral shaping, and cultural norms drive every UI decision.
3. **Local-first trust** — School data never leaves the device; no account, no cloud, no tracking.
4. **Show the math** — Unplaced lessons, explored nodes, soft penalty, and solve time are visible — no black box.
5. **Responsive solver, responsive UI** — Web Worker keeps interaction smooth even during 10k+ node searches.

## Accessibility & Inclusion

- Arabic RTL layout with logical properties (not physical left/right)
- Minimum 12px Arabic font size (WCAG AA for Arabic script)
- Color is not sole information carrier — subject codes + icons + patterns
- Keyboard navigable: all grids, dialogs, forms
- Screen reader labels on interactive elements (to be audited)
- No motion reduction preference detected yet — add `prefers-reduced-motion`