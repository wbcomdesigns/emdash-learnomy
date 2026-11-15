# Troubleshooting and known limits

**Included in Free.**

## Something does not show

**`/courses/` shows my 404 page.** The site kit is not copied yet, or the dev server was not restarted. See [Install Learnomy](../getting-started/install.md).

**A course is missing from the catalog.** Only published courses show. Publish it under Courses.

**A lesson is missing from its course.** Only published lessons show. On the Course outline page a lesson that is not published is marked Draft. Publish it under Lessons. Also check that the lesson is in that course's outline at all.

**A course shows "No lessons yet".** Its outline is empty. Add lessons on the Course outline page.

**A lesson has no quiz.** The quiz is not on that lesson. On the Quizzes page, open the quiz and press Choose lesson.

**Members cannot enroll.** They need to be signed in. Invite them: see [Let members join](../getting-started/let-members-join.md).

**An invited member got no email.** Your site needs an email provider. Check Settings, Email.

**Course pages do not match my theme.** If your site's layout is not `src/layouts/Base.astro`, change the import in `src/layouts/LearnomyLayout.astro`.

**Agents cannot see Learnomy's tools.** Turn on Agent access on the Learnomy plugin card, and give the token the Learnomy MCP tools scope. Turn it on again after an update. See [Build a course with agents](../developers/agents.md).

## Known limits

- **1,500 published lessons.** Course pages look through the first 1,500 published lessons of your site to find a course's lessons. On a site with more, a lesson further back is hidden from its course page, never shown by mistake.
- **200 lessons per course.** A course outline holds up to 200 lessons.
- **20 questions per quiz.** One quiz per lesson, multiple choice with four answers or true or false.
- **Lessons can sit in several courses.** That is allowed. A lesson opened without a course (from search, for example) takes the access of the first course it finds, Open courses first.
- **Members is not enrolled-only.** Any signed-in member can read every published lesson.
- **Lists show 15 rows a page.** Enrollments and Quiz results page through 15 at a time.
- **Your courses shows the 50 most recent courses** of a member.
- **Self-signup** waits for EmDash's fix. Invite members for now.
