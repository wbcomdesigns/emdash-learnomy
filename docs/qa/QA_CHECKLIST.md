# Learnomy QA checklist (0.1.0, with 0.2.0 and 0.3.0 cases)

Run on a standard EmDash 1.5 blog site (`npm create emdash@latest -- --template blog --platform node`), plugin installed from the registry, kit copied from the release tag by following `docs/install/` word for word. Repeat the starred cases on the Cloudflare testbed. Every screen at 1440, 768 and 390, light and dark, keyboard only once. Read every screenshot.

## Site owner (admin)

- [ ] O1 Install from the registry: the capabilities screen lists only `content:read`, `users:read`, storage and kv. Install and activate cause no error and no disabled plugin.*
- [ ] O2 Seed creates `lms_courses`, `lms_lessons` and `lms_course_category`; a site with its own `courses` collection is untouched.
- [ ] O3 Create a course: title, excerpt, body, access Open or Members, category, cover image. Publish.
- [ ] O4 Create three lessons. On Course outline pick the course by title, add the lessons by title, reorder them, save. The site shows them in that order. No id is typed or shown anywhere.*
- [ ] O5 Unpublish a lesson in the outline: the outline marks it, the site hides it; a second tab saving the same outline is refused (version token).
- [ ] O6 Quizzes page empty state shows Create quiz. Create a quiz with one choice question (four answers) and one true/false question; edit a question; a 21st question is refused with a clear message.
- [ ] O7 Two tabs edit the same quiz: the second save is refused (version token) and says why.
- [ ] O8 On the Quizzes page pick the quiz's lesson by title; a second quiz on the same lesson is refused; the lesson editor panel shows the quiz with a link; no id anywhere.
- [ ] O9 Delete a quiz attached to a lesson: the lesson shows "No quiz on this lesson" on the site, no error.
- [ ] O10 Enrollments list: member names (not ids), 10 rows (call budget), Find by name, Next/Previous, empty state. Progress matches the member's course page: a draft lesson in the outline is not counted (#39).
- [ ] O11 Quiz results list: names, score, date, same paging, empty state.
- [ ] O12 Dashboard card shows courses, enrollments and attempts counts, with New course and Course outline links. Before the kit's seed (registry install, no kit yet) the card, Course outline and a quiz's Choose lesson show "Next: copy the site kit" with Open the install guide, never "Plugin error" (#38).
- [ ] O15 Lesson editor panel shows the courses the lesson is in, each linking to its outline.
- [ ] O13 Erase one member: confirm once, all their enrollments and attempts gone, lists update.
- [ ] O14 Invite a member following the "Let members join" guide word for word: email provider checked first, role changed from Author to Subscriber; on a local Node site the link is found in the terminal or /_emdash/api/dev/emails; the member signs in (#42).

## Guest (signed out)

- [ ] G1 Catalog lists published courses with title, excerpt, cover, category; empty state with an owner line when none.*
- [ ] G2 Open course: lessons in order; an Open lesson shows its full text.*
- [ ] G3 Members course lesson: page HTML carries the title only; a sign-in prompt says how to join. Body absent from page source, cached page, search, sitemap, RSS and meta tags.*
- [ ] G4 Enroll button on any course asks the guest to sign in; no error.
- [ ] G5 Quiz route for a lesson returns questions without correct answers (check the network response).*
- [ ] G7 Outline and quiz routes return nothing for a draft course or draft lesson; draft lesson titles never appear.
- [ ] G6 Course page carries valid schema.org `Course` structured data.

## Member (invited, signed in)

- [ ] M1 Enroll in an Open course and a Members course; a second enroll says "already enrolled".*
- [ ] M2 Members lesson body loads in the browser; loading and failed states shown.
- [ ] M3 Mark lessons complete in any order; progress shows on the course and in Your courses; finishing the last lesson marks the course complete.*
- [ ] M4 Completing a lesson of another course, or without enrolling, is refused with a clear message.
- [ ] M5 Take the quiz: score shows; answers stay if the save fails; resubmit replaces the old score.*
- [ ] M6 Your courses (mounted on the site's account page): empty state, list with progress, failed state.
- [ ] M7 Erase my data: asks once, then confirms; Your courses is empty afterwards.

## Presentation

- [ ] P1 Catalog, course, lesson, quiz and Your courses look finished on at least three `create-emdash` templates and on Fieldnote: font, colours and spacing come from the theme; no broken layout at 1440, 768, 390; light and dark.
- [ ] P2 Override three `--learnomy-*` tokens and one string per the Make it yours guide: the change shows everywhere, nothing else on the site changes.
- [ ] P3 Keyboard only and screen reader: the whole member path works, the current lesson has `aria-current`, the score and progress are announced.
- [ ] P4 No layout shift from cover images; contrast AA on each template.

## Agents

- [ ] A1 With EmDash's MCP (token with content scopes) an agent creates a course and three lessons and publishes them.
- [ ] A2 After the admin turns on Learnomy's MCP tools, an agent with `mcp:tools:<pluginId>` sets the outline and saves a quiz; the site shows both. `deleteQuiz` is marked destructive.
- [ ] A3 Course page JSON-LD validates as `Course` with lessons in `hasPart`.

## Quizzes 0.2.0 (#28 to #31)

- [ ] Q1 Owner: on a quiz, Save settings with Graded, pass mark 70, Retakes "A maximum number of attempts" 3: the line under the title reads "Graded, pass mark 70%...; at most 3 attempts." A pass mark of 120 is refused with a clear message. Switching to Practice clears the pass mark.
- [ ] Q2 Owner: add one question of each kind (multiple choice, multiple answers with two ticked, true or false, short answer with two accepted answers, fill in the blank). Each kind shows only its own fields. A blank question without `___` and a multiple-answers question with nothing ticked are refused. The table shows the kind and the correct or accepted answers. A 21st question is still refused.
- [ ] Q3 Guest and member: the quiz network responses (`quiz`, `memberQuiz`) carry no correct or accepted answers and no explanations, on graded and practice quizzes.*
- [ ] Q4 Member, graded with a pass mark: Mark complete before passing is refused with "Pass the quiz on this lesson first"; a failing submit shows the score, percent and Not passed yet; a passing submit shows Passed; Mark complete then works. A worse later attempt keeps the pass (best score counts).*
- [ ] Q5 Member: the course page lesson list shows "Quiz to pass" then "Quiz passed"; Your courses shows "1 quiz passed".
- [ ] Q6 Member, maximum attempts: the quiz shows attempts left; after the last one the submit button goes and "You have used every attempt on this quiz." shows; a submit through the route is refused with `NO_ATTEMPTS_LEFT`.
- [ ] Q7 Member, wait before retry: after a submit the quiz says "You can try again after <time>" and the button goes; a submit through the route is refused with `RETRY_LATER` and `retryAt`; after the wait it is accepted.
- [ ] Q8 Member, practice quiz: after submitting, each question shows the right answer and the owner's explanation; Mark complete works without passing. A graded quiz never shows them.
- [ ] Q9 Short and blank answers: "  pARIS " and "One   Hundred" are marked right against "Paris" and "one hundred".
- [ ] Q10 Owner: Quiz results shows Best and Attempts; erasing the member removes their attempts.
- [ ] Q14 Member on a max-attempts quiz uses every attempt, then Erase my course data: the quiz still shows no attempts left and a submit is refused; on a wait quiz the wait still applies. Owner finds the member by email on Quiz results (they have no rows left), erases them: the member can take the quiz again.
- [ ] Q15 (0.2.1) Member takes an unlimited quiz twice, then Erase my course data; owner sets the quiz to at most 2 attempts: the member sees no attempts left and a submit is refused. Owner deletes a quiz the member took, member erases again: the kept count for that quiz is gone.
- [ ] Q16 (0.2.2) Quizzes page: a pass mark of 120, -5 or an empty box, 0 or 101 attempts, or a wait of 50000 minutes is refused with a red message saying what is allowed, and the settings line does not change. MCP `saveQuiz` with `passMark: 120` answers `INVALID_QUIZ` with the same words; `passMark: 0` removes it (#41).
- [ ] Q11 Upgrade: on a site with 0.1.x quizzes and results, update to 0.2.0 with no other step: the old quizzes show and score as graded with unlimited retakes, Quiz results shows each old result as 1 attempt with its best score, and the next submit keeps the old score as the first history entry.*
- [ ] Q12 Agents: `saveQuiz` with every question type, mode, pass mark and retake; `getQuiz` returns them; leaving them out keeps them; `passMark: null` removes it.
- [ ] Q13 Quiz with each type at 1440, 768 and 390, light and dark, keyboard only: every question is a fieldset with a legend, multiple answers are checkboxes with the "Choose every answer that applies" hint, text answers have a label, the score and pass state are announced.

## Certificates 0.3.0 (#37)

- [ ] C1 Member finishes a course (with a graded quiz with a pass mark passed): Your courses shows Certificate with View, Copy link and Turn link off. View opens `/certificates/<32 hex>` with their name, the course, "Completed on <date>" and "Issued by <site title>".*
- [ ] C2 Copy link puts the full address on the clipboard and says so. A guest opening it sees the same certificate; the page HTML has no email and no ids; `meta robots` is `noindex, nofollow`.*
- [ ] C3 Turn link off: the old link shows "Certificate not found" (404, no name or course in the HTML), the same page as a made-up 32-character link and as `/certificates/x`. Turn on with a new link: the new link works, the old one stays not found.*
- [ ] C4 Print preview (or print to PDF): only the certificate, black on white, one landscape page; no header, footer or button. On screen: light and dark, 1440, 768, 390, no sideways scroll; the buttons work by keyboard and focus stays on the switch after it changes.
- [ ] C5 Owner: Plugins, Certificates lists courses; a course shows each member who finished (name, date, link on or off), 8 per page. Turn link off asks once; the member's link then shows not found. An off row has no action.
- [ ] C6 A course finished before 0.3.0 (completedAt set, no certificate) gets one on the member's first view of Your courses, and on the owner's first view of its course on Certificates; progress is unchanged.
- [ ] C7 Member's own erase and the admin Erase their data: the certificate link shows not found afterwards.
- [ ] C8 Agents: `listCertificates` lists names, dates and link state; `turnOffCertificate` switches a link off and is marked destructive.

## Budget and build

- [ ] B1 `npm test` passes, including the call-budget test: every entry point 20 calls or fewer.
- [ ] B2 Bundle under 100 KB per file.
- [ ] B3 `gate.sh` passes.
- [ ] B4 Cloudflare testbed: the starred cases with no call-limit or time-limit errors in the logs.
