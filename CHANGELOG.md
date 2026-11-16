# Changelog

Versions match `package.json`, the git tag and the registry release. Newest first.

## [0.3.0]

Course certificates with a shareable link. No new permissions and no new storage collection. Copy the site kit again after updating (new `pages/certificates/[token].astro`; Your courses, `learnomy.ts`, `learnomy-strings.ts`, `learnomy.css`).

- New      - A certificate for every finished course: member name, course, completion date and the site's name, printable and savable as PDF from the browser.
- New      - Each certificate has a long random link anyone can open to check it; an unknown or switched-off link answers not found the same way, and the page is never cached or indexed.
- New      - Your courses: view a certificate, copy its link, turn the link off, or turn it on again with a new link.
- New      - Certificates admin page: per course, who finished, the date, whether the link is on, and Turn link off.
- New      - MCP tools listCertificates and turnOffCertificate (destructive).
- Improve  - Courses finished before 0.3.0 get their certificate on the first view of Your courses or the Certificates page, with no migration step.
- Improve  - A member's own erase and the admin erase remove the member's certificates.
- Dev      - The certificate lives on the enrollment row (certToken) with a storage index for the lookup; finishing a course issues it in the same write.

## [0.2.2]

Fixes from the 0.2.1 QA pass. No new permissions and no new storage. The site kit did not change.

- Fix      - The dashboard card and the admin pages show the next step, copy the site kit, instead of a plugin error before the Courses and Lessons content types exist.
- Fix      - Enrollments counts progress on published lessons only, the same number the member sees; a draft lesson in the outline no longer holds a course open.
- Fix      - A pass mark, number of attempts or wait out of range is refused with a message saying what is allowed, on the Quizzes page and in the saveQuiz agent tool.
- Improve  - Enrollments and Quiz results show 10 rows a page, so Enrollments can check which lessons are published within its call budget.
- Improve  - The saveQuiz agent tool takes a pass mark of 0 for none, as the Quizzes page does.
- Dev      - README, introduction and known limits describe the 0.2 quiz types, pass marks, retakes and practice; Let members join walks through email setup, the Subscriber role and finding the invite link on a local site.

## [0.2.1]

Retake counts through a member's own erase. No new permissions and no new storage. Copy the site kit again after updating (`learnomy-strings.ts`).

- Fix      - A member's own erase keeps attempts used for every quiz they took, so a quiz limited later still counts attempts made before the erase.
- Fix      - A member's own erase removes the kept attempt counts of quizzes that were deleted.

## [0.2.0]

Richer quizzes. No new permissions and no new storage. Copy the site kit again after updating (course and lesson pages, Your courses, `learnomy-strings.ts`, `learnomy.css`).

- New      - Pass mark per quiz: a graded quiz with a pass mark must be passed, on the member's best score, before its lesson can be marked complete.
- New      - Multiple answers, short answer and fill in the blank questions, graded on the server against accepted answers, ignoring case and extra spacing.
- New      - Retakes per quiz: unlimited, a maximum number of attempts, or a wait between attempts, enforced on the server.
- New      - Practice mode: never blocks progress and shows each right answer and the owner's explanation after submitting.
- Improve  - The course page, lesson page and Your courses show passed quizzes, attempts left and when a member can retry.
- Improve  - Quiz results shows each member's best score and number of attempts.
- Improve  - A member's own erase keeps only attempts used and the last attempt time on quizzes with a retake limit, so erasing never resets the limit; the admin erase removes everything.
- Dev      - Each attempt row keeps a capped history of 20 attempts, the attempt count and the best percent; 0.1.x rows read as one attempt with no migration step.
- Dev      - The saveQuiz and getQuiz MCP tools take the new question types, mode, pass mark and retake policy.

## [0.1.1]

Fixes from the 0.1.0 review. No new permissions. Copy the site kit again after updating (catalog, course and lesson pages, and `learnomy.ts`).

- Improve  - Find on Enrollments and Quiz results counts the matches only and pages through all of them with Next.
- Fix      - A course with no access value shows as Members on every page, the same as its lessons.
- Fix      - The catalog's Previous link goes to the previous page instead of the first.
- Dev      - Single-column storage indexes for the newest-first admin lists; EmDash adds them when it loads the plugin.
- Dev      - The registry Installation text says to redeploy on Cloudflare after installing or updating.

## [0.1.0]

The first release of Learnomy for EmDash: free courses, lessons, progress and a quiz per lesson. Needs EmDash 1.5.0 or later.

New permissions: Read your content, to list courses and lessons by title and show only published ones; Read user accounts, to show member names in the admin lists.

- New      - Courses, Lessons and Course categories content types, written in EmDash's own editor, each course Open or Members.
- New      - A Course outline page to add a course's lessons by title, set their order and see which are not published.
- New      - A Quizzes page to write one quiz per lesson, multiple choice or true or false, up to 20 questions.
- New      - The lesson editor panel shows the lesson's courses and quiz, with a link to each.
- New      - Free enrollment, Mark complete and progress for signed-in members, with a finished state when every published lesson is done.
- New      - Quizzes are scored on the server and never send the correct answers; each member keeps one result per quiz.
- New      - Enrollments and Quiz results lists with member names, find by name or email, 15 rows a page.
- New      - Erase one member's enrollments and quiz results from the admin, or their own from Your courses.
- New      - A dashboard card with the counts, New course and Course outline.
- New      - Eight MCP tools for outlines, quizzes, enrollments and results, so an agent can build a whole course.
- New      - A site kit with the catalog, course, lesson and quiz pages and the Your courses component, styled from your theme.
- New      - Course pages carry schema.org Course data with their lessons.
- Dev      - A daily task with a version marker, so later releases can add background work without an update hook.
- Dev      - Install and activate never fail the plugin; a scheduling error is logged instead.
- Dev      - Every route, admin action, tool and hook stays at 20 site calls or fewer.
