# Changelog

Versions match `package.json`, the git tag and the registry release. Newest first.

## [0.1.0]

The first release of Learnomy for EmDash: free courses, lessons, progress and a quiz per lesson. Needs EmDash 1.5.0 or later.

New permissions: Read your content, to list courses and lessons by title and show only published ones; Read user accounts, to show member names in the admin lists.

- New      - Courses, Lessons and Course categories content types, written in EmDash's own editor, each course Open or Members.
- New      - A Course outline page to add a course's lessons by title, set their order and see which are not published.
- New      - A Quizzes page to write one quiz per lesson, multiple choice or true or false, up to 20 questions.
- New      - The lesson editor panel shows the lesson's courses and quiz, with a link to each.
- New      - Free enrollment, Mark complete and progress for signed-in members, with a finished state when every lesson is done.
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
