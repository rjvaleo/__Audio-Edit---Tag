# Editing the room by dragging the room

Written 18 Aug 2026, before the work, as the design being built to.

The master bus box has a shape and a camera, and both are currently five
constants at the top of `ui/vis-gl.js`. They were chosen for one frame shape — a
wide panel in a dock — and they are about to be asked to work at 16:9, 1:1, 4:5
and 9:16, because that is what the video export offers. See
`docs/VIDEO-EXPORT.md`.

Those numbers need to be found by looking, not by arithmetic. So: **you edit the
room by dragging the room.**

## Why not a panel of numbers

This has already been learned here once, in a different corner, and it is
written down because it did not stick.

`a17c3ce` replaced the first theme editor, which was three `<input
type="color">` in a panel. Its own commit message is the argument: *"Nobody
chooses a theme by typing `#0e1116` — that is a developer's idea of a colour
tool, and it was the wrong thing to build."* What replaced it was five strips
you drag, each painted along its length with what it does, so the choice is
visible before it is made.

Then `256249e` ported a theme studio in over the top of it, and what is on
screen today is a name field and five hex codes. The version that had to be
argued for was replaced by the version it was written to replace, and the result
is unusable.

A room is worse than a palette for this, not better. `VG_FLOOR_Y = -0.38` against
`VG_CEIL_Y = 0.62` is not a number anyone can picture; what it means is *how far
you are looking down*, and the only way to choose it is to look down and see. A
field with `-0.38` in it puts a spreadsheet between you and the room.

**So there are no inputs.** Every control is a grab on the thing it changes.

## Why not a miniature either

The theme editor's miniature was right for the theme editor and the reason is
specific: a theme repaints the whole interface, so a control that applies on
every pointer move makes the thing you are judging jump under your hand. The
miniature holds still while the real interface does not have to.

The room has nothing around it to disturb. It is one canvas, and it is already
the thing you want to look at. There is no interface to protect from the edit,
so the edit happens on the real box at its real size, live, and the miniature
would only be a smaller worse copy of what is already on screen.

## The gestures

| grab | changes |
|---|---|
| inside the room | swings the view |
| the horizon | the eye line — where you are looking from, up and down |
| the back wall, or scroll | depth, pulling the room longer or shorter |
| the ring | its height up the room, and its size |
| the floor's near edge | how much of the frame the floor takes |

The eye line is the one worth naming properly, because it is the camera angle
under another name. The room is drawn with an **off-axis frustum**: the camera
stays square to the frame and the frustum is shifted instead, which is what puts
the vanishing point above the middle so you can see the floor, while the front
face still lands exactly on the edges of the canvas. `VG_FLOOR_Y` and
`VG_CEIL_Y` are not two independent numbers — their asymmetry about zero *is*
the tilt. Dragging the horizon is dragging that asymmetry, which is why it is
one gesture and not two fields.

## The frame selector, which is the point

Dock · 16:9 · 1:1 · 4:5 · 9:16, switching the real box to that shape while you
work.

Without this the tool is not worth building. The room lives in a wide dock, the
frames that need designing are square and tall, and nobody can tune a portrait
composition by looking at a landscape one and imagining. The whole reason the
constants fail at 9:16 is that they were chosen while looking at 16:9.

Each frame keeps its own camera. That is what the video export reads when a size
is chosen, so picking Vertical in the export box gets the camera that was
designed for vertical rather than the wide one squeezed.

## Portrait is probably isometric, and that is a real break

At 9:16 the room is 0.562 world units wide against 1.0 tall, and the sky ring —
whose radius comes from the height and therefore does not shrink — takes 60% of
that width. The wide composition does not survive being narrowed; see
`docs/VIDEO-EXPORT.md` for the table.

An **isometric** arrangement answers it: no vanishing point pulling everything
to a centre, depth as a constant diagonal instead, so the box can run up and
back and spend the height a tall frame has going spare.

It has to be said plainly that this is the arrangement that was already tried
and rejected. From the commit that built the room: *"Tilt the camera and the
near rectangle rotates out of alignment and you get a box floating in a field of
nothing, which is exactly what the first attempt was."*

The rejection does not transfer, and the reason is precise: it failed in a
**wide** frame, where a floating box wastes the width and reads as lost. A tall
frame has height and nothing to spend it on, because the room's height is fixed
and only its width tracks the aspect. What was a waste at 16:9 is the way out
at 9:16.

Two things go with it, and both should be chosen rather than discovered:

- **"The panel is the box" stops being true.** Under isometric there is no front
  face parallel to the screen filling the frame, so the identity that the room's
  near edges *are* the panel's edges is gone.
- **The borderless canvas was a consequence of that identity** — `#visGl` has no
  border because a border would be "a frame drawn over the frame". An isometric
  box floating in a frame may well want the frame back.

## The numbers are an output

They still exist and they still matter: the point of the exercise is a set of
constants good enough to become the defaults in `vis-gl.js`.

So they are displayed, and they are copyable, and they are never typed. You drag
until it looks right and the tool tells you what you just made.

## One refactor first

`VG_DEPTH`, `VG_FLOOR_Y`, `VG_CEIL_Y`, `VG_LEAD` and the sky's two factors are
module constants read directly at every draw call. They have to become live
values before any of this can move.

That is a small change that touches a lot of lines, and it is worth doing on its
own, deliberately, rather than sprinkling globals through the file as each
gesture needs one. The shape it wants is a single camera object with the frame's
aspect as its key — which is also exactly what the per-frame cameras and the
video export need it to be, so the refactor is not scaffolding, it is the
structure.
