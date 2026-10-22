# Shelf House: a room unwraps on the front view

Written after the build, from what was agreed while sketching it, so the next
person to change the front view knows what was decided and why.

## What it is

Clicking a room (or a table, stairs or lift) on the front view **unwraps** it:
every control for it is laid out around it at once, so nothing is hidden behind
a hover or a line under the view. Before, each wall had a folded tab that
opened one at a time, and the name, colour, sizes and actions sat in a line
under the front view.

## The layout

For a room, around it:

- **Each wall** has its weight (thick, thin, missing) beside it, then its
  openings as a row of tabs with a `+`. The ceiling's row is above its weight;
  the floor's and the back wall's are below theirs (the back wall under a
  "Back wall" label); the side walls' are upright beside theirs.
- A wall set to **no wall** replaces its row with a grey italic note. Its
  openings are kept, and come back with the wall.
- **Picking a tab** opens the opening's **tile**, joined to the tab and opening
  away from the room: wide and short above and below, narrow and tall beside.
  Shape (rectangle, arch, round) and alignment (centre of the wall, doorway)
  are pictures; the rest are the same fields as before. One `+` per wall adds a
  window (a skylight on the ceiling, a hatch on the floor); its shape is set in
  the tile.
- **Corner dots** are as before, outer ring outside the corners, inner inside.
- The **card** (name, colour, W·H·D, where it stands, move, duplicate, delete,
  STL, and ⋯ for save-as-type, copy settings and reset) is on the front view,
  to the left of the ceiling's stack. No control for a block is outside the
  view. A table, stairs or lift gets the same card without the sizes, and a
  panel on each side for its own sizes.

## The camera

The front view is a camera over the shelf.

- Picking a block **zooms to fit it and every panel around it**. A block in a
  room brings its room along. Letting go zooms back to the whole shelf.
- Opening a tile **keeps the zoom** the room had without it, and only slides to
  show the room, that wall and the tile. This was chosen from six ideas
  measured on a mock-up (`/notes/shelf-house-opening-tile/`): it is the only one
  that keeps the room at its size for every tile on both sizes of view.
- By hand: − / + / fit in the view's head, pinch or Ctrl+scroll around the
  pointer, two-finger pinch and pan on touch, and dragging empty paper. A
  hand-set view holds until another block or opening is picked, or fit is
  pressed.
- While a block or an opening is held down the camera holds still, so the view
  never moves under the pointer. It fits when let go.

## Closing

While an opening's tile is open, a press **anywhere else** on the front view
only closes it, even on another room or empty paper. Going to another room is
a second, deliberate press, so a click meant to close the tile cannot pick a
room by accident. With no tile open, a click on empty paper lets go of the
block.

## Phones

Below 700 px of front view the card folds to its colour and name, with a
button that unfolds the rest, and sits above the ceiling's stack instead of
beside it. The front view grows (to 82% of the screen's height) while a block
is edited, since everything around the block needs the room.

## Things that will bite

- The panels are placed by script and measured in the same pass, so **nothing
  that sets where they are may have a transition**. With reduced motion the
  site gives every element a near-instant `transition: all`, which leaves the
  old position to read back and throws the fit. `.sh-jig > *` and `.sh-mat`
  set `transition: none` for this.
- Screenshots that resize the page (`captureBeyondViewport`) show the camera
  mid-refit. Capture inside the viewport.
- Not built: dragging a block while zoomed in does not zoom out for you. The
  view holds still while dragging, as it always has.
