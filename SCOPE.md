# Learnomy for EmDash: scope

**Status: LOCKED on 2026-11-15; amended the same day by the owner (Course outline page, issue #1; quiz picks its lesson, issue #3; presentation, agents and dashboard sections).** Decided with the owner on 2026-11-14 and 2026-11-15 after an audit of the 2026-10-15 draft against the EmDash 1.5 docs and source, and three proving spikes on a fresh EmDash 1.5.0 lab. An agent does not add options, change decisions, or move items in or out. If an item cannot be built as written, stop, say why on its issue, and wait for the owner.

Every recommendation below is tagged **P** (proven in one of our plugins or a spike), **D** (EmDash docs or source say it works, not yet built by us) or **step 1** (proved in plan step 1 before anything depends on it).

## Purpose

A basic, free LMS for any EmDash site: courses and lessons written in EmDash's own editor, free enrollment, progress, and a short quiz per lesson. No payments of any kind. It grows later toward the free WordPress Learnomy features that EmDash can actually finish.

**Who it is for:** a teacher, a company or a publisher who wants courses on their site without a shop.

**WordPress source:** Learnomy free (feature list and wording only; no PHP is copied).

## Decisions

| Question | Decision |
| --- | --- |
| EmDash floor | `release.requires: {"env:emdash": ">=1.5.0"}`. No installed base, and 1.5 gives each plugin call 30 requests on Cloudflare. Our cap is 20 calls per entry point, leaving headroom (P: limits checked in the 1.2-1.5 packages) |
| Payments | None. No price field, plan, coupon, checkout, instructor revenue or `network:request` capability (owner, 2026-11-14) |
| Course access | Each course is **Open** (anyone, guests included) or **Members** (signed-in only) (owner, 2026-11-15) |
| What Members protects | It keeps out guests, not other members: EmDash's content API lets any signed-in member read every published lesson (spike 2, P). The docs say so plainly. Enrolled-only lesson text is out (it would need lessons outside EmDash's editor) |
| How Members lessons stay out of guests' hands | The kit lesson page server-renders the title only for a Members course and loads the body in the browser from EmDash's content API; a guest gets a sign-in prompt (spike 2, P: nothing leaked in page HTML, cached pages, search, sitemap, RSS or meta) |
| How visitors become members | By the owner's invite (EmDash Users > Invite user, role Subscriber). Allowed-domain self-signup is broken in EmDash 1.5 (reported upstream as emdash-cms/emdash#4863); site code cannot safely work around it (spike, P). The docs say members join by invite until EmDash fixes #4863, then the guide adds self-signup |
| Lessons by course | A **Course outline** admin page: the owner picks a course, adds its lessons by title and sets their order. The outline is one plugin storage row per course. Lessons carry no course field (owner, 2026-11-15). Why: a reference field cannot be indexed or filtered (spike 1, P), and a sandboxed plugin cannot copy the picked course into a searchable field: `content:beforeSave` needs `content:write` and never sees reference values, and `ctx.content` returns no references (step 1 finding, issue #1). A lesson may sit in more than one course |
| Collection names | Prefixed: `lms_courses`, `lms_lessons`, taxonomy `lms_course_category`, so a site's own `courses` collection is never merged into ours (D) |
| Quizzes | One quiz per lesson, multiple choice (four answers) and true/false, at most 20 questions. Written on a Quizzes admin page, one question per form, where each quiz picks its lesson by title; one quiz per lesson is enforced there. The lesson editor panel shows the lesson's quiz and links to it (owner, 2026-11-15: a sandboxed panel cannot save a field on the entry without `admin.editor-draft:patch`; P pattern: WB Polls) |
| Scoring | On the server. The quiz route never sends the correct answers. One attempt per member and quiz, replaced on resubmit |
| Certificates | Later (0.3.0), as a printable kit page. A PDF library does not fit the 128 KB bundle cap |
| Settings page | None in 0.1.0 (no real switch exists yet). EmDash's generated settings form is not used |
| Background task | One small daily task with a version marker in `ctx.kv`, so later releases can schedule reminders and notices: no hook runs on a plugin update (P: Listora 0.7.1) |
| Reviews, discussion, polls, search | Reviews through WB Reviews on `lms_courses`; discussion through EmDash core comments; polls through WB Polls; search is EmDash core (course titles and excerpts; lesson bodies are not searchable) |
| Registry install | The whole product |
| Tracking | GitHub issues on `wbcomdesigns/emdash-learnomy`, milestone `0.1.0` |

## Presentation (owner, 2026-11-15: "presentation is key")

The kit is the product people see, so it is designed, not just wired.

- **Any EmDash theme.** The kit works on every template `create-emdash` ships, and on the Fieldnote model site. It inherits the site's font, text colour, link colour, radius and spacing from the theme's own CSS custom properties, with safe fallbacks. It never ships a font, a reset or global selectors. All kit styles live under `.learnomy` in one file, `learnomy.css`, built on `--learnomy-*` tokens.
- **Owners can improve it.** They restyle by overriding `--learnomy-*` tokens (documented, with a table), change any wording in `learnomy-strings.ts`, and change markup in the copied `.astro` files. Every element carries a `data-learnomy-*` hook for site CSS and scripts. A "Make it yours" guide shows all three, with before and after screenshots.
- **Screens:**
  - **Catalog:** a responsive card grid with cover image (aspect-ratio box, no layout shift), category, title, excerpt, lesson count, an Open or Members badge, and the member's progress when signed in. Filter by category.
  - **Course:** a header with cover, title, excerpt, lesson count and the primary action (Enroll, Continue, or Review when finished), a progress bar for members, the body, then the ordered lesson list with done, current and to-do states.
  - **Lesson:** the reading column at a comfortable measure (about 65-75 characters), the course outline beside it on wide screens and collapsible above it under 768px, Mark complete, previous and next lesson, and "lesson 3 of 8".
  - **Quiz:** one fieldset per question with large radio targets, a clear submit, then the score with each question marked right or wrong (shown after scoring, never before).
  - **Your courses:** compact rows with progress and Continue.
- **Quality bar:** every screen at 1440, 768 and 390, light and dark (theme or system), keyboard and screen reader (landmarks, `aria-current` on the current lesson, a live region for progress and score), tap targets at least 40px, and contrast AA on every template. Judged by Reading screenshots on at least three templates.

## Agents ready (owner, 2026-11-15)

- **Courses and lessons** are ordinary EmDash entries, so EmDash's own MCP server and API already let an agent create, edit, publish and schedule them (`content_create` and the rest on `lms_courses` and `lms_lessons`). The docs show how.
- **Outlines and quizzes** live in plugin storage, so Learnomy declares MCP tools on its private admin routes (EmDash 1.5 plugin MCP tools: `creating-plugins/references/api-routes.md`, "Expose a route as an MCP tool"): `getOutline`, `setOutline`, `listQuizzes`, `getQuiz`, `saveQuiz`, `deleteQuiz` (destructive), `listEnrollments`, `listResults`. Each has an input schema, an explicit route permission, and `destructive: true` where it deletes or overwrites. The admin turns plugin MCP tools on after installing; the docs say how, and which token scope (`mcp:tools:<pluginId>`) to give.
- **Machine-readable pages:** schema.org `Course` on course pages, with `hasPart` lessons; clean headings; no lesson body in Members page HTML.
- **An agent guide** (`docs/agents.md`): how to build a whole course with agents end to end, in one flow.
- If the input schemas push a bundle file past 100 KB, say so on the issue with the measured size before trimming anything.

## Owners work in the EmDash dashboard

Everything an owner does happens in the EmDash admin, with no code. Courses and lessons are written in EmDash's editor under their own menu entries (seed labels "Courses", "Lessons", "Course categories"). The Course outline and Quizzes pages and the dashboard card live in Learnomy's admin section. The dashboard card has "New course" and "Course outline" links. The lesson editor panel shows which courses the lesson is in, with a link to each outline, and shows the lesson's quiz with a link to it.

## Records

| Record | Where | 0.1.0 holds | Later adds |
| --- | --- | --- | --- |
| Course | EmDash entry in `lms_courses` | Title, excerpt, body, `access` (open or members), category, cover image | Announcements (0.4.0) |
| Lesson | EmDash entry in `lms_lessons` | Title, excerpt (used for SEO; never the body), body | Publish date per lesson through EmDash scheduling |
| Outline | Plugin storage `outlines`, id = course entry id | courseKey, course title, ordered lessons (`{id, title}`, at most 200), updatedAt, version token | Sections (0.2.0 or later) |
| Enrollment | Plugin storage `enrollments`, id `${memberId}:${courseKey}` | memberId, courseKey, course title, startedAt, updatedAt, completedAt, completed lesson ids (at most 500) | `source` for grants and imports |
| Quiz | Plugin storage `quizzes` | Title, lesson key, questions embedded (type `choice` or `true_false`, prompt, answers, correct index), updatedAt, version token | 0.2.0: mode, pass mark, retake policy, question types `multi`, `short`, `blank`, explanations (see "0.2.0"). Bank later |
| Attempt | Plugin storage `attempts`, id `${memberId}:${quizId}` | memberId, quizId, lessonKey, score, total, answers, submittedAt | 0.2.0: attempts, best, history (see "0.2.0") |

One row per member and course means progress is one get and one put, never a 100-row query (D). Indexes: `enrollments` `["startedAt"]`, `["courseKey","startedAt"]`, `["memberId","updatedAt"]`; `attempts` `["submittedAt"]`, `["quizId","submittedAt"]`, `["memberId","submittedAt"]`; `quizzes` `["updatedAt"]`, `["lessonKey"]`; `outlines` `["updatedAt"]`. Counts use `count()`.

## One path for each action

- `enroll` (member route): creates the enrollment row with compare-and-set; a second enroll answers "already enrolled". Open and Members courses both need a signed-in member to enroll.
- `outline` (public route): returns a course's ordered lessons (ids and titles) from one storage get. The kit hides lessons that are not published.
- `completeLesson` (member route): the only writer of progress. Refuses a member who is not enrolled or a lesson not in that course's outline. Sets `completedAt` the first time every published lesson in the outline is done, so a draft, scheduled or deleted lesson never holds a course open (review M2, 2026-11-15). Every screen counts progress the same way, on the outline's published lessons. The outline page marks lessons that are not published, so the owner can remove them.
- `quiz` (public route): finds a lesson's quiz by `lessonKey` and returns the questions without the correct answers. Answers only for a published lesson in a published Open course; a guest asking for any other lesson's quiz is asked to sign in, the same protection as the lesson text (walk issue #9, 2026-11-15). `memberQuiz` (member route) answers signed-in members for any published lesson.
- `outline` and `quiz` never reveal drafts: `outline` answers only for a published course and returns only published lessons (security review, 2026-11-15). `submitQuiz` (member route): scores on the server, replaces the member's attempt.
- `eraseMember` (member route, and the admin's erase): deletes the member's enrollments and attempts in batches of 100.
- Member routes never write or publish EmDash content.

## In scope for 0.1.0

1. Seed for `lms_courses`, `lms_lessons` and `lms_course_category`, with `access`.
2. Storage, indexes and the routes above, with tests and the call budget.
3. Admin: a Course outline page (pick a course by title, add lessons by title, move up and down, remove, save with a version token, lessons that are not published marked), a Quizzes page (list, create, edit questions one per form, delete with a version token), a lesson editor panel that picks a quiz by title, an Enrollments list and a Quiz results list (15 rows, Find, Next/Previous, member names through `users:read`; 15 because `users:read` has no batch lookup, so each page looks up each name once and stays under the 20-call cap), a dashboard card with the counts, and an erase action for one member.
4. Site kit (prefixed files): `LearnomyLayout.astro`, `learnomy-strings.ts`, catalog, course, lesson (Open: full text; Members: title for guests, body loaded in the browser for members), a "Your courses" component (`LearnomyMyCourses.astro`) that the site's shared account page mounts (starter rule: each plugin ships a My component and no account page of its own), enroll, mark complete, quiz, erase, `data-learnomy-*` hooks, the shared `wbcom-kit.ts` (current starter version) for every plugin request.
5. Course structured data (schema.org `Course`) through `page:metadata`.
6. A "Let members join" guide (invite steps, pick Subscriber, recovery needs an email provider), the install guide, the admin guide, the routes guide, and the registry texts saying plainly what Members means and how members join.
7. The daily task with its version marker; install and activate that never throw and set only missing values.

## Out of scope for 0.1.0

Payments of any kind, a price field, enrolled-only lesson text, certificates, practice mode, passing scores, a question bank, essays, mail, a Settings page, self-signup of our own, a native block, anything in the WordPress Pro list.

## Screens and states

Each screen has loading, empty and failed states, at 1440, 768 and 390, light and dark, keyboard reachable.

| Screen | Empty | Failed |
| --- | --- | --- |
| Catalog | No courses yet, with a line for the owner | Could not load the courses |
| Course | No lessons yet | Could not load the lessons |
| Course outline (admin) | No lessons in this course yet, with Add lesson | A refused save says what was wrong |
| Lesson (Members, guest) | Title and a sign-in prompt with how to join | Could not load the lesson; title stays |
| Lesson quiz | No quiz on this lesson | The score could not be saved; answers stay |
| Your courses | You have not enrolled yet | Could not load; erase asks once, then confirms |
| Quizzes (admin) | No quizzes yet, with Create quiz | A refused save says what was wrong |
| Enrollments, Quiz results | None yet | Could not load |

## 0.2.0: richer quizzes (owner, 2026-11-15)

Decided by the owner on 2026-11-15 in issues #28 to #31. No new storage collection, no new permission, no new option beyond the per-quiz fields below.

| Question | Decision |
| --- | --- |
| Passing score (#28) | The owner sets a pass mark per quiz, in percent. A lesson with a graded quiz that has a pass mark counts as complete only when the member passes; a course finishes only when all its lessons are complete, so all its quizzes are passed. Shown on the course, the lesson and Your courses. `completeLesson` stays the only writer of progress and checks the member's best attempt on the server. A lesson already complete stays complete when a pass mark is added later. Scores round down to a whole percent |
| More question types (#29) | Multiple answers (pick all that apply, four answers, every right one ticked; right only when the member picks exactly those), short answer and fill in the blank (the prompt marks the blank with `___`), graded on the server against the owner's accepted answers (up to 10), ignoring case and extra spacing. The public and member quiz routes never return correct or accepted answers or explanations. One question per form on the Quizzes page, each kind with its own fields; the 20-question cap stays. Essays stay out (manual grading) |
| Retakes and limits (#30) | Per quiz: unlimited, a maximum number of attempts (1 to 100), or a wait before retrying (1 minute to 30 days). Computed and enforced on the server; a refused submit says that no attempts are left, or when the member may retry. Members see attempts left and when they can retry. Each attempt is kept inside the member's existing attempt row (history capped at the latest 20, the count uncapped), so no new storage collection; the best score counts for the pass mark. Quiz results shows attempts and best score. Erase removes all of it |
| Practice mode (#31) | A quiz is Graded (default) or Practice. After submitting a Practice quiz the member sees the right answer to each question and the optional explanation the owner writes per question. A Practice quiz never blocks progress and needs no pass. Right answers and explanations are only ever returned in the submit response of a Practice quiz |
| Erase and retake limits (security review) | Owner, 2026-11-15: a member's own erase ("Erase my course data") keeps one small record per quiz that has a maximum number of attempts or a wait, holding only the attempts used and the time of the last attempt (no answers, no scores, no progress), so erasing never resets a retake limit. Everything else is erased as before. The admin erase from the dashboard removes everything, that record included, so the owner can reset a member or honour a full deletion request. The record is one `ctx.kv` entry per member (`state:retake:<member>`), no new collection; the retake check, the quiz and attempts left read it |
| Upgrade from 0.1.x | No migration step. A stored 0.1.x quiz reads as graded, no pass mark, unlimited retakes; a stored 0.1.x attempt reads as one attempt whose score is its first history entry and its best, and gains the new fields on its next write |

New fields:

- Quiz: `mode` (`graded` or `practice`, default `graded`), `passMark` (optional whole percent 1 to 100; ignored and cleared for a practice quiz), `retake` (`{type: "unlimited"}`, `{type: "max", attempts}` or `{type: "wait", minutes}`, default unlimited). Question types `multi` (`answers` x4, `correct` list of indexes), `short` and `blank` (`accepted` list); every question may carry `explain` (up to 1,000 characters).
- Attempt: `attempts` (count), `best` (best whole percent), `history` (latest 20 of `{score, total, submittedAt}`). `score`, `total`, `answers` and `submittedAt` stay the latest submission; `answers` now holds an index, a list of indexes or text per question.

Routes: `submitQuiz` (5 calls: it also reads the kept retake record) takes one answer per question (an index, a list of indexes or text), uses compare-and-set on the attempt row so two tabs cannot pass the limit, and answers `percent`, `passed`, `attempts`, `best`, `attemptsLeft`, `retryAt` (and `review` for Practice only). `memberQuiz` adds the member's standing (`mine`, 4 calls). `eraseMember` keeps the retake record described above; the admin erase deletes it. `progress` adds the pass state of each lesson quiz that has a pass mark; `myCourses` adds `quizzesPassed` (counted among the member's latest 100 attempts). Every entry point stays at 20 calls or fewer (`completeLesson` scans 13 lesson pages instead of 15 to pay for the quiz check).

Out of scope for 0.2.0: essays, a question bank, timed quizzes, certificates.

## Done means

Every item works from the registry install on a standard EmDash 1.5 blog site on Node and on the Cloudflare testbed, as guest, invited member and admin; every entry point at 20 calls or fewer; the bundle under 100 KB; the release gate (`references/release-gate.md`) passes with its evidence; an independent walk reads every screenshot.
