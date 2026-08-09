# Peak 6 — Chapter 12: Menus

> The complete menu tree. This is the reference for our own menu bar: what belongs under File, Edit, Audio and so on, and what each command is called.

> Extracted from `Peak 6 User Guide.pdf`, pages 267–306.


### Chapter 12:  Peak Menus


#### Introduction


#### Peak Pro Menu


##### About Peak...


##### Help


##### Authorization Manager


##### Check for Updates


##### Preferences


##### Colors

<!-- p.267 -->
Chapter 12:
Peak Menus
Introduction
This chapter explains each of the commands found in
Peak's menus.  For step-by-step instructions on
implementing these commands, refer to the index, and
go to the appropriate chapter where use of the
command is covered.
Peak Pro Menu
The following items and commands appear under the
Peak Pro menu.
About Peak...
This menu shows information about the particular
version of Peak you are using, including the exact version
number and your serial number.
Help
This command will open the Peak User's Guide, which is
installed along with the Peak application.
Authorization Manager
This command launches the BIAS Authorization
Manager, which allows you to manage your BIAS
software licenses.
Check for Updates
This command checks to see if a newer version of Peak is
available.
Preferences...
The Preferences command opens Peak's Preferences
dialog, which contains many of the customizable
elements of the application.  Preferences details are
listed below, for each category of Preferences found in
Peak's Preferences dialog.
Colors
Peak allows you to customize the colors used to display
the elements in audio documents.  You can use this
dialog to set the background color, waveform color, and
Chapter 12:  Peak Menus
267
12


##### Scratch Disks


##### Blending


##### Auditioning

<!-- p.268 -->
colors for markers and loops.  You can select either a
preset color combination, individual colors for each
element in the audio document window, as well as
picking your own custom colors from a color palette.
Changes made using the Colors dialog affect both the
current audio document's colors, and any subsequent
new audio document's colors.  See Chapter 3 for more
information on this feature.
Scratch Disks
Because audio data can be very large, Peak utilizes a
portion of your hard disk's free space to hold audio
documents that have been cut or copied, as well as for
temporary or "scratch" files for undo purposes.  If your
hard disk is short on space, you may not be able to cut,
copy, or modify large selections.  If you have more than
one hard drive attached to your Mac, the Scratch Disks
command in the Preference menu allows you to choose
the hard drives (or "scratch disks") that you wish to use
for these temporary files.  Peak allows you to select
which disk you want to have as your default, or "Primary"
disk for this purpose-usually you would select the disk
that has the most free space.  If you are connected to a
file server, you can utilize available storage on the server
by clicking the Allow Servers checkbox.  Any available
servers will then appear in the Scratch Disks pop-up
menu.  This feature is recommended only if you have
access to a high speed Ethernet, or other fast server.
Blending
Blending is an automatic crossfade function with a usereditable envelope.  Peak can apply blending to areas of
an audio document when they are modified by cutting,
pasting or other editing processes in order to smooth
abrupt transitions between waveform amplitudes.  It can
be very useful for creating a smooth transition between
edits that would otherwise sound too abrupt.  If are
going to cut, paste, or insert audio into a document, you
may wish to enable blending to smooth things out a bit.
It can be toggled on or off by clicking the Blending
button in the Audio Document Window, or pressing the
Caps Lock key on your keyboard.  For detailed
instructions on how to use blending or how to edit the
blending crossfade envelope, see Chapter 5: Editing.
Auditioning
Peak's Auditioning command allows you to audition a
selection along with a specific amount of audio
preceding or following it.  The Auditioning dialog allows
you to select a desired amount of Pre-roll or Post-roll
when you play the selection.
Peak 6 User's Guide
268
The Document Colors dialog
The Blending dialog
The Scratch Disks dialog


##### Fade In Envelope


##### Fade Out Envelope


##### Plug-ins Envelope


##### Sampler Preferences


##### DSP Preferences

<!-- p.269 -->
Fade In Envelope
The Fade In Envelope command allows you to edit
Peak's fade-in envelope.  Fade-ins can be very useful for
smoothly fading into an audio document, or for fading
into one type of audio material from another.  Very short
fade ins can also be useful for smoothing or removing
clicks and pops in a recording.  The Fade In Envelope
dialog allows you to control the exact shape of a fade in
by providing you with user definable envelope controls.
For detailed instructions on how to create fade ins and
edit their envelopes, see Chapter 5: Editing.
Fade Out Envelope
The Fade Out Envelope command allows you to edit
Peak's fade-out envelope.  Fade-outs can be very useful
for smoothly fading out of an audio document, or for
fading out of one type of audio material into another.
The Fade Out Envelope dialog allows you to control the
exact shape of a fade out by providing you with userdefinable envelope controls.  For detailed instructions on
how to create fade out and edit their envelopes, see
Chapter 5: Editing.
Plug-Ins Envelope
This command allows you to apply plug-in effects
gradually according to the envelope you create in the
Envelope Editor dialog.  This is very useful for varying
the intensity of effects over time.
Sampler Preferences
The Sampler command allows you to set an offset of one
sample, for those samplers that require it, as well as
choose SCSI preferences.  See Chapter 11: Samplers, for
more on the Sampler Preferences dialog.
DSP Preferences
Peak's DSP tools appear in the DSP menu in alphabetical
order by default.  A user selectable "Use Subcategories in
DSP Menu" preference is also available, which allows DSP
tools to be grouped by type of function:  Analysis,
Conversion, Effects, Gain, Loops & Regions, Repair, and
Time & Pitch.  To enable DSP categorization, simply
check the "Use Subcategories in DSP Menu" checkbox in
the DSP Preferences window.
Peak DSP Preferences allow you to set the size of the
"window" used in time shifting, and the quality of sample
rate conversion.  A setting of 8 is recommended for
Sample Rate Conversion Quality, (with 1 being lowest and
10 being the highest).  A setting of 30ms is recommended
for the time shifting window size – a lower setting is
better for simpler, monophonic sounds, and a higher
setting is better for more complex polyphonic.
Chapter 12:  Peak Menus
269
12
The Auditioning Dialog.tif
Preferences...>Fade Out Envelope
The Sampler Preferences dialog


##### Playback Preferences


##### Shortcuts/Toolbar Preferences

<!-- p.270 -->
Playback Preferences
The Playback Preferences dialog contains the following
controls:
Double-click on Waveform to Begin Playback
If this box is checked, double-clicking in an audio document's
waveform display starts playback at that point.  If this box is
unchecked, double-clicking in the audio waveform selects
the space between adjacent markers (or the beginning
and/or end of a file and the closest adjacent marker).
Playback Buffer
Peak allows you to control the amount of RAM the
program uses when playing back audio documents.  In
general, lower is better.  A playback buffer of 32k is a
good place to start.  If you are experiencing clicks in your
playback, working with fragmented files, using
processor-intensive real-time DSP, or are using a slow
hard drive, you may need a larger playback buffer setting.
Window Buffer
Peak allows you to control the amount of RAM the program
uses to keep audio documents buffered in RAM.  Use larger
values if you are working with a few large files, and smaller
values if you are working with many smaller files.  Experiment
to find the best settings for your system and working style.
Shortcuts/Toolbar Preferences
Peak allows you to customize any Peak menu item with a
keyboard shortcut.  To change your keyboard shortcuts,
go to the Preference menu and select the Shortcuts and
Toolbar item.  Keyboard shortcuts are stored in a
preference file in the directory:
/Users/<YourUserAccount>/Library/Preferences/
Peak's default Keyboard Shortcuts are listed in Appendix 1.
You may also customize the Peak Toolbar using the
Shortcuts & Toolbar dialog.  Just scroll to a function in
the dialog list, and use the checkbox to toggle the icon
on and off.  This allows you to group only the items you
use most frequently on the Toolbar for easy access.
Customized Shortcuts & Toolbar are not available
in Peak LE
Peak 6 User's Guide
270
LE
The Playback Preferences Dialog
The Shortcuts & Toolbar dialog
The DSP Preferences dialog


##### Window Preferences


##### Dither Preferences


##### Hide Peak


##### Hide Others


##### Quit Peak


#### File Menu

<!-- p.271 -->
Window Preferences
Peak's Window Preferences allow you to set several window
styles and behaviors.
"Floating" windowsalways appear above other windows.  It is
particularly useful to set plug-ins, movies, and the Contents
window as floaters, so they are always quickly accesible.
Live Document Resizingscales an audio document's contents
when the window is resized, allowing you to see the audio
waveform's size change as you change the size of the window.
Window Magnetism makes windows snap together when
they are positioned close to each other.  This feature is
useful for creating tight window arrangements and
maximizing available screen real estate.
Dither Preferences
The dither preferences dialog allows you to choose
which dithering algorithm is applied when saving files or
bouncing Playlists.  For more detailed on the various
dithering algorithms included in Peak, please see the
section on Dithering in Chapter 3:  Peak Basics.
Peak LE does not feature built in dithering.
Dithering in Peak LE is performed using the
included MDA Dither plug-in.
Hide Peak
Temporarily puts Peak into the background, and hides all
windows.  Peak can be brought back into the foreground
by choosing its icon from the Dock.
Hide Others
Temporarily puts any other open applications into the
background.  This is a useful command if you have
several applications open, and want to focus on working
in Peak.  Other applications can be brought back into the
foreground by clicking on their icon in the Dock.
Quit Peak
Choosing Quit Peak closes the Peak application.  If you
haven't saved changes to a currently open audio
document, Peak will prompt you to do so before quitting.
File Menu
This menu contains all of the standard Mac commands
for opening, closing, and saving files, as well as several
additional commands specific to the Peak application.
Chapter 12:  Peak Menus
271
12
LE
The Window Preferences dialog


##### New


##### Mono Document


##### Stereo Document


##### Document from Selection


##### Playlist Document


##### Document from Playlist


##### Open


##### Close


##### Close All


##### Save


##### Save As

<!-- p.272 -->
New
This command allows you to create a new Peak audio
document.  When you choose this command, a submenu
menu appears which allows you to choose either a mono
or stereo format for the new audio document, or to
create a Playlist document or a new audio document
from an open Playlist document.
Mono Document
Choosing Mono Document (-N) creates a mono (one
channel) audio document.
Stereo Document
Choosing Stereo Document (Shift--N) creates a stereo
(two channel) audio document.
Document From Selection
Choosing Document From Selection (Ctrl-N) creates a
new audio document from any selected audio in an open
audio document.
Playlist Document
Choosing Playlist Document (Shift--P) creates a new
Playlist document.
Document From Playlist
Choosing Document From Playlist (Shift--B) creates a
new audio document from an open Playlist document.
Open
The Open command (-O) allows you to locate and open
an audio document.  Peak can open audio documents in a
variety of formats including AIFF, Sound Designer II, WAVE,
QuickTime, Raw, System 7 Sound, Sonic AIFF, Paris, Jam
Image, AU, MP2, MP3, MP4, and FLAC.
Close
The Close command (-W) closes the currently active
Peak audio document.  If you haven't saved changes,
Peak will prompt you to do so before it closes the
document.  If you have many documents open and don't
wish to save any of the changes you've made, Optionclick on the prompt dialog's Don't Save button.
Close All
The Close All command (Option--W) closes all open
Peak audio documents.  If you haven't saved changes, Peak
will prompt you to do so before it closes the documents.
If you don't wish to save any of the changes you've made,
Option-click on the prompt dialog's Don't Save button.
Save
The Save command (-S) saves the current audio
document.  Peak can save audio documents in a wide
variety of audio file formats.  For more information on
supported file formats, please see Chapter 3:  Peak Basics.
Save As
The Save As (Shift--S) command allows you to save a copy
of the current audio document under a different name, in a
different location on your hard drive, or in a different audio
Peak 6 User's Guide
272
The Open Dialog


##### Save a Copy As


##### Import CD Track


##### Import Dual Mono


##### Recover Audio File

<!-- p.273 -->
file format.  The saved copy will become the active open
audio document.  You can save the document with a variety
of audio compression schemes.  For detailed instructions on
using this feature, see Chapter 3: Peak Basics.
Save A Copy As
The Save A Copy As command (Option--S) allows you
to save a copy of the currently active open audio
document under a different name without replacing the
active open audio document.
Import CD Track
The Import CD Track command allows you to import
tracks from an audio CD.  CD tracks imported to Peak will
be saved as AIFF files.  For more detail on importing CD
audio with Peak, see Chapter 4: Playback & Recording.
Import Dual Mono
The Import Dual Mono command lets you import two
mono files and create an interleaved stereo file.
Certain audio applications, such as Pro Tools, use "dual
mono", rather than stereo interleaved files.  Peak
allows you to open such dual mono files, and in the
process creates a new stereo audio document.
Because Peak actually writes a new stereo audio file to
disk, this conversion process requires hard disk space
equivalent to the two original mono files.  For more
information on opening dual mono files, see Chapter
3: Peak Basics.
Recover Audio File
The Recover Audio File command allows you to open a
damaged audio file, and attempt to recover the audio data
contained in it.  This tool extracts audio data only, and
ignores all other information contained in the file's
header, such as information about loop points, regular
markers, Region markers, etc.
When audio data is successfully recovered, it is
placed into a new audio document and must be
saved.  For more information on working with the
Recover Audio File command, please see Chapter 3:
Peak Basics.
Chapter 12:  Peak Menus
273
12
The Save As dialog
Import CD Audio dialog
Recover Audio File dialog


##### Export Dual Mono


##### Export Regions


##### Export as Text


##### Publish Podcast

<!-- p.274 -->
Recover Audio File is not available in Peak LE.
Export Dual Mono
The Export Dual Mono command allows you to save a
stereo audio document as separate mono digital audio
documents.  This feature is convenient if you intend to
use the audio document in a multitrack audio
application, such as Pro Tools, which does not directly
support stereo audio files.  When you choose this
command Peak will prompt you to name both the left
and right sides with a Save dialog.
Export Regions
If you have placed markers or Regions in an audio
document, Peak's Export Regions command allows you
to save each of these Regions as a separate audio
document.
This feature is very convenient if you wish to divide a
larger file into Regions and transfer them as samples into
a sample playback instrument, or divide a live concert
record into Regions and export those Regions as
separate files.  Furthermore, you can use Peak's Batch
File Processor to process a file's Regions with any of
Peak's DSP functions and third party plug-ins during the
automatic exporting of Regions into new files.  For more
information on exporting Regions, see Chapter 5:
Editing.
Export Regions is not available in Peak LE.
However, Regions may be dragged from the
Contents Window to the Finder as discrete files.
Export as Text
If you wish to keep a text record of your Playlist, you may
export the Playlist into a new text document.  The text
document will show names, times, crossfade times, and
gain levels of each Playlist Event.
Publish Podcast
Choosing the Publish Podcast command publishes the
foreground audio document locally, or to a .Mac or FTP
server.  The Publish Podcast dialog provides fields for
entering information used to create an RSS syndication
file, options for encoding an MP3 or AAC audio file, as
well as information for submitting and publicizing your
podcast via the iTunes Music Store's Podcast directory.
For detailed information about publishing podcasts with
Peak, please see Chapter 7:  Podcasting.
Peak 6 User's Guide
274
LE
The Export Regions dialog
LE
The Publish Podcast dialog


##### Send to iTunes


##### Batch Processor


##### Burn Audio CD


##### Recently Opened Documents

<!-- p.275 -->
Send to iTunes
Choosing the Send to iTunes command sends the
foreground audio document directly to your iTunes
library.  If the document you're working with in Peak
contains regions, Peak gives you the option to create an
iTunes playlist, with each region listed as a track within
that playlist.  For more information on using the Send to
iTunes feature, please see Chapter 5:  Editing.
Batch Processor
Peak's Batch File Processor is one of the most powerful,
versatile, and useful features in Peak.  Using the Batch
File Processor, you can integrate any series of Peak
processes (called a batch script), and apply these scripts
to any number of audio files.
To use Batch File Processing, go to the File menu and
select Batch Processing.  The Batch File Processor dialog
appears.
Peak's Batch File Processor is split into three areas: Input,
Process, and Output.  Sequence a series of steps for Peak
to execute in the Process section, then set your output
file settings in the Output area.  Once Peak's Batch File
Processor is configured, you may turn on the Batch File
Processor in the Input area.
Once the Batch File Processor is configured and turned
on, any files you drop onto the Peak application's icon
(or an alias) will be batch processed according to your
settings.  You can even drop folders or disks onto Peak's
icon and all of the supported audio contents will be
batch processed.  You can continue dropping files, folder,
or disks, onto the Peak icon for batch processing while
the Batch File Processor is turned on.  All subfolders or
disks you drag onto the Peak application for Batch File
Processing will be recreated in the Batch File Processor's
output directory, preserving all organization of your files.
Audio documents opened using the Open command
from the File menu will not be batch processed.  More
information on batch processing with Peak appears in
Chapter 10:  Batch File Processor and Apple Events.
Batch File Processor is not available in Peak LE.
Burn Audio CD
Choosing the Burn Audio CD will burn the foreground
audio document as an audio CD.  If Regions are
contained in the document, Peak will prompt you as to
whether these should be used to designate different
tracks on the finished audio CD.
Recently Opened Documents
Peak automatically remembers the last several audio
documents or Playlists that you have opened and keeps
a list of these at the bottom of the File menu.  This allows
you to easily select a document's name and reopen it
without having to search for it on your hard drive.  Peak
can also find and open a document even if you have
changed its location on your hard drive.  And if you
change the name of the file, the next time you open
Peak, Peak will automatically update the name in its
internal list.
Chapter 12:  Peak Menus
275
12
Batch File Processor
LE


#### Edit Menu


##### Undo


##### Redo


##### Edits


##### Cut


##### Copy

<!-- p.276 -->
Edit Menu
This menu contains all of the standard Mac commands
for cutting, copying, and pasting, as well as several other
commands specific to Peak.
Undo
The Undo command (-Z) undoes the last action that
you performed.  Since Peak features unlimited undo and
redo capability, repeatedly choosing this command will
undo each action that you have performed on your audio
document.  If you wish, you can continue undoing
actions until you return to the original state of the audio
document.  When there are no actions left to undo, the
Undo command will be unavailable and appear grayed
out.
Redo
The Redo command (-Y) "undoes" the undo
command.  If you wish, you can continue redoing actions
until there are no items left to redo.  In this case, the
Redo command will be unavailable and appear grayed
out.  The only limitation in using the Redo command is
that if you insert a new action when a redo action is
available, you will no longer be able to redo.  In other
words, as soon as you perform an editing action other
than Undo, Redo is no longer available
Edits
The Edits command provides you with a second unique
and powerful "unlimited undo" feature.  You can think of
the Edits command as a kind of "random access" undo with
a list of all your editing actions since you last saved.  Using
this list, you can navigate back in time to the point at which
you performed a particular edit, and if you wish, undo it.
Once you have returned to an earlier state in the project,
you are free to start editing from that point on, if you wish.
Be aware that if you do go back to a past action and
perform a different action at that state in the project, any
edits that originally followed will be gone and you won't
be able to redo them.
Cut
The Cut command (-X) cuts selected data from an
audio document and copies it to Peak's Clipboard.  Once
you have cut a portion of an audio document, you can
paste it or insert it at another location in the same
document or a different document.
Copy
The Copy command (-C) copies selected audio into
Peak's Clipboard.  Once you have copied a portion of an
Peak 6 User's Guide
276
The Edits dialog


##### Paste


##### Paste Markers Only


##### Replace


##### Duplicate


##### Insert


##### Insert Silence

<!-- p.277 -->
audio document, you can paste it or insert it at another
location in the same document or a different document.
Paste
The Paste command (-V) allows you to paste the
contents of the Clipboard into a location that you choose
by placing an insertion point.  Pasting audio deletes any
selected audio and inserts the clipboard audio at the
insertion point.
Paste Markers Only
The Paste Markers Only command allows you to paste
the markers contained in a copied selection into a
location that you choose by placing an insertion point.
This feature in particularly useful for pasting markers set
at specific times into another audio document, much like
using a template.
Replace
The Replace command allows you to paste audio from
Peak's Clipboard over existing audio, without pushing all
data to the right of the insertion point farther to the right
(later in time) to accommodate the newly pasted audio.
Duplicate
The Duplicate command has a number of different
behaviors, depending on whether you are working in an
audio document or in a Playlist.  More information about
this command is available in Chapters 5 & 6.
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
creating longer audio documents that need to repeat a
certain piece of audio, such as creating a 4 bar drum loop
out of a 1 bar drum loop.
If there is a selection in the waveform when the
Duplicate command is invoked, then Peak automatically
fills the selection with the Clipboard contents.  Peak
determines how many times the Clipboard contents
must be duplicated in order to fill the selection.  If the
selection is not evenly divisible by the duration of the
Clipboard contents, Peak includes a fraction of the
Clipboard contents to make the duplication completely
sample accurate to the original selection.
Insert
The Insert command (-D) allows you to paste audio
into an audio document without overwriting any existing
data at the insertion point.  When you paste data with the
Insert command, all audio to the right of the insertion
point or selection start is pushed farther to the right
(later in time) to accommodate the newly pasted audio.
Insert Silence
The Insert Silence command allows you to insert a
specific amount of silence into an audio document at the
current insertion point.  When you choose this
command, Peak will prompt you to enter the amount of
silence you wish to insert.  You can enter this value in
Samples, Milliseconds, or Seconds.  All audio occurring
after the insertion point is moved later in time by the
amount of the silence that you insert.
Chapter 12:  Peak Menus
277
12
The Insertion dialog


##### Silence


##### Delete


##### Delete Markers Only


##### Crop


##### Clear Clipboard


##### Select All


##### Insertion Point at Selection Start/End


##### Set Selection


##### Select Loop


##### Previous Selection/Next Selection

<!-- p.278 -->
Silence
The Silence command (-E) replaces the selected audio
in the audio document's selection with silence.
Delete
The Delete command (the Delete key) allows you to cut
an audio selection without transferring it to the
Clipboard.
Delete Markers Only
The Delete Markers Only command (Option-Delete)
allows you to easily remove all markers, Region markers
and loops in the current audio document selection
without removing the audio.
Crop
The Crop command (-`) allows you to remove all other
audio from the audio document except the selection.
Clear Clipboard
Peak utilizes a portion of your hard disk's free space to
hold audio that has been cut or copied.  The Clear
Clipboard command allows you to free up disk space
occupied by the contents of the clipboard if you no
longer need the audio contained there.
Select All
The Select All command (-A) selects all audio in the
audio document.
Insertion Point at Selection Start/End
The Insertion Point at Selection Start command (Up
Arrow) places the insertion point at the beginning of a
selection.  The Insertion Point at Selection End
command (Down Arrow) places the insertion point at
the end of a selection.
Set Selection
The Set Selection command allows you to precisely edit
the length, start and end times of an audio selection by
entering numerical values in the Set Selection dialog.
Use the Time Units pop-up menu at the top of the dialog
to select the time units you want, and use the radio
buttons to select whether you want to affect the Start or
End of the selection.
Select Loop
The Select Loop command (-"-") will automatically
select the audio within the loop start and loop end
markers, if you have defined a loop in a document.
Previous Selection/Next Selection
If you have made a selection in an audio document, then
made another selection, you can use Previous Selection
(-Shift-Left Arrow) to jump back to the previous
selection.  You can then use Next Selection (-ShiftRight Arrow) to jump ahead again.  This works for
multiple selections.
Peak 6 User's Guide
278
The Set Selection dialog


#### Action Menu


##### Zoom Out


##### Zoom In


##### Increase Vertical Zoom


##### Decrease Vertical Zoom


##### Fit Selection


##### Zoom Out All the Way


##### Zoom at Sample Level

<!-- p.279 -->
Action Menu
This menu provides several commands for zooming in
and out of the audio document window, creating loops,
markers and Regions, and navigating to specific locations
in an audio document.
Zoom Out
The Zoom Out command (- [) zooms the waveform
view out allowing you to see more of the entire
waveform, but in less detail.  The Zoom Out command is
useful for obtaining a better "big picture" view of audio
material.  To zoom progressively out from a waveform,
select this command repeatedly or press - [ repeatedly
on your computer keyboard.
Zoom In
The Zoom In command (-]) zooms the waveform
view in so that you can view audio data in greater
detail.  The Zoom In command is essential when you
wish to select and edit audio with great precision.  To
view a waveform in progressively greater detail, select
this command repeatedly or press -] repeatedly on
your computer keyboard.  Holding down the Option
key while you make a selection will zoom the
waveform view in so that your selection fills the audio
document window after you release the mouse
button.
Increase Vertical Zoom
The Increase Vertical Zoom command (Control-Up
Arrow) makes the waveform "taller," or increases the
vertical zoom.  The Increase Vertical Zoom command is
useful for obtaining a better "big picture" view of quieter
audio material.
Decrease Vertical Zoom
The Decrease Vertical Zoom command (Control-Down
Arrow) makes the waveform "shorter," or decreases the
vertical zoom.
Fit Selection
The Fit Selection command (Shift--]) will zoom the view
so that your selection fills the audio document window.
Zoom Out All the Way
The Zoom Out all the way command (Shift-- [) zooms
the audio document window to show an overview of the
entire audio document.
Zoom at Sample Level
The Zoom at Sample Level command (Shift-Left Arrow)
zooms the audio document window to the single-cycle
level, allowing you to view the waveform a single
sample at a time.  This is useful for drawing on the
sample with a pencil tool, or fine-tuning loops and
markers.
Chapter 12:  Peak Menus
279
12


##### Zoom at Sample Level (End)


##### Snap To


##### Zero Crossings


##### Bars/Beats


##### CD Frames


##### Sony PS2 Loop Boundaries


##### Microsoft Xbox Loop Boundaries


##### Custom Units


##### Snap Start & End


##### Snap Start


##### Snap End


##### Loop this Selection


##### Nudge Loop Backward


##### Nudge Loop Forward


##### New Marker

<!-- p.280 -->
Zoom at Sample Level (End)
The Zoom at Sample Level (End) command (Shift-Right
Arrow) zooms the audio document window to the singlecycle level and places the insertion point at the end of
the audio selection.
Snap To
This command will cause new selections in the audio
waveform to move, or "snap" to the nearest selected Snap
To unit.  The Snap To units available are listed below:
•
Zero Crossings
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
Custom Units (allow entry of a user-definable
number of samples)
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
Snap Start & End
This command adjusts the beginning and end of the
current selection to the nearest selected Snap To unit.
Snap Start
This command will cause the beginning of the current
selection to move to the nearest selected Snap To unit.
Snap End
This command will cause the end of the current
selection to move to the nearest selected Snap To unit.
Loop This Selection
The Loop This Selection command (Shift--"-")
automatically creates a loop from the current selection
by placing loop markers on either side of the selection.
Since Peak supports a single loop per audio document,
choosing this command in a document with a loop
already defined will cause the loop markers to move to
the current selection.
Nudge Loop Backward
The Nudge Loop Backward command (Option-Left
Arrow) pushes, or "nudges," the loop point backward.
This allows you to fine-tune the loop.
Nudge Loop Forward
The Nudge Loop Backward command (Option-Right
Arrow) pushes, or "nudges," the loop point forward.
This allows you to fine-tune the loop.
New Marker
The New Marker command (-M) creates a new marker
at the current insertion point in an audio document.
Markers are locations in an audio document that you
define as important.  By marking specific locations in a
recording, you can navigate easily to a location for
selection, editing or playback purposes.
Once you have defined a marker, you can assign or edit a
number of its attributes with the Edit Marker dialog that
Peak 6 User's Guide
280


##### Markers from Tempo


##### New Region


##### New Region Split


##### Capture Region to Playlist


##### Markers to Regions

<!-- p.281 -->
appears when you double-click the marker.  This dialog
and the attributes contained within are explained in
Chapter 5: Editing.
Markers from Tempo
The Markers from Tempo command will automatically
create markers at regular intervals based on the tempo
that is entered.  To use Markers from Tempo, you will
either need to know the tempo of the audio material you
are working with, or you can use Peak's Guess Tempo
feature to figure it out.  Place Peak's insertion point in the
waveform at the point you wish to have the first marker
placed.  Designate whether you prefer to have markers
placed every Beat or Bar, and then indicate the duration
for which you wish to have markers placed.  Peak will
place markers either for the duration of a selected range
of audio, or you can enter a specific value.  Click OK to
create markers.  Markers from Tempo is described in
more detail in Chapter 5: Editing.
When working with audio material with a
pronounced beat, it's best to place the insertion
point just before a downbeat.  This ensures that all
following markers will also be placed just before
beats for the duration you choose.
New Region
The New Region command (Shift--R) defines a
selection as a new Region and adds it to the Regions
menu.  Locate a Region by double-clicking the name of a
Region in the Contents Window.  The audio document
will automatically scroll to display the selected Region,
and the Region will become the current selection in the
audio document.  For more detail on Regions in Peak,
see Chapter 5: Editing, and Chapter 6: Playlists & CD
Burning.
New Region Split
The New Region Split command will subdivide an
existing Region or audio document  into two separate,
back-to-back sections, one on either side of the insertion
point.  To use this feature, simply place the insertion
point cursor within an existing Region or audio
document, and choose the New Region Split command
from the Action menu – the existing Region or
document is split into two sections at the point where
the insertion point was placed.
Capture Region to Playlist
The Capture Region to Playlist command (-K) will
create a Region based on a selection made in an audio
document and automatically enter it into a Playlist.
This feature is very useful when you need to quickly
create Regions that will also be used immediately in a
Playlist.
Markers to Regions
The Markers to Regions command will convert any
markers in a selection to Regions.  If you make a
selection containing two markers, they will be
converted to one Region with the name of the first
marker.  If you make a selection containing three or
more markers, the markers will be converted to
contiguous, butt-spliced Regions.  For example, if you
have three markers named "Foo 1", "Foo 2", and "Foo 3"
Chapter 12:  Peak Menus
281
12
The Edit Marker dialog


##### Nudge


##### Rename


##### Go To

<!-- p.282 -->
and select them and apply Markers to Regions, the
resulting two Regions will be named "Foo 1" and "Foo
2"-wherein the first marker has become the begin
Region marker of Region "Foo 1", the second marker
has become the end Region marker of Region "Foo 1"
and the begin Region marker of "Foo 2", and the third
marker has become the end Region marker of Region
"Foo 2".
Alternatively, hold the Option key down when selecting
the Markers To Regions command to make each marker
a Region that ends at the next marker.
Nudge
The Nudge command allows you to nudge all marker,
loops and Regions in the current audio document
selection by the number of seconds entered in the
Nudge Markers dialog.  Type either positive or
negative numbers, and Peak nudges the marker by the
value you entered in the dialog.
Rename
The Rename dialog allows you to rename multiple
markers and/or region markers using a custom naming
conventions.  More information about renaming markers
and regions appears in Chapter 5:  Editing.
Go To
The Go To command (-G) allows you to quickly and
precisely navigate to a the start or end of a selection,
the start or end of a loop, a specific marker, or a
specific time location in an audio document.  This
command is essential for speedily locating any of these
important locations in an audio document.  Choosing
the Go To Time command allows you to enter the exact
time location that you wish to navigate to.  In addition,
the Location submenu lists all markers, Regions and
loops.
Peak 6 User's Guide
282
Three Markers named "Foo"
Two Regions named "Foo"
The Nudge dialog
The Rename dialog


##### Edit Audio Info


##### Edit Peak Meatadata Chunk


##### Edit MIDI &Tempo Info

<!-- p.283 -->
Edit Audio Info
The Edit Audio Info command opens the Edit Metadata
dialog.
The Edit Metadata dialog allows editing metadata specific
to the file format you are working with.
As different file types support different types of
metadata, you may see different fields, for example, the
available fields for an MP3 file will be different than the
available fields for a WAVE file.
Edit Peak Metadata Chunk
The Edit Peak Metadata Chunk dialog contains all of the
supported metadata fields for all of the file formats in
which Peak supports metadata.  These formats include
MP3, FLAC, AIFF, and WAVE.  This dialog acts as a bridge
between file formats, and once metadata in entered into
the Peak Metadata Chunk dialog, it may be easily applied
to any of the aforementioned file formats.
More information about editing metadata is
available in Chapter 5:  Editing.
Edit MIDI & Tempo Info
The Edit MIDI & Tempo Info dialog allows you to specify
the tempo, meter, and timestamp for an audio document,
as well as the root, low, and high key parameters, and the
MIDI Note Name (for use in sample playback instruments).
If your audio document is using Bars|Beats as its Time Unit,
you will want to tell Peak what the tempo of the audio
document is, so the document's timeline can be set
appropriately.  Use the Edit MIDI & Tempo Info command from
the Action menu to set the tempo of the audio document.
You can enter the meter of an audio document using the
Edit MIDI & Tempo Info dialog.  The numerator represents
Chapter 12:  Peak Menus
283
12
The Go To Time dialog
The Edit Metadata Dialog
The Edit Peak Metadata Chunk dialog


##### Loop Surfer


##### Guess Tempo


#### Audio Menu


##### Stop/Return to Start


##### Play+Pause

<!-- p.284 -->
the number of beats per measure, and the denominator
represents the value of a beat, where 4=quarter note,
8=eighth note, 16=sixteenth note, and so forth.
You may also enter a timestamp for the audio document in
seconds.  If the audio document has a timestamp, then the
displayed time in an audio document will be offset from this
time rather than starting at zero.  For example, if the
timestamp for an audio document is four seconds, then the
first sample in the audio document will appear in the audio
document with a time of 4 seconds instead of zero seconds.
Loop Surfer
Peak's Loop Surfer feature (-J) automates some of the
steps for setting up loop points.  Loop Surfer allows you
to "Loop Surf" (adjust your loops during playback)
quickly, easily and in a musically intuitive manner.
If you're working with music, and know the music's
tempo in beats per minute, you can use Loop Surfer to
create a loop which lasts for a rhythmically "correct"
length of time.  For more detail regarding Loop Surfer,
see Chapter 5: Editing.
Loop Surfer is not available in Peak LE.
Guess Tempo
If you are working with music and don't know the tempo-and
your music has a relatively pronounced or obvious beat-you
can use the Guess Tempo command to have Peak
automatically guess the tempo of a selection.  Make a selection
and choose Guess Tempo from the Action menu.  There will
be a pause while Peak scans your selection and calculates the
tempo for you.  A dialog will then appear showing you the
estimated tempo in BPM, or beats per minute.  You can then
enter the estimated tempo in BPM in the Loop Surfer dialog's
Tempo field or in the Audio Information dialog's Tempo field
or press the Loop It button to create a loop at the current
insertion point with the detected BPM.
Audio Menu
The Audio menu contains commands for playing back and
recording audio, as well as configuring Peak's Recording
Settings, your audio hardware, and Peak's Meters.
Stop/Return to Start
The Stop/Return to Start command (Return) stops
playback and places the insertion point at the beginning
of the audio document.
Play+Pause
The Play+Pause command (Spacebar) starts playback of
the audio file from the insertion point or pauses
playback.
Peak 6 User's Guide
284
The Loop Surfer dialog
LE


##### Play Selection


##### Play with Auditioning


##### Stop & Extend Selection


##### Go to End


##### Record


##### Record Settings

<!-- p.285 -->
Play Selection
The Play Selection command plays only the selected
portion of an audio document.
Play with Auditioning
The Play with Auditioning command (Control-Spacebar)
plays the selected portion of an audio document with
pre-roll and post-roll.  The pre-roll and post-roll times are
designated in the Auditioning dialog under the
Preference menu.
Stop & Extend Selection
The Stop & Extend Selection command stops playback
and extends any selection from the point at which
playback was initiated.  The Stop & Extend Selection
command can also be used to start playback from the
insertion point or selection start.
Go to End
The Go to End command places the insertion point at
the end of the audio document.
Record
The Record command (-R) opens the Record window.
This window allows you to start and monitor recording.
When you select Record from the Audio menu (-R),
Transport, or Toolbar, the Record dialog appears.  There are
transport buttons-Record Settings, Pause, Stop, and Recordalong the bottom, an Audio Source display that shows you the
waveform as it is being recorded, and a Notepad window.  The
sample rate, bit depth, and number of channels you selected
in the Record Settings dialog are also displayed, along with the
amount of time you have available to record on the selected
Record Disk with the recording settings you have chosen.
The Notepad feature in the Record Dialog allows you to
type in text descriptions, transcribe a recording, or type
in comments called Notepad Cues at specific points
during the recording of an audio document.  The
Notepad feature is available from the Record dialog and
may be used once a recording starts.
Notepad Cues are not available in Peak LE.
Record Settings
When you select Record Settings (Option-R) from the
Audio menu or Toolbar, the Record Settings dialog
appears.  This dialog is used to configure your settings
for recording with Peak.
You will notice several pop-up menus, buttons, and
checkboxes in the Record Settings dialog.  These allow
you to select which hard drive to record to, what file
format you'd like to record in, sampling rate, source
input, and so on.  The next few paragraphs describe how
to set all of these parameters using the Record Settings
dialog.  More information about recording is available in
Chapter 4.
Chapter 12:  Peak Menus
285
12
The Record dialog
LE
The Record Settings dialog

<!-- p.286 -->
Record Disk
The Record Disk pop-up menu allows you to choose
which hard drive you would like to record to.  If you
have more than one hard drive connected to your
Mac, use this pop-up to select your record drive.
(This option will default to the largest drive
currently available to your Mac unless you select
otherwise.)
File Format
The File Format pop-up menu allows you to select
the file format for the incoming audio.  You can
choose from AIFF or Sound Designer II.  (If you need
the newly recorded audio file to be in a different
format, use the Save As function to save it as a
another format once recording is complete.) If you
do not select a file format for recording, Peak will
default to AIFF.
Monitor checkbox
The Monitor checkbox allows you to monitor the audio
source while you are recording.
Split Stereo Files checkbox
The Split Stereo Files checkbox allows you to record the
incoming stereo audio as dual mono files rather than a
single stereo file.  Dual mono files are used in programs
like Digital Performer or Pro Tools so this option is
useful if you need to record dual mono files (i.e., split
stereo).
Append to document checkbox
The Append to document checkbox allows you to
record into an existing audio document.  To record
into an existing audio document, place the insertion
point in the existing audio document at the point
where you want to insert the new audio.  If the
insertion point is at the beginning of the file, the
newly recorded audio will be inserted at the beginning
of the file.  If the insertion point is at the end of the
file, the newly recorded audio will be appended to the
end of the existing file.  If the insertion point is
somewhere in the middle of the file, the newly
recorded audio will be inserted at that point.  If you
make a selection, the Append to document feature will
allow you to replace the selection with newly recorded
audio from the beginning of the selection through the
end of the selection or wherever you stop the
recording.
Record timer checkbox
The Record timer checkbox allows you to designate
a specific duration for recording.  Peak will stop
recording after this set time and bring up the Save
dialog for your audio recording.  Checking the
Record timer checkbox will bring up the Recording
Time dialog.  In the Recording Time dialog,
designate the duration for recording in seconds and
click OK.
Open after saving checkbox
The Open after saving checkbox determines whether the
audio document is opened in Peak after it is recorded.
Audio Input Settings Button
Clicking on the Audio Input Settings button will opens
the Audio Input Settings dialog, where you can specify
the recording format to be used.
Peak 6 User's Guide
286
The Recording Time dialog


##### Select Audio I/O


##### Audio Input Settings


##### Audio Output Settings


##### Meters Settings

<!-- p.287 -->
Select Audio I/O Button
Clicking the Select Audio I/O button in the Record
Settings dialog brings up the Select Audio I/O dialog.
Note that in many instances there may be no settings for
a given device (including the Apple Built-In Sound!).
Some sound card's drivers have control panels or utility
applications that will launch when you click on the Select
Audio I/O button.  The actual third-party dialog will differ
depending on the type of audio hardware you have.
Record Through Plug-Ins checkbox
If you have plug-ins installed, you can record through
them in real-time.  This is useful if you want to use a
noise reduction, equalizing, or dynamics plug-in during
recording.
For complete instructions on recording audio in Peak,
please see Chapter 4.
Select Audio I/O
The Select Audio I/O command brings up a the Select
Audio I/O.  The Select Audio I/O dialog is used to select
the audio hardware you would like to use for audio input
and output.
Audio Input Settings
The Audio Input Settings dialog is used to specify which
channels of a multichannel audio interface should be
used for recording.  In addition, you can select a specific
sample rate and recording format (i.e., number of
channels and bit depth).
Audio Output Settings
The Audio Output Settings dialog allows you to specify
output related settings, such as Clock Source, Sample
Rate, which channels of a multichannel audio interface
to play audio through, as well as Sample Rate
Converter quality (for use with Tape-Style Scrubbing).
Meters Settings
The Meters Settings command opens the Meters
dialog, which allows you to configure the Meters
display.  Using the Meters dialog, you can select the
Peak Hold time, Clip Indicator Hold Time, and meter
resolution. The Peak Hold indicators appear as yellow
bars at the far right of each of the bar graphs, and
selecting a hold time causes the indicator to pause for
easy reading of the peak value during playback.  The
Clip Indicators appear as red bars at the far right of
each of the bar graphs, and are triggered when audio
distorts, or "clips", and selecting a hold time causes the
indicator to pause for easy reading of any clipping or
distortion that occurs during playback.  Setting the
Peak Hold and Clip Indicator Hold Times to None turns
these features off.
Chapter 12:  Peak Menus
287
12
The Meters dialog


#### DSP Menu


##### Add


##### Amplitude Fit

<!-- p.288 -->
DSP Menu
This menu contains Peak's DSP-based audio processing
and advanced editing tools.  A complete description of
Peak's DSP functions and instructions on how to use
them are given in Chapter 8: DSP.
Add
The Add command adds any selection of audio copied to
the clipboard into the audio document at the selection
point.  To use the Add command, you must first copy a
selection of audio.  The copied material can then be mixed
into the target audio material.  To add copied material with
a variable level, click the envelope button, create the
desired envelope, and then click the Change button, and
then click the Add button.  Be careful not to adjust too
high an amount which can potentially clip the signal.
Add is not available in Peak LE.
Amplitude Fit
Amplitude Fit provides granular normalization of an audio
selection on a grain-by-grain basis.  Grains are small groups
of samples, often around 30ms.  As each grain is read in, it
is normalized according to the Amplitude Fit Envelopeeach normalized grain crossfaded with the previous grain
and written out as the result.  Amplitude Fit can be used to
maximize the volume level of an audio selection, or to
make quiet passages as loud as louder passages.
Amplitude Fit is not available in Peak LE.
Peak 6 User's Guide
288
The Add dialog
LE
The Amplitude Fit Envelope editor
LE


##### Auto Define Tracks


##### Bit Usage


##### Change Duration

<!-- p.289 -->
Auto Define Tracks
The Auto Define Tracks tool allows you to automatically
split audio recordings into separate Regions, each of which
will become an individual CD track when an audio CD is
burned.  This tool is useful for quickly editing LP and
cassette recordings, in preparation for burning them to CD.
This DSP tool works by automatically placing Region
markers into an audio document based on audio level,
minimum period of silence between songs, and
minimum song duration.  Peak analyzes the audio levels
throughout a document, and places Region markers
around each song.  The louder parts are considered to be
songs, and the quieter parts are the gaps between them.
Since some songs may contain very quiet parts that could
mistakenly be interpreted as gaps between tracks, a few
parameters are available to help Peak correctly distinguish
between songs and the gaps between them.  More information
about Auto Define Tracks is available in Chapter 8:  DSP.
Bit Usage
The small rectangles that make up the graph appear in
different shades of black, white, and green.  These
represent the level of bit usage over the selected amount
of time.  Darker shades equate to more bit usage, while
lighter shades indicate less bit usage.  Each rectangle
represents many samples, and the shading corresponds
to the audio waveform.  The primary purpose of this
display is to show whether the audio content has been
degraded by processing that has been applied to the file.
Bit Usage is not available in Peak LE.
Change Duration
The Change Duration command allows you to slow
down or speed up the selected material by a specified
amount without changing its pitch.
You can specify the change in duration by a value in
seconds, a percentage of the original, or, for rhythmicallyChapter 12:  Peak Menus
289
12
Auto Define Tracks
The Bit Usage Meter
LE
The Change Duration dialog


##### Change Duration (Variable)


##### Change Gain


##### Change Pitch


##### Change Pitch (Variable)


##### Convert Sample Rate

<!-- p.290 -->
oriented material, beats per minute.  A change in duration
by a reasonable amount, about 85% to 115%, can be very
convincing.  Exaggerated time stretching, 200% or more,
can result in some very interesting granular textures.
Try experimenting with the Change Duration function on
drums, rhythm loops, speech, sampled instruments or
sound effects to achieve a wide variety of useful effects.
Change Duration (Variable)
Variable Change Duration allows the selected portion of an
audio document to have its duration modified dynamically
over time, using Peak's familiar envelope editor dialog.
Change Gain
The Change Gain function changes the gain (i.e., amplitude)
of a selection.  You can specify the amount of gain change
either in decibels (dB) or as a percentage.  If you wish to
double the volume of a sound, you must apply approximately
6 dB of gain change, or add 200%.  Enable the Clipguard
checkbox in the Change Gain dialog to protect against the
possibility of clipping.  Clipguard will search through the audio
document or selection for the maximum peak in amplitude,
and then limit the Change Gain slider's range based on the
maximum peak it finds in the audio document or selection.
Change Pitch
The Change Pitch function allows you to alter the pitch of
an audio selection by as much as an octave.  The Change
Pitch dialog uses a slider that allows you to choose a new
pitch by musical interval, and "fine tune" the pitch change
by smaller increments called "cents." (Cents are divisions of
a musical octave-one octave is equivalent to 1200 centsthus, 100 cents is a semi-tone, 50 cents a quarter-tone, etc.)
You can also choose to alter the length, or duration, of the
selection just as you would by slowing down or speeding up
analog tape, or you can choose to preserve the duration of
the selection (something not possible with analog tape!).
Change Pitch (Variable)
The Variable Change Pitch function feature allows the selected
portion of an audio document to have its pitch modified
dynamically over time, using Peak's familiar envelope editor dialog.
Convert Sample Rate
The Convert Sample Rate command allows you to change
the sample rate of a sound without changing its pitch.
This feature is very useful for converting audio material
into lower or higher sample rates as required by other
applications.  Please note that sample rate conversion is
applied to an entire document.  It cannot be applied to
just a selection within a document.  Refer to Chapters 3
and 4 for an explanation of commonly used sample rates.
Peak 6 User's Guide
290
The Change Gain dialog
The Change Pitch dialog
The Convert Sample Rate dialog


##### Convolve


##### Crossfade Loop


##### Envelope from Audio

<!-- p.291 -->
Peak LE is limited to a maximum sample rate of 96kHz
Convolve
The Convolve command is a unique and powerful sound
design tool that allows you to apply the sonic (e.g.,
spectral) characteristics of one sound onto another.
Convolution works by multiplying the frequency spectrum
of the impulse contained in the clipboard and that of the
target audio document, reinforcing the frequencies that
are in common between the two.  To use the Convolve
DSP command, you must first copy a selection of audio.
The copied material will provide the spectral "character"
that you will apply to the target audio material.
Convolve is not available in Peak LE.
Crossfade Loop
The Crossfade Loop function applies a "smoothing" effect
to loops made in Peak audio documents.  Crossfade Loop
fades the end of the loop into the beginning of the loop
to make the loop sound smoother.  (It uses the Blending
envelope you've set in Peak's Preference menu's
Blending dialog.) Use the Crossfade Loop dialog to select
the length of the crossfade in milliseconds.
Crossfade Loop is not available in Peak LE.
Envelope from Audio
The Envelope from Audio tool allows you to create an
envelope from a selected portion of audio.  For
example, imagine a piece of music that has a specific
type of fade out, and you would like to be able to apply
that fade out "envelope" to other pieces of audio.  By
selecting the entire fade out, and then using the
Envelope from Audio command, Peak is able to "reverse
engineer" the fade out characteristics, and save them as
an envelope that can later be recalled in any of Peak's
envelope based tools, such as Fade In/Out, Gain
Envelope, etc.  Once an envelope is saved, it is available
for use in any of Peak's DSP tools that are able to access
the Peak Envelopes folder, stored in your Home
directory's Preferences folder.  Other DSP tools that can
access these envelopes include Fade In/Out, Blending,
Panner, Gain Envelope, Amplitude Fit, and Plug-In
Envelope.
Envelopes of varying precision may be created with
this tool.  For a more precise envelope, where more
points define the shape, enter a smaller value in
milliseconds in the "ms" field (or use the slider).   For
a less precise  (smoother) envelope – use a larger
value.
Chapter 12:  Peak Menus
291
12
The Crossfade Loop dialog
LE
Envelope from Audio
LE
LE


##### Fade In & Fade Out


##### Find Peak


##### Gain Envelope


##### Harmonic Rotate


##### ImpulseVerb

<!-- p.292 -->
Fade In & Fade Out
The Fade In and Fade Out commands allow you to apply
an amplitude envelope to an audio selection.  The Fade
In and Fade Out DSP commands, and the Fade Envelope
Editor dialog are described in detail in Chapter 5: Editing.
Find Peak
The Find Peak operation will place the insertion point at
the sample with the maximum amplitude value that it
locates in the audio selection.
Find Peak is not available in Peak LE.
Gain Envelope
The Gain Envelope operation allows you to enter an
amplitude envelope to be applied to an audio selection.
The selected audio's amplitude will be boosted and/or
attenuated according to the envelope you draw in the
Gain Envelope editor.
Harmonic Rotate
The Harmonic Rotate tool is excellent for sound design
experimentation.  This command allows the frequency
spectrum in a selected range of audio to be rotated
around a horizontal axis, which has the effect of taking
frequencies that were previously associated with one
section of a file with a particular amplitude, and assigning
them to different areas of audio with different amplitudes.
The Harmonic Rotate command can be previewed in real
time, so that desired setting can be found before spending
time processing.  Options for processing include
checkboxes for using Real & Imaginary calculations, and a
slider & text field to set amount of rotation.
Harmonic Rotate is not available in Peak LE.
ImpulseVerb
ImpulseVerbTM is an extremely high-quality reverb
processing tool, that utilizes actual reverb impulses
recorded in real spaces, such as performance halls,
catherdrals, caves, and other spaces that have various
reverberation qualities.
The same convolution technology that is used in Peak's
Convolve DSP tool allows these natural reverb impulses
to be applied to dry audio signals, giving the impression
Peak 6 User's Guide
292
LE
The Gain Envelope dialog
The Harmonic Rotate dialog
LE
The ImpulseVerb dialog


##### Invert


##### Loop Tuner


##### Mono-to-Stereo/Stereo-to-Mono

<!-- p.293 -->
that a file was actually recorded in a particular
environment.  ImpulseVerb offers real time preview, so
that the ideal settings can be found before processing.  In
addition, ImpulseVerb offers an editable Space envelope,
which controls reverb length and decay characteristics,
and a Wet/Dry slider to control the amount of reverb
being applied.
The ImpulseVerb dialog can also be used as a real
time convolution tool, and is not limited to using
impulse response files to create reverb effects.  Any
selection that is copied to the clipboard can be
convolved with the selected range of audio.  To
add audio files to the Space pop-up menu within
the ImpulseVerb dialog, simply save the desired file
as a 24-bit Sound Designer II format file, and
place into the Peak Impulses folder within:
/Mac HD/Users/Library/Preferences/
ImpulseVerb is not available in Peak LE!
Invert
The Invert function allows you to invert the phase of a
selection or an entire audio document.
Loop Tuner
Peak's Loop Tuner provides a way to visually line up the
start and end points of your loop and listen to the effects
of these adjustments as you make them.  The waveform
display in the Loop Tuner dialog shows the Start and End
points of the loop, which you can visually adjust with the
scroll bars at the bottom of the window to achieve a
natural transition at the loop point by carefully adjusting
the slope alignment.  The arrows of the slider will move
the loop markers sample by sample and clicking in the
body of the slider will move the loop markers to the next
zero crossing.  The two zoom buttons (magnifying glass
icons) in the upper left of the Loop Tuner dialog allow
you to adjust the vertical zoom up of the waveform.  The
two zoom buttons in the lower left hand corner of the
Loop Tuner dialog allow you to adjust the zoom view in
and out all the way down to the sample level.  You can
listen to the effects of the adjustments as you make them
by clicking on the Play button.
Loop Tuner is not available in Peak LE.
Mono To Stereo/Stereo To Mono
These two DSP commands may be used to easily convert
an audio document between one and two channel formats.
Mono To Stereo/Stereo To Mono is not available in Peak LE.
Chapter 12:  Peak Menus
293
12
The Loop Tuner dialog – showing a smooth transition between the
looop's end and beginning.
Mono to Stereo Conversion dialog
LE
LE
LE


##### Mix


##### Modulate


##### Normalize


##### Normalize (RMS)

<!-- p.294 -->
While automatic Mono To Stereo/Stereo To Mono
conversion is not available in Peak LE, you can
achieve the same end result manually, by selecting
all in an open mono or stereo document, and
then opening a new, empty document.  If you copy
an entire document, open a new empty
document, and attempt to paste in the contents of
the clipboard, Peak will detect if there is a different
number of channels, and will prompt you to enter
a Left/Right panning value, and will then allow
you to paste in the clipboard contents.
Mix
The Mix command allows you to mix material that you
have copied to the clipboard with a target selection.  This
function can be used as a kind of "sound-on-sound"
capability for mixing audio tracks together, or for
blending sound elements.  The Mix command is similar
to the Add command, but it does not have the potential
to clip because the target and clipboard contents are
attenuated before mixing.  To use the Mix command, you
must first copy a selection of audio.  The copied material
can then be mixed into the target audio material.
Modulate
This Modulate command functions as a "ring modulator"
which multiplies two audio signals together (e.g., the
material copied to the clipboard and the currently
selected audio).  The resulting audio includes the sum
and difference tones of the frequency components of the
modulated audio and the modulating audio.  These are
generally very complex timbres that often have a
"metallic" (i.e., inharmonic) character to them.
Modulate is not available in Peak LE.
Normalize
This command allows you to optimize the volume of a
selection or an entire audio document so that it is at its
maximum possible amplitude without clipping.  The
normalize function is very useful for boosting the volume
of material that was recorded at too low a level, or if used
on multiple audio documents, for ensuring that the
amplitude of each of the documents is uniform.
Normalize (RMS)
This command allows volume optimization of a
selection or an entire audio document, so that it is at its
Peak 6 User's Guide
294
The Mix dialog
The Modulator dialog
LE
The Normalize dialog


##### Panner


##### Perpetual Looper

<!-- p.295 -->
maximum possible amplitude without clipping.  RMS
Normalization is based on the RMS (Root Mean
Square), or "average" signal level of the selected
portion of audio.  The RMS value of a file cannot be
increased to an arbitrarily high value, that is, if the
desired RMS value  specified is so high that will produce
clipping, the Soft Clip feature will automatically activate
and the resulting level will be lower than specified by
the user.  The processed file will be as loud as possible
while guaranteeing that the signal will be limited to the
ceiling specified by the user.
The RMS Normalize dialog offers two parameters – RMS
Level and Digital Ceiling.  RMS Level allows you to enter
the desired RMS Level (or average level), and the Digital
Ceiling allows you to limit the maximum audio level,
which is also the level at which Soft Clipping will activate,
if the RMS Level exceeds it.
The RMS Normalize function is very useful for boosting
the volume of material that was recorded at too low a
level, or if used on multiple audio documents, for making
sure that the amplitude of each of the documents is
uniform.
RMS Normalize is not available in Peak LE.
Panner
The Panner allows you to adjust the panning, or left-toright movement, of a stereo document by drawing an
envelope in the Panner dialog.  Left is at the top of the
graph, and right is a the bottom.
Panner is not available in Peak LE.
Perpetual Looper
The Perpetual Looper is a new tool based on BIAS'
powerful Partial Harmonic Audio Technology (PHAT).
The Perpetual Looper makes it easy to create smooth,
seamless loops of monophonic, tonal sounds by
performing its work in the frequency domain, instead of
in the time domain as looping has traditionally been
done. PHAT is, at its heart, an analysis/additive
resynthesis engine, which gives Perpetual Looper potent
sound design capabilities beyond smooth looping. The
Perpetual Looper is intended for looping single notes or
sounds, not phrases or sections of audio, and generally
will not produce useful results from phrases.
PHAT uses a Fast Fourier Transform to convert the signal
from the time domain into the frequency domain, then
extracts the harmonic structure of the signal. The
Chapter 12:  Peak Menus
295
12
LE
LE
The Perpetual Looper Dialog
The Normalize (RMS) dialog
The Panner dialog


##### Phase Vocoder


##### Rappify


##### Repair Click


##### Repair Clicks

<!-- p.296 -->
Perpetual Looper's ability to treat each harmonic
component in the sound individually enables it to
eliminate looping discontinuities in the waveform of each
partial (often the cause of clicking in otherwise wellexecuted time-domain loops), smooth spectral differences
between the start and end of the loop (high frequencies of
a sound generally decay quickly), or smooth differences in
pitch modulation between the beginning and end of the
loop. It even allows the pitch and amplitude modulations
in vibrato to be manipulated independently of each other.
The Perpetual Looper separates the sound being looped
into two components: Partials, which are the harmonic
content, and the Residual signal, which is everything that is
not in the Partials (noise components, non-harmonic
partials, etc.). The user can employ both components, or
choose to use only one or the other. These options present
excellent sound design possibilities.  For more information
on the Perpetual Looper, please see Chapter 8:  DSP.
Perpetual Looper is not available in Peak LE.
Phase Vocoder
The Phase Vocoder is a type of audio spectrum
analysis/resynthesis that allows you to modify the
duration and/or pitch of an audio selection.
Phase Vocoder is not available in Peak LE.
Rappify
The Rappify command applies extreme dynamic filtering to a
selection.  As one Peak user described it, "Rappify can turn your
hi-fi into lo-fi!" If the target material has a pronounced beat, this
has the effect of reducing the material to its most essential
rhythmic components.  Try using this function with a variety of
different music material for some surprising and exciting results.
Rappify is not available in Peak LE.
Repair Click
The Repair Click command will eliminate a selected click
or "spike" in the waveform using the setting designated
in the Repair Clicks dialog (explained next).
Repair Click is not available in Peak LE.
Repair Clicks
The Repair Clicks command allows you to find and repair
pops or clicks in an audio document.  The Repair Clicks
dialog automates the process of finding and removing clicks
(usually indicated by a sharp "spike" in a waveform), much
like a search and replace dialog in a word processor.  Repair
Clicks works by looking for discontinuity from sample to
sample.  For example, a sample value of -100 followed by a
sample value of 10,000 is likely to be a click.  Once the area
Peak 6 User's Guide
296
LE
LE
The Phase Vocoder dialog
LE
The Rappify dialog
LE


##### Remove DC Offset


##### Reverse Boomerang


##### Reverse


##### Strip Silence

<!-- p.297 -->
of the click is identified, a smoothing technique is used to
maintain the original shape of the area being repaired.
If you are working with mostly digitally induced clicks,
the Repair Clicks dialog will become an indispensable
tool.  Extremely damaged signals such as those of a
scratching and popping vinyl record will require more
careful repair in addition to using the Repair Clicks
dialog, such as Change Gain, Delete, and the Pencil Tool.
Clicks such as those of a scratching and popping vinyl
record loose their detectability once they are sampled
using Analog to Digital converters.  For more information
on using Repair Clicks, please see Chapter 8: DSP.
Repair Clicks is not available in Peak LE.
Remove DC Offset
This function allows you to remove any DC Offset in your
audio file.  Peak scans the audio for DC offset and then
removes it.  Peak will scan the left and right channels of a
stereo file independently.  DC Offset is usually caused by
problems in the analog to digital conversion process.  The
result is that the waveform is not centered on the base line
– it is offset either higher or lower than the center line.
Remove DC Offset is not available in Peak LE.
Reverse Boomerang
The Reverse Boomerang command mixes a reversed
copy of the selected audio with the original.  This creates
a variety of interesting and useful results.  Try using
Boomerang on drum loops, voice, and sound effects.
Reverse
The Reverse command reverses the current selection.
In a reversed selection, the last sample becomes the
first sample, the second-to-last sample becomes the
second sample, and so-forth.  The effect is similar to
playing a record or cassette tape backwards.
Strip Silence
The Strip Silence tool allows areas of silence, or very low
amplitude, to be automatically silenced, minimized, or
completely removed from an audio document.  This tool
is useful for removing silence from recordings that
predominantly contain silence (or very low level audio
content), interspersed with some desired audio content.
By adjusting the various Strip Silence parameters, you
can control what content is preserved, and what is
silenced completely or deleted from an audio document.
The Strip Silence tool is composed of two sections, the
Noise Gate and the Stripper.  Additional information
about Strip Silence is available in Chapter 8:  DSP.
Chapter 12:  Peak Menus
297
12
LE
LE
The Reverse Boomerang dialog
The Strip Silence dialog
The Repair Clicks dialog


##### Swap Channels


##### Threshold


##### Voiceover Ducking


#### Sampler Menu

<!-- p.298 -->
Strip Silence is not available in Peak LE.
Swap Channels
The Swap Channels command reverses the left and right
channels in a stereo selection.
Swap Channels is not available in Peak LE.
Threshold
The Threshold command allows you to split up an audio
document into its component parts by analyzing the
amplitude levels in the audio document and setting a
cutoff or threshold amplitude.  For instance, you might
use the Threshold command on an audio document that
contains successive notes from a musical instrument to
split them up, or on a drum loop to break it up into its
component parts.  You can save the segments with
Markers, or as Regions.  See Chapter 8: DSP for more info
on using the Threshold command.
Threshold is not available in Peak LE.
Voiceover Ducking
Voiceover Ducking is useful for adding vocal material, such
as a radio or podcast show intro, commercial, etc. to a piece
of background audio.  Voiceover Ducking functions much
like a standard "Paste" command, but had the added benefit
of controlling several aspects of the background material.
Sampler Menu
This menu allows you to import samples directly from
compatible samplers, edit or process the audio using all
of Peak's functions, and send the modified sample back
to the sampler.  Peak supports SMDI samplers.  For
detailed information on using Peak with SMDI samplers,
see Chapter 11: Samplers.
Peak 6 User's Guide
298
LE
LE
Audio waveform divided into sections (using markers) based on
amplitude using the Threshold tool.
The Voiceover Ducking dialog
LE


##### Send to Sampler


##### Revert from Sampler


##### Send All to Sampler


##### Revert All from Sampler


##### E-mu, Ensoniq, ASR-X, Kurzweil, Peaver, Yamaha Sampler


#### Plug-ins Menu


##### Inserts (1-5)


##### BIAS

<!-- p.299 -->
Send to Sampler
The Send to Sampler command will send the selected
sample from Peak to your sampler using the Sampler dialog.
Revert from Sampler
The Revert from Sampler command will revert to the
previously received sample from Peak to your sampler
using the Sampler dialog.
Send All to Sampler
The Send All to Sampler command will send all selected
samples from Peak to your sampler using the Sampler dialog.
Revert All from Sampler
The Revert All from Sampler command will revert all
previously received samples from Peak to your sampler
using the Sampler dialog.
E-mu, Ensoniq ASR-X, Kurzweil, Peavey,
Yamaha Sampler
A large number of samplers support SMDI sample
transfer.  Choosing the name of your sampler from the
Sampler menu will open the Sampler dialog.  SMDI
Samplers, such as the Kurzweil K2500 or the E-mu E-IV,
use SCSI to transfer samples between devices.  In order
to transfer samples between the Mac and your sampler
using SMDI, you must connect a SCSI cable between
your Mac and the sampler.  Consult your sampler's
owner's manual for instructions on how to connect the
cable to your Mac with proper termination.  For detailed
information on using Peak with Samplers, see Chapter
11: Samplers.
Sampler Support is not available in Peak LE
Plug-Ins Menu
The Plug-Ins menu provides access to any Audio Units,
BIAS, or VST effects or virtual instrument plug-ins
installed in your system.
Peak can access plug-ins in two different ways – using
"Inserts" or through Vbox.  An insert can contain a single
plug-in, and up to 5 inserts are available.  When using inserts,
signal flows through the plug-in in each insert in the order of
the insert number.  For example, if an equalizer plug-in is
used on Insert 1, and a reverb plug-in is used on Insert 2, the
output of the equalizer plug-in will flow into the input of the
reverb plug-in.  Inserts are typically more convenient when
using a small number of plug-ins is required.
Inserts (1-5)
Any installed VST or Audio Units plug-in may be assigned
to any insert.  Each insert can contain a single plug-in.
VST & Audio Units plug-ins may be mixed and matched.
When more than one plug-in/insert is active, the output
of Insert 1 flows into the input of Insert 2, the output of
Insert 2 flows into the input of Insert 3, and so on.
Peak LE supports up to two plug-ins at a time.
BIAS
Choosing BIAS from the Insert "X" submenu brings up
another submenu, displaying all currently available BIAS
Chapter 12:  Peak Menus
299
12
LE
LE


##### VST


##### Audio Units


##### Vbox


##### Plug-in Envelope


##### Bounce


##### Real-Time Bounce

<!-- p.300 -->
plug-ins.  Select the desired plug-in from this menu, and
its editor window (interface) will appear.
VST
Choosing VST from the Insert "X" submenu brings up
another submenu, displaying all currently available VST
format plug-ins.  Select the desired plug-in from this
menu, and its editor window (interface) will appear.
Audio Units
Choosing Audio Units from the Insert "X" submenu brings
up another submenu, displaying all currently available Audio
Units format plug-ins.  Select the desired plug-in from this
menu, and its editor window (interface) will appear.  For
more information on third-party plug-ins, please refer to the
manufacturer's documentation.  For detailed information on
using plug-ins and Vbox, see Chapter 9: Plug-Ins.
Vbox
Peak includes BIAS Vbox for managing and mixing plugins.  Think of Vbox as a virtual effects box, in which you
can combine, repatch, and mix your plug-ins in real-time.
Using its unique effects matrix, Vbox lets you combine
multiple individual plug-ins.  Vbox can patch plug-ins in
series, in parallel, or in series and parallel, and you can
hot-swap plug-ins.  Vbox has controls for each plug-in to
mute, solo, and edit parameters.  Vbox also provides
input and output gain controls both globally and for each
individual plug-in, and a control for the global Wet/Dry
mix.  Use Vbox's A/B comparison feature to get just the
right settings, and use Vbox's presets to store
configurations and settings for later use.
To use multiple plug-ins within Vbox, you must
select Vbox from an available insert.  While Vbox
can be used on one insert, and other VST plug-ins
can be used on other inserts, it is recommended to
use multiple plug-in within the Vbox matrix, as it
offers much more control and flexibility.
Plug-In Envelope
Choosing Plug-In Envelope brings up Peak's Plug-in
Envelope editor, which allows applying a variable wet/dry
mix over a selected portion of an audio waveform.  For
example, if you have a dialogue clip that you would like
to apply reverb to, but would like the amount of reverb
to vary dynamically, you can create a custom envelope
that automatically varies the amount of reverb applied to
different portions of the clip.
Bounce
Once you have the right settings for your plug-ins, you
will probably want to apply the effects to the audio
document.  This process is called "bouncing." Bounce
the audio file to process the audio document with any
active plug-ins.  Bouncing changes the audio data stored
on disk, allowing you to use the Save command to
permanently apply the plug-in effects to your audio
document (this action is undo-able before saving).
Real-Time Bounce
The Real-Time Bounce command applies plug-ins to
audio documents in real time.  That is, if you are applying
an effect to an hour long audio document, it will take an
hour to bounce.  While this technique is significantly
slower than the standard Bounce command, it has the
added benefit of allowing plug-in parameters to be
adjusted during the bounce, and these changes will be
applied to the bounced file.
Another additional benefit of using the Real-Time
Bounce command is routing an audio signal out of Peak,
to a piece of outboard processing gear, and then back in
to Peak.  This technique allows processing files with
outboard gear, and requires using the included Jack VST
plug-in, and a multichannel audio interface.
Peak 6 User's Guide
300


#### Options Menu


##### Time Units


##### Sample Units


##### Playlist


##### Cache in RAM


##### Use Loop in Playback


##### Scroll During Play


##### Move Waveform During Playback


##### Compute File Max dB

<!-- p.301 -->
Options Menu
This menu contains a number of commands that allow
you to customize aspects of your Peak software such as
waveform display colors, output volume, and other user
preferences.
Time Units
The Time Units command allows you to choose a time
format for the audio timeline in Peak's audio document
window.  You can choose Samples, Hours:Min:Sec:cdframes,
Min:Sec:ms, various SMPTE formats, and Bars|Beats.  The
format you choose will depend on the nature of the project
that you are working on.
Sample Units
The Sample Units command allows you to select whether
sample units will be displayed in decimal, percentage, or dB.
Playlist
The Playlist menu item features a submenu with options
to view the Playlist's List, Waveform, or both views
simultaneously.
Cache in RAM
On Mac systems with 2 GB or more of RAM, Cache in
RAM can be used to speed up the editing process by up
to 500%.  When Cache in RAM is active, any audio files
that are opened are loaded completely into RAM, and all
temp files created during the editing process are also
stored in RAM.  When a file has been edited as desired
and saved, all relevant temp files that have been stored in
RAM are written back to the hard drive.
Use Loop in Playback
If an audio document contains a loop (defined by loop
markers), the Use Loop in Playback command (-L)
allows you to listen just to the Loop.  If playback is
initiated before the Loop, once the Loop is reached, it will
begin repeating.  A check mark next to this menu item
indicates that it is enabled.  To turn off loop playback,
disable this command by selecting it a second time.
Scroll During Play
When the Scroll During Play command is enabled, Peak
will "scroll" through the audio document as playback
progresses.  This conveniently allows you to visually
follow the progress of audio playback.  A check next to
this menu item indicates that it is enabled.  To disable
this command, deselect it.
Move Waveform During Playback
The Move Waveform During Play command will move
the waveform under the cursor as playback progresses,
so that the insertion point is always in the middle of the
waveform display.  A check next to this menu item
indicates that it is enabled.
Compute File Max dB
The Compute File Max dB command scans the audio
document for it's maximum amplitude, and gives you a
readout of the maximum value and its precise location.
Chapter 12:  Peak Menus
301
12


##### Show Edits


##### Show Marker Times


##### Show Overview


##### Show Cursor Info


##### Auto-Tiling Windows


##### Auto-Stacking Windows


##### Auto-Import Dual Mono


##### Auto-Adjust Bounce for Latency

<!-- p.302 -->
This feature requires extra time, and is best used with
smaller audio documents when needing to monitor
overall volume during editing.  Otherwise, keep this
option off and option-click the "Max" text left of the
overview to update the current audio document's
maximum volume indicator at the left of the overview.
Show Edits
The Show Edits command indicates areas of an audio
document that you have edited by enclosing these areas with
hatched lines.  This provides you with a convenient visual
reference to portions of the document that have been affected
by your editing actions.  Once you save a document, the edits
are saved, and these indicators will no longer appear.
Show Marker Times
The Show Marker Times command will show a time value as
well as a marker name for all Peak markers, loops, and Regions.
Show Overview
The Show Overview command (-,) provides an
Overview display of the entire audio waveform along the
top of the Audio Document window under the title bar.
This provides you with a convenient visual reference of
the overall document when you are editing only a
portion in the audio document window.
Show Cursor Info
The Show Cursor Info command (-Shift-T) brings up a
floating, translucent cursor information window, which
follows along with the mouse cursor as it is moved.
Choosing this command again turns the window off.
Auto-Tiling Windows
When this option is active, all audio documents that are
opened are tiled on the screen automatically.
Auto-Stacking Windows
When this option is active, all audio documents that are
opened are stacked on the screen automatically.
Auto-Import Dual Mono
Certain audio applications such as Digidesign's Pro Tools
do not directly support stereo interleaved documents,
and instead use "dual mono" documents which comprise
the right and left channels of stereo material.  Enabling
the Auto-Import Dual Mono command tells Peak to
automatically convert such documents into new stereo
audio documents when you attempt to open these
documents with the Open command.  Because Peak
actually writes a new stereo audio file to disk, this
conversion process requires hard disk space equivalent
to the two original mono documents.
Please note that the Import Dual Mono command
requires that both files be mono files, have the
same sample rate and bit depth, and the must
have the exact same name followed by the suffixes
".L" and ".R".  If you are using file type extensions
(.aif,
.wav,
etc)
the
format
must
be
"Filename.Side.Extension".  For example –
"Song1.L.aif" and "Song1.R.aif".
Auto-Adjust Bounce for Latency
Plug-ins may introduce a short delay, known as latency,
into the audio they are being used to process.
Depending on the type of processing the plug-in
performs, the amount of latency can vary – so it is
common for different plug-ins to produce varying
amounts of latency.  Latency typically appears in audio
documents after bouncing, by a shift in samples later in
time relative to the document's own timeline.
Peak features an automatic plug-in latency compensation
feature called Auto Adjust Bounce for Latency – which
automatically compensates for the latency introduced
into a processed signal.  Automatic latency compensation
Peak 6 User's Guide
302


##### Dynamic Scrub Time


##### Auto Snap


##### Keyboard MIDI Input


##### Movie Sound Tracks


##### Half Size


##### Original Size


##### Double Size


##### "Open" Dialog after Launch

<!-- p.303 -->
may be toggled on and off from Peak's Options menu.  A
check next to the Auto Adjust Bounce for Latency item
indicates that this feature is active.  The absence of a
check next to this item means it is inactive.
Plug-in latency compensation may also be used manually.
To compensate for plug-in latency when bouncing effects
on a selection, hold down the Option key when choosing
Bounce, and enter the delay compensation you want in
samples in the Bounce Effects dialog.  More information
about Plug-In latency is available in Chapter 9:  Plug-Ins.
Dynamic Scrub Time
Peak provides a unique audio auditioning technique called
dynamic scrubbing.  This feature is very useful for
precisely pinpointing a desired location in an audio
document.  Dynamic scrubbing allows you to drag the
mouse forward or backward over a waveform while Peak
plays a short loop (between 10 and 600 milliseconds) at
the scrub location.  You can control the tempo and
direction (forward or backward) of playback by dragging
the mouse slower or faster, forwards or backwards.  When
you have found the location you are looking for, you can
commence editing or playback.  The Dynamic Scrub Time
command allows you to choose the length of this playback
loop.  Depending on the audio document's content, a
value of between 40 to 80 milliseconds typically works
well.  See Chapter 5: Editing, for step-by-step instructions
on how to use the Dynamic Scrubbing feature.
Auto Snap
The Auto Snap command will automatically "snap" any
selection to the specified Snap To units.
Keyboard MIDI Input
Choosing the Keyboard MIDI Input command makes your
computer's keyboard function as a MIDI input device, able
to send MIDI signals to virtual instrument plug-ins being
hosted in Peak.  Additional information about virtual
instruments is available in Chapter 9:  Plug-Ins.
Movie Sound Tracks
The Movie Sound Tracks command brings up a dialog
that allows you to Enable or Disable the movie's existing
soundtracks.  You can use this dialog to toggle multiple
soundtracks contained in a movie on and off to check
balances or "solo" certain tracks.  Click on the Set button
to accept the changes, or Cancel to leave the movie
unaffected.
Half Size
Selecting this menu command displays the open
QuickTime movie at half of its original size.
Original Size
Selecting this menu command displays the open
QuickTime movie at its original size.
Double Size
Selecting this menu command displays the open
QuickTime movie at double its original size.
"Open" Dialog after Launch
The "Open" Dialog after Launch option allows you to
choose whether an open dialog is automatically
displayed when Peak is launched.  A check next to this
menu items indicates that it is active.  The absence of a
check indicates that it is inactive.
Chapter 12:  Peak Menus
303
12
The QuickTime Audio Tracks dialog


#### Window Menu


##### Transport


##### Toolbar


##### Contents


##### Movie


##### MIDI


##### Playlist


##### Tile Windows

<!-- p.304 -->
Window Menu
The commands in this menu allow you to display and manage
Peak's windows – including the Transport, Toolbar, Contents,
Movie, MIDI, Playlist, audio document, or active plug-in windows.
Transport
The Transport window is a floating, re-sizable window.  It
contains three areas: a time display showing elapsed time,
the Transport controls (Return to Zero, Stop, Play, Go to
End, Record, and Loop during playback), audio level meters
with clip/peak indicators, and a master volume fader.
Toolbar
You may assign almost any Peak command as an icon in the
Toolbar.  The Toolbar menu allows you to group together the
functions you use most often, so that you can simply click a
button instead of going to the menus.  For example, if you
frequently use Normalize and Pitch Change, you can choose
to have the icons for these functions in the Toolbar, so that
all you have to do to use one of them is to make an audio
selection and click a button.  The Toolbar is an easy way to
make your work in Peak faster and more efficient, allowing
you to customize the program to suit the way you work.
To add or subtract items from the Toolbar, use the
Shortcuts & Toolbar command in the Preferences dialog.
Contents
Peak has a floating Contents Window that will display all
Regions, Markers, and Loops contained in any open
audio documents.  There are three buttons at the bottom
of the palette that allow you to select which items to
view-from left to right: the Markers button, the Region
button and the Loop button.  Option-double-clicking on
any item in the Contents window will bring up the Edit
Region or Edit Marker dialog.
Movie
The Movie command toggles the Movie window on and off
for any QuickTime movie you currently have open in Peak.
MIDI
The MIDI command opens Peak's MIDI keyboard
window, which can be used to send MIDI signals to
virtual instruments being hosted in Peak.  More
information about the MIDI keyboard window is
available in Chapter 9:  Plug-Ins.
Playlist
The Playlist command (-P) allows you to open up the
current Playlist window.  For more information on using
Playlists, see Chapter 6: Playlists & CD Burning.
Tile Windows
The Tiling Windows command (-T) arranges all open
audio documents in a tile formation on your computer
screen.  This type of arrangement allows you to view multiple
open audio documents at once, and is particularly
convenient if you are cutting and pasting between several
documents or jumping back and forth between them for
editing purposes.  You can press a -number key
corresponding to an open audio document and the
document will become the active window.  (Click the
Windows menu to see the numbers that correspond to each
open audio document.)
Peak 6 User's Guide
304


##### Stack Windows


##### Hide All Audio Document Windows


##### Reset Windows


##### Toggle Contents Drawer


##### Plug-in Effect (1-5)


##### Document Windows


#### Links Menu

<!-- p.305 -->
Stack Windows
The Stack Windows command arranges all open audio
documents into a stack, with each document overlapping
the previous document, in the order that they were
opened.  This type of arrangement allows you to have the
maximum number of documents open and use the
minimum amount of screen real estate.  You can then
conveniently use the Windows menu to select any open
document and make it the active window.  Alternatively,
you can press the -number key corresponding to the
open document and the document will become the active
window.  (Click the Windows menu to see the -numbers
that correspond to each open audio document.)
These are active commands that will change the
state of document windows that are already open.
In addition, you can specify how windows are
opened by default, by using the Option menu's AutoStacking and Auto-Tiling Windows commands.
Hide All Audio Document Windows
This command temporarily hides all open audio document
windows.  This command is particularly useful when
working with Playlists, when the Playlist window is expanded
to a large size.  In this mode, Regions may still be pulled from
hidden documents into Playlists.  More information is
available in Chapter 6:  Playlists & CD Burning.
Reset Windows
This command relocates and resizes the Toolbar and
Transport windows to their default size and position on the
screen.  This is especially useful if you frequently work on
different size displays (for example, if you use a MacBook Pro
and occasionally use an external display  as a main display).
Toggle Contents Drawer
The Toggle Contents Drawer command opens and closes
the Contents Drawer that is located on each audio
document.  Choosing this command will open the
Contents Drawer on the right side of an audio document.
Choosing this command when the Contents Drawer is
open will close the drawer.  Toggling the Contents
Drawer can also be done with a button in the top right
corner of each audio document window.
The Contents Drawer is not available in Peak LE!
Plug-In Effect (1-5)
These menu items correspond to open plug-in editor
windows.  If you have plug-ins active, choosing the
corresponding insert number in the Window menu will
bring that plug-in's editor window to the foreground.
Document Windows
All currently open documents appear at the bottom of
the Window menu.  Choosing a filename here brings that
document window to the foreground.
Links Menu
The Links menu in Peak provides useful links to the BIAS
website.  Included are the BIAS home page, the Peak
updates page, technical support pages, online
documentation, special offers, and current BIAS product
information pages.
Chapter 12:  Peak Menus
305
12
LE


#### Conclusion

<!-- p.306 -->
Conclusion
You should now be familiar with using Peak.  For
additional information about using Peak, tutorials,
frequently asked questions, etc. please visit the BIAS
website:
http://www.bias-inc.com
Peak 6 User's Guide
306
