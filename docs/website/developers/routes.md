# Routes

**Included in Free.**

The site kit talks to the plugin through these routes. You only need this page to build your own pages or scripts.

## The address

A route answers at `/_emdash/api/plugins/<plugin id>/<route>`. The plugin id is not always `learnomy`: a registry install gets its own id. Use `pluginFetch()` from `src/lib/wbcom-kit.ts` (as `src/lib/learnomy.ts` does), which finds the id for you. Never write the address yourself.

GET routes take their input as query parameters. POST routes take a JSON body. Every answer has `ok: true`, or `ok: false` with `error.code` and a plain `error.message` you can show.

## Public routes (guests too)

| Route | Method | Input | Answers |
| --- | --- | --- | --- |
| `outline` | GET | `course`: course entry id | The course's published lessons in order (`id`, `title`, `slug`). Empty for a course that is not published |
| `catalog` | GET | `courses`: up to 24 course ids, comma separated | `counts`: published lessons per course, 0 for a course that is not published |
| `lessonCourses` | GET | `lesson`: lesson entry id | The published courses the lesson is in, Open courses first |
| `quiz` | GET | `lesson`: lesson entry id | The lesson's quiz for a published lesson in a published Open course: questions (`choice` and `multi` with their four answers, `true_false`, `short`, `blank` with `___` in the prompt), `mode`, `passMark` (graded quizzes with one) and `retake`. Never correct or accepted answers or explanations. Any other lesson answers `SIGN_IN_REQUIRED` (use `memberQuiz` when signed in) |
| `certificate` | GET | `token`: the 32-character code from a certificate link | `certificate`: `member` (the name, empty when the account has none), `course`, `completedAt` and `site`. Never an email or id. An unknown, malformed or switched-off code answers `CERTIFICATE_NOT_FOUND`, the same each time |
| `health` | GET | none | The plugin id and version |

## Member routes (signed in)

The member is always the signed-in account. A member id in the input is never used.

| Route | Method | Input | Answers |
| --- | --- | --- | --- |
| `progress` | GET | `course` | The member's enrollment in that course, or null, and `quizzes`: for each lesson whose graded quiz has a pass mark, `passMark`, `best` and `passed` |
| `myCourses` | GET | none | The member's courses, most recent first (up to 50): `done`, `total` and `finished` counted on the course's published lessons (the count the course page shows), and `available: false` for a course that was deleted or unpublished, and `quizzesPassed` |
| `memberQuiz` | GET | `lesson` | The quiz of any published lesson, as `quiz` answers it, plus `mine`: `attempts`, `best` (percent), `passed` (null without a pass mark), `attemptsLeft` (null when unlimited) and `retryAt` (null when they may try now) |
| `enroll` | POST | `course` | The new enrollment. `ALREADY_ENROLLED` the second time |
| `completeLesson` | POST | `course`, `lesson` | The updated enrollment. `completedAt` is set the first time every published lesson of the outline is done (a draft, scheduled or deleted lesson does not hold the course open). `NOT_ENROLLED`, `LESSON_NOT_IN_COURSE`, `QUIZ_NOT_PASSED` (the lesson's graded quiz has a pass mark the member's best score has not reached) |
| `submitQuiz` | POST | `quiz`, `answers`: one per question: a number 0 to 3 (`choice`, `true_false`), a list of numbers (`multi`) or text (`short`, `blank`) | `score`, `total`, `percent`, which questions were right, `mode` and the member's standing as in `mine`. Only a practice quiz adds `review`: each question's right answer and explanation. Refused with `NO_ATTEMPTS_LEFT`, or `RETRY_LATER` with `retryAt` |
| `myCertificates` | GET | none | The member's finished courses, newest completion first (up to 50): `course`, `completedAt`, `on`, and `token` when the link is on. Courses finished before 0.3.0 get their certificate here |
| `setCertificate` | POST | `course`, `on`: true or false | Turns the member's certificate link off, or on again with a new `token` (the old link stops working). Turning on a link that is already on keeps it. `NOT_FINISHED` for a course the member has not finished |
| `eraseMember` | POST | none | Deletes the member's enrollments (and with them their certificates) and quiz results with every past attempt. For every quiz the member took that still exists it keeps only the attempts used and the last attempt time, so a limit set now or later still applies; records of deleted quizzes are removed (the admin erase removes all of them). `done: false` means call it again |

A guest calling a member route gets `SIGN_IN_REQUIRED`.

## How far the published checks reach

Public routes show only published courses and lessons. Each call reads the first 100 published entries, then looks up any it still needs one by one when they fit in the plugin's call budget, so a draft lesson in an outline costs one extra read. When more are missing than that (an outline with many lessons on a site with thousands of published lessons), it reads up to 1,500 published lessons (300 courses for the catalog, 1,000 for a lesson's courses); a lesson beyond that is treated as not published and hidden, never shown by mistake.

## Admin routes

`admin` draws the admin pages. `panel` draws the lesson editor panel. The `tools/*` routes back the MCP tools in [Build a course with agents](agents.md) and need the site admin.

## Course structured data

On a course page whose layout passes the entry to the page head (every EmDash template does, and `LearnomyLayout.astro` passes it), the plugin adds schema.org `Course` data with the published lessons in `hasPart`.
