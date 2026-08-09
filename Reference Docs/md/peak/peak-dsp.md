# Peak 6 — Chapter 8: DSP

> The processing functions, including time and pitch. Useful for naming and for the shape of the dialogs.

> Extracted from `Peak 6 User Guide.pdf`, pages 197–230.


### Chapter 8:  DSP


#### Introduction


#### Processing Audio with Peak's DSP Tools


#### Peak's Audio Processing Tools


##### Add

<!-- p.197 -->
Chapter 8:
DSP
Introduction
Peak allows you to transform your audio with a variety of
powerful Digital Signal Processing (DSP) tools.  You can
apply these tools at any time by first making a selection
in an audio document and then choosing the desired
menu command from the DSP menu.
Processing Audio with Peak's DSP Tools
The following general procedure describes how to
process a selection in an audio document, or the entire
document, with a particular DSP function.  The specific
capabilities and parameters of the DSP function will vary.
To process audio with a DSP function:
1.
Select the portion of the audio that you wish to
process with the DSP function.  If no selection is
made, the entire document will be processed.
2.
Select the type of process you wish to use from the
DSP menu.
3.
A dialog appears allowing you to set the
parameters for the DSP function.
4.
Set the parameters for the DSP function as desired
and click OK.  Peak processes the selection with
the DSP function or plug-in.
Note that if no selection is made, Peak will apply
processing to the entire audio document.
Peak's Audio Processing Tools
Peak's DSP capabilities provide composers and
professional sound designers with many interesting and
useful audio effects and processing tools.  Peak's many
DSP functions include Add, Amplitude Fit, Auto Define
Tracks, Bit Usage, Change Duration, Change Duration
(Variable), Change Gain, Change Pitch, Change Pitch
(Variable), Convert Sample Rate, Convolve, Crossfade
Loop, Envelope From Audio, Fade In, Fade Out, Find
Peak, Gain Envelope, Harmonic Rotate, ImpulseVerb,
Invert, Loop Tuner, Mono to Stereo, Stereo To Mono,
Mix, Modify Sample Rate, Modulate, Normalize,
Normalize (RMS), Panner, Perpetual Looper, Phase
Vocoder, Rappify, Remove DC Offset, Repair Click, Repair
Clicks, Reverse Boomerang, Reverse, Strip Silence, Swap
Channels, Threshold, and Voiceover Ducking.
The following sections explain how to use each of these
functions.
By default, Peak's DSP tools appear in the DSP
menu in alphabetical order.  A user selectable "Use
Subcategories in DSP Menu" preference is also
available, which allows DSP tools to be grouped by
type of function (i.e., Analysis, Conversion, Gain,
etc.).  For more information, please see Chapter
12:  Peak Menus.
Add
The Add command adds any selection of audio copied to the
clipboard into the audio document at the selection point.  To
Chapter 8:  DSP
197
8


##### Amplitude Fit


##### Auto Define Tracks

<!-- p.198 -->
use the Add command, you must first copy a selection of
audio.  The copied material can then be mixed into the
target audio material.  The Add command can also be
customized using an envelope.  If you wish to Add material
with a variable level, click the envelope button in the Add
dialog.  The Add function differs from the Mix function
slightly, in that the Add function never alters the amplitude
level of the target audio material you are adding to – you can
only specify the level of the material you are adding.
To use the Add command:
1.
Select the audio that you wish to Add to another
audio document and choose Copy from the Edit
menu (-C) or Toolbar.
2.
Select the audio that you wish to add the copied
material into.
3.
Choose Add from the DSP menu or Toolbar.
4.
In the dialog that appears, use the slider to adjust
the amount of the copied signal that you wish to
add into the target audio document.  To add copied
material with a variable level, click the envelope
button, create the desired envelope, click the
Change button, and then click the Add button.  Be
careful not to add too high an amount, which can
potentially clip the signal.
5.
Click OK.  Peak adds the two signals together.
6.
To hear the results, press the Spacebar.
Add is not available in Peak LE.
Amplitude Fit
Amplitude Fit provides granular normalization of an
audio selection on a grain-by-grain basis.  Grains are
small groups of samples, often around 30ms.  As each
grain is read in, it is normalized according to the
Amplitude Fit Envelope – each normalized grain
crossfaded with the previous grain and written out as the
result.  Amplitude Fit can be used to maximize the level
of an audio selection, or to make quiet passages as loud
as louder passages.
To apply the Amplitude Envelope to an audio selection:
1.
Select the audio material you wish to process.
2.
Choose Amplitude Envelope from the DSP menu.
3.
Draw the amplitude envelope you wish to apply to
the audio selection in the envelope editor.  Points
above and below the 0% line will normalize the
selected
audio
using
the
grain-by-grain
normalization technique.
Amplitude Fit is not available in Peak LE.
Auto Define Tracks
The Auto Define Tracks tool allows you to automatically
split audio recordings into separate Regions, each of which
will become an individual CD track when an audio CD is
Peak 6 User's Guide
198
The Add Dialog
LE
The Amplitude Fit Dialog
LE

<!-- p.199 -->
burned. This tool is useful for quickly editing LP and
cassette recordings, in preparation for burning them to
CD, or exporting them for use with a portable music player.
This DSP tool works by automatically placing Region
markers into an audio document based on audio level,
minimum period of silence between songs, and
minimum song duration. Peak analyzes the audio levels
throughout a document, and places Region markers
around each song. The louder parts are considered to be
songs, and the quieter parts are the gaps between them.
Since some songs may contain very quiet parts that could
mistakenly be interpreted as gaps between tracks, a few
parameters are available to help Peak correctly
distinguish between songs and the gaps between them.
Minimum Silence Between Tracks
This field is used to enter the minimum gap time between
songs in the audio document you are working with. If a
recording you are working with contains two second gaps
between each song, start with the default value of "2.00"
in this field. If the gaps between songs vary in length,
enter the value of the shortest gap in the entire recording.
To measure the gap time between songs, activate
the Cursor Info overlay by selecting Show Cursor
Info (-Shift-T) from the Options menu, and then
select the gap between songs in the audio
waveform – the Cursor Info overlay will tell you
the length of the selected area. You may also need
to set your preferred Time Units to Min:Sec:ms –
this can be done in the Options Menu>Time Units.
Minimum Track Duration
Peak needs to have some information about the length of
each song, in order to accurately divide a long recording
Chapter 8:  DSP
199
8
The Auto Define Tracks dialog
Before using the Auto Define Tracks tool on an LP recording – note the area of silence near the middle of the recording has not yet been edited out...
After deleting silence from middle of the recording (where the LP was flipped over and Peak was left recording), and using Auto Define Tracks...

<!-- p.200 -->
into individual songs.  The Minimum Track Duration
parameter tells Peak how long the shortest song in a
recording is, and helps ensure that Region markers are
placed in the correct location in the audio waveform –
that is, a begin Region marker just before a song starts,
and an end Region marker just after a song ends – even
if the audio level falls below the threshold value set with
the Silence is Audio Below slider (see next section).  If a
recording you are working with contains songs that are
all approximately 4-5 minutes long, a good value to enter
in this field would be 240 seconds (4 minutes).
Silence is Audio Below slider
This slider controls the threshold level between audio
material you wish to define as a Region and the gaps
between it. As this slider is moved, you will notice Region
markers appearing in the audio waveform in the
background, and you will also notice the value in the
Number of Songs field changing. (More information on
the Number of Songs field is in the next section).  For
example, if you are working with a recording from a
cassette, the gaps will typically contain hiss or other
noise that is not completely silent, but has a significantly
lower amplitude level than the program material that you
are trying to isolate into tracks. By adjusting the Silence
is Audio Below slider, you can make the judgment as to
what should be silence, even if it does contain some low
level audio such as tape hiss, or other background noise.
Number of Songs field
This numerical field is tied to the Silence is Audio Below
slider, and displays the number of songs that Peak
automatically detects in a recording, based on the settings
used for Minimum Silence Between Songs, Minimum
Track Duration, and Silence is Audio Below. Depending
on the settings you choose, Peak will detect a different
number of songs, and this field will display different
numbers.  When the Silence is Audio Below slider is
moved, the number of songs detected will update, and
typing in a new value in the Number of Songs field will
update the Silence is Audio Below slider.  Typically, the
automatic number of songs detected is very accurate,
provided you have entered accurate settings for the other
parameters that define tracks. There may be times
however, where Peak detects more or fewer songs than
the recording actually contains.  You may choose to
define the number of tracks using the Silence is Audio
Below slider, or by typing in a known number of songs in
the recording, and then fine tuning with the Silence is
Audio Below slider.  Be aware that the values you enter in
the Number of Songs field, and the values you set with
the Silence is Audio Below slider may override each other.
To Auto Define Tracks:
1. Open a recording from a cassette or LP.
2. Select All (-A).
3. From the DSP menu, choose Auto Define Tracks.
4. In the Minimum Silence Between Songs field, enter
the shortest amount of time (gap time) between
any two songs in the entire recording.
5. In the Minimum Track Duration field, enter the
length of the shortest song in the recording.
6. Adjust the Silence is Audio Below slider until the
Number of Songs field reflects the actual number
of songs in the recording – Peak inserts Region
markers for each song detected (you can visually
scan the waveform of the entire recording and
count the number of individual songs).
7. Click OK.
Tips for using Auto Define Tracks
While Auto Define Tracks can greatly speed up the process
of dividing audio documents into track, there are a few
tips for getting the best results – these are outlined below.
Before Auto Defining Tracks
When recording cassettes and LPs, you will be working
with fairly long audio documents, and there are a few
things you can do to get the most accurate results with
the Auto Define Tracks tool.
Peak 6 User's Guide
200


##### Bit Usage

<!-- p.201 -->
•
Zoom out all the way, so that you can see the entire
audio document from beginning to end. This way,
when setting parameters in the Auto Define Tracks
dialog, Region markers being placed into the audio
waveform will be visible throughout the document.
•
Delete excess silence – if you have recorded excess
silence at the beginning or end of the audio
document, or recorded a long pause when "flipping"
a cassette or LP, it's a good idea to edit this out before
attempting to use the Auto Define Tracks tool.
•
You may want to apply noise reduction for clicks,
crackles, pops, broadband noise, and hum before
auto-defining tracks. These types of noise are
reflected in the audio waveform and may interfere
with accurate placement of markers.  Some of
Peak's built-in tools can help reduce/remove
certain kinds of unwanted noise, but for the best
results, BIAS recommends using SoundSoap or
SoundSoap Pro. More information is available at:
http://www.bias-inc.com/products/soundsoap/
http://www.bias-inc.com/products/soundsoappro/
•
Get an idea of the length of songs and gap times
between songs – this will give the most accurate
results in placing Region markers/creating tracks.
From the Options menu, choose Show Cursor Info
(-Shift-T), this will show you the duration of the
selected portion of the waveform.
•
Visually scan the audio waveform, while looking for:
The number of songs in the recording – you should
be able to see how many individual songs there are
by counting the number of high amplitude areas.
The shortest song – select the shortest song from
beginning to end, and then turn on Cursor Info,
which will show the length of the selected part of
the waveform.  You may need to zoom in to make
a more accurate selection.
The shortest gap time between songs – select the
gap between songs and measure using the Cursor
Info overlay.
After Auto Defining Tracks
There may be times when an anomaly in the audio
waveform, or a less than ideal setting causes a track/Region
marker to be placed in the wrong location.  In some cases,
when most of the tracks have been identified correctly, but
one or two have not, it may be easiest to simply adjust the
markers that are in the wrong position.
Region markers may be moved by clicking and dragging the
triangular base to the left or right. Also, by engaging Peak's
Vertical Lock mode, you may move the end of one
song/Region and the beginning of the next at the same time.
This technique is especially useful when working with
live recordings or DJ mixes, where it's important to
preserve the overall duration and timing – but a track
index needs to be adjusted into the correct position.
Nudging Markers
If all the Region markers placed into an audio document are
incorrectly placed, but are off by a small amount, you may
wish to use the Nudge feature to adjust them all
simultaneously. To nudge a group of markers, select the
portion of the audio waveform that contains the markers
you wish to nudge, and then choose Nudge from the Action
menu.  Now that you know a bit about Peak's Auto Define
Tracks tool, give it a try! This feature can save a great deal of
time, and the more you use it, and get a feel for how the
various parameters need to be set, the faster it will work.
Bit Usage
The Bit Usage meter allows you to monitor bit saturation,
degradation, and the "true" bit depth of a file.  The graph
display area in the Bit Usage dialog plots the bits in the
current selection on the vertical axis, and the duration of
the selection on the horizontal axis.
Chapter 8:  DSP
201
8


##### Change Duration

<!-- p.202 -->
The small rectangles that make up the graph appear in
different shades of black, white, and green.  These
represent the level of bit usage over the selected amount
of time.  Darker shades equate to more bit usage, while
lighter shades indicate less bit usage.  Each rectangle
represents many samples, and the shading corresponds
to the audio waveform.  The primary purpose of this
display is to show whether the audio content has been
degraded by processing that has been applied to the file.
For example, the screenshot above shows a 32-bit file, which
has fairly severe bit usage degradation in bits 01 - 07 (in the
upper part of the display), and also in bits 29 - 31 (in the
lower part) – these are represented as vertical white streaks.
The Bit Usage meter also shows the "true" bit depth of a file.
For example, a file recorded at 16-bit resolution, and then
saved as a 24-bit file will be a larger file, but will contain
empty bits.  It would appear in the Bit Usage meter with bits
00 - 15 in use (shaded with black and green rectangles),
while bits 16 - 31 would be empty, and appear all white.
To use the Bit Usage meter:
1.
Select the desired range of audio you wish to examine.
2.
Choose Bit Usage from the DSP menu – The bit
usage meter will appear, and plot a graph showing
the status of bit usage in the selected area of audio.
Bit Usage is not available in Peak LE.
Change Duration
You can specify the change in duration by a value in
seconds, a percentage of the original, or, for rhythmicallyoriented material, beats per minute.  In addition, when
working with rhythmically-oriented material, a special
Transient mode may be used for optimal results.
A change in duration by a reasonable amount, about 85%
to 115%, can be very convincing.  Exaggerated time
stretching, 200% or more, can result in some very
interesting granular textures.  Try experimenting with the
Change Duration function on drums, rhythm loops,
speech, sampled instruments or sound effects to achieve
a wide variety of useful effects.
To change the duration of a selection:
1.
Select the portion of audio that you wish to process.
2.
Choose Change Duration from DSP menu.  The
Change Duration dialog appears.
3.
Click the radio button for one of the following
fields, and enter a new duration value:
•
In the Seconds field, enter a new duration in
seconds.
•
In the Percentage field, type the percentage
you wish to slow down or speed up the
selected audio.  For example, typing "50%"
will speed up the selection to half  its original
duration, typing "200%" will slow down the
selection to twice its original duration.
Peak 6 User's Guide
202
The Bit Usage Meter
LE
The Change Duration dialog


##### Change Duration (Variable)

<!-- p.203 -->
•
In the Beats per minute field, type the old
tempo for the selected audio and then the
desired new tempo, and Peak will compute
the correct new duration.  Use this field to
change the duration of rhythmically-oriented
material.
•
Click the Tempo Envelope radio button to
Create a custom Tempo Envelope that will
vary the tempo/duration dynamically.
4.
If you wish to adjust the quality of the duration
change, click on the Prefs button.  The DSP
Preferences dialog will appear, allowing you to
choose the size of the Time Shifting Window and
Sample Rate Conversion quality that will be used in
processing.  For the Time Shifting Window, a lower
value is best for simpler, monophonic sounds, while
a higher value yields the best results for more
complex, polyrhythmic sounds.  For the Sample Rate
Conversion quality, 1 is lowest quality (and uses the
least amount of CPU power) and 10 is the highest
quality (using the most CPU power).  Once you have
set these preferences to your liking, click OK.
5.
Click OK when you have finished.  Peak changes
the duration of the selection according to the
settings that you chose.
A Sample Rate Conversion setting of 8 is the
recommended starting point.
Peak LE features a more basic Change Duration
algorithm.  It features the same controls with the
exception of the Tempo Envelope, and is limited in
quality compared to the algorithm used in Peak Pro.
Change Duration (Variable)
The Variable Change Duration feature allows the selected
portion of an audio document to have its duration
modified dynamically over time, using Peak's familiar
envelope editor dialog.
This DSP menu item offers quick access to Peak's
Duration Envelope editor dialog – it opens the same
editor window as when using the Duration Envelope
mode of the standard Change Duration DSP command.
To apply variable duration change to an audio selection:
1.
Select the audio material you wish to process.
2.
Choose Change Duration (Variable) from the DSP menu.
3.
Create the tempo envelope you wish to apply to the
audio selection in the envelope editor, by clicking
to create breakpoints.  Points above the 0% line will
lengthen the selected audio's duration (i.e., slow
down playback).  Points below the 0% line will
shorten the duration (i.e., speed up playback).
4.
To process the audio selection using the envelope,
press Change.
Chapter 8:  DSP
203
8
The DSP Preferences dialog
LE
The Duration Envelope dialog


##### Change Gain


##### Change Pitch

<!-- p.204 -->
Change Gain
The Change Gain function changes the gain (i.e.,
amplitude) of a selection.  You can specify the
amount of gain change either in decibels (dB) or as
a percentage.  If you wish to double the volume of
a sound, you must apply approximately 6 dB of
gain change, or add 200%.  Enable the Clipguard
checkbox in the Change Gain dialog to protect
against the possibility of clipping.  Clipguard will
search through the audio document or selection
for the maximum peak in amplitude, and then limit
the Change Gain slider's range based on the
maximum peak it finds in the audio document or
selection.
To change the gain of a selection:
1.
Select the portion of the audio that you wish to
process.
2.
Choose the Change Gain command from the DSP
menu or from the Toolbar.  The Change Gain dialog
appears.
3.
Enter the number of decibels or percentage by
which you wish to change the amplitude of the
selection by.
4.
If you wish to protect against the possibility of
clipping, enable Clipguard by checking the
Clipguard checkbox.
5.
Click OK when you have finished.  Peak will
change the gain of the signal by the amount you
specified.
Change Pitch
The Change Pitch function allows you to alter the pitch
of an audio selection by as much as an octave, with
excellent sounding results.
The Change Pitch dialog uses a pitch slider that allows
you to choose a new pitch by musical interval, and "fine
tune" the pitch change by smaller increments called
"cents." (Cents are divisions of a musical octave-one
octave is equivalent to 1200 cents – thus, 100 cents is a
semi-tone, 50 cents a quarter-tone, etc.)
You can also choose to alter the length, or duration, of
the selection just as you would by slowing down or
speeding up analog tape, or you can choose to preserve
the duration of the selection (something not possible
with analog tape!).
To change the pitch of an audio selection:
1.
Select the portion of the audio that you wish to process.
2.
Choose Change Pitch from the DSP menu or from
the Toolbar.  The Change Pitch dialog appears.
3.
Select the interval of transposition up or down by
entering a positive or negative value in cents in the
"Change Pitch by" field or by using the pitch slider.
Fine-tune the interval of transposition by entering
a positive or negative value in cents in the "Fine
Tune by" field or by using the Fine Tune slider.
Check the Preserve Duration checkbox to retain
the original duration of the selected audio.
4.
If you wish to adjust the quality of the pitch change,
Peak 6 User's Guide
204
The Change Gain dialog
The Change Pitch dialog


##### Change Pitch (Variable)


##### Convert Sample Rate

<!-- p.205 -->
click on the Prefs button.  The DSP Preferences dialog
will appear, allowing you to choose the size of the
Time Shifting Window and Sample Rate Conversion
quality that will be used in processing.  For the Time
Shifting Window, a lower value is best for simpler,
monophonic sounds, while a higher value yields the
best results for more complex, polyrhythmic sounds.
For the Sample Rate Conversion quality, 1 is lowest
quality (and uses the least amount of CPU power) and
10 is the highest quality (using the most CPU power).
Once you have set these preferences to your liking,
click OK to exit the DSP Preferences dialog.
5.
Click OK when you have finished.  Peak transposes
the pitch of the selected audio up or down by the
amount you specified.
A Sample Rate Conversion setting of 8 is the
recommended starting point.
Peak LE features a more basic Change Pitch
algorithm.  It features the same controls, but is
limited in quality compared to the algorithm used
in Peak Pro.
Change Pitch (Variable)
The Variable Change Pitch function feature allows the
selected portion of an audio document to have its pitch
modified dynamically over time, using Peak's familiar
envelope editor dialog.
To apply variable pitch change to an audio selection:
1.
Select the audio material you wish to process.
2.
Choose Change Pitch (Variable) from the DSP menu.
3.
Create the pitch envelope you wish to apply to the
audio selection in the envelope editor, by clicking to
create breakpoints.  Points above the 0% line will raise
pitch, and points below the 0% line will lower pitch.
4.
To process the audio selection using the pitch
envelope, press Change.
Convert Sample Rate
The Convert Sample Rate command allows you to
change the sample rate of an audio document without
changing its pitch.  This feature is very useful for
converting audio material into lower or higher sample
rates as required by other applications.  Please note that
sample rate conversion is applied to an entire document.
It cannot be applied to just a selection within a
document.
Sample rate conversion quality may be set in the DSP
Preferences section of the Preferences dialog.  A setting
of 1 is lowest quality (and uses the least amount of CPU
power and takes the least amount of processing time)
and 10 is the highest quality (using the most CPU power
and taking the longest to process).
Chapter 8:  DSP
205
8
LE
Pitch Envelope Dialog
The Convert Sample Rate dialog


##### Convolve

<!-- p.206 -->
The default setting for sample rate conversion is 8, and
this should work well in most cases.  In a practical sense,
use the highest setting possible for your particular
computer system's CPU.
To change the sample rate of a document:
1.
Choose Convert Sample Rate from the DSP menu
or Toolbar.  The Convert Sample Rate dialog
appears.
2.
Type in the sample rate that you wish to convert the
audio document to, or click the down arrow to select
from a pop-up of commonly used sample rates.
3.
Click OK.  Peak converts the entire audio
document to the selected sample rate.
A Mac's built-in audio hardware is typically
limited to sample rates from 11 kHz to 96 kHz, and
support will vary depending on the model of Mac.
Higher sample rates are possible with Core Audio
depending on the particular audio hardware
device and its Core Audio drivers.
Peak LE contains a basic sample rate conversion
algorithm.
Convolve
The Convolve command is a unique and powerful sound
design tool that allows you to apply the sonic (i.e.,
spectral) characteristics of one sound onto another.
Convolution works by multiplying the frequency
spectrum of the impulse contained in the clipboard and
that of the target audio document, reinforcing the
frequencies that are in common between the two.  The
results are always interesting and often quite unlike
anything you've heard before.  This is especially true
when the character of the two sounds are very different,
and when the clipboard impulse is harmonically rich
(imagine, for example, convolving a rainfall sample with
piano tinkling!).  To use the Convolve DSP command,
you must first copy a selection of audio.  The copied
material will provide the spectral "character" that you will
apply to the target audio material.  Convolution can be
very useful not only for creating new and unusual sound,
but also for giving an audio selection a sense of space.
Try copying a small amount of room noise to the
clipboard and then Convolve it with a selection of audio
– the convolved audio will sound like it is being played
in that room environment.
Users of the Convolve feature will also enjoy the
additional parameters of the ImpulseVerb DSP tool,
when set up to use the Clipboard contents as a
convolution source (See the section on ImpulseVerb
later in this chapter for more information).
Because the clipboard contents that provide the
spectrum for this process must be held in RAM,
small clipboard impulses should be used, unless a
large amount of RAM is available.  This process
can use a lot of RAM!
To use Convolve:
1.
Select the audio with the characteristics you wish
to apply and choose Copy (-C) from the Edit
menu or Toolbar.
2.
Select the audio that you wish to modify with the
copied audio impulse.
3.
Choose Convolve from the DSP menu.  Peak
applies the spectral character of the copied
material to the selection.
4.
To hear the results, press the Spacebar.
If the Option key is held down when the Convolve
DSP is selected, an envelope editor window
appears, and allows variable convolution
between the two audio sources being used.
Peak 6 User's Guide
206
LE


##### Crossfade Loop

<!-- p.207 -->
To apply variable convolution to an audio selection:
1.
Copy the audio material you wish to convolve with
to the Clipboard.
2.
Hold down the Option key while choosing
Convolve from the DSP menu.
3.
Create the convolution envelope you wish to apply
to the audio selection in the envelope editor, by
clicking to create breakpoints.  By default, the
convolution envelope is set to apply 100%
convolution across the entire audio selection.
Breakpoints created below this default envelope
will convolve by a lesser percentage – use the Yaxis scale along the left side of the window as a
guide.
4.
To process the audio selection using the
convolution envelope, press Change.
Convolve is not available in Peak LE.
Crossfade Loop
Peak allows you to crossfade the start and end points of
a loop.  Crossfading a loop can be very useful for
smoothing the transition between the end of the loop
and its beginning as it repeats.  Peak allows you to
control the envelope of the crossfade, the duration, and
other parameters in the Crossfade Loop dialog.
The four checkboxes at the top of the Crossfade Loop
dialog allow you to customize how the end of the loop is
faded into the beginning of the loop. These boxes
indicate where in the loop the crossfade is applied. For
most loops, you should be able to leave the default
checkbox checked and get good results.
Crossfade Variations
If you consider the crossfades "A", "B", "C", and "D" from
left to right, then:
"A" = Crossfade between A and C
"B" = Crossfade between B and D
"C" = Crossfade between C and A
"D" = Crossfade between D and B
Chapter 8:  DSP
207
8
The Convolve Envelope Dialog
LE
The Crossfade Loop dialog
Crossfade positioning options – different uses for loops may call for
different loop crossfade settings – With crossfade position "C" checked
a crossfade is applied as indicated by the red "X".
A
B
C
D

<!-- p.208 -->
The way these crossfade variations are configured
depends on where the loop is destined to be used – for
most purposes the default crossfade position (Position
"C") works well – if however, you plan on transferring
these loops to a sample playback instrument such as a
SMDI sampler, then you may want to experiment with
different crossfade positions/combinations.  Some
hardware based samplers offer advanced playback
controls, allowing loops to be played forward, backward,
and in various other ways. By changing where in the loop
crossfades are applied, you can customize your audio
content for a particular sampler and for the desired effect.
Another application that may require using loop
crossfade position(s) other than the default position "C",
are when creating audio loops intended to be used in a
proprietary video game audio engine. Depending on the
requirements of a particular video game's audio engine,
users may need to adjust the position of the crossfades
used in their loops to achieve the desired effect.
Depending on the application requiring crossfades, users
may need "loop with release" (plays the tail of the audio
document – the section of audio that lies outside the
loop markers – after the loop stops playing/sampler's
key is released) or "loop hold" (doesn't play the audio
after the loop when the key is released). Because of
these different modes, users may need to turn some
crossfades on or off.
To crossfade a loop:
1. Create a loop using one of the techniques
explained earlier in this chapter.
2. Choose Crossfade Loop from the DSP menu or
Toolbar.
3. In the Crossfade Loop dialog that appears, enter a
duration for the crossfade-in milliseconds and click
OK.
4. To hear the completed crossfade, choose Select
Loop from the Edit menu, select Use Loop in
Playback from the Options menu (-L) or click
the Loop button on the Transport, and press the
Spacebar. You will hear the loop, complete with
your crossfade.
To edit a Crossfade Loop Envelope:
•
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
Continue creating and dragging breakpoints until you
have created the envelope that you desire.  If you wish
to delete a breakpoint, click on it with the cursor and
press the Delete key on your computer keyboard.
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
Peak 6 User's Guide
208
The Blending Envelope Editor


##### Envelope from Audio


##### Fade In & Fade Out

<!-- p.209 -->
the Options menu or click the Loop button on the
Toolbar, and press the Spacebar.  You will hear the loop,
complete with your crossfade.
If you save your custom Blending envelope into:
/MacintoshHD/Users/<YourAccount>/Library/
Preferences/Peak Envelopes/
it will automatically appear in the Envelope
pop-up menu it the Fade In/Out Envelope
editor.  Please note that you must apply the
custom fade in/out for it to later appear in the
pop-up menu.
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
Envelope, etc.
Once an envelope is saved, it is available for use in any of
Peak's DSP tools that are able to access the Peak
Envelopes folder, stored in your Home directory's
Preferences folder.  Other DSP tools that can access these
envelopes include Fade In/Out, Blending, Panner, Gain
Envelope, Amplitude Fit, and Plug-In Envelope.
Envelopes of varying precision may be created with this
tool.  For a more precise envelope, where more points
define the shape, enter a smaller value in milliseconds in
the "ms" field (or use the slider).   For a less precise (or
"smoother") envelope, where fewer points define the
shape of the envelope – use a larger value.
Fade In & Fade Out
The Fade In and Fade Out commands allow you to apply
an amplitude envelope to an audio selection.  The Fade
In and Fade Out DSP functions, and the Fade Envelope
Editor dialog are described at length in Chapter 5.
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
Chapter 8:  DSP
209
8
The Envelope from Audio's Envelope Resolution dialog
LE


##### Find Peak


##### Gain Envelope


##### Harmonic Rotate

<!-- p.210 -->
2.
Choose Fade Out from the DSP menu, or click the
Fade Out button in the Toolbar.  Peak applies the
Fade Out to the selection you have made in the
audio document.
3.
To hear the Fade Out, press Control-Spacebar.  You
will hear the selected audio complete with your
Fade Out.
More detailed information regarding the Fade In
and Fade Out DSP tools is available in Chapter 5:
Editing.
Find Peak
The Find Peak operation will place the insertion point at
the sample with the maximum amplitude value that it
locates in the audio selection.
To find the maximum amplitude point in an audio
selection:
1.  Select the audio in which you wish to locate the
maximum amplitude.
2.  Choose Find Peak from the DSP menu.
3.
A dialog will appear telling you what the peak value
is, and where it is located.  The insertion point will
be placed at the sample where the greatest
amplitude was located.
4.
Press the left arrow to bring the insertion point
into view or the Shift key to the view of the
insertion point at the sample level
Find Peak is not available in Peak LE.
Gain Envelope
The Gain Envelope operation allows you to enter an
amplitude envelope to be applied to an audio selection.
The selected audio's amplitude will be boosted and/or
attenuated according to the envelope you draw in the
Gain Envelope editor.  It is easy to cause samples to clip
when using this feature, so use it carefully.
To apply variable gain and attenuation to an audio
selection:
1.
Select the audio material you wish to process.
2.
Choose Gain Envelope from the DSP menu.
3.
Draw the gain envelope you wish to apply to the
audio selection in the envelope editor.  Points
above the 0% line will amplify the selected audio.
Points below the 0% line will attenuate the selected
audio.  Note that the waveform display in the Gain
Envelope editor will change according the
envelope you draw.
4.
To process the audio selection using the gain
envelope, press Change.
Harmonic Rotate
The Harmonic Rotate tool is excellent for sound design
experimentation.  This command allows the frequency
spectrum in a selected range of audio to be rotated
Peak 6 User's Guide
210
The results of a Find Peak operation
LE
The Gain Envelope dialog


##### ImpulseVerb

<!-- p.211 -->
around a horizontal axis, which has the effect of taking
frequencies that were previously associated with one
section of the frequency spectrum, and assigning them
to different areas of the frequency spectrum.  The
Harmonic Rotate command can be previewed in real
time, so that desired setting can be found before
spending time processing.  Options for processing
include checkboxes for using Real & Imaginary
calculations, and a slider & text field to set amount of
rotation.
To apply Harmonic Rotate to an audio selection:
1.
Select the audio material you wish to process.
2.
Choose Harmonic Rotate from the DSP menu.
3.
Click the Preview button, and select the desired
settings for Real or Imaginary frequency spectrum
calculation, and move the slider, or type in the
desired value.
4.
When you've made the desired settings, click OK.
Harmonic Rotate is not available in Peak LE!
ImpulseVerb
ImpulseVerb is an extremely high-quality reverb
processing tool, that utilizes actual reverb impulses
recorded in real spaces, such as performance halls,
cathedrals, caves, and other spaces that have
various reverberation qualities.  The same
convolution technology that is used in Peak's
Convolve DSP tool allows these natural reverb
impulses to be applied to dry audio signals, giving
the impression that a file was actually recorded in a
particular environment.
ImpulseVerb offers real time preview, so that the ideal
settings can be found before processing.  In addition,
ImpulseVerb offers an editable Space envelope, which
controls reverb length and decay characteristics, and a
Wet/Dry slider to control the amount of reverb being
applied.
Enhancements to ImpulseVerb include a new user
interface, as well as new Source Gain and Impulse Gain
sliders, for even more control over reverb
characteristics.
The ImpulseVerb dialog can also be used as a real
time convolution tool, and is not limited to using
impulse response files to create reverb effects.  Any
selection that is copied to the clipboard can be
convolved with the selected range of audio.  To
add audio files to the Space pop-up menu within
the ImpulseVerb dialog, simply save the desired file
as a 24-bit Sound Designer II format file, and
place into the Peak Impulses folder within:
/MacintoshHD/Library/ApplicationSupport/BIAS/
Peak/Peak Impulses/
Chapter 8:  DSP
211
8
The Harmonic Rotate dialog
LE
The ImpulseVerb dialog


##### Invert


##### Loop Tuner

<!-- p.212 -->
To apply reverb using ImpulseVerb:
1.
Select the audio material you wish to process.
2.
Choose ImpulseVerb from the DSP menu.
3.
Select a Space using the Space pop-up menu, or
choose clipboard to use the contents of the
clipboard.
4.
Click the Preview button, and adjust the Wet/Dry
slider to the desired position.
5.  To apply the current reverb characteristics, click
the Apply button.
To modify reverb characteristics:
•
Click the Space Envelope checkbox – a standard
Peak envelope editor appears.  The example below
shows an envelope for a reverb that fades over
time.
While the settings above describe how to simply
modify the reverb effect, other types of settings may
be useful for creative sound design.  When using
the ImpulseVerb interface for real time
convolution, experiment with the type of Space
Envelope used – especially when the content used
is a non-impulse response file.
ImpulseVerb is not available in Peak LE!
Invert
The Invert function allows you to invert the phase of a
selection or an entire audio document.
To invert the phase of a selection:
1.
Select the portion of the audio that you wish to invert.
2.
Choose Invert from the DSP menu.  Peak inverts
the phase of the selected audio.
Loop Tuner
Peak's Loop Tuner provides a way to visually line up
the start and end points of your loop and listen to the
effects of these adjustments as you make them.  If you
wish to "tune" a loop you've made, simply select Loop
Tuner from the DSP menu or Toolbar, and a dialog will
appear.  The waveform display in the Loop Tuner
dialog shows the Start and End points of the loop,
which you can visually adjust with the scroll bars at the
bottom of the window to achieve a natural transition
at the loop point by carefully adjusting the slope
alignment.
The arrows of the slider will move the loop markers
sample by sample and clicking in the body of the
slider will move the loop markers to the next zero
crossing.  The two zoom buttons (magnifying glass
Peak 6 User's Guide
212
LE
The Loop Tuner showing a smooth transition between the end and
beginning of the loop – this would create a seamless loop.


##### Mono-to-Stereo/Stereo-to-Mono

<!-- p.213 -->
icons) in the upper left of the Loop Tuner dialog
allow you to adjust the vertical zoom up of the
waveform.  The two zoom buttons in the lower left
hand corner of the Loop Tuner dialog allow you to
adjust the zoom view in and out all the way down to
the sample level.  You can listen to the effects of the
adjustments as you make them by clicking on the Play
button.  To exit this dialog, click on OK to accept the
changes, or Cancel to leave the original loop
unaffected.
Loop Tuner is not available in Peak LE.
Mono To Stereo/Stereo To Mono
These two DSP commands may be used to easily convert
an audio document between one and two channel
formats.
To change an audio document from mono to stereo
1.
Select the entire audio document with the Select
All command from the Edit menu (-A).
2.
Choose Mono To Stereo from the DSP menu or
Toolbar.
3.
In the dialog that appears, adjust the slider to
adjust the left and right-channel balance in the
mix.
4.
Click OK.  Peak converts the mono document to a
stereo document.
To change an audio document from stereo to mono:
1.
Select the entire audio document with the Select
All command from the Edit menu (-A).
2.
Choose Stereo To Mono from the DSP menu or
Toolbar.
3.
In the dialog that appears, adjust the slider to
adjust the left and right-channel balance in the mix.
4.
Click OK.  Peak converts the stereo document to a
mono document.
Mono To Stereo/Stereo To Mono is not available in
Peak LE.
Chapter 8:  DSP
213
8
The Loop Tuner showing an abrupt transition between the end and
beginning of the loop – this would create a click each time the loop
LE
Mono to Stereo Conversion dialog
Stereo to Mono Conversion dialog
LE


##### Mix


##### Modify Sample Rate

<!-- p.214 -->
While automatic Mono To Stereo/Stereo To Mono
conversion is not available in Peak LE, you can
achieve the same end result manually, by
selecting all in an open mono or stereo
document, and then opening a new, empty
document.  If you copy an entire document, open
a new empty document, and attempt to paste in
the contents of the clipboard, Peak will detect if
there is a different number of channels, and will
prompt you to enter a Left/Right panning value,
and will then allow you to paste in the clipboard
contents.
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
can then be mixed into the target audio material.  The
Mix command also allows an envelope to be applied to
the copied material.  This can be useful when the content
being mixed needs to have variable levels in it.  The Mix
function differs slightly from the Add function, in that the
percentage slider affects both the material being mixed,
as well as the original target material.  For example, a
50/50 mix will lower the amplitude level of the target
material.
To use the Mix command:
1.
Select the audio you wish to mix into another
audio document and choose Copy from the Edit
menu or Toolbar (or press -C).
2.
Select the audio that you wish to mix the copied
material into.
3.
Choose Mix from the DSP menu.
4.
In the dialog that appears, use the slider to
adjust the amount of the copied signal that
you wish to mix into the target audio
document.  To mix copied material with a
variable level, click the envelope button,
create the desired envelope, and then click the
Change button.
5.
Click OK – Peak mixes the two signals together.
6.
To hear the results, press the Spacebar.
Modify Sample Rate
The Modify Sample Rate command simply changes the
sample rate value store in a file's header metadata.  By
changing this value, you can force a file to play back
faster or slower.
This command does not actually change a file's
sample rate.  To change sample rate, use Peak's
Convert Sample Rate command.
Peak 6 User's Guide
214
The Mixer dialog
The Modify Sample Rate dialog


##### Modulate


##### Normalize

<!-- p.215 -->
Modulate
This Modulate command functions as a "ring modulator"
which multiplies two audio signals together (e.g., the
material copied to the clipboard and the currently
selected audio).  The resulting audio includes the sum
and difference tones of the frequency components of the
modulated audio and the modulating audio.  These are
generally very complex timbres that often have a
"metallic" (i.e., inharmonic) character to them.
Try using generated tones, like sine, swept sine,
square, or saw-tooth waves with the Modulate
command.
To use the Modulate command:
1.
Select the desired source audio and choose Copy
from the Edit menu or Toolbar (or press -C).
2.
Select the destination audio.
3.
Choose Modulate from the DSP menu.
4.
In the dialog that appears, use the slider to adjust
the amount of the copied signal that you wish to
use to modulate the destination audio document.
5.
Click OK – Peak processes the two signals.
6.
To hear the results, press the Spacebar.
Modulate is not available in Peak LE.
Normalize
This command allows you to optimize the volume of a
selection or an entire audio document so that it is at its
maximum possible amplitude without clipping.  The
normalize function is very useful for boosting the
volume of material that was recorded at too low a level,
or if used on multiple audio documents, for making
sure that the amplitude of each of the documents is
uniform.
Note that because normalization uniformly
changes the amplitude of a selection (i.e., the
proportions between loud and soft stay the same),
it does not have the same effect as
compression/limiting (which makes the soft parts
louder and does not allow the loud part to exceed
a specified amplitude).
To normalize a selection:
1.
Select the audio that you wish to normalize.  If you
wish to normalize the entire audio document,
choose Select All from the Edit menu (-A).
2.
Choose Normalize from the DSP menu.
3.
In the dialog that appears, use the slider to adjust
the percentage of normalization from the
maximum level.
4.
Click OK – Peak normalizes the selected audio.
Chapter 8:  DSP
215
8
The Modulator dialog
LE
The Normalize dialog


##### Normalize (RMS)


##### Panner

<!-- p.216 -->
Normalize (RMS)
This command allows you to optimize the volume of a
selection or an entire audio document so that it is at its
maximum possible amplitude without clipping.  RMS
Normalization is based on the RMS (Root Mean Square), or
"average" signal level of the selected portion of audio.  The
RMS value of a file cannot be increased to an arbitrarily high
value.  If the desired RMS specified by the user is so high
that will produce clipping in the signal, the Soft Clip feature
will automatically activate and the resulting RMS level will
be lower than the one specified by the user.  The processed
file will be as loud as possible while guaranteeing that the
signal will be limited to the ceiling specified by the user.
The RMS Normalize dialog offers two parameters – RMS
Level and Digital Ceiling.  RMS Level allows you to enter the
desired RMS Level (or average level), and the Digital
Ceiling allows you to limit the maximum audio level, which
is also the level at which Soft Clipping will activate, if the
RMS Level exceeds it.
The RMS Normalize function is very useful for boosting the
volume of material that was recorded at too low a level, or
if used on multiple audio documents, for making sure that
the amplitude of each of the documents is uniform.
To RMS Normalize a selection:
1.
Select the audio that you wish to RMS normalize.  If
you wish to normalize the entire audio document,
choose Select All from the Edit menu (-A).
2.
Choose Normalize (RMS) from the DSP menu.
3.
In the dialog that appears, enter the desired RMS
and Digital Ceiling levels, and click the OK button.
4.
Click OK – Peak normalizes the selected audio.
RMS Normalize is not available in Peak LE.
Panner
The Panner allows you to adjust the panning, or left-toright movement, of a stereo document by drawing an
envelope in the Panner dialog.  Left is at the top of the
graph, and right is at the bottom.
The Panner also offers an option to keep volume constant as
audio pans from side to side.  When the Keep Volume
Constant checkbox is enabled, Peak uses Logarithmic
calculation to determine volume levels while panning between
the left and right channels – resulting in overall volume levels
being preserved.  When this option is not enabled, Peak uses
linear calculations and does not preserve volume levels.  When
disabled, it is common to have dips in the overall audio level
when panning from one channel to the other.
To adjust the panning of a selection:
1.
Select the stereo document that you wish to adjust.
If you wish to select the entire document, choose
Select All from the Edit menu (-A).
2.
Choose Panner from the DSP menu.
3.
In the Panner editor dialog that appears, use the
envelope to "draw in" the panning you desire.
4.
Click OK.  Peak will change the panning of the
document to reflect the changes you've made.
Peak 6 User's Guide
216
The Normalize (RMS) dialog
LE
The Panner editor dialog


##### Perpetual Looper

<!-- p.217 -->
Panner is not available in Peak LE.
Perpetual Looper
The Perpetual Looper is based on BIAS' powerful Partial
Harmonic Audio Technology (PHAT). The Perpetual
Looper makes it easy to create smooth, seamless loops of
monophonic, tonal sounds by performing its work in the
frequency domain, instead of in the time domain as
looping has traditionally been done. PHAT is, at its heart,
an analysis/additive resynthesis engine, which gives
Perpetual Looper potent sound design capabilities
beyond smooth looping. The Perpetual Looper is
intended for looping single notes or sounds, not phrases
or sections of audio, and generally will not produce
useful results from phrases.
PHAT uses a Fast Fourier Transform to convert the signal
from the time domain into the frequency domain, then
extracts the harmonic structure of the signal. The
Perpetual Looper's ability to treat each harmonic
component in the sound individually enables it to
eliminate looping discontinuities in the waveform of
each partial (often the cause of clicking in otherwise
well-executed time-domain loops), smooth spectral
differences between the start and end of the loop (high
frequencies of a sound generally decay quickly), or
smooth differences in pitch modulation between the
beginning and end of the loop. It even allows the pitch
and amplitude modulations in vibrato to be manipulated
independently of each other.
The Perpetual Looper separates the sound being looped
into two components: Partials, which are the harmonic
content, and the Residual signal, which is everything that
is not in the Partials (noise components, non-harmonic
partials, etc.). The user can employ both components, or
choose to use only one or the other. These options
present excellent sound design possibilities.
The Perpetual Looper's parameters are explained below.
Preset
The Perpetual Looper begins its extraction of a sound's
harmonic structure by determining its fundamental
frequency. The Preset chooses the range of fundamental
frequencies that will be examined as the basis for
analysis. Select a range of fundamental frequencies that
contains the pitch of the material you are trying to loop.
Chapter 8:  DSP
217
8
LE
The Perpetual Looper dialog

<!-- p.218 -->
For most applications, the default value of 100 to 600 Hz
will produce excellent results, however, for some
applications, best results are achieved by setting the
range to be narrower. This can be accomplished by
selecting a narrower range from the Preset menu, if one
containing the fundamental frequency of the sound is
available, or by using the Min and Max Pitch parameters
to narrow the range.
Minimum (Min) Pitch
This is the lowest value in the range of fundamental
frequencies being analyzed. Choosing a Preset will set
this parameter, but it can be further adjusted to optimize
loop operation by narrowing the range.
Maximum (Max) Pitch
This is the highest value in the range of fundamental
frequencies being analyzed. Choosing a Preset will set
this parameter, but it can be further adjusted to optimize
the loop operation by narrowing the range.
Analysis Window Duration
The Analysis Window Duration specifies the time
window used for FFT analysis. For most uses, the default
value of 40 ms will produce excellent results, but a good
rule of thumb is that the duration should be long enough
to contain three to four periods of the waveform. (The
period, in seconds, is 1/frequency.) When trying to loop
low-pitched sounds, increasing the Analysis Window
Duration may produce the best results.
Choose an item to generate
The Perpetual Looper separates sound into Partials and
Residual components. When the "Partials + Residual"
radio button is selected, both components will be
generated by the PHAT resynthesis engine, producing
the most natural results. Click the "Partials" button to
generate only the harmonic partials and discard the
Residual component, or click the "Residual" button to
discard the harmonic component and keep only the
Residual.
Use Loop in Playback
When checked, this allows auditioning the loop.
However, the Perpetual Looper also affects the audio just
after the loop. Unchecking "Use Loop in Playback" allows
playback to continue past the loop to the end, enabling
auditioning of the audio just after the loop.
Frequency Smoothing
Frequency Smoothing modifies frequency variations,
such as in vibrato, that occur within the loop. With the
slider set to the left (0 %), no smoothing is applied. With
the slider set to the right (100 %), all frequency variations
are removed, resulting in an unnaturally perfect sound.
For example, this can turn vibrato (frequency and
amplitude variations) into tremolo (amplitude variation
only).
Amplitude Smoothing
Amplitude Smoothing modifies level variations, such as
in tremolo or vibrato, that occur within the loop. With
the slider set to the left (0%), no smoothing is applied.
With the slider set to the right (100%), all amplitude
variations are removed. When applied to vibrato, this
produces an effect not found in nature, where frequency
variations are nearly always accompanied by amplitude
variations.
Loop Morph Out Time
The Perpetual Looper modifies both the partials and the
residual within the loop. Loop Morph Out Time sets the
period of time following the loop over which the
harmonic and residual components are crossfaded, both
in amplitude and frequency, back to the levels in the
unmodified material after the loop.
Peak 6 User's Guide
218


##### Phase Vocoder

<!-- p.219 -->
Residual Gain
Gain of the residual signal component within the loop can be
set with this control independently of the gain of the partials.
Residual Gain Morph In Time
If Residual Gain has been adjusted, Loop Morph Out
Timewill correct for the timbral discontinuity that occurs
at the loop end. Residual Gain Morph In Time serves a
similar function for the Residual signal component only
at the loop start. This control sets the time over which
the gain of the residual signal component is faded from
its level before the loop to the level set by Residual Gain
for inside the loop.
To create a loop with the Perpetual Looper:
1.
Open a file and use the "Loop This Selection"
command from the Action menu to loop a section.
You do not need to be precise in placing the loop
markers, but you should choose a sustain section
appropriate for looping.
2.
Choose "Perpetual Looper" from the DSP menu.
3.
Click the "Preview" button to see if the default
settings will work – if necessary, select a narrower
range of fundamental frequencies, or adjust the
min and/or max frequency parameters to create a
narrower range. If attempting to loop a signal with
a low fundamental frequency, try a longer Analysis
Duration Window.
4.
Adjust the parameters on the right side of the
dialog to taste.
5.
When all settings are satisfactory, click the "Apply"
button to make the changes in the file.
Perpetual Looper is not available in Peak LE.
Phase Vocoder
The Phase Vocoder is a type of audio spectrum
analysis/resynthesis tool that allows you to modify the
duration and/or pitch of an audio selection.
To use the Phase Vocoder:
1.
Select the audio that you wish to process.  If you
wish to select the entire document, press -A.
2.
Choose Phase Vocoder from the DSP menu.  The
Phase Vocoder dialog appears.
3.
In the Change Duration field, you may enter a new
duration for the selection by typing the time in seconds.
4.
In the Change Pitch field, you can change the pitch
of the selection by entering a new value in cents.
(Cents are divisions of a musical octave – one octave
is equivalent to 1200 cents.) Common musical
intervals are stored in the interval pop-up menu,
allowing you to enter a major third, octave, or other
intervals.  Use the direction pop-up menu to control
whether the pitch is shifted upward or downward.
5.
In the Analysis Settings field, select the number of
bands and FFT (Fast Fourier Transform) size to
determine the quality of the output.  The Phase
Vocoder works by analyzing the frequency content of
the audio selection and placing the found
frequencies into tracks.  These tracks are then used
to control an oscillator-based resynthesis that uses
the pitch and duration modifications you enter.  In
Chapter 8:  DSP
219
8
The Phase Vocoder dialog
LE


##### Rappify


##### Repair Click


##### Repair Clicks

<!-- p.220 -->
general, using a smaller FFT size brings less smearing
of the audio output than higher FFT sizes.  Using a
larger number of bands setting used increases the
accuracy while tracking of harmonic content of the
source sound.  In general, setting the FFT size larger
than the number of bands will give undesirable
results.  Due to the nature of the Phase Vocoder's
algorithm, optimum results are achieved when it is
used with solo instruments and steady state sounds
(such as a voice or solo flute line) rather than
complex tones (such as an orchestra playing).
6.
Click OK.  Peak processes the audio.  To hear the
results, initiate playback.
Phase Vocoder is not available in Peak LE.
Rappify
The Rappify command applies extreme dynamic filtering
to a selection.  As one Peak user described it, "Rappify
can turn your hi-fi into lo-fi!" If the target material has a
pronounced beat, this has the effect of reducing the
material to its most essential rhythmic components.  Try
using this function with a variety of different music
material for some surprising and exciting results.
To Rappify a selection:
1.
Select the audio that you wish to process.  If you
wish to select the entire document, press -A.
2.
Choose Rappify from the DSP menu.
3.
In the dialog that appears, select the amount of
"rappification" you wish to mix back into the
original, with 100% being entirely rappified and 0%
being unchanged.
4.
Click OK.  Peak processes the audio.  To hear the
results, initiate playback.
Rappify is not available in Peak LE.
Repair Click
The Repair Click command will eliminate a selected click
or "spike" in the waveform using the setting designated
in the Repair Clicks dialog (explained next).
To repair a single click:
1.
Place the Insertion Point over the click you wish to
repair.
2.
Choose Zoom To Sample Level from the action
menu (Shift-Left arrow).
3.
Select the click in the waveform.  Please be sure
that your selection is no more than 100 samples.
4.
Choose Repair Click from the DSP menu.
Repair Click is not available in Peak LE.
Repair Clicks
The Repair Clicks command allows you to find and repair
pops or clicks in an audio document.  The Repair Clicks
dialog automates the process of finding and removing
clicks (usually indicated by a sharp "spike" in a
waveform), much like a search and replace dialog in a
word processor.
Peak 6 User's Guide
220
LE
LE
The Rappify dialog
LE

<!-- p.221 -->
The Repair Clicks operation works by looking for any
significant discontinuity from sample to sample.  For
example, a sample value of -100 followed by a sample
value of 10,000 is likely to be a click.  Once the area of the
click is identified, a smoothing technique is used to
maintain the original shape of the area being repaired.
If you are working with mostly digitally induced clicks,
the Repair Clicks dialog will become an indispensable
tool.  Extremely damaged signals such as those of a
scratching and popping vinyl record will require more
careful repair in addition to using the Repair Clicks
dialog, such as Change Gain, Delete, and the Pencil Tool.
Clicks such as those of a scratching and popping vinyl
record lose their detectability once they are sampled
using Analog to Digital converters.
Using BIAS SoundSoap or SoundSoap Pro will
provide ideal click & crackle reduction for
repairing audio recorded from vinyl.  For more
information, please visit the SoundSoap and
SoundSoap Pro web pages, using the links in
Peak's Links menu.
Smoothing Factor
Smoothing Factor determines how much smoothing is
applied to the click.  Material with high frequency
information may require lower smoothing factors to
preserve the high frequencies.  In general, a setting of 4060 percent will repair most clicks.
Detection Setting
The Detection Setting value determines how the clicks
are located.  Higher values locate only the most severe
clicks, while lower values will detect less severe clicks.
Note that lower values such as 10% also have a greater
chance of misjudging audio for a click.  In general, a
setting of 40-80% works well.
Repair Size
The Repair Size setting affects how many samples around
the click are used in determining the new shape of the
repair.  Repair size can vary from 5 to 100 samples, with
a repair size of 50 samples working well in most
circumstances.  Peak will then interpolate what the
correct waveform should be, and repair the click.
Buttons along the bottom of the Repair Clicks dialog
allow you to control repairing, auditioning, and undoing
click repairs:
•
Click the Repair button when you wish to repair a
click found by the Next Click button.
•
Use the Next Click button to search for the next
potential click in the audio selection.
•
Once a click is located, you may listen to the click
using the Audition button.  The Audition button
plays the click using the Pre-roll and Post-roll
settings from the Auditioning dialog in the
Preferences dialog.
•
If you repair a click and are unsatisfied with the
results, simply click on the Undo button.
•
If you would like to repair all of the clicks in the
audio document's selection without having to
repair each one individually, click the Repair All
button.
Be sure not to confuse repair size with the size of
the selection containing the audio you want to
scan and repair.  The repair size refers to the size
of each individual repaired click.
Chapter 8:  DSP
221
8
The Repair Clicks dialog


##### Remove DC Offset


##### Reverse Boomerang

<!-- p.222 -->
To repair multiple clicks in an audio document:
1.
Select the entire audio document or the area in the
audio document you wish to repair click.
2.
Choose Repair Clicks from the DSP menu.
3.
Click the Next Click button.  Peak will search for
any clicks.  If none are found, you can try again
with a lower detection setting.
4.
Audition the click using the Audition button.  The
click should sound in the middle of the auditioned
area.
5.
Once the click is found, click the Repair button.
Click the Audition button to make sure the click
was adequately repaired.  If it was not adequately
repaired, use the Undo button, modify the
smoothing factor or repair size and click the Repair
button again.
6.
Proceed from step 3 until all clicks are removed, or
simply click the Repair All button.  If you wish to
stop the Repair All process, press -period.
To repair a single click from an audio document:
1.
Select the area around the click, centering the click
in the selection.
2.
Choose Repair Clicks from the DSP menu or use
Repair Click and skip step 3.
3.
Click the Repair button.  Then click the Audition
button to make sure the click was adequately
repaired.  If it was not adequately repaired, use the
Undo button, modify the smoothing factor or
repair size and click the Repair button again.
You may need to lower the detection setting in the
Repair Clicks dialog to find some clicks, depending upon
their severity.  Be careful not to lower the detection
setting dramatically – lower it gradually for the best
results.
Repair Click is not available in Peak LE.
Remove DC Offset
This function allows you to remove any DC Offset in your
audio file.  Peak scans the audio for DC offset and then
removes it.  Peak will scan the left and right channels of a
stereo file independently.  DC Offset is usually caused by
problems in the analog to digital conversion process.  The
result is that the waveform is not centered on the base line
– it is offset either higher or lower than the center line.
To use Remove DC Offset:
1.
Select the audio that you wish to process.  If you
wish to select the entire document, choose Select
All from the Edit menu (-A).
2.
Choose Remove DC Offset from the DSP menu.
Peak will scan the audio, and automatically remove
any DC offset that might be present.
Remove DC Offset is not available in Peak LE.
Reverse Boomerang
The Reverse Boomerang command mixes a reversed copy
of the selected audio with the original.  This creates a
variety of interesting and useful results.  Try using Reverse
Boomerang on drum loops, voice, and sound effects.
To use Reverse Boomerang:
1.
Select the audio that you wish to process.  If you
wish to select the entire document, choose Select
All from the Edit menu (-A).
Peak 6 User's Guide
222
LE
The Reverse Boomerang dialog
LE


##### Reverse


##### Strip Silence

<!-- p.223 -->
2.
Choose Reverse Boomerang from the DSP menu.
3.
In the dialog that appears, select the amount of
reversed sound you wish to mix back into the
original, with 100% being entirely reversed, and 0%
being unchanged.
4.
Click OK.  Peak processes the audio.  To hear the
results, press the Spacebar to initiate playback.
Reverse
The Reverse command reverses the current selection.  In
a reversed selection, the last sample becomes the first
sample, the second-to-last sample becomes the second
sample, and so forth.  The effect is similar to playing a
record or cassette tape backwards.
To reverse a selection:
1.
Select the audio that you wish to reverse.  If you
wish to select the entire document, choose Select
All from the Edit menu (-A).
2.
Choose Reverse from the DSP menu.  Peak
reverses the selected audio.  To hear the results,
start playback.
Strip Silence
Peak includes a Strip Silence tool, which allows areas of
silence, or very low amplitude, to be automatically
silenced, minimized, or completely removed from an
audio document.  This tool is useful for removing silence
from recordings that predominantly contain silence (or
very low level audio content), interspersed with some
desired audio content.  By adjusting the various Strip
Silence parameters, you can control what content is
preserved, and what is silenced completely or deleted
from an audio document.
The Strip Silence tool is composed of two sections, the
Noise Gate and the Stripper.
Noise Gate
The Noise Gate's controls include:
Threshold Slider
The Threshold slider determines the level at which all
audio with a higher signal level is preserved, and at a
lower level is either silenced/reduced in level.  By default,
the Threshold slider is set to a value of -20dB, and has a
range of 0dB to -60dB.
Chapter 8:  DSP
223
8
The Strip Silence dialog

<!-- p.224 -->
Setting the Threshold slider is fairly straightforward – for
example, if working with a dialogue recording in which
the voice has a nice strong level, but the ambient room
tone is still audible (around -30dB), you would set the
Threshold slider right around -30dB.  This control allows
you designate a level above which audio will be
preserved – and a level below which audio will be
silenced, or removed.
A good technique for determining the Threshold
slider setting is by first selecting a portion of audio
containing just the background noise/room tone
(what should be silence, and should be removed),
and using Peak's Find Peak DSP tool to determine
the exact level.  This level can then be used as a
Threshold slider setting in the Strip Silence tool.
Reduction Ratio Slider
This slider provides a proportional amount of reduction,
based on the setting of the Threshold Slider.   Whether
audio below the threshold is completely silenced or
simply reduced in level depends largely on the setting
used for the Reduction Ratio slider.  The Reduction Ratio
slider provides a proportional amount of reduction for
any audio with a signal level that falls below the
threshold level.
A high setting on the Reduction Ratio slider will
reduce low amplitude sections of the audio waveform
(what is considered "low amplitude" depends on the
level set with the Threshold slider) to complete
silence.  A lower setting on the Reduction Ratio slider
will reduce low amplitude sections of the audio
waveform slightly (again, what is considered "low
amplitude" depends largely on what setting is made to
the Threshold slider).  By default, the Reduction Ratio
slider is set to a value of 2.00, and has a range of 1.00
to 5.00.
Using the same example of working with a dialogue
recording, which has an ambient room tone around –
30dB, which we would like to minimize.  If the Threshold
slider is set to about -30dB, that targets the audio below
that level only to be reduced – by how much depends on
how the Reduction Ratio slider is set.  To silence these
sub -30dB sections completely, a high setting, such as 4
or 5 might be used for the Reduction Ratio slider.
However, to maintain some amount of room tone, use a
milder setting between 1 and 3.
Attack Slider
The Attack slider determines how quickly level reduction
happens, once audio falls below the threshold level
(which is set with the Threshold slider).  By default, the
Attack value is set to 20 milliseconds, and has a range of
10 milliseconds to 500 milliseconds.
Release Slider
The Release slider determines how quickly level
reduction turns off, once audio exceeds the threshold
level (which is set with the Threshold slider).  By
default, the Release value is set to 100 milliseconds,
and has a range of 50 milliseconds to 1000
milliseconds.
A good rule of thumb for making settings to the Attack
and Release sliders is to take into account the type of
audio material that you're with.  For example, if working
with dialogue, it takes a relatively long time for a spoken
word to go from zero amplitude to full amplitude, (long
attack time) so it's best to use a higher attack setting.
This will cause the reduction to be applied more
gradually.  Likewise, with this type of material, it's best to
use a longer release time setting as well, as spoken words
tend to gradually diminish in amplitude, rather than end
very abruptly.
On the other hand, consider a drum recording.  Drums
have a much faster attack time – that is, it takes much
less time to hit a drum and have it go from zero
amplitude to full amplitude.  Once it's been hit, it also
takes a very short time to diminish to silence.  This type
of audio material would require much shorter attack and
release times.
Peak 6 User's Guide
224


##### Swap Channels


##### Threshold

<!-- p.225 -->
Stripper
The Stripper is the section of the Strip Silence tool that
will delete sections of audio that fall below a certain level
and stay below that level for a certain length of time.  The
Stripper's behavior depends on the settings made with
the following parameters:
Noise Floor
This slider functions much like the Threshold slider in
the Noise Gate section of the Strip Silence tool.  Setting
this slider more to the left has the effect of using a lower
threshold setting in the Noise Gate section – that is, only
audio material with the lowest signal level would be
deleted.  On the other hand, when this slider is set to a
more "aggressive" setting, audio with a higher amplitude
level would also be deleted.  Audio is only deleted when
it stays below a certain level for a certain length of time.
The Noise Floor Slider has a range of 0.0000 – 1.0000%.
Required Silence Before Strip Slider
This parameter controls how many milliseconds of
consecutive silence (silence being any audio with a level
below the level set with the Noise Floor slider) are
required before silent areas can be eliminated.
Strip Silence is not available in Peak LE!
Swap Channels
The Swap Channels command reverses the left and right
channels in a stereo selection.
To swap channels for a stereo selection:
1.
Select the audio that you wish to swap.  If you wish
to select the entire document, choose Select All
from the Edit menu (-A).
2.
Choose Swap Channels from the DSP menu.  Peak
swaps the left channel for the right channel and the
right channel for the left channel.  To hear the
results, start playback.
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
Markers, or as Regions.
To use the Threshold command:
1.
Select the audio you wish to process and choose
Threshold from the DSP menu.  After Peak analyzes
the amplitudes in the selection, the Threshold
dialog will appear, allowing you to select a threshold
amplitude for both attack and release values.
2.
Drag the threshold indicator left or right to set the
threshold amplitude.  As you drag the indicator,
new markers will appear in the audio document
Chapter 8:  DSP
225
8
The Threshold Regions dialog
LE
LE


##### Voiceover Ducking

<!-- p.226 -->
forming markers or regions, depending on your
settings.  The Offset sliders allow you to "nudge"
the onsets of markers or regions by plus or minus
0 to 512 samples.
3.
Select Create Regions to create regions instead of
markers.  The separate Release Threshold, attack
and sludge settings affect the region end points,
allowing you to eliminate silence from the region
end points.
4.
Adjust the Attack value.  This parameter sets the
amount of time that audio must stay above the
given threshold to qualify as a new marker or
region.
5.
When you have finished, click OK.
6.
After
the
audio
document
has
been
"thresholded" to your satisfaction, you can use
the Export Regions command in the File menu to
export the separated regions into new windows
or files.
7.
To select and play regions in order from left to
right, press the Page Up key on your computer
keyboard.  To select and play regions in order from
right to left, press the Page Down key.
Use the Threshold command to create several
looping points.  To convert a marker to a Loop
Start or Loop End point, double-click on the
marker and change it to "Loop Start" or "Loop
End" in the Edit Marker dialog.  Also, try
rearranging the regions generated by the
Threshold function in the Playlist or by using Cut
and Paste to create new interesting compositional
and rhythmic ideas!
Threshold is not available in Peak LE.
Voiceover Ducking
The Voiceover Ducking tools is useful for adding vocal
material, such as a radio or podcast show intro, public
service announcement, commercial, etc. to a piece of
background audio.  Voiceover Ducking functions much
like a standard "Paste" command, but has the added
benefits of controlling several aspects of the background
material.
Peak 6 User's Guide
226
The Threshold DSP tool allows inserting markers or Regions based on the amplitude of the audio signal
LE


#### Conclusion

<!-- p.227 -->
Attack
Controls how quickly the background audio fades out
(until it reaches the level set in the Ducking Amount field).
Decay
Controls how quickly the background audio fades back in to
full volume (from the level set in the Ducking Amount field).
Ducking Amount
Sets the level of audio ducking (volume reduction) for
the background audio material.
Hold
The Hold field forces ducking to be maintained.  For
example, if you have a voiceover that has a 3 second pause
in between two passages of dialogue, but you don't want
the background audio level to fade back in during the 3
second pause, you would enter a value of 3 in the Hold
field.  This would force the background material to remain
ducked, until after the second passage of dialogue.
Preroll Voiceover
Controls how quickly the voiceover content (audio on
Clipboard that's being pasted in) fades in.
Postroll Voiceover
Controls how quickly the voiceover content fades out.
To use Voiceover Ducking:
1.
Open the audio document that you wish to add a
voiceover to (a podcast, for example).
2.
Open the audio document that contains the
voiceover content (or record a voiceover).
The background and voiceover material must be
in the same audio format (i.e., the same bit depth,
sample rate, and number of channels).
3.
In the document that contains the voiceover, select
and copy the desired portion to the clipboard.
4.
In the document that contains the background
material, place the playhead cursor where you wish
to have the voiceover start.
5.
From the DSP menu, choose Voiceover Ducking –
the Voiceover Ducking dialog appears.
6.
Set parameters as desired, and click OK to add the
voiceover from the Clipboard to the background
audio.
Conclusion
You have now learned how to manipulate and process
audio using Peak's native DSP capabilities.  In the next
chapter, you will learn how to use VST & Audio Units
effect and instrument plug-ins with Peak.
Chapter 8:  DSP
227
8
The Voiceover Ducking Dialog

<!-- p.228 -->
Peak 6 User's Guide
228

<!-- p.229 -->
Chapter 9
Plug-Ins

<!-- p.230 -->
Peak 6 User's Guide
230
