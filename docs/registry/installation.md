Needs EmDash 1.5.0 or later and a sandbox runner (Registry shows in the admin menu).

1. Install Learnomy from the Registry and accept the two permissions: Read your content (list courses and lessons by title, show only published ones) and Read user accounts (names in your lists).
2. Copy the site kit into your site with the one command in the install guide (link below), from your site's root folder. It adds the course pages, the Your courses component and the Courses, Lessons and Course categories content types, and never replaces a newer shared Wbcom file.
3. Add `<LearnomyMyCourses />` to your site's account page.
4. Restart the dev server or deploy. Add `/courses/` to your menu.
5. Invite members: Users, Invite User, role Subscriber.

Full guide: https://github.com/wbcomdesigns/emdash-learnomy/blob/main/docs/website/getting-started/install.md
