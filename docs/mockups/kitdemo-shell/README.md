# Kitdemo Shell: Mockups (S2 Step 4)

Three options for the 3-entity demo shell (food, meal, goal) that proves K1's done-when: a schema
becomes a working app shell, device-only with no sign-in, owner-scoped when signed in.

Open `index.html` for all three side by side, or `index.html?opt=a|b|c&theme=light|dark` for one
at full size. Static data, no store. 390x844 PNGs are in `shots/` (light and dark per option).

| | Shape | Best at | Cost |
|---|---|---|---|
| A. Tabs By Entity | Bottom tabs Meals, Foods, Goal; a floating Log Meal button | Familiar; any record in 2 taps | Reads as three lists, not one app |
| B. Today Dashboard | Goal ring, today's meals, Foods summary on one screen | Feels like a real app; closest to Marble | Most hand-built; Foods and Goal are second-level screens |
| C. Generated Console | Segmented entity picker over generated lists and forms | Proves schema in, shell out; any new schema gets it free | Utilitarian, not a product face |

The chip shows "On This Device" with no sign-in; signed in it reads the account name and the
store scopes rows to that owner. All copy is Title Case, icons are SVG, no emojis.
