# Student experience redesign

Trigger: product feedback that the student side feels "dry, bland and dead". I logged in as the seeded demo student (`demo_aarav`, class 8) at phone width and used Learn and Study.

## What is wrong today

1. **No identity or welcome.** `/learn` opens on the heading "Learn" and a list of old chat titles. It never says who you are or what to do.
2. **No character.** There is no mascot, no voice and no emoji. The only brand element is a graduation-cap icon.
3. **One flat colour.** Everything is white cards on pale indigo with thin grey borders. Nothing is rewarding to look at or tap.
4. **Tiny, admin-style navigation.** Small text links in a header wrap on phones, and Log out sits next to them. Kids use phones with thumbs.
5. **Starting a chat is a form.** "How should the tutor help?" is a radio list plus a select, which is paperwork rather than invitation.
6. **Empty chat is blank.** A child who opens a chat sees nothing and has to know what to type.
7. **Chat feels mechanical.** There is a plain grey bubble, a "…" while waiting, no typing animation, and tutor replies are not markdown-rendered, so `**bold**` and lists show as raw characters.
8. **Study is a tab strip and a "Create" button.** The four tools (practice test, mock exam, notes, last-night notes) have no explanation and no visual identity.
9. **Taking a test is joyless.** Radios in white boxes, a thin progress bar, no encouragement.
10. **Results have no payoff.** A score in a grey box. No celebration, no "what next".
11. **No sense of progress or habit.** No streak, no stats, nothing to come back for.
12. **One tone for ages 5 to 18.** A class 2 child and a class 12 student see the same UI and copy.
13. **Dark mode and motion.** Fine today, but must stay fine, and motion must respect `prefers-reduced-motion`.

## Design direction

- **Mascot "Tutu"**: a friendly owl drawn as inline SVG with moods (happy, thinking, cheer). It appears on home, in chat as the tutor's avatar, and on results.
- **Playful student theme** scoped to the student area only (`.student-theme`), so the admin UI is untouched: brighter violet primary, warm accents (sun, coral, mint, sky), larger radii, chunky buttons with a bottom edge, bigger type.
- **Age bands** from the student's grade (`src/lib/student-band.ts`): `junior` (classes 1-5): biggest type, most emoji, simplest copy; `middle` (6-8): playful but lighter; `senior` (9-12): calm, compact, almost no emoji, same layout. Band drives copy and a `data-band` attribute that scales type and decoration.
- **Mobile first**: a single responsive nav that is a bottom tab bar on phones and a top pill nav on larger screens.

## Tasks

1. `student-band.ts` (pure, unit-tested): grade to band, greetings, copy, streak calculation.
2. Theme tokens, keyframes and chunky-button utility in `globals.css`, scoped to `.student-theme`.
3. `Tutu` mascot component.
4. Student layout loads name and grade; provider exposes them; new nav.
5. Home (`/learn`): greeting hero, streak and stat chips, big "ask" tiles, a friendly chat picker, a nicer chat list and empty state.
6. Chat: Tutu avatar, markdown replies, typing dots, starter prompts in the empty state, larger bubbles.
7. Study hub: tool tiles with icon, colour and one-line description; friendlier rows.
8. Test taking: lettered answer cards, encouragement, clearer progress.
9. Results: score ring, message by score band, confetti for a strong score, clear next steps.
10. Verify: typecheck, unit tests, the student e2e journeys, and screenshots at phone and desktop width in each age band.

## Constraints to preserve

Existing e2e journeys select by role and label text ("New chat", "Start chat", "Socratic", "Your message", "Question 1 of 4", "Graded", "Yes, submit", "Ready", "No chats yet. Start one above.", a nav named "Student" with a "Study" link). Those accessible names stay; decoration is `aria-hidden`.

## Known limit (not in this change)

The database restricts `student_profiles.grade` and `content_items.grade` to 5-12, so classes 1-4 cannot enrol yet. The age-band code already handles grades 1-12; widening the constraint is a separate migration plus signup and content validation changes.
