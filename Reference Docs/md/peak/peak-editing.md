# Peak 6 — Chapter 5: Editing

> Every edit operation and how it behaves — selection, cut/paste variants, fades, loops, markers and regions.

> Extracted from `Peak 6 User Guide.pdf`, pages 77–116.


### Chapter 5:  Editing


#### Introduction


#### Editing Audio with Peak


##### Interactive Editing


##### Nondestructive Editing


##### Unlimited Undo & Redo


#### The Audio Document Window

<!-- p.77 -->
Chapter 5:
Editing
Introduction
This chapter introduces you to the concept of digital
audio editing.  You will learn how to edit digital audio
with Peak's many powerful editing tools.
Editing Audio with Peak
Peak provides you with a powerful interactive,
nondestructive environment for editing and manipulating
audio.  In this environment, not only are virtually all editing
actions completely "undo-able" and "redo-able," but they can
be performed interactively while audio playback is engaged.
Interactive Editing
Interactive editing means that you can cut, paste, loop, and
process audio with many of Peak's DSP functions and plugins, even while playing back the very audio that you are
editing.  For example, you can start playback, cut a
selection of audio and paste or insert it later in the
document, and when Peak reaches the location of the
inserted audio, it will play it as if it were there all along.  This
revolutionary capability makes Peak a supremely fast and
flexible audio production tool that makes conventional
recording and editing methods, such as analog tape and a
razor blade, seem primitive and archaic by comparison.
Nondestructive Editing
Peak's nondestructive editing capabilities mean that the
edits you perform to an audio document do not
permanently change the original source recording until
you finally save the document.  Thus, you can cut, copy,
paste, fade in and out of, and otherwise completely
change a recording, and still be able to return back to
square one – the original untouched state of the
recording – up until the time that you save the
document to disk.  At that time, all edits are permanently
written into the document.
Unlimited Undo and Redo
As an editing session progresses, Peak maintains an
internal list of the edits that you perform.  Changes that
you make to an audio document are not permanently
applied to the file until you ultimately save it.  This is
what gives Peak its unprecedented unlimited undo and
redo capability.  Through the use of the Mac's standard
Undo and Redo commands, you can undo or redo your
actions sequentially, or by using the Edits command,
using a "playlist-style" editing event list.  This is a very
exciting technology that allows you to maintain complete
creative freedom of choice – right up until the last
moment before you save your project to disk.
The Audio Document Window
The heart of Peak's powerful editing capabilities is the
audio document window.  The audio document window
provides you with a "window into sound," allowing you to
make good use of both your eyes and ears to perform
Chapter 5:  Editing
77
5


##### An Audio Waveform


##### A Selection

<!-- p.78 -->
extremely precise editing tasks.  The audio document
window gives you a time-domain representation of sound,
that is, you see the amplitude of the sound over time.
An Audio Waveform
If you have never seen sound displayed in a visual format
before, it may not be immediately obvious how to "read"
an audio waveform.  It is actually quite easy to navigate
through a recording with a waveform as your road map.
The peaks in the waveform are areas of high amplitude
(loud spots).  The valleys in the waveform are areas of
low amplitude (quiet spots).  If the audio material is
music with a pronounced, regular beat, it is generally
very easy to pick out where the beats are simply by
looking for peaks.  Using this information, and the
guidelines given shortly in the "A Selection" section, you
will be able to successfully locate and select a desired
portion of the audio document and perform the edits
that you wish.  The cursor marks the current location,
and also serves as an insertion point.
Vertical Scaling
Peak allows you to control the vertical magnification of
audio waveforms.  This feature is useful if you are editing
and viewing a document with very quiet audio material.
To increase the vertical scaling magnification:
•
Hold the Control key down and press the Up
Arrow key.
To decrease the vertical scaling magnification:
•
Hold the Control key down and press the Down
Arrow key.
Audio Waveform Overview
Peak provides an Overview display of the entire audio
waveform along the top of the screen under the menu
bar.  This provides you with a convenient visual reference
of the overall document when you are editing only a
portion in the audio document window.  The highlighted
area in the Overview display shows the area of the audio
waveform currently visible in the audio document
window.  If desired, you can hide the Overview display to
allow the audio document window to occupy more of
the computer screen.
To show/hide the Audio Waveform Overview:
•
Select Show Overview in the Options menu (-,)
– a check next to this item indicates it is enabled,
and the absence of a check means it is disabled.
(Show/Hide Overview may also be toggle using the
disclosure triangle in the upper left corner of the
audio document window).
A Selection
A selection is just what it sounds like: a portion of audio
that you have selected by clicking and dragging with the
mouse.  You must select audio in order to perform an
editing action on it.  To make good selections for editing,
the best rule of thumb is to begin a selection just before
a peak in the waveform and end it just after a peak in the
waveform.  In other words, try to make selections start
and end in areas of low amplitude ("valleys" in the
waveform).
It is also important, when possible, to begin and end a
selection at a point where the waveform meets the zero
crossing line (the center line through the waveform).
This helps you avoid creating pops and clicks if you later
Peak 6 User's Guide
78
An audio waveform
A waveform with selected audio


##### A Marker

<!-- p.79 -->
cut or paste the audio, because the point at which the
waveform meets the zero crossing is a point of no
amplitude in the sound wave.  Pops and click generally
only occur if you make a careless selection and begin or
end on a portion of the sound wave where the amplitude
is high (where the waveform is high above, or far below
the center point).  Enable Auto-Snap in the Options
menu, and select Snap To>Zero Crossings from the
Action menu to have Peak nudge your selection to the
nearest zero crossings automatically.
In addition to snapping to zero crossings in the audio
waveform, Peak features a number of other Snap To
options.  These options allow a selection to be "snapped"
to a preset number of samples, or to a custom selection
length.  Other Snap To boundaries include:
•
Bars/Beats
•
CD Frames (588 samples or multiple thereof)
•
Sony PS2 Loop Boundaries (28 samples or multiple
thereof)
•
Microsoft Xbox Loop Boundaries (64 samples or
multiple thereof)
•
Custom Units (user-definable number of samples)
The Snap To units you choose will depend on the type of
editing work you will be doing.  Most users will probably
use Zero Crossings or Bars/Beats for most musical
applications.  Multimedia and video game sound
designers will especially appreciate these new options
when producing audio for a particular delivery platform.
For example, when creating audio loops and sound
effects for a Playstation 2 video game, audio edits need to
be made at increments of 28 samples in order to
loop/play back smoothly in the PS2's audio engine.  By
choosing the Snap To PS2 loop boundary setting, any
edits that are made will automatically be made in units
that will translate smoothly to the PS2's playback system.
Once markers are placed in the waveform, they may
need to be moved.  By holding down the Shift key while
dragging the markers the selected Snap To behavior will
be applied, and the markers may be shifted slightly so as
to conform to the selected Snap To format.
The Zoom In function helps you make very precise
selections by letting you zoom in to a higher
magnification and select exactly the portion of the
waveform you desire.  Also, once you have made a
selection, you can adjust the beginning or the end of the
current selection by holding down the Shift key and
clicking with the mouse.  Your selection will be
shortened or lengthened accordingly.
Channel Independent Processing
To select only the Left channel, move the cursor over it
and above the left channel's waveform.  The cursor will
show a small "L" at the insertion point.  To select only the
Right channel, move the cursor over it and below the left
channel's waveform.  The cursor will show a small "R" at
the insertion point.  You can process one channel of an
audio document using most of Peak's native DSP or
third-party plug-ins.
Peak allows you to select and process the left and
right channels of a stereo file independently, but
you cannot edit (i.e., Cut, Paste, Delete, etc.) the left
and right channels of a stereo file independently.
A Marker
A marker can be placed in a document to identify a point
of importance.  A marker appears as a line with a solid
triangular base.  Peak allows you to place markers into a
document in order to mark a given location or Region in
a document for later selection, navigation, or editing.
Markers can be moved, named and renamed, "anchored"
to a particular location on a waveform, and given other
attributes.  The use of markers is covered in greater detail
later in this chapter.
Chapter 5:  Editing
79
5
A waveform with a Marker


##### A Loop


##### Audio Between Adjacent Markers


##### Audio Info Area


#### Selecting Audio

<!-- p.80 -->
A Loop
A loop refers to a section of audio that is bounded on
either side by loop markers.  In the illustration above, the
area that falls between the loop markers "beg loop" and
"end loop" is looped.  Loops are used to sustain or repeat
a section of audio.  They can be used for material that
you intend to transfer to a sampler, or simply for
playback within Peak itself.  Peak allows you to create one
loop per audio file.
Although Peak allows only one loop per audio
document, there is a quick and easy way to mark
multiple desired sections for looping.  With the loop
markers in the desired location, choose Select Loop
from the Edit menu, then, choose New Region from
the Action menu – a Region is created that is the
same length as the loop.  Using this technique allows
you to create as many Regions as desired within a
single audio document.  To loop any of these Regions,
simply -click between a Region's markers to select
the Region (or press the Tab key until the desired
Region is selected), and then choose Loop this
Selection (-Shift-"-") from the Action menu.
Audio Between Adjacent Markers
Audio between adjacent markers refers to a section of
audio that is bounded by markers.  Understanding the
concept of audio between adjacent markers is important,
as many editing techniques in Peak are based on it.  For
example, the audio between adjacent markers can be
quickly and discretely selected for cut/copy/paste edits,
or DSP/effects processing, simply by -clicking between
adjacent markers.   (Note: A selection of audio between
markers is different than an audio Region.  Regions are
described later in this chapter, as well as in Chapter 6,
Playlists and Audio CD Burning.)In the following
illustration, the area that falls between "My Marker"  and
"My Other Marker" is audio between markers.
Audio Info Area
In the lower left corner of each Peak Audio Document is
the Audio Info Area.  The Info Area shows the maximum
amplitude, sample rate, bit resolution, file format, and
file size of the audio file.
Clicking on the Max dB section of the Audio Info Area
will open the Change Gain dialog, so that you can change
the gain for the entire audio file, or the current selection.
For more information on the Change Gain DSP function,
please refer to Chapter 8:  DSP.  Clicking on any other
portion of the Audio Info Area will open the Edit
Metadata dialog.
Selecting Audio
In order to perform most types of editing actions, you
must first select the portion of the document that you
Peak 6 User's Guide
80
A waveform with 2 adjacent markers (named "My Marker" and "My
Other Marker")
A waveform with a Loop
Audio Info Area


##### Markers & Selections as Navigational Aids

<!-- p.81 -->
wish to modify.  Peak has several techniques for making
and modifying selections.
To make a selection with the mouse:
•
Click the cursor at the desired start location in the
audio document and drag to select the desired
range.
To extend or shorten a selection:
1.
Make a selection with the mouse as explained
above.
2.
Hold down the Shift key and click on the end of the
selection that you wish to modify.
3.
Drag the mouse to extend or shorten the selection.
When you are satisfied with the length of the
selection, release the mouse.
To select audio between two markers:
1.
Hold down the Command key (z) and click
anywhere in between two markers.  (Markers are
explained in detail in the next section.) Peak selects
the audio between the markers.
2.
If there are additional markers in the document and
you wish to extend the selection to encompass
other portions of audio that fall between the
markers, hold down the Shift key and the Command
key, and click between another two markers.  The
selection will extend from the originally selected
audio to the audio that you just added.
3.
Repeat as desired to navigate to and select
additional audio between markers.
Peak offers a preference for selecting the audio
between markers by double-clicking.  To enable
this preference, open Peak's Preference Panel,
click the Playback Preferences button, and then
uncheck the Double-click on Waveform to Begin
Playback checkbox.  Once this preference has been
set, you may select audio between two adjacent
markers by double-clicking between them.
To select audio between two markers with the Tab key:
1.
Create markers at several locations in the
document (various techniques for creating
markers are explained in the next section).
2.
Press the Tab key on your computer keyboard.
Peak selects the portion of the waveform that lies
between the first two markers in the document.
3.
Press the Tab key again to select the portion of
audio between the next two markers.  (If you hold
down the Shift key while tabbing the selection
through the audio file, you can append each
successive space between markers to the current
selection.)
4.
Repeat as desired to navigate to and select
additional audio.
To select all audio in a document:
•
Choose Select All from the Edit menu or press -
A on your keyboard.
Markers & Selections as Navigational Aids
The presence of Regions, loops, or markers – and
selected portions of the waveform can be very helpful in
navigating through an audio document.
When markers are present, the Tab key on your keyboard
may be used to select the audio between markers.
Pressing the Tab key again selects the next space
between markers – when Peak reaches the end of the
document, it will "wrap" back to the beginning.  Using
the Option & Tab keys together will select the spaces
between markers in the opposite direction.
This keyboard shortcut makes it very easy to navigate to
specific areas, for example:  Imagine you are working
with a recording of an LP, and have placed a marker in
the space between each song (the silent area).  To
quickly navigate to the beginning of song 5, simply press
the Tab key five times, and then press the up arrow key
on your keyboard – this would select the space between
markers that bound the fifth song, and the up arrow key
Chapter 5:  Editing
81
5


#### Auditioning Audio


#### Scrubbing


##### Dynamic Scrubbing

<!-- p.82 -->
would locate Peak's cursor to the beginning of the
selection.
Many other useful tips can be found in Appendix
2:  Peak Actions.
Auditioning Audio
It is often useful to audition a selection along with just a
bit of audio preceding or following it – without actually
including this material in the selection itself.  Peak's
Auditioning command allows you to do this by specifying
a desired amount of pre-roll or post-roll when you play
the selection.
To audition audio with pre-roll or post-roll:
1.
Choose Auditioning from the Preferences panel –
the Auditioning Preferences dialog appears.
2.
Enter the desired amount of pre-roll and post-roll
and click OK.
3.
Click the cursor in the audio document and drag to
select the desired range.
4.
Press Control-Spacebar – Peak plays the selection,
adding the specified amount of pre- and post-roll.
Scrubbing
Peak offers a number of ways to scrub audio, described
below.
Dynamic Scrubbing
Peak provides a unique audio auditioning technique
called dynamic scrubbing.  This feature is very useful for
precisely pinpointing and selecting a desired location in
an audio document.  Dynamic scrubbing allows you to
drag the mouse forward or backward over a waveform
while Peak plays a short loop (between 10 and 600
milliseconds) at the scrub location.  When you have
found the location you are looking for, you can
commence editing.  Peak allows you to choose the
length of this playback loop with the Dynamic Scrub
Time command in the Options menu.  Peak provides
two types of dynamic scrubbing: dynamic shuttle
scrubbing and dynamic jog scrubbing.  Both are
described below.
To select a loop duration for dynamic scrubbing:
•
Choose Dynamic Scrub Time from the Options
menu, and choose a duration from the hierarchical
submenu.  Typically, values between 40 and 80
milliseconds work well.
To use dynamic "Shuttle-type" scrubbing:
1.
Hold down the Control key and click and drag the
mouse across a portion of the waveform in an
audio document window.  As you drag the mouse,
Peak plays a short loop of the audio at the
Peak 6 User's Guide
82
The Auditioning Preferences Dialog
Setting the Dynamic Scrub feature's loop time


##### Jog Scrubbing


##### Tape-Style Scrubbing

<!-- p.83 -->
insertion point.  You can control the tempo and
direction (forward or backward) of playback by
dragging the mouse slower or faster, forwards, or
backwards.
2.
Release the mouse button to stop scrubbing.  The
insertion point will be exactly where you left off
scrubbing.
3.
To make a selection starting at the current scrub
point, stop scrubbing, hold down the Shift key, and
click the mouse to extend the selection from the
insertion point to the desired end location.
Jog Scrubbing
Peak provides a variation of the dynamic scrubbing
feature, which is similar to a technique known in
recording studios as jog scrubbing.  With this technique,
Peak actually engages playback and moves through the
file at its normal pace, but allows you to control the
playback point by dragging the mouse.  You can control
the direction (forward or backward) of playback by
dragging the mouse forwards or backwards.  This
scrubbing mode affords a greater degree of control when
you are "zoomed out" in the audio document window.
To use dynamic "jog" scrubbing:
1.
Hold down the Control key and Option key and
drag the mouse across a portion of the waveform
in an audio document window.  As you drag the
mouse, Peak engages playback while it loops a
short portion of the audio at the insertion point.
Dragging the cursor farther away from the current
insertion point increases the velocity of
scrubbing.
2.
Release the mouse button to stop scrubbing.  The
insertion point will be exactly where you left off
scrubbing.
3.
To make a selection starting at the current scrub
point, stop scrubbing, hold down the Shift key, and
click the mouse to extend the selection from the
insertion point to the desired end location.
Since jog scrubbing mode is engaged by pressing the
Option key in combination with the Control key, it is
possible to toggle back and forth between jog and
shuttle modes simply by pressing or releasing the
Option key.
Tape-Style Scrubbing
In addition to dynamic scrubbing feature, Peak provides
high resolution tape-style scrubbing.  To enable tapestyle scrubbing, set the Dynamic Scrub Time under the
Options menu to Tape-Style.
To start tape-style scrubbing:
•
Hold down the Control key on your keyboard,
and then click and drag the mouse at the location
in the waveform where you wish to begin
scrubbing.
To deactivate tape-style scrubbing:
•
Release the mouse and Control key.
To control "tape" speed in tape-style scrubbing:
1.  As you drag the mouse towards the right,
scrubbing speed will increase.
2.  As you drag the mouse toward the left, scrubbing
will slow down.
3.  If you drag the mouse to the left of the point where
you started scrubbing, the scrub direction will
change from forward playback to backwards
playback.
The top of the playhead cursor will display the scrubbing
speed, which can vary from +/- 2.25 times the original
speed.
Chapter 5:  Editing
83
5


#### Using Unlimited Undo & Redo


##### Using the Edits Command to Undo a Series of Actions

<!-- p.84 -->
Using Unlimited Undo and Redo
Peak maintains an internal list of the edits that you perform
during the course of an editing session.  These changes are
not permanently applied to the file until you save it.  This
gives Peak unlimited undo and redo capability.  Through
the use of the Mac's standard Undo (-Z) and Redo (-
Y) commands, you can undo and redo your actions
sequentially; or by using the Edits command, using a
"playlist-style" editing event list.  This powerful capability
allows you to maintain complete creative freedom of
choice – right up until the last moment before you save
your project to disk.  The only limitation in using Redo is
that if you insert a new action when a redo action is
available, you will no longer be able to redo.  Remember, as
soon as you perform an editing action other than Undo in
Peak, Redo is no longer available.
To undo an action:
1.
Perform an edit (such as cutting audio or moving a
marker).
2.
Choose Undo from the Edit menu (-Z) or
Toolbar.  The action is undone.
3.
You can continue undoing actions until you return
to the original state of the audio document (the
state at which it was last saved).  When there are no
actions left to undo, the Undo menu item will
appear grayed out.
To redo an action:
1.
If you wish to redo the action that was undone,
choose Redo from the Edit menu (-Y) or
Toolbar.  The action is redone.
2.
You can continue redoing actions until none are
left to redo.  When there are no actions left to redo,
the Redo menu item will appear grayed out.
Using the Edits Command to Undo a Series
of Actions
Peak's Edits command provides you with a second
unique and powerful method of undoing virtually any
number of editing actions performed on an audio
document since you last saved it.  You can think of the
Edits command as an "event-based" listing of all your
editing actions since you last saved.  Using this list, you
can navigate back in time to the point at which you
performed a particular edit, and if you wish, undo it.
Once you have returned to an earlier state in the project,
you are free to start editing from that point on.
The Edit history list is available in two locations – one is
in the Edits dialog, located under the Edit menu.
The other location where the Edit history may be
accessed is in the Audio Document Window's Contents
Drawer.
Peak 6 User's Guide
84
The Edits dialog
The Edits history in the Contents Drawer


#### Essential Editing Functions


##### Scratch Disks

<!-- p.85 -->
Be aware that if you do go back to a past action
and perform a different action at that state in the
project, any edits that originally occurred after
will be gone, and you won't be able to redo them.
To use the Edits dialog to return to or undo an action:
1.
Perform several edits.  (Don't use the Save
command or you won't be able to undo any edits
that occurred before you saved.)
2.
Choose Edits from the Edit menu.  A dialog
appears listing the edits you have performed since
you last saved the document.
3.
In the list, double-click on the description of the
action you wish to return to (or select an action
and click the Revert to Item button).  Peak returns
the document to the state it was in at the time of
that edit.
4.
When you have finished, click Done.
To use the Edits list in the Contents Drawer to return to or
undo an action:
1.
Perform several edits.  (Don't use the Save
command or you won't be able to undo any edits
that occurred before you saved.)
2.
From the Window menu, choose Toggle Contents
Drawer (-F), and click the Show History button
in the lower right portion of the drawer – a list of
edits you have performed since you last saved the
document appears.
3.
In the list, double-click on the description of the
action you wish to return to.  Peak returns the
document to the state it was in at the time of that
edit.
4.
When you have finished, click Done.
Essential Editing Functions
Peak supports all of the Mac's essential editing functions
such as cut, copy, and paste and provides several more
specifically designed for audio editing.  This section
explains how to use each of these functions.
Because Peak allows you to have multiple audio
documents open at the same time, it is possible to
conveniently cut, copy, paste, and insert audio between
documents.  This makes combining material from several
audio documents very fast and easy.
Scratch Disks
Because audio data can be very large, Peak utilizes a
portion of your hard disk's free space to hold audio data
that has been cut or copied, as well as for temporary or
"scratch" files for undo purposes.  If you have more than
one hard drive attached to your Mac, the Scratch Disks
section of the Preferences panel allows you to choose the
hard drives (or "scratch disks") that you wish to use for
these temporary files.  Peak allows you to select which
disk you want to have as your default, or "Primary" disk
for this purpose – ideally you would select the disk that
has the most free space.  If you are connected to a file
server, you can utilize available storage on the server by
clicking the Allow Servers checkbox (that is if you have a
very fast server connection).  Any available servers will
then appear in the Scratch Disks pop-up menu.  This is
recommended only if you have access to a high-speed
ethernet, or other fast server.
Chapter 5:  Editing
85
5
The Scratch Disks dialog


##### Clearing the Clipboard to Reclaim Disk Space


##### Cutting Audio


##### Deleting Audio


##### Copying Audio


##### Pasting Audio

<!-- p.86 -->
Clearing the Clipboard to Reclaim Disk Space
If you no longer need the clipboard contents, you can
free up the disk space occupied by the clipboard by
choosing the Clear Clipboard command from the Edit
menu.
Cutting Audio
The Cut command (-X) allows you to cut a selected
range out of an audio document.  Audio that occurs after
the cut slides over to fill in the gap.  By cutting and
pasting "pieces" of audio, you can freely rearrange
material in an audio document.  This can be a powerful
tool for creating audio remixes for music-oriented
applications, as well as an indispensable tool for general
sound design tasks.  When you cut a selection, the Mac
holds the cut audio data in its internal memory (the
Clipboard) in case you wish to paste it elsewhere.
Because all real-time editing you do with Peak is
nondestructive, the audio isn't actually removed from
the original audio document until you finally save the file
to disk with the Save command.  At that time, all edits are
saved and any changes that you have made are
permanently saved to the audio document.
To cut a selection:
1.
Click the cursor at the desired location in the audio
document and drag to select the desired range.
2.
Choose Cut from the Edit menu (-X) or Toolbar.
3.
The selected range is removed from the audio
document(s) and held on the Clipboard.  Audio
occurring after the cut slides over to fill in the gap.
Deleting Audio
If you wish to remove a section of audio from an audio
document without using the Cut command, you can use
the Delete key, or the Delete button on the Toolbar.  As
with the Cut command and other editing functions, the
audio isn't actually removed from the original audio
document until you save the file to disk.
To delete a selection:
1.
Click the cursor at the desired location in the audio
document and drag to select the desired range.
2.
Press the Delete key, or click the Delete button on
the Toolbar.
3.
The selection is removed from the audio
document.  Audio occurring after the deleted
section slides over to fill in the gap.
Copying Audio
The Copy command (-C) copies the current selection
to the Mac's Clipboard (or internal memory buffer) so
that you can paste it, insert it, or use it with optional
"Clipboard-based" processing such as Add, Convolve,
Mix, Modulate, and ImpulseVerb.  As with the Cut
command, copying and pasting "pieces" of audio, allows
you to freely rearrange material in a document.  This can
be a powerful tool for creating audio remixes for musicoriented applications, and is an indispensable tool for
sound design.
To copy a selection:
1.
Click the cursor at the desired location in the audio
document and drag to select the desired range.
2.
Choose Copy from the Edit menu (-C) or
Toolbar.
3.
The selection is copied to the Clipboard.
At this point, you can use the Paste, Insert, or Duplicate
commands to place the copied audio into an audio
document.  Each of these commands is explained below.
Pasting Audio
The Paste command (-V) allows you to paste the
contents of the Clipboard into a location that you choose
by placing an insertion point.  Pasting audio deletes any
selected audio and inserts the clipboard audio at the
insertion point.  Blending can be used with the Paste
command if you have made a selection – the pasted
Peak 6 User's Guide
86


##### Replacing Audio


##### Inserting Audio


##### Duplicating Audio

<!-- p.87 -->
audio will be crossfaded with the audio on either side of
the selection according to the Blending Envelope and
Blending Envelope Duration settings.
By cutting and pasting pieces of audio, you can freely
rearrange material in an audio document.  In musical
applications, this gives you the freedom to entirely
"rewrite" compositions by changing the order of things,
repeating desired sections, and so on.  In sound design
applications, this gives you the power to "compose" with
sound by creating audio collages.
To paste audio into an audio document:
1.
Click the cursor at the point where you wish to
paste the audio data in an audio document or make
a selection of audio you want to delete and replace
with the contents of the clipboard.
2.
Choose Paste from the Edit menu (-V) or
Toolbar.
The Clipboard contents are pasted into the audio
document(s), beginning immediately after the insertion
point.  Any selected audio at the location of the paste is
overwritten when the pasted data is inserted into the
audio document.
Replacing Audio
The Replace command allows you to paste audio data
over existing audio – to paste audio into an audio
document without pushing all data to the right of the
insertion point farther to the right (later in time) to
accommodate the newly pasted audio.  The Replace
command is useful for "laying over" a portion of audio
while maintaining the timing of the original document.
To replace audio into an audio document:
1.
Click the cursor at the point where you wish to
replace the audio data in an audio document.
2.
Choose Replace from the Edit menu or Toolbar.  All
data to the right of the replaced audio maintains
their time position.
Inserting Audio
The Insert command (-D) allows you to paste audio
data into an audio document without overwriting any
existing data at the insertion point.  When you paste data
with the Insert command, all data to the right of the
insertion point or selection start is pushed farther to the
right (later in time) to accommodate the newly pasted
audio.  The Insert command is one of Peak's most useful
tools for restructuring the contents of an audio
document.  It is particularly good for "composing on the
fly" since it allows you to cut and insert pieces of audio –
musical phrases, riffs, or simply textural sounds – to
create a composition or soundscape.
To insert audio into an audio document:
1.
Click the cursor at the point where you wish to
insert the audio data in an audio document.
2.
Choose Insert from the Edit menu (-D) or
Toolbar.  All data to the right of the insertion point
is pushed farther to the right (later in time) to
accommodate the newly pasted range.
Duplicating Audio
The Duplicate command has a number of different
behaviors, depending on whether you are working in an
audio document or in a Playlist.  The behavior in Playlists
is covered in Chapter 6: Playlists – this section covers the
behaviors of the Duplicate command in audio
documents.
If no selection is made when this command is invoked,
the Duplicate command allows you to paste multiple
copies of audio data into an audio document without
overwriting any existing data at the insertion point.
When you paste data with the Duplicate command, all
data to the right of the insertion point or selection start
is pushed farther to the right (later in time) to
accommodate the newly pasted audio.  The Duplicate
command allows you to specify how many times you
would like to Duplicate the audio data contained in the
clipboard.  The Duplicate command is very useful for
Chapter 5:  Editing
87
5


##### Cropping a Selection


##### New Document from Selection


##### Silencing a Selection

<!-- p.88 -->
creating longer audio documents that need to repeat a
certain piece of audio, such as creating a 4 bar drum loop
out of a 1 bar drum loop.
To Duplicate audio:
1.
Select a range of audio, and choose Copy from the
Edit Menu (-C).
2.
Click the cursor at the point you wish to insert
duplicate copies of the audio selected in step 1.
3.
Choose Duplicate from the Edit menu.
4.
Use the Duplicate slider to indicate how many
copies should be inserted, or type in the number of
desired copies.
5.
Click the OK button.  All data to the right of the
insertion point is pushed farther to the right (later
in time) to accommodate the newly pasted range.
If there is a selection in the waveform when the
Duplicate command is invoked, then Peak automatically
fills the selection with the Clipboard contents.  Peak
determines how many times the Clipboard contents
must be duplicated in order to fill the selection.  If the
selection is not evenly divisible by the duration of the
Clipboard contents, Peak includes a fraction of the
Clipboard contents to make the duplication completely
sample accurate to the original selection.
To Duplicate audio to fit a Selection:
1.
Select a range of audio, and choose Copy from the
Edit Menu (-C).
2.
Select a range of audio that will be the "target", and
will be filled with the Clipboard contents.
3.
Choose Duplicate from the Edit menu – Peak fills
the selection with as many copies of the Clipboard
contents as possible, and fraction of Clipboard
contents if there is not enough space left in the
selection for another duplicate of the full Clipboard
contents.
Cropping a Selection
The Crop command (-`) allows you to make a
selection in an audio document and quickly remove all
other audio from the audio document except the
selection.  The Crop command is a particularly useful
tool for editing material to be used as samples or sound
effects, since it allows you to isolate and save just the
desired portion of a recording.
To crop a selection:
1.
Click the cursor at the desired location in the audio
document and drag to select the desired range.
2.
Choose Crop from the Edit menu (-`).  All audio
but the selection is removed from the audio
document.
New Document from Selection
The New Document from Selection command will
automatically create a new Audio Document containing
the selected audio from the source document.
To create a new document from a selection:
1.
Make a selection in any open audio document that
you want to have as its own document.
2.
Choose Document from Selection from the New
submenu under the File menu (Control-N).
3.
A new audio document will be created with the
selected audio.
Silencing a Selection
The Silence command (-E) replaces the selected
portion of an audio document's waveform with silence.
This feature is very useful for silencing nonessential
portions of a recording that contain an unusual amount of
noise.  This can be used very successfully with spoken
material such as dialog or narration to remove noise
between words or during pauses in speech.  It can also be
used to remove pops or clicks that occur in such material.
Peak 6 User's Guide
88


##### Inserting Silence into a Document


##### Repairing Clicks & Pops

<!-- p.89 -->
To silence a selection:
1.
Click the cursor at the desired location in the audio
document and drag to select the desired range.
2.
Choose Silence from the Edit menu (-E) – the
selected audio is replaced with silence.
Inserting Silence into a Document
The Insert Silence command allows you to insert a
specific amount of silence into an audio document at the
current insertion point.  This feature is very useful for
inserting pauses of a desired duration into a recording,
and can be particularly useful in adjusting the timing or
rhythm of spoken material such as dialog or narration.
When you choose this command, Peak will prompt you
to enter the amount of silence you wish to insert.  You
can enter this value in samples, milliseconds, or seconds.
All audio occurring after the insertion point is moved
later in time by the amount of the silence that you insert.
To insert silence of a specific duration into a document:
1.
Click the cursor at the desired location in the audio
document.
2.
Choose Insert Silence from the Edit menu.
3.
In the dialog that appears, enter the amount of
silence that you wish to insert into the audio
document – Peak inserts the specified amount of
silence into the document.
Repairing Clicks & Pops
Clicks & pops are common artifacts in digital audio –
they occur in various ways, such as:  performing
cut/copy/paste-type edits at non-zero crossings in the
audio waveform, editing without Blending enabled,
recording vinyl records, faulty recording equipment or
cables, digital sync problems, etc.  There are two main
categories of clicks that Peak's tools can repair.
When editing audio with Peak, it is unlikely that
you will introduce new clicks and pops because of
its Auto Snap (to Zero) option.  When Auto Snap
(to Zero) is turned on (which it is by default), any
selections made are automatically snapped to the
closest zero crossing in the waveform, where the
audio is at zero amplitude.  This ensures that you
do not inadvertently introduce a click or pop
when performing cut/copy/paste type edits.
Analog clicks such as those found in digital recordings of
vinyl records – are caused by scratches or other surface
imperfections on a record.  This type of click usually
appears in the audio waveform as an abrupt, jagged
anomaly.
Digital clicks are generally caused by digital sync
problems with audio hardware interfaces, bad digital
cables, or recording with improper buffer settings.  This
type of click generally has a square shape to it.
Chapter 5:  Editing
89
5
The Insert Silence dialog
Example of a digitized scratch on a vinyl record
Example of a digital click

<!-- p.90 -->
Peak's Pencil Tool can repair either type, though in the
case of digital clicks you may want to use the Repair Click
and Repair Clicks DSP tools, which are specifically
designed for this purpose (more information on Repair
Click and Repair Clicks is available in Chapter 8:  DSP).
In either case, to use the Pencil Tool, you must be
zoomed in to sample level (sample level being the first
zoom level at which you can see individual audio
samples) or beyond.  Additional information on settings
for the Pencil Tool is available in Chapter 3:  Peak Basics.
To repair a click with the Pencil Tool:
1.
Locate a click in the audio waveform – it will
appear as an abrupt "spike".
2.
Using your mouse, place Peak's insertion point/
cursor directly over the "spike".
It is useful to place a marker over a click, and
then zoom in to repair it using the Pencil Tool.
Markers are covered in detail later in this chapter.
When you are zoomed in to allow viewing the
waveform in detail, it is very easy to scroll past a
click – having a marker in place makes it easy to
locate the click, should you lose your place.
When placing the cursor over a  click, you may
notice that it jumps to one side or the other.  This is
due to the Auto Snap option being enabled, and
Peak trying to move the cursor to the closest zero
crossing in the waveform.  You may want to disable
the Auto Snap option for this type of work – it can
be disabled by selecting it from the Options menu.
3.
From the Action menu, select Zoom at Sample
Level – you should now be able to see the
individual samples that make up the click.
4.
In the tool area of the audio document window,
select the Pencil Tool.
5.
Click into the waveform, and "draw" across the
anomaly, trying to approximate the shape of the
waveform on either side of the click.  When you
have repaired the click, don't forget to switch back
to the Arrow Cursor.
Peak 6 User's Guide
90
Place the insertion point cursor as close to the click as possible, so you
can easily locate it when zoomed in.
Draw across the click, trying to approximate the shape of the
surrounding waveform.
This picture shows the repaired click, which now blends smoothly into
the surrounding audio.


#### Show Edits


#### Using Crossfades & Blending to Smooth Edits

<!-- p.91 -->
Show Edits
When you enable the Show Edits command, Peak
indicates areas of an audio document that you have
edited by enclosing these areas with hatched lines.  This
provides you with a convenient visual reference to
portions of the document that have been affected by your
editing actions.  Once you save a document, the edits are
saved, and these indicators will no longer appear.
To Enable Show Edits:
•
Choose Show Edits from the Options menu.  A
check next to this item indicates it is enabled.
To Disable Show Edits:
•
Choose Show Edits again from the Options menu.
The absence of a check next to this item indicates
it disabled.
Using Crossfades and Blending to
Smooth Edits
Blending is an automatic crossfade function with a usereditable envelope.  Peak can apply blending to areas of
an audio document where they are modified by cutting,
deleting, pasting, or other editing processes in order to
smooth abrupt transitions between waveform
amplitudes.
It can be very useful for creating a smooth transition
between edits that would otherwise sound too abrupt.  If
you are going to edit (i.e., Cut, Copy, Paste, Delete, etc.)
a document, you may wish to enable blending to smooth
things out a bit.  You can toggle blending on or off by
clicking the Blend enable/disable button in the audio
document window, or by pressing the Caps Lock key on
your keyboard.
Be aware that Blending can interfere with certain
DSP processes available under Peak's DSP menu,
such as Fade In/Out and Normalize.  You will
typically only want to enable Blending only when
you intend to make an edit in which Blending
may be desirable.
To enable blending:
•
Click the blending button in the audio document
window, or press the Caps Lock key on your
keyboard.  The blending button will light up in blue
when blending is turned on.
To disable blending:
•
Click the blending button in the audio document
window, or press the Caps Lock key on your
keyboard.  The blending button will not be
illuminated when blending is turned off.
To set blending parameters:
1.
Choose Blending in Peak's Preferences panel.
2.
Enter a value in milliseconds in the Duration field.
Peak will apply a crossfade of this duration across
the edit.
3.
If you wish to edit the shape of the crossfade that
the blending function applies, click the Edit
Blending Envelope.
Chapter 5:  Editing
91
5
The Blending Enable/Disable button in the audio document window
The Blending dialog


#### Creating Fade Ins & Fade Outs

<!-- p.92 -->
4.
Peak's Crossfades are calculated logarithmically to
preserve volume levels for crossfaded material.  If
you want Peak to calculate the Blending Crossfade
linearly, check the Linear Blend Calculations
checkbox.
5.
Click OK when you have finished.
To quickly access the Blending Envelope editor,
press the Option key while clicking the Blending
button in the tool area at the upper right of an
audio document window.
To select and edit the blending envelope:
1.
Choose Blending in Peak's Preference panel and
click the Edit Blending Envelope button.  The
Blending Envelope Editor appears.  The envelope
shape shown here represents the shape of the
crossfade.  Peak also comes with several commonly
used preset envelopes that appear in the pop-up at
the top of all of Peak's Envelope Editing windows
(see also Editing a Fade In/Out Envelope).  These
are stored in the Peak Envelopes folder in the
Preferences folder of your home directory.
2.
Click anywhere in the envelope area and a new
moveable "breakpoint" will appear.
3.
Drag the breakpoint to the desired location.
4.
Continue creating and dragging breakpoints until
you have created the envelope that you desire.  If
you wish to delete a breakpoint, click on it with the
cursor and press the Delete key on your computer
keyboard.
5.
If you wish to reverse the shape of the envelope
you have created, click the "<->" button.  This
creates a mirror image of the envelope.
6.
If you would like to save your custom envelope for
later use, click on the Save button before exiting
the envelope editor.
If you save your custom blending envelope into:
/MacHD/Users/<YourUserAccount>/Library/
Preferences/Peak Envelopes/
It will automatically appear in the Envelope popup menu it the Blending Envelope editor.
7.
When you are satisfied with your new envelope
shape, click Change to confirm your edits and close
the envelope editor.  Peak will use this envelope
until you change it again.
Note that the Blending Envelope will only be
applied to an edit if it is configured prior to
making the edit.
If Linear Blend Calculations is checked in the
Blending dialog, the Equal Power X-fade envelope
is very effective for a smooth crossfade that will
not result in a dip in the energy of the audio data.
Creating Fade Ins and Fade Outs
Peak allows you to create fade-ins or fade-outs at any
point in an audio document.  Fade ins/outs can be very
useful for smoothly fading in or out of an audio
document, or for fading out of one type of audio material
into another.  Very short fade ins can also be useful for
Peak 6 User's Guide
92
The Blending Envelope Editor


##### Editing a Fade In/Fade Out Envelope

<!-- p.93 -->
smoothing or removing clicks and pops in a recording.
Peak allows you to control the exact "shape" of the fade
in/out by providing you with preset envelope shapes as
well as very precise user-definable envelope controls for
the fade.  Peak also comes with several commonly used
preset envelopes that appear in the pop-up at the top of
the Envelope Editing windows.  These are stored in the
Peak Envelopes folder in your Peak folder.
To create a Fade In:
1.
Click the cursor at the desired location in the audio
document and drag to select the range you desire.
The Fade In will be applied to the audio within this
selection.
2.
Choose Fade In from the DSP menu, or click the
Fade In button in the Toolbar.  Peak applies the
Fade In to the selection you have made in the
audio document.
3.
To hear the completed Fade In, press ControlSpacebar.  You will hear the selected audio
complete with your Fade In.
To create a Fade Out:
1.
Click the cursor at the desired location in the audio
document and drag to select the range you desire.
The Fade Out will be applied to the selected audio.
2.
Choose Fade Out from the DSP menu, or click the
Fade Out button in the Toolbar.  Peak applies the
Fade Out to the selection you have made in the
audio document.
3.
To hear the Fade Out, press Control-Spacebar.  You will
hear the selected audio complete with your Fade Out.
Editing a Fade In/Fade Out Envelope
Peak allows you to control the exact shape of Fade
Ins/Outs by providing you with controls for editing the
Fade In/Out envelope.  These are found in the Fade In
Envelope and Fade Out Envelope sections in the
Preferences panel.
To edit and save a Fade In/Fade Out envelope:
1.
Choose Fade In Envelope (or Fade Out Envelope)
from the Preferences panel.  The Fade Envelope
Editor appears.  The envelope shape shown here
represents the shape of the fade, and overlays the
selected audio to show where the curve is
graphically applied to the waveform representation
of the audio.
2.
Click anywhere in the envelope area and a new
moveable "breakpoint" will appear.
3.
Drag the breakpoint to the desired location on the
envelope's curve.
4.
Continue creating and dragging breakpoints until
you have created the fade envelope that you
desire.  If you wish to delete a breakpoint, click on
it with the cursor and press the Delete key on your
computer keyboard.
5.
If you wish to reverse the shape of the envelope
you have created, click the "<->" button.  This
creates a mirror image of the envelope.
Chapter 5:  Editing
93
5
The Fade Envelope Editor (a Fade In is shown)


#### Working with Markers


##### Creating Markers

<!-- p.94 -->
6.
If you would like to save your custom envelope for
later use, click on the Save button before exiting
the envelope editor.
If you save your custom Fade In/Out envelope
into:
/MacHD/Users/<YourAccount>/Library/
Preferences/Peak Envelopes/
It will automatically appear in the Envelope popup menu it the Fade In/Out Envelope editor.
7.
When you are satisfied with your new envelope
shape, click Change to confirm your edits and close
the envelope editor.  Peak will use this envelope
every time you apply a Fade In (or Fade Out) until
you change it again.
To quickly access the Fade Envelope editor, press
the Option key while clicking the Fade In/Out
buttons in the toolbar, or while picking these
commands from the DSP menu.
Note that the Fade In/Fade Out Envelope will only
be applied to a selection if it is configured prior to
applying the Fade In/Fade Out DSP function.
To load a Fade In/Fade Out envelope:
1.
Choose Fade In Envelope (or Fade Out Envelope)
from the Preferences panel.  The envelope editor
appears.
2.
Click the Load button.
3.
In the dialog that appears, locate and select the
fade envelope that you desire, and click Open.
4.
Click Change to confirm this new envelope and
close the envelope editor.  Peak will use this
envelope until you change it again.
The steps above for loading a custom envelope
apply only if you have saved a custom envelope
outside of the Peak Envelopes folder, for example,
if you have saved custom envelopes with a project
that will be transferred to another Peak user.
Otherwise, you may simply choose the desired
envelope from the Envelope pop-up menu in the
Fade In/Out Envelope editor dialog.
Working with Markers
Peak has a very powerful set of features to control the
placement and modification of markers.  Markers are
locations in an audio document that you define as
important.  By marking specific locations in a recording,
you can navigate easily to a location for selection, editing
or playback purposes.
Markers can also be made into loops.  Loops are used to
sustain or repeat a section of audio.  They can be used for
material that you intend to transfer to a sampler, or
simply for playback within Peak itself.  Peak allows you to
create one loop per audio file.  Loops are covered in
detail later in this chapter.
Creating Markers
The next few pages describe in detail the various
ways to create markers – by dropping them "on the
fly" during playback, inserting them during recording
with Notepad Cues, defining them with the mouse
when playback is stopped, creating markers using the
Threshold DSP command, or using the Markers from
Tempo command to insert multiple markers at
Peak 6 User's Guide
94
A waveform with a Marker

<!-- p.95 -->
regular intervals.  Of the various ways to create
markers, the mouse method is perhaps the more
precise.  However, since it is possible to fine tune the
location of a marker at any time by dragging it, (or by
using the Edit Marker dialog, explained later) all
methods work equally well – the method you choose
to insert markers will depend largely on the task at
hand.
Remember that if Auto Snap is enabled the
insertion point will snap to the nearest
selected Snap To unit.  This will cause your
marker to be placed at the nearest Snap To
unit when you use the mouse to create or place
a marker.
Once you have created a marker, you can assign or edit
the marker's attributes in the Edit Marker dialog.
Double-click the triangular base of the marker to open
the Edit Marker dialog.
Text
You may wish to give markers meaningful names (up to
256 characters long) based on their locations in an audio
document.  Peak gives markers default numeric names
based on the name of the audio document and the order
in which the marker was defined.  To name or rename a
marker, simply type the new name in to the Text field of
the Edit Marker dialog.
You can easily find any marker, Region, or loop
that you have named by simply typing the first few
letters of its name.  For example, if you want to
locate a marker called "Solo," just type the letters
"s"-"o"-"l", and Peak will automatically scroll to
the marker called "Solo." If you hit Enter or
Return after typing the characters, Peak will also
automatically place the insertion point at that
marker.  If more than one marker matches the
letters you type in, Peak will locate the first
marker with that name.  (Note that numerical
marker name entries will only work from the
keypad, not the numbers keys along the top of
your keyboard.)
If you re-name the first marker in a document to
"1" – then all subsequent markers will be
automatically named "2", "3", "4", and so on.  You
can then quickly locate to the desired marker by
typing its number on the numeric keypad (the
numbers at the top of the keyboard serve another
purpose) and pressing Enter.
Marker Position
The Marker Position field allows you to move a marker to
a specific time location in an audio document by entering
the desired value.  The pop-up menu to the right of this
field allows you to choose a time format (samples,
Minutes:Seconds:Miliseconds, etc.) for the value that you
enter in the Marker Position field.
Marker, Loop Start, and Loop End
These three radio-style buttons allow you to define
whether the marker is a regular marker or a loop
marker.  If you choose to designate the marker as loop
marker, you can define it as either the loop start or the
loop end by clicking on the corresponding radio
button.
Chapter 5:  Editing
95
5
The Edit Marker dialog

<!-- p.96 -->
Anchor To Sample Checkbox
When you insert or delete audio that is near a marker,
you may want the marker to move with that particular
location on the waveform.  This will compensate for the
insertion or deletion, so that the marker remains with
the particular portion of audio you want it to be
associated with.  By enabling the Anchor feature for a
marker, you can assure that Peak will "tie" the marker to
a location on a waveform, causing it to stay with that
location even when audio is inserted or deleted into the
document.  By default, Peak enables this feature for
markers, loops and Regions.
Be a Reference Marker Checkbox
By defining a marker as a reference marker, you can use
the marker as a reference when you make selections or
move other markers.  Selecting or dragging the marker
will then automatically display the distance to the closest
reference marker in whatever time format (Samples or
Seconds) is currently selected in the Peak application.
This may be useful, for instance, if you know that you
want a particular sound event (such as a car door slam)
to happen a certain number of seconds before or after
another sound event (such as a tire squeal).
Delete Marker button
The Delete Marker button allows you to remove the
currently selected marker from an audio document.
The following section explains how to create markers
and define their attributes.
To create a marker when playback is stopped:
1.
Click the mouse at the desired location in the
audio document – a dotted vertical line appears,
indicating the insertion point.
2.
Press -M on your computer keyboard or choose
New Marker from the Action menu or Toolbar –
Peak places a marker at that location.
To create a marker during playback:
1.
Begin playback of an audio document.
2.
At the desired point during playback, press -M
on your computer keyboard.  Peak will drop a
marker at that location.
3.
Repeat as desired as playback continues.  Each
marker will appear at the appropriate location in
the audio document window.
To create a marker during recording:
1.
Open the Record dialog.
2.
Check the Notepad checkbox.
3.
Begin recording.
4.
Press the Return key to place a marker – then type
a name for the marker.  To place another marker,
press the Return key and type a name for the
second marker, and so on.
Pressing the Return key first, and then typing the
marker's name ensures that markers are placed
accurately – for instance, if an error was made
when typing in the marker's name, it might take
longer than anticipated to enter the corrected
name, and the marker would be placed later in
time.  By pressing the Return key first, and then
typing the name, you can be sure that the marker
is placed in the correct location.
To create a marker using dynamic scrubbing:
1.
Hold down the Control key (or Control-Option for
jog-type scrubbing) and drag the mouse across the
desired location to scrub playback.
2.
At the desired point during playback, release the
mouse to stop scrubbing.
3.
Press -M on your computer keyboard.  Peak will
drop a marker at that location.
Peak 6 User's Guide
96


##### Deleting Markers

<!-- p.97 -->
To name a marker or set other marker attributes:
1.
Double-click on the triangular base of the marker that
you wish to edit.  The Edit Marker dialog appears.
2.
Enter a name for the marker.
3.
Change other attributes of the marker as desired.
For an explanation of each of these attributes, refer
to the beginning of this section.
4.
When you have finished, click OK to close the Edit
Marker dialog – the marker now has the attributes
you selected.
or:
•
You may also open the audio document's Contents
Drawer and click the desired marker's name – it will
become editable text and can be re-named.  When you
press the Return key, the marker's name is updated.
To move a marker to a new location:
1.
Click on the triangular base of the marker and drag
it to the desired location.
2.
To make a marker's position snap to a zerocrossing (the point at which a waveform crosses
the center phase line) as you drag it, hold down
the Shift key while you drag.
To move a marker to a new location numerically:
1.
Double-click on the triangular base of the marker.
The Edit Marker dialog appears.
2.
Choose the desired time units (Samples, Seconds, or
Milliseconds) from the time format pop-up menu.
3.  In the Position field, enter the precise time location
that you wish to move the marker to.
4.
Click OK to close this dialog – Peak moves the
marker to the location you entered in the dialog.
or:
•
You may also open the audio document's Contents
Drawer and click the desired marker's duration – it will
become editable text and a new value can be entered.
Once the duration is altered and the Return key is
pressed, the marker will snap to the new location.
To nudge a marker or a selection of markers to a new
location:
1.
Make a selection that includes the marker (or
markers) that you wish to nudge.
2.
Choose Nudge Markers from the Action menu or
Toolbar – the Nudge Markers dialog appears.
3.
In the "Nudge Markers By" field, enter the number
of seconds (positive or negative) by which you
wish to nudge the marker.
4.
Click OK to close this dialog – Peak nudges the
marker by the value you entered in the dialog.
Deleting Markers
There are a number of ways to delete markers,
described below.
To delete a marker:
1.
Double-click the triangular base of the marker –
the Edit Marker dialog appears.
2.
Click the Delete button – the marker is deleted
from the audio document.
3.
Click OK to close the Edit Marker dialog.
To delete markers in a Selection:
1.
Make a selection in the audio document that
contains the markers you want to delete.
Chapter 5:  Editing
97
5
The Nudge Markers dialog


#### Working with Regions


##### About Regions & CD Frame Boundaries

<!-- p.98 -->
2.
Choose Delete Markers Only (Option-Delete) from
the Action menu and all markers, Regions, and
loops in the selection will be deleted.
To Copy/Paste only Markers:
1.
Select the desired range of audio, which contains
the markers you wish to copy.
2.
From the Edit menu, choose Copy (-C).
3.
Select a different range of audio (in the same
document or in a different document).
4.
Hold down the Option key, and choose Paste
Markers Only from the Edit menu  – just the
markers are pasted into the current selection.
Working with Regions
Regions are portions of an audio document defined by Region
Markers using the New Region command from the Action
menu (-Shift-R) or Toolbar.  Regions present in currently
open audio documents will be listed in the Contents window.
Regions can be saved only into AIFF, Sound Designer II, and
WAVE files.  However, Peak will also read Regions stored from
other programs in Sound Designer II files.  The method Peak
uses to store Regions in AIFF files is specific to Peak and is
not necessarily supported by other software applications.  If
you are using Regions with other programs, you will want to
store your files as Sound Designer II or WAVE files.
To define a new Region:
1.
Make a selection in an opened audio document.
2.
Choose New Region from the Action menu (-
Shift-R) or Toolbar.
3.
Type the name of the Region and click OK.  The
new Region will appear in the audio document.
About Regions and CD Frame Boundaries
If you are creating Regions that will be used in a Peak
Playlist – and will eventually be burned as individual
tracks on a Red Book CD, be sure to set Peak's Snap to
format to CD Frames (Action Menu>Snap To).  In
addition, make sure that Auto Snap is active prior to
creating these Regions (Auto Snap can be turned on/off
in the Options Menu).
Creating Regions on CD frame boundaries is most
important when working with continuous play audio
material, such as a DJ mix or live concert recording,
where one track plays into the next with no gaps.  By
creating Regions on CD frame boundaries, you can be
assured that the audio CD you create will not have short
gaps or clicks between tracks.
If you have already created Regions, and had the Snap To
format set to a different value, or did not have Auto Snap
turned on, you can easily edit the Region marker position.
To conform Regions to CD frame boundaries:
1.  From the Options menu, check that Auto Snap is
enabled (a check appears next to the menu item
when active).
2.
From the Action menu, choose Snap To, and CD
Frames from the submenu.
3.
Shift-drag a Region marker, and it will snap to the
closest CD Frame boundary.
If you created multiple back-to-back Regions (for
example, with the Markers to Regions command),
but were not in Snap To CD Frames mode, you can
quickly adjust the end of one Region and the
beginning of the next simultaneously by clicking
the Vertical Lock button in the audio document's
Tool Area, and then following the steps above.
Peak 6 User's Guide
98
An audio Region (named "My Region")

<!-- p.99 -->
To modify the length of the Region by changing the start
or end:
•
Drag the start or end marker of the Region in the
audio document window.
To move a Region without changing its length:
•
Hold down the Option key and drag either the start
or end marker of the Region.
or:
•
Click the Horizontal Lock button in the tool
area of the audio document window, and then
drag either the start or end marker of the
Region.
To edit a Region's start, end, or length manually:
1.
Double-click on either the start or end marker
of the Region in the audio document window.
The Edit Region dialog will appear.
2.
Enter new values for Start, End, or Length times,
then click OK.
To change the name of a Region:
1.
Double-click on either the start or end marker of
the Region in the audio document window.  The
Edit Region dialog will appear.
2.
Type the new name of the Region into the dialog
and click OK.
or:
•
You may also open the audio document's drawer
and click the desired marker's name – it will
become editable text and can be re-named.  When
you press the Return key, the marker's name is
updated.
To locate a Region:
•
Double-click the Region's name in the Contents
Window or in the audio document window's
Contents Drawer.  The Region will automatically
snap into view, with the Region selected.
or:
•
Type the first few letters of the Region's name, and
the Region will snap into view automatically.
Please note that if multiple Regions share similar names,
such as "TheIntro" and "TheEnd", you would need to
type at least one character beyond "t-h-e-" for Peak to be
able to distinguish between these similar names.  If you
plan on using this technique to locate to Regions, it is
recommended that you not use spaces in the Regions'
names, as when you attempt to locate to them, pressing
the Space Bar on your keyboard will initiate playback.
Chapter 5:  Editing
99
5
By using Vertical lock mode, you can snap the end of one Region and
the beginning of the next simultaneously.
Note the position of the end of "Region A" and the beginning of
"Region B" – located at a peak in the waveform.
The end of "Region A" and beginning of "Region B" have been
"snapped" to the closest CD frame boundary.
The Edit Region Dialog


##### Renaming Markers & Regions

<!-- p.100 -->
To split a Region:
1.
Place insertion point cursor at the the desired
location.
2.
Choose New Region Split (Ctrl-Shift--R) from the
Action menu.  The cursor's position determines
the split point.  Any part of the document before
the split point becomes one Region, and any part
after the split point becomes another Region.
To Copy/Paste only Regions:
1.
Select the desired range of audio, which contains
the Region markers you wish to copy.
2.
From the Edit menu, choose Copy (-C).
3.
Select a different range of audio (in the same
document or in a different document).
4.
Hold down the Option key, and choose Paste
Markers Only from the Edit menu  – just the
Region markers are pasted into the current
selection.
Renaming Markers & Regions
The Rename dialog allows you to rename multiple
markers and/or region markers.  This dialog is broken up
into two sections, the "Find" section and the "Rename"
section.
Find Section
This section allows you to specify whether you are
affecting markers, regions, or both, as well as whether
you are affecting all markers/regions, or just those
containing a particular string of text.
Markers and regions are found and renamed
chronologically, as they appear along the
audio document's timeline.  If you have
created markers and then changed their
positions, they will renamed according to their
new positions.
Rename Section
This section allows you to specify how markers and
regions will be renamed and/or renumbered.
•
Rename Field – Adding a text string here changes
the names of all found markers to this text string.
For example, adding "PeakPro" here would result
in all found markers being renamed "PeakPro".
•
"#" Character – Adding the # character in the
Rename field, and a letter or number in the
Start field adds letters or numbers sequentially
to the renamed marker or region names.  For
example, if "PeakPro" was added in the Rename
field, with a "#" directly following it, and the
number "1" was added in the Start field, the
resulting markers/regions would be named
"PeakPro1", "PeakPro2", "PeakPro3", "PeakPro4"
and so on.
•
"0" Character – Adding the "0" character (zero)
after the # character allows you to control leading
zeros.  For example, rename to "Event #000" start
with "10" produces  markers/regions named "Event
010", "Event 011", "Event 012", etc.
The "0" character only works with the numbers,
not letters, and only up to 9 leading zeros may be
used.
Peak 6 User's Guide
100
The Rename Dialog


##### Exporting Regions

<!-- p.101 -->
To Rename a Series of Markers/Regions:
1.
Make a selection in the audio document containing
the markers/regions you wish to rename (or Select
All for the entire document).
2.
From the Action menu, choose Rename.
3.
Use the Markers and Regions checkboxes to
specify which type of markers should be renamed.
4.
Use the radio button that best suits how you wish
to rename – the All Selected radio button will apply
renaming to all markers/regions that lie in the
selected portion of the audio document, while the
Containing the Text radio button will apply changes
only to markers/regions that contain a specific text
string.
5.
In the "Rename to" field, enter a new name.
6.
If you wish to have this new name appended with
a letter or number, also enter the "#" character in
the Rename field, and then enter the desired
starting number or letter in the Start field.
7.
Click OK – the selected range of markers is
renamed.
Exporting Regions
Regions may be exported from an audio document using
the Export Regions dialog, or by manually dragging them
from the Contents palette or drawer to the Finder, or to
other applications, such as iTunes.
Exporting with the Export Regions Dialog
If you have placed markers or Regions in an audio
document, Peak's Export Regions command allows you
to export those Regions from the source document and
save each of these Regions as a separate audio
document.  This feature is very convenient if you wish to
divide a larger file into Regions and transfer them as
samples into a sample playback instrument, or divide a
live concert record into Regions and export those
Regions as separate files.  Furthermore, you can use
Peak's Batch File Processor to process a file's Regions
with any of Peak's DSP functions and third party plug-ins
during the automatic exporting of Regions into new files.
To export Regions from an audio document:
1.
Select the Regions that you wish to export.  (To
make selections, you can use the Tab key, Shift-Tab,
or if you wish to select the entire document, press
-A.)
2.
Choose Export Regions from the File menu.
3.
In the Export Regions dialog, choose the
parameters that you wish to use for selecting the
Regions to export.
4.
Using the Region Detection options, choose which
Regions are to be exported.
5.
Using the Output Format options, choose the
format and resolution you wish for the exported
Regions.
6.
Using the Output Directory options, choose the
destination for the exported Regions.
7.
If you wish the newly exported Regions to appear
as new open Peak documents, choose Output to
new windows.
Chapter 5:  Editing
101
5
The Export Regions dialog


#### Send to iTunes

<!-- p.102 -->
8.
To save the exported Regions to disk, select Save To
Disk and choose whether you would like to save
the Regions into the same folder as the source files,
or to a different folder.  If you prefer to save to a
new folder, use the Set Path button.
9.
To export the Regions, click Begin.  Peak exports
each of the Regions into its own audio document.
Region Detection area – To export all Regions in an audio
document, click the Export Regions button.  To export
audio between adjacent markers, click the Export Audio
between Markers button.  To export only Regions that
are bounded by specific marker names, click the Only
Regions button and enter the parameters that you wish
to use to select the desired Regions.  For instance, if you
wish to export only Regions bounded by markers with
the word "hit" in them, click the pop-up menu, choose
containing, and type the word "hit" in the field next to
the pop-up.  Conversely, if you wish export all Regions
except those with the word "hit" in them, click the popup menu, choose not containing, and type the word
"hit" in the field next to the pop-up menu.
Output Format area – Choose the file format, bit depth
resolution, and Stereo or Mono from these pop-up
menus for the resulting exported audio documents.  You
can set the Sample rate in kHz for the resulting files in the
Rate field.  You can also designate whether the resulting
audio documents contain Regions or Markers or not.
Output Directory area – Resulting audio documents can
either be output to new open audio document windows
or saved to the hard drive.  Choose Output to New
Windows if you want to have the resulting audio
documents open in Peak or choose Save To Disk if you just
want to write the new audio files to disk without opening
them in Peak.  If you Save To Disk, you can simply choose
to use the original audio document's folder or you can
specify another folder on your hard drive(s) to save the
resulting audio documents by choosing Set Path.  The
Name Prefix field allows you to include a specified prefix
to all the resulting audio documents.  The default prefix is
the name of the file.  Each and every one of the resulting
audio documents will be named with the prefix plus the
name of the individual Region.
Another exciting feature of the Export Regions function
is that you can Export Regions through Peak's Batch File
Processor.  First configure the Batch File Processor and
turn it on, then, go to Export Regions and check the Use
Batch File Processor checkbox.  When you begin
exporting Regions, each one will be affected by the
processes you choose in the Batch File Processor dialog
(see Chapter 8: DSP & Chapter 9: Plug-Ins).
Do not save the output of the Batch File Processor
to the input directory (i.e., the same directory that
contains the files being batch processed).
Export Regions is not available in Peak LE.
Send to iTunes
Entire audio documents and/or the Regions they contain
may be exported directly to your iTunes library.  This is a
useful command if you plan to export Regions and then
add them to your iTunes library, as Peak can do this
automatically.
To send an audio document to iTunes:
1.
Open and/or bring the desired audio document to
the foreground.
2.
From the File menu, choose Send to iTunes.
3.
To send the entire audio document as a single file,
click the Single Song button – or, if the audio
document contains Regions, and you wish for each
Region to be sent to iTunes as a separate song, click
the iTunes Playlist button.
Peak 6 User's Guide
102
LE


#### Working with Loops

<!-- p.103 -->
Working with Loops
If you're editing music or other rhythmically-based
material, it is generally a good idea to test a selection to
make sure it contains an even number of beats before
you cut, copy, or paste it.  A good way to do this is to
loop the selection and listen to the loop as it plays.  As
described in the next section, Peak includes Loop
Surfer, which can automate the process of finding a
rhythmically "correct" length of audio to loop,
assuming you know the tempo and the number of beats
you wish to loop.  You can also use the Loop Tuner,
found in the DSP menu, to adjust the loop start and end
points.  The Loop Tuner is also described in the next
section.
Loops are useful in material that you plan to transfer to a
sampler.  Loop markers created with Peak are recognized
by samplers as sustain loops.  Peak allows you to create
one loop per audio document.
When using a single loop per audio document,
there is a quick and easy way to mark multiple
desired sections for looping.  With the loop
markers in the desired location, choose Select
Loop from the Edit menu, then, choose New Region
from the Action menu – a Region is created that is
the same length as the loop.  Using this technique
allows you to create as many Regions as desired
within a single audio document.  To loop any of
these Regions, simply -click between a Region's
markers to select the Region (or press the Tab key
until the desired Region is selected), and then
choose Loop this Selection from the Action menu.
To play a loop in Peak, select Use Loop in Playback
command (-L) from the Options menu or click the
loop button in the Transport window, begin playback,
and when Peak reaches the loop, it will continue to
repeat until you stop playback.  If Use Loop in
Playback is not enabled, Peak will simply play right
through the loop to the end of the audio document or
selection.
To create a loop from a selection:
1.
Click the cursor at the desired location in the audio
document and drag to select the range you want.
2.
Choose Loop This Selection from the Action menu (-
Shift-"-") or Toolbar.  Your selection is now looped.  Loop
markers appear at the beginning and end of the loop.
3.
To listen to the loop, choose the Use Loop in
Playback command (-L) from the Options menu
(a check next to this menu item indicates it is
enabled), or click the Loop button in the Transport
window, and start playback by pressing the
Spacebar on your keyboard.
4.
You can interactively fine-tune a loop by dragging
the loop start or end markers while loop playback
is engaged.  As you drag a loop marker to a new
location, Peak will adjust the playback loop to
reflect the changes you make.  You can also use the
Loop Tuner to call up a dialog that allows you to
visually fine tune the loop, and even play the loop
while adjusting it to listen to the changes.
To change regular markers into loop markers:
1.
Create markers in an audio document.
2.
Double-click on the triangular base of the marker
that you wish to define as the loop start point.  The
Edit Marker dialog appears.
3.
Click the Loop Start button and click OK.  The
marker becomes a Loop Start marker.
4.
Double-click on the triangular base of the marker
that you wish to define as the loop end point.  The
Edit Marker dialog appears.
5.
Click the Loop End button and click OK.  The
marker becomes a Loop End marker.  You have
now defined a loop in your audio document.
To move a pair of loop markers together:
•
Hold down the Option key and drag one of the
loop markers to the desired location.
or:
Chapter 5:  Editing
103
5


##### Turn Loop Flag On/Off on Save


##### Crossfading Loops

<!-- p.104 -->
•
Click the Horizontal Lock button in the audio
document window, and drag the begin loop or end
loop marker – both markers move in tandem.  Be
sure to turn off Horizontal Lock to move the loop
markers independently.
To listen to the loop only:
1.
Choose Select Loop (-"-") from the Edit menu.
2.
Make sure loop playback is enabled using the Use
Loop in Playback command (-L) from the
Options menu (a check next to this menu item
indicates it is enabled), or by pressing the Loop
button on the Transport.
3.
Press the Spacebar to begin playing back the loop.
Turn Loop Flag On/Off on Save
This feature allows the loop flag in AIFF files to be
turned on or off when saving a file.  The state of this
loop flag when a file is saved determines the file's
playback behavior when loaded into Peak again, or into
another application capable of reading embedded loop
flags.
The loop flag is now toggled on or off when saving,
depending on the state of the Loop Playback setting in Peak.
To Save an AIFF File with the Loop Flag On:
1.
From the Options menu, choose Use Loop in
Playback (-L), or click the Use Loop in Playback
button in the Transport.  A check next to the menu
item, or an illuminated button in the Transport
indicates the loop flag is turned on.
2.
Save the AIFF file – the loop flag is saved in the on
position.
To Save an AIFF File with the Loop Flag Off:
1.
From the Options menu, choose Use Loop in
Playback (-L), or click the Use Loop in Playback
button in the Transport.  The absence of a check
next to the menu item, or a non-illuminated button
in the Transport indicates the loop flag is turned
on.
2.
Save the AIFF file – the loop flag is saved in the off
position.
Crossfading Loops
Peak allows you to crossfade the start and end points
of a loop.  Crossfading a loop can be very useful for
smoothing the transition between the end of the
loop and its beginning as it repeats.  Peak allows you
to control the envelope of the crossfade, the
duration, and other parameters in the Crossfade
Loop dialog.
The Crossfade Loop dialog
The four checkboxes at the top of the Crossfade
Loop dialog allow you to customize how the end of
the loop is faded into the beginning of the loop.
These boxes indicate where in the loop the
crossfade is applied. For most loops, you should be
Peak 6 User's Guide
104
There are two ways to turn Use Loop in Playback on or off – the Use
Loop in Playback button in the Transport, and the Use Loop in
Playback command in the Options menu.
The Horizontal Lock button

<!-- p.105 -->
able to leave the default checkbox checked and get
good results.
Crossfade Variations
If you consider the crossfades "A", "B", "C", and "D" from
left to right, then:
"A" = Crossfade between A and C
"B" = Crossfade between B and D
"C" = Crossfade between C and A
"D" = Crossfade between D and B
The way these crossfade variations are configured
depends on where the loop is destined to be used –
for most purposes the default crossfade position
(Position "C") works well – if however, you plan on
transferring these loops to a sample playback
instrument such as a SMDI sampler, then you may
want to experiment with different crossfade
positions/combinations.  Some hardware based
samplers offer advanced playback controls, allowing
loops to be played forward, backward, and in various
other ways. By changing where in the loop
crossfades are applied, you can customize your
audio content for a particular sampler and for the
desired effect.
Another application that may require using loop
crossfade position(s) other than the default position "C",
are when creating audio loops intended to be used in a
proprietary video game audio engine. Depending on the
requirements of a particular video game's audio engine,
users may need to adjust the position of the crossfades
used in their loops, to achieve the desired effect.
Depending on the application requiring crossfades, users
may need "loop with release" (plays the tail of the audio
document – the section of audio that lies outside the
loop markers – after the loop stops playing/sampler's
key is released) or "loop hold" (doesn't play the audio
after the loop when the key is released). Because of
these different modes, users may need to turn some
crossfades on or off
To crossfade a loop:
1. Create a loop using one of the techniques
explained earlier in this chapter.
2. Choose Crossfade Loop from the DSP menu or
Toolbar.
3. In the Crossfade Loop dialog that appears, enter a
duration for the crossfade-in milliseconds and click
OK.
4. To hear the completed crossfade, choose Select
Chapter 5:  Editing
105
5
The Crossfade Loop dialog
A
D
C
B
Crossfade positioning options – different uses for loops may call for
different loop crossfade settings – With crossfade position "C" checked
a crossfade is applied as indicated by the red "X"


##### Using Loop Surfer

<!-- p.106 -->
Loop from the Edit menu, select Use Loop in
Playback from the Options menu (-L) or click
the Loop button on the Transport, and press the
Spacebar. You will hear the loop, complete with
your crossfade.
To edit a Crossfade Loop Envelope:
1.
Click on the Envelope button in the Crossfade
Loop dialog and the Blending Envelope Editor
appears.
Note that this is the same Blending Envelope Editor
that is accessed from the Blending dialog.
2.
Click anywhere on the line and a new moveable
"breakpoint" will appear.
3.
Drag the breakpoint to the desired location.
4.
Continue creating and dragging breakpoints until
you have created the envelope that you desire.  If
you wish to delete a breakpoint, click on it with the
cursor and press the Delete key on your computer
keyboard.
5.
If you wish to reverse the shape of the envelope
you have created, click the "<->" button.  This
creates a mirror image of the envelope.
6.
If you would like to save your custom envelope for
later use, click on the Save button before exiting
the envelope editor.
7.
When you are satisfied with your new envelope
shape, click Change to confirm your edits and close
the envelope editor.  Peak will use this envelope
until you change it again.
To hear the completed crossfade, choose Select Loop
from the Edit menu, select Use Loop in Playback from
the Options menu or click the Loop button on the
Toolbar, and press the Spacebar.  You will hear the loop,
complete with your crossfade.
If you save your custom Blending envelope into:
/MacHD/Users/<YourAccount>/Library/
Preferences/Peak Envelopes/
It will automatically appear in the Envelope popup menu it the Fade In/Out Envelope editor.
The Crossfade Loop dialog is not available in Peak
LE.
Using Loop Surfer
Peak's Loop Surfer feature automates some of the steps
for setting up loop points.  Loop Surfer allows you to
"Loop Surf" (adjust your loops during playback) quickly,
easily and in a musically intuitive manner.
If you're working with music, and know the music's
tempo in beats per minute, you can use Loop Surfer to
create a loop which lasts for a rhythmically "correct"
length of time.
To use Loop Surfer based on a musical tempo:
1.
Place the cursor where you wish to begin the loop
(it's okay to place it approximately, rather than
exactly, where you wish to start).
2.
Choose Loop Surfer from the Action menu (-J).
The Loop Surfer dialog appears.
Peak 6 User's Guide
106
LE
The Blending Envelope Editor

<!-- p.107 -->
3.
Type in the music's tempo.  If you are not sure of
the tempo, you can use the Tempo Calculator to
determine the tempo.  Simply select a portion of
audio, and type in the number of bars and beats in
the selection.  The calculator will determine the
tempo based on your selection.  If you are unsure,
and have used a drum machine or sequencer to
create the music, you might wish to refer back to
its settings determine the time signature and
tempo.  Additionally, you can use the Threshold
command from the DSP menu to select a portion
of audio that should correspond to the beat; see
"To use Loop Surfer based on a selection" below.
4.
Type in the number of beats that you wish the loop
to last.  The beats are based upon quarter-notes, in
terms of musical time.  For instance, if your song
was in a 4/4 time signature, typing "4" beats would
mean the loop would be one measure in length; if
the song were in 7/4 time, typing "14" would mean
the loop would be two measures in length.  (If you
are interested in exploring syncopations, however,
there's no reason why you can't type a beat value
that doesn't correspond to the time signature, such
as "5" if the music is actually in "3/4" time.)
5.
If you then select the Start Surfing button (the
default), Peak will automatically:
a)
close the Loop Surfer dialog box;
b)
extend the selection from the cursor insertion
point to a calculated length, based upon the tempo
and number of beats;
c)
change the cursor insertion point to a Loop
Start marker;
d)
drop a Loop End marker at the end of the
newly calculated selection;
e)
turn on (if it hasn't already been turned on)
the Use Loop In Playback option under the
Options menu.
f)
begin looped playback of the audio selection,
stopping only once you hit your keyboard's
Spacebar or press Stop on the Toolbar.
6.
If you select the Make Loop button, Peak will
automatically:
a)
close the Loop Surfer dialog box;
b) extend the selection from the cursor insertion
point to a calculated length, based upon the tempo
and number of beats;
c)
change the cursor insertion point to a Loop
Start marker;
d)
drop a Loop End marker at the end of the
newly calculated selection;
e)
turn on (if it hasn't already been turned on) the
Use Loop In Playback option under the Options menu.
f)
At this point, you must start playback manually
using the Spacebar or the Toolbar if you wish to
begin Loop Surfing.
While you're Loop Surfing (adjusting your loop during
playback), you're free to perform all standard looping
functions as described in the previous section, including
adjusting the Loop Start and End points during playback.
Most importantly, you'll now have a selection that lasts
for a rhythmically correct period of time (that matches
the beat).  If you move the markers in tandem, by
holding down the Option key and clicking and dragging
one of the loop markers to the desired location with the
mouse, you'll find it's a great way to set up interesting
rhythms and syncopations! Peak's interactive editing
Chapter 5:  Editing
107
5
The Loop Surfer dialog


##### Making Loops into Regions

<!-- p.108 -->
capabilities also allow you to use the Loop Surfer dialog
while a loop plays to adjust the tempo, beats and so on.
If you're not working with music (or if you simply don't
know the tempo of the music you're working with), you
might choose to Loop Surf based upon a selection (or
use the Threshold feature), rather than starting at a
cursor insertion point.
To use Loop Surfer based on a selection:
1.
Place the cursor where you wish to begin the loop,
and using the mouse, select the portion of audio
you wish to loop.  (You can make your selection in
a variety of other ways, also, as described earlier,
including selecting between markers by -clicking
with the mouse).
2.
Select Loop Surfer from the Action menu.  The
Loop Surfer dialog appears.
3.
If you check the Use Selection box and select
either the Start Surfing or Make Loop button, Peak
will automatically:
a)
close the Loop Surfer dialog box;
b)
extend the selection from the cursor insertion
point to a calculated length, based upon the tempo
and number of beats;
c)
change the cursor insertion point to a Loop
Start marker;
d)
drop a Loop End marker at the end of the
newly calculated selection;
e)
turn on (if it hasn't already been turned on)
the Use Loop In Playback option under the
Options menu;
f)
begin looping and playing.  The selection will begin
looped playback (if you have selected Start Surfing);
or:
g)
wait for you to start playback manually using
the Spacebar or the Toolbar if you wish to begin
Loop Surfing (if you have selected Make Loop).
Making Loops into Regions
As you "Loop Surf", that is, as you move the loop
points simultaneously through an audio document
while audio plays, you may find sections that you
would like to set aside for later.  These sections can be
saved as Regions, which can be used to create a remix
within a Peak Playlist, may be exported as new audio
documents, or used in a loop-based sequencing
application, such as Ableton Live or Apple SoundTrack
or GarageBand.
Since Peak allows only one loop per audio document,
you can turn the loops that you like into Regions.
To create Regions from Loops:
1.
As a loop plays, choose Select Loop (-"-") from
the Edit menu.
2.
With the loop selected, choose New Region (-R)
from the Action menu.  Name the Region and click OK.
3.
Hold down the Option key (or click the Horizontal
Lock button in the Toolbar) and drag the begin
loop or end loop marker to a new position in the
audio document – both loop points will move
simultaneously.
4.
When you locate another section of the audio
document that you would like to set aside for later
use, choose Select Loop (-"-") from the Edit menu.
5.
With the loop selected, choose New Region (-R)
from the Action menu.  Name the Region and click
OK. Continue Loop Surfing and creating Regions as
desired.
You may continue placing as many Regions as desired
using this technique.  To later loop any of the Regions
you have created, just select the desired Region, and
choose Loop this Selection from the Action menu.
To create a remix in a Peak Playlist, simply create a new
Playlist, and add the desired Regions to it.  For more
information on using Playlists, please see Chapter 6:
Playlists & CD Burning.
Peak 6 User's Guide
108


##### Using the Guess Tempo & Threshold Commands to Find Tempo


##### Using Loop Tuner

<!-- p.109 -->
To export these Regions as new audio documents, or to
use within another application, please see the section on
Exporting Regions, later in this chapter.
Loop Surfer is not available in Peak LE.
Using the Guess Tempo and Threshold
commands to find tempo
If you are working with music and don't know the tempo
– and your music has a relatively pronounced or obvious
beat – you can use the Guess Tempo command to have
Peak automatically guess the tempo of a selection.  Make
a selection and choose Guess Tempo from the Action
menu.  There will be a pause while Peak scans your
selection and calculates the tempo for you.  A dialog will
then appear showing you the estimated tempo in BPM,
or beats per minute.  You can then enter the estimated
tempo in BPM in the Loop Surfer dialog's Tempo field, or
click Loop-It to automatically place the guessed tempo
value into the Loop Surfer dialog.
As you Loop Surf, you may automatically change the
number of beats in a loop by selecting the loop (-Shift-
"-"), opening the Loop Surfer dialog (-J), and entering
a new value for beats.
You can also use the Threshold command (described in
greater detail in Chapter 8:  DSP) to define a number of
markers or Regions based on amplitude peaks.  If you then
select audio with start and end points that correspond to
these sections, you should have a selection that precisely
matches the musical beat.  Using Loop Surfer, you could
then automate the process of looping the selection by
following the steps described directly above.
Guess Tempo works best with audio selections that
contain one full measure of audio with pronounced
attacks on the beats, which appear visually on the
waveform as taller sections of the audio.  Using the
Normalize feature on the selection prior to Guess Tempo
can improve the accuracy of its deduction.
Guess Tempo is not available in Peak LE.
Using Loop Tuner
Loop Tuner provides a way to visually line up the start
and end points of your loop to get a smooth transition at
the loop points.  Loop Tuner also allows you listen to the
effects of these adjustments as you make them.
If you wish to "tune" a loop you've made, simply select
Loop Tuner from the DSP menu or Toolbar, and a dialog
will appear.  The waveform display in the Loop Tuner
dialog shows the Start and End points of the loop, which
you can visually adjust with the scroll bars at the bottom
of the window.  The two zoom buttons – magnifying
glass icons-in the upper left of the Loop Tuner dialog
allow you to adjust the vertical zoom up of the waveform.
The two zoom buttons in the lower left hand corner of
Chapter 5:  Editing
109
5
LE
LE
The Loop Tuner showing a smooth transition between the end and
beginning of the loop – this would produce a seamless loop.
The Loop Tuner showing an abrupt transition between the end and
beginning of the loop – this would create a click each time the loop repeats.


##### Perpetual Looper


#### Editing QuickTime Soundtracks

<!-- p.110 -->
the Loop Tuner dialog allow you to adjust the zoom view
in and out all the way down to the sample level.  You can
listen to the effects of the adjustments as you make them
by clicking on the Play button.  To exit this dialog, click
on OK to accept the changes, or Cancel to leave the
original loop unaffected.
Loop Tuner is not available in Peak LE.
Perpetual Looper
The Perpetual Looper is based on BIAS' powerful Partial
Harmonic Audio Technology (PHAT). The Perpetual
Looper makes it easy to create smooth, seamless loops of
monophonic, tonal sounds by performing its work in the
frequency domain, instead of in the time domain as
looping has traditionally been done.
The Perpetual Looper is intended for creating "sustain
loops" of  single notes or sounds, not phrases or sections
of audio, and generally will not produce useful results
from phrases.
Working with the Perpetual Looper is explained in detail
in Chapter 8: DSP.
Perpetual Looper is not available in Peak LE.
Editing QuickTime Soundtracks
Peak allows you to edit QuickTime movie
soundtracks.  While you cannot edit QuickTime video
in Peak, you can use Peak as a full-featured audio postproduction tool for QuickTime movies.  This makes
Peak an ideal tool for editing and cleaning up
soundtracks, as well as adding sound effects or music
to QuickTime movies.
How to open and edit QuickTime sound tracks in Peak:
1.  Select Open from the Edit menu (-O) or Toolbar.
2.
In the dialog that appears, locate the QuickTime
movie that you wish to open.
3.
Click the Open button, and Peak will open the
QuickTime movie in a movie window, and open
the movie's audio track in an audio document
window.  Select Movie>Movie Sound Tracks from
the Options menu to Enable or Disable the movie's
other audio tracks.  You can also use this dialog to
toggle multiple soundtracks contained in a movie
on and off to check balances or "solo" certain
tracks.  Click on the Set button to accept the
changes, or Cancel to leave the movie unaffected.
To toggle the Movie Window on or off, choose
Movie from the Window menu.  A check next to
this item indicates it is enabled.
4.
You may now edit the movie's audio track as you
would any other audio document.  The movie will
"scrub" along with the audio, and the placement of
the insertion point in the audio document window
will also scroll the movie to that point.
Peak 6 User's Guide
110
The Peak Movie Window
LE
LE
The Perpetual Looper dialog.


#### Editing Metadata


##### The Edit Metadata Dialog

<!-- p.111 -->
5.
When you are finished editing the QuickTime
sound track, use Peak's "Save As" command to save
the movie with its new sound track.
Be careful not to change the duration of the audio
using cut, delete, or insert, as this will cause the
audio and video to fall out of sync.
Editing Metadata
Metadata is commonly described as "data about data",
but it is easier just to say that it is descriptive information
about a computer file.  Artist, album, and song are three
typical pieces of metadata that might describe a music
file purchased from an online music retailer, while
metadata for a file from a sound effects library might
include file name, duration, sample rate, bit depth, and
sound effects category.  [Metadata is most useful when it
is stored as part of the file that it describes, and an
increasing number of file types include metadata
capabilities].
Many people are familiar with the ID3 tags stored in MP3format files. The first metadata format for MP3 files was
called ID3v1.  However, that format had some severe
limitations, leading to the creation of ID3v2.  While not an
official standard, ID3v2 is currently the most common
metadata format for MP3 files. Peak supports both formats.
Unfortunately, there is no standardization between file
formats on what metadata is stored or how.  In fact,
sometimes two applications creating the same file type
will store metadata in them differently.
Peak offers extensive metadata capabilities, including a
"master" metadata chunk (Peak Metadata) that can
contain all of the fields used in every file format for which
Peak supports metadata.  Currently, Peak supports
metadata in MP3, FLAC, AIFF, WAVE, and Broadcast WAVE
files.
The Edit Metadata Dialog
Metadata for a specific file format is edited in the Edit
Metadata dialog.
The Edit Metadata dialog can be reached in one of five
ways:
1.
Clicking at the bottom of a document window will
open the Edit Metadata dialog.
2.
The Edit Metadata command in the File menu
allows reading and editing of metadata without it
being open in Peak.
3.
The Edit Audio Info command in the Action menu
allows reading and editing of metadata in files that
are open in Peak
4.
When saving a file in the MP3 format, choose the
Save As menu item from the File dialog, and then
click the  "Format Options" >  "Edit ID3v2 Tags"
button to open the Edit Metadata dialog.
5.
When publishing a podcast, choosing the Publish
Podcast item from the File menu, then select the
MP3 format and clicking the "Settings..." >  "Edit
ID3v2 Tags" button to open the Edit Metadata dialog.
To read and edit file metadata without opening the file in
Peak:
1.
Choose Edit Metadata from the File menu.
2.
Browse to the file for which you wish to edit
metadata.
3.
Click the "Open" button – the Edit Metadata dialog
appears, showing any existing metadata.
Chapter 5:  Editing
111
5
The Movie Sound Tracks dialog

<!-- p.112 -->
4.
Edit the metadata as desired.  Be sure to mark the
checkboxes for all metadata fields you want saved.
5.
Click the "Save" button to save your metadata
changes back to the file.
To read and edit metadata in a file that is open in Peak:
1.
Choose the Edit Audio Info item from the Action
menu or click at the bottom of the audio document
window.  The Edit Metadata dialog will appear,
showing any existing metadata.
2.
Edit the metadata as desired.  Be sure to mark the
checkboxes for all metadata fields you want
saved.
3.
Click the "Save" button.
Note that metadata edits are not  actually saved
until the audio document is saved.
To read and edit metadata when saving a file into the
MP3 format:
1.
Choose the Save As item from the File menu.
2.
Select MP3 from the File Type menu.
3.
Click the "Format Options" button – the MP3
Encoder dialog opens.
4.
Click the "Edit ID3v2 Tags" button – the Edit
Metadata dialog opens.
5.
Edit the metadata as desired.  Be sure to mark the
checkboxes for all metadata fields you want
saved.
6.
Click the "Save" button.
7.
Click "Save" in the Save As dialog.
To read and edit metadata for a podcast being published
in MP3 format:
1.
In the Publish Podcast dialog, select "MP3" from
the Format drop-down menu.
2.
Click the "Settings..." button – the MP3 Encoder
dialog opens.
3.
Click the "Edit ID3v2 Tags" button – the Edit
Metadata dialog opens.
4.
Edit the metadata as desired. Be sure to mark the
checkboxes for all metadata fields you want
saved.
5.
Click the "Save" button.
6.
Finish
entering
podcast
and/or
episode
information, and click the "Publish" button.
Peak 6 User's Guide
112
The Edit Metadata dialog allows editing metadata for specific file
formats, and only fields supported by the current file type being
edited are available.
The Edit Peak Metadata chunk dialog contains all of the metadata
fields used in every file format for which Peak supports metadata.
Once entered here, metadata can be applied to any supported file


##### The Peak Metadata Chunk


#### Conclusion

<!-- p.113 -->
The Peak Metadata Chunk
The Peak Metadata chunk provides a central location that
contains all of the metadata fields for all supported file
formats.  This means that you can enter all of your
metadata in the Peak Metadata dialog and then copy it to
the metadata for each individual file format through the
use of the "Copy from Peak Metadata" button that
appears at the bottom of the Edit Metadata dialog.  Of
course, it is only possible to copy fields that are
supported in the target file format.
Unlike the data that is entered/copied into the Edit
Metadata dialog, the Peak Metadata chunk is stored in a
file in a proprietary form that is read only by Peak.
In addition to the metadata fields, the Edit Peak Metadata
Chunk dialog includes the following controls:
To read and edit Peak metadata chunk:
1.
Choose the Edit Peak Metadata Chunk item from
the Action menu.  The Edit Peak Metadata Chunk
dialog will open.
2.
Edit the metadata as desired.  Be sure to mark the
checkboxes for all metadata fields you want saved.
3.
Click the "Save" button.
Note that metadata edits are not  actually saved
until the audio document is saved.
To copy metadata from the Peak Metadata Chunk to the
metadata for a file:
1.
Be sure that all desired metadata has been entered
in the Edit Peak Metadata Chunk dialog.
2.
Open an Edit Metadata dialog for the file being
edited.
3.
Mark the checkboxes for every field in the dialog
for which you want to copy data from the Peak
Metadata Chunk.
4.
Click the "Copy from Peak Metadata Chunk"
button at the bottom of the dialog.
Note that field data in the Edit Metadata will only
be overwritten if there is data for that field existing
in the Peak Metadata Chunk, and the checkbox for
the field in the Edit Metadata dialog is marked.
Conclusion
You have now learned how to manipulate audio with
Peak's various editing tools, including how to work with
Markers, Loops, and Regions.  In the next chapter you
will learn more about the use of Regions in Playlists, and
outputting in a variety of formats, including Red Book
audio CD, DDP, and more.
Chapter 5:  Editing
113
5

<!-- p.114 -->
Peak 6 User's Guide
114

<!-- p.115 -->
Chapter 6
Playlists & CD Burning

<!-- p.116 -->
Peak 6 User's Guide
116
