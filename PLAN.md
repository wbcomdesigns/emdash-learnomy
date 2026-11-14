# Learnomy for EmDash: plan

**Status: LOCKED on 2026-11-15; amended the same day by the owner (Course outline page, issue #1).** Scope is `SCOPE.md`. An agent does not change scope, add options or reorder steps. If a task cannot be done as written, stop, say why on its issue, and wait for the owner.

Every task is a GitHub issue under the `0.1.0` milestone on `wbcomdesigns/emdash-learnomy`, worked on branch `0.1.0`. One builder at a time: the steps share the same files.

## Order of work

| Step | Task | Done when |
| --- | --- | --- |
| 1 | Repo from `~/code/emdash-plugin-starter`, manifest (`release.requires >=1.5.0`, capabilities `content:read`, `users:read`, storage, kv; no network), seed for `lms_courses`, `lms_lessons`, `lms_course_category` (amended 2026-11-15: no course field on lessons; the Course outline holds lessons per course) | On a fresh 1.5 blog lab the seed applies cleanly and the plugin can list published `lms_courses` and `lms_lessons` by title with `content:read` |
| 2 | Storage, indexes and the routes: `outline` (public), `enroll`, `completeLesson`, `quiz`, `submitQuiz`, `eraseMember`; compare-and-set on enroll; server-side scoring; correct answers never returned. Tests: guest refused, second enroll, lesson not on the course, not enrolled, quiz type refused, erase removes every row, 20 calls or fewer per entry point (shared `tests/bridge-count.ts`) | `npm test` passes |
| 3 | Admin (owner works only in the EmDash dashboard): MCP tools on the outline and quiz routes per SCOPE Agents ready, Course outline page (pick course, add lessons by title, order, remove, version token), Quizzes page (create, questions one per form, edit, delete with a version token), lesson editor panel that picks a quiz by title, Enrollments and Quiz results lists (names via `users:read`, 25 rows, Find, Next/Previous), dashboard card, erase for one member. Every response through EmDash's Block Kit validator | An owner builds an outline and a quiz and attaches both by title; lists show names |
| 4 | Site kit, designed per SCOPE Presentation: `learnomy.css` on `--learnomy-*` tokens inheriting theme properties, layout, strings, catalog, course, lesson (Open and Members), Your courses, enroll, complete, quiz, erase; Course structured data; `data-learnomy-*`; shared `wbcom-kit.ts` | Looks right on three or more EmDash templates (screenshots read); a guest reads an Open course; a guest sees a Members lesson's title and sign-in prompt only; an invited member enrolls, finishes, scores, erases |
| 5 | Daily task with version marker; install and activate that never throw; docs (install, Let members join, admin, routes, Make it yours, agents guide, registry texts, what's new); QA checklist | Docs lint clean; gate Gate A passes |
| 6 | Release: independent walk on a standard 1.5 Node lab and the Cloudflare testbed (registry install), review, gate, owner says publish | Walk and review findings fixed; owner's yes |

## How each step is checked (three layers, no self-grading)

1. **Builder (Opus)**: tests that fail on the old code, call budget, bundle size, own browser look. Pushes and comments evidence on the issue.
2. **Me, before the next step starts**: re-run `npm test` and the bundle build myself, read the diff against SCOPE, open the builder's screenshots, and re-run any claim that the next step depends on. A failed claim goes back to the builder, nothing is built on top of it.
3. **Independent (Sonnet walk, then one Opus diff review) at step 6 only**, against `docs/qa/QA_CHECKLIST.md`, on sites the builder did not set up.

## Things to prove early (each "documented, not tried" by us)

| What | Proved in | If it fails |
| --- | --- | --- |
| Plugin MCP tools register, ask consent, and work once the admin turns them on | step 3, on the lab, with a scoped token | Ship without tools, say so in the docs and on the issue; owner decides |
| Bundle stays under 100 KB with the tool input schemas | step 2 (measured), step 3 | Owner decides between fewer tools or a larger bundle (cap 128 KB) |
| Enrollment and results lists show names within 20 calls (one batched `users:read` per page) | step 3 | Fewer rows per page |
| The kit looks finished on all four `create-emdash` templates (blog, starter, marketing, portfolio); starter has no theme CSS, so it tests the fallbacks | step 4 | Fix the kit; never a per-template branch |

## Release (step 6) checklist

- [ ] All earlier issues closed with evidence; `git diff main..0.1.0` read against SCOPE once more
- [ ] Standard 1.5 Node lab from `create-emdash` (blog), registry-style install, kit copied from the branch by the install guide word for word; plus marketing, portfolio and starter labs for presentation
- [ ] Fieldnote model data loaded into a 1.5 lab (`model-site/load-into-lab.sh`) with Learnomy demo courses (the showcase itself is on 1.2 and is not touched)
- [ ] Sonnet walk of every QA case (owner, guest, invited member, presentation, agents), every screenshot read
- [ ] Opus review of the diff; findings fixed with their blast radius and proven by tests
- [ ] `gate.sh` green, release-gate checklist ticked with evidence in the release PR
- [ ] Automatic security review of the final commit clear
- [ ] PR merged to main (`--admin`), tag `v0.1.0`, `npx emdash-plugin publish`, GitHub release in the release-notes style
- [ ] **After publish:** install 0.1.0 from the registry on the Cloudflare testbed and a fresh Node lab, starred QA cases again, no call-limit or time-limit errors; the registry page text and images checked
- [ ] Skill plugin table, repo `ops/handoff.md` and the EmDash support table updated

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
