# Learnomy for EmDash: plan

**Status: LOCKED on 2026-11-15; amended the same day by the owner (Course outline page, issue #1).** Scope is `SCOPE.md`. An agent does not change scope, add options or reorder steps. If a task cannot be done as written, stop, say why on its issue, and wait for the owner.

Every task is a GitHub issue under the `0.1.0` milestone on `wbcomdesigns/emdash-learnomy`, worked on branch `0.1.0`. One builder at a time: the steps share the same files.

## Order of work

| Step | Task | Done when |
| --- | --- | --- |
| 1 | Repo from `~/code/emdash-plugin-starter`, manifest (`release.requires >=1.5.0`, capabilities `content:read`, `users:read`, storage, kv; no network), seed for `lms_courses`, `lms_lessons`, `lms_course_category` (amended 2026-11-15: no course field on lessons; the Course outline holds lessons per course) | On a fresh 1.5 blog lab the seed applies cleanly and the plugin can list published `lms_courses` and `lms_lessons` by title with `content:read` |
| 2 | Storage, indexes and the routes: `outline` (public), `enroll`, `completeLesson`, `quiz`, `submitQuiz`, `eraseMember`; compare-and-set on enroll; server-side scoring; correct answers never returned. Tests: guest refused, second enroll, lesson not on the course, not enrolled, quiz type refused, erase removes every row, 20 calls or fewer per entry point (shared `tests/bridge-count.ts`) | `npm test` passes |
| 3 | Admin: Course outline page (pick course, add lessons by title, order, remove, version token), Quizzes page (create, questions one per form, edit, delete with a version token), lesson editor panel that picks a quiz by title, Enrollments and Quiz results lists (names via `users:read`, 25 rows, Find, Next/Previous), dashboard card, erase for one member. Every response through EmDash's Block Kit validator | An owner builds an outline and a quiz and attaches both by title; lists show names |
| 4 | Site kit: layout, strings, catalog, course, lesson (Open and Members), Your courses, enroll, complete, quiz, erase; Course structured data; `data-learnomy-*`; shared `wbcom-kit.ts` | A guest reads an Open course; a guest sees a Members lesson's title and sign-in prompt only; an invited member enrolls, finishes, scores, erases |
| 5 | Daily task with version marker; install and activate that never throw; docs (install, Let members join, admin, routes, registry texts, what's new); QA checklist | Docs lint clean; gate Gate A passes |
| 6 | Release: independent walk on a standard 1.5 Node lab and the Cloudflare testbed (registry install), review, gate, owner says publish | Walk and review findings fixed; owner's yes |

## Rules every task follows

- Load the `emdash-plugin-development` skill and its `references/build-check-publish.md` and `release-gate.md` first.
- Docs first: check every EmDash API, hook and config in the `emdash-docs` MCP; name any deviation and its source line in the PR.
- Every behaviour change has a test that fails on the old code. Every entry point at 20 calls or fewer. Report the bundle size each step (cap 128 KB per file; target under 100 KB).
- One-shot tasks alternate two names. Nothing depends on a plugin update hook. Install and activate never throw.
- Every admin screen: Block Kit elements the docs allow on admin pages, names never ids, empty, loading and error states. Every kit screen: 1440, 768, 390, light and dark, keyboard, escaped output.
- Commit with explicit paths, no AI attribution. Push the branch; comment on the step's issue. Never merge, tag or publish.

## Later releases (not started until the previous one is on main)

| Release | Adds |
| --- | --- |
| 0.2.0 | Practice mode, passing score inside `completeLesson`, more question types |
| 0.3.0 | Finished-course printable page from `completedAt` |
| 0.4.0 | Announcements; reviews through WB Reviews |
| Later | Self-signup in the join guide once EmDash fixes #4863; grants by email (`users:read`); course file import and export; a completion email (`email:send`) |
