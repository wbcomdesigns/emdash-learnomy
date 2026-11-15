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
| `quiz` | GET | `lesson`: lesson entry id | The lesson's quiz without the correct answers. Only for a published lesson |
| `health` | GET | none | The plugin id and version |

## Member routes (signed in)

The member is always the signed-in account. A member id in the input is never used.

| Route | Method | Input | Answers |
| --- | --- | --- | --- |
| `progress` | GET | `course` | The member's enrollment in that course, or null |
| `myCourses` | GET | none | The member's courses with progress, most recent first (up to 50) |
| `enroll` | POST | `course` | The new enrollment. `ALREADY_ENROLLED` the second time |
| `completeLesson` | POST | `course`, `lesson` | The updated enrollment, with `completedAt` once every lesson is done. `NOT_ENROLLED`, `LESSON_NOT_IN_COURSE` |
| `submitQuiz` | POST | `quiz`, `answers`: one number per question (0 to 3) | `score`, `total` and which questions were right. Never the correct answers. Replaces the member's earlier try |
| `eraseMember` | POST | none | Deletes the member's enrollments and quiz results. `done: false` means call it again |

A guest calling a member route gets `SIGN_IN_REQUIRED`.

## Admin routes

`admin` draws the admin pages. `panel` draws the lesson editor panel. The `tools/*` routes back the MCP tools in [Build a course with agents](agents.md) and need the site admin.

## Course structured data

On a course page whose layout passes the entry to the page head (every EmDash template does, and `LearnomyLayout.astro` passes it), the plugin adds schema.org `Course` data with the published lessons in `hasPart`.
