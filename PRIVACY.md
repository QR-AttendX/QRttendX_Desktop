# PRIVACY & DATA HANDLING — QRttendX

QRttendX processes attendance-related data which may include student names, IDs, timestamps, and device identifiers.

## Recommendations for deployers
- Only collect the minimum data required for attendance tracking.
- Store data encrypted at rest and in transit (use TLS for network communication).
- Implement role-based access control (admins, teachers, students).
- Retention: define a data retention policy (e.g., purge raw attendance logs after X months unless required by law).
- Inform users (students/parents) about what data is collected and how it is used.

## Legal/Compliance
- Check local data protection laws (e.g., data protection, student privacy regulations) before deploying.
- Display a clear privacy notice during onboarding or installation where applicable.
