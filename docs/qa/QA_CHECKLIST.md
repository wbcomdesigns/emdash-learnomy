# Learnomy QA checklist (0.1.0)

Run on a standard EmDash 1.5 blog site (`npm create emdash@latest -- --template blog --platform node`), plugin installed from the registry, kit copied from the release tag by following `docs/install/` word for word. Repeat the starred cases on the Cloudflare testbed. Every screen at 1440, 768 and 390, light and dark, keyboard only once. Read every screenshot.

## Site owner (admin)

- [ ] O1 Install from the registry: the capabilities screen lists only `content:read`, `users:read`, storage and kv. Install and activate cause no error and no disabled plugin.*
- [ ] O2 Seed creates `lms_courses`, `lms_lessons` and `lms_course_category`; a site with its own `courses` collection is untouched.
- [ ] O3 Create a course: title, excerpt, body, access Open or Members, category, cover image. Publish.
- [ ] O4 Create three lessons. On Course outline pick the course by title, add the lessons by title, reorder them, save. The site shows them in that order. No id is typed or shown anywhere.*
- [ ] O5 Unpublish a lesson in the outline: the outline marks it, the site hides it; a second tab saving the same outline is refused (version token).
- [ ] O6 Quizzes page empty state shows Create quiz. Create a quiz with one choice question (four answers) and one true/false question; edit a question; a 21st question is refused with a clear message.
- [ ] O7 Two tabs edit the same quiz: the second save is refused (version token) and says why.
- [ ] O8 Lesson editor panel lists quizzes by title; pick one; the lesson saves `quiz_id`; never shows an id.
- [ ] O9 Delete a quiz attached to a lesson: the lesson shows "No quiz on this lesson" on the site, no error.
- [ ] O10 Enrollments list: member names (not ids), 25 rows, Find by name, Next/Previous, empty state.
- [ ] O11 Quiz results list: names, score, date, same paging, empty state.
- [ ] O12 Dashboard card shows courses, enrollments and attempts counts.
- [ ] O13 Erase one member: confirm once, all their enrollments and attempts gone, lists update.
- [ ] O14 Invite a member (Users > Invite user, role Subscriber) following the "Let members join" guide; the member signs in.

## Guest (signed out)

- [ ] G1 Catalog lists published courses with title, excerpt, cover, category; empty state with an owner line when none.*
- [ ] G2 Open course: lessons in order; an Open lesson shows its full text.*
- [ ] G3 Members course lesson: page HTML carries the title only; a sign-in prompt says how to join. Body absent from page source, cached page, search, sitemap, RSS and meta tags.*
- [ ] G4 Enroll button on any course asks the guest to sign in; no error.
- [ ] G5 Quiz route for a lesson returns questions without correct answers (check the network response).*
- [ ] G6 Course page carries valid schema.org `Course` structured data.

## Member (invited, signed in)

- [ ] M1 Enroll in an Open course and a Members course; a second enroll says "already enrolled".*
- [ ] M2 Members lesson body loads in the browser; loading and failed states shown.
- [ ] M3 Mark lessons complete in any order; progress shows on the course and in Your courses; finishing the last lesson marks the course complete.*
- [ ] M4 Completing a lesson of another course, or without enrolling, is refused with a clear message.
- [ ] M5 Take the quiz: score shows; answers stay if the save fails; resubmit replaces the old score.*
- [ ] M6 Your courses (mounted on the site's account page): empty state, list with progress, failed state.
- [ ] M7 Erase my data: asks once, then confirms; Your courses is empty afterwards.

## Budget and build

- [ ] B1 `npm test` passes, including the call-budget test: every entry point 20 calls or fewer.
- [ ] B2 Bundle under 100 KB per file.
- [ ] B3 `gate.sh` passes.
- [ ] B4 Cloudflare testbed: the starred cases with no call-limit or time-limit errors in the logs.
