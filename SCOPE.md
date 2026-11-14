# Learnomy for EmDash: scope

**Status: LOCKED on 2026-11-15.** Decided with the owner on 2026-11-14 and 2026-11-15 after an audit of the 2026-10-15 draft against the EmDash 1.5 docs and source, and three proving spikes on a fresh EmDash 1.5.0 lab (`~/code/emdash-lab-learnomy`, report `~/work-artifacts/scratch/learnomy-spikes-report.md` and `learnomy-signup-spike.md`). An agent does not add options, change decisions, or move items in or out. If an item cannot be built as written, stop, say why on its issue, and wait for the owner.

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
| Lessons by course | Lessons carry an indexed string `course_key` (the course's entry id) and an indexed number `order`; the reference field `course` stays for the editor's picker only. A reference field cannot be indexed or filtered (spike 1, P). `course_key` is filled from the picker automatically; how is proved in plan step 1 |
| Collection names | Prefixed: `lms_courses`, `lms_lessons`, taxonomy `lms_course_category`, so a site's own `courses` collection is never merged into ours (D) |
| Quizzes | One quiz per lesson, multiple choice (four answers) and true/false, at most 20 questions. Written on a Quizzes admin page, one question per form; the lesson editor panel only picks a quiz by its title (P pattern: WB Polls) |
| Scoring | On the server. The quiz route never sends the correct answers. One attempt per member and quiz, replaced on resubmit |
| Certificates | Later (0.3.0), as a printable kit page. A PDF library does not fit the 128 KB bundle cap |
| Settings page | None in 0.1.0 (no real switch exists yet). EmDash's generated settings form is not used |
| Background task | One small daily task with a version marker in `ctx.kv`, so later releases can schedule reminders and notices: no hook runs on a plugin update (P: Listora 0.7.1) |
| Reviews, discussion, polls, search | Reviews through WB Reviews on `lms_courses`; discussion through EmDash core comments; polls through WB Polls; search is EmDash core (course titles and excerpts; lesson bodies are not searchable) |
| Registry install | The whole product |
| Tracking | GitHub issues on `wbcomdesigns/emdash-learnomy`, milestone `0.1.0` |

## Records

| Record | Where | 0.1.0 holds | Later adds |
| --- | --- | --- | --- |
| Course | EmDash entry in `lms_courses` | Title, excerpt, body, `access` (open or members), category, cover image | Announcements (0.4.0) |
| Lesson | EmDash entry in `lms_lessons` | Title, excerpt (used for SEO; never the body), body, `course` reference, `course_key`, `order`, optional `quiz_id` | Publish date per lesson through EmDash scheduling |
| Enrollment | Plugin storage `enrollments`, id `${memberId}:${courseKey}` | memberId, courseKey, course title, startedAt, updatedAt, completedAt, completed lesson ids (at most 500) | `source` for grants and imports |
| Quiz | Plugin storage `quizzes` | Title, lesson key, questions embedded (type `choice` or `true_false`, prompt, answers, correct index), updatedAt, version token | Practice mode, passing score, bank (0.2.0) |
| Attempt | Plugin storage `attempts`, id `${memberId}:${quizId}` | memberId, quizId, lessonKey, score, total, answers, submittedAt | `mode` |

One row per member and course means progress is one get and one put, never a 100-row query (D). Indexes: `enrollments` `["courseKey","startedAt"]`, `["memberId","updatedAt"]`; `attempts` `["quizId","submittedAt"]`, `["memberId","submittedAt"]`; `quizzes` `["updatedAt"]`. Counts use `count()`.

## One path for each action

- `enroll` (member route): creates the enrollment row with compare-and-set; a second enroll answers "already enrolled". Open and Members courses both need a signed-in member to enroll.
- `completeLesson` (member route): the only writer of progress. Refuses a member who is not enrolled or a lesson not on that course. Sets `completedAt` when every published lesson of the course is done.
- `quiz` (public route): returns the questions without the correct answers. `submitQuiz` (member route): scores on the server, replaces the member's attempt.
- `eraseMember` (member route, and the admin's erase): deletes the member's enrollments and attempts in batches of 100.
- Member routes never write or publish EmDash content.

## In scope for 0.1.0

1. Seed for `lms_courses`, `lms_lessons` and `lms_course_category`, with `access`, `course`, `course_key`, `order` and `quiz_id`, and `course_key` filled automatically from the course picker (plan step 1).
2. Storage, indexes and the routes above, with tests and the call budget.
3. Admin: a Quizzes page (list, create, edit questions one per form, delete with a version token), a lesson editor panel that picks a quiz by title, an Enrollments list and a Quiz results list (25 rows, Find, Next/Previous, member names through `users:read`), a dashboard card with the counts, and an erase action for one member.
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
| Lesson (Members, guest) | Title and a sign-in prompt with how to join | Could not load the lesson; title stays |
| Lesson quiz | No quiz on this lesson | The score could not be saved; answers stay |
| Your courses | You have not enrolled yet | Could not load; erase asks once, then confirms |
| Quizzes (admin) | No quizzes yet, with Create quiz | A refused save says what was wrong |
| Enrollments, Quiz results | None yet | Could not load |

## Done means

Every item works from the registry install on a standard EmDash 1.5 blog site on Node and on the Cloudflare testbed, as guest, invited member and admin; every entry point at 20 calls or fewer; the bundle under 100 KB; the release gate (`references/release-gate.md`) passes with its evidence; an independent walk reads every screenshot.
