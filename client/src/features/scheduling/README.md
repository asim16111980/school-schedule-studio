# Scheduling Engine

The scheduling engine is a constraint-satisfaction/optimization layer independent from the React UI.

## Hard constraints
- Class collision prevention
- Teacher collision prevention
- Room collision prevention
- Stage study days and daily slot limits
- Teacher unavailability
- Teacher gap limits and explicit slot limits
- Per-subject daily limits
- Minimum spacing between repeated subject lessons
- Consecutive lesson blocks when configured

## Soft objectives
The solver minimizes internal class gaps, teacher gaps, repeated subjects on the same day, subject-spacing pressure, daily-load imbalance, and missed preferences. Every weight is configurable through `SchedulingConfig.weights`.

## Search strategy
MRV + fail-first variable selection + forward checking + branch ordering + bounded search. Locked assignments are seeded first and are never moved. When a full solution is impossible, the engine returns the best partial solution and the exact unplaced lessons instead of silently dropping them.

## Curriculum mode
`expandRequirements()` turns weekly curriculum requirements into individual lesson variables. `buildCurriculumRequirements()` provides a convenient adapter from classes + weekly subject counts + teacher mapping.
