# WAC2016-48

> Extracted from `WAC2016-48.pdf` — 6 pages.
> Page markers are kept so a claim can be traced back to the original.


## Introduction


## Theoretical Background

<!-- p.1 -->
Time Stretching & Pitch Shifting with the Web Audio API:
Where are we at?
Bruno Dias
INESC-ID, IST - Universidade
de Lisboa, Portugal
bruno.s.dias@ist.utl.pt
Matthew E. P. Davies
INESC TEC, Porto, Portugal
mdavies@inesctec.pt
David M. Matos
INESC-ID, IST - Universidade
de Lisboa, Portugal
david.matos@inesc-id.pt
H. Sofia Pinto
INESC-ID, IST - Universidade
de Lisboa, Portugal
sofia@inesc-id.pt
ABSTRACT
Audio time stretching and pitch shifting are operations that
all major commercial and/or open source Digital Audio
Workstations, DJ Mixing Software and Live Coding Suites
offer. These operations allow users to change the duration of
audio files while maintaining the pitch and vice-versa. Such
operations enable DJs to speed up or slow down songs in
order to mix them by aligning the beats.
Unfortunately,
there are few (and experimental) client-side JavaScript implementations of these two operations.
In this paper, we
review the current state of the art for client-side implementations of time stretching and pitch shifting, their limitations,
and describe new implementations for two well-known algorithms: (1) Phase Vocoder with Identity Phase Lock and
(2) a modified version of Overlap & Add. Additionally, we
discuss some issues related to the Web Audio API (WAA)
and frequency-based audio processing regarding latency and
audio quality in pitch shifting and time stretching towards
raising awareness about possible changes in the WAA.
1.
INTRODUCTION
Time stretching and pitch shifting are two operations
widely available in commercial and open source musical applications like Ableton Live,1 Traktor Pro2 and Ardour.3
Currently, creative frameworks implemented in JavaScript
and the Web Audio API (WAA) such as Flocking [2] can
only change the duration of a signal by re-sampling of audio buffers, thus changing both the duration (i.e.: tempo)
and pitch at the same time. In digital audio workstations
(DAW) like EarSketch [9], time stretching and pitch shifting are performed server-side, with SoX,4 making real-time
1https://www.ableton.com/
2http://www.native-instruments.com/en/products/
traktor/dj-software/traktor-pro-2/
3http://ardour.org/
4http://sox.sourceforge.net/
Licensed under a Creative Commons Attribution 4.0 International License (CC BY
4.0). Attribution: owner/author(s).
Web Audio Conference WAC-2016, April 4-6, 2016, Atlanta, USA.
c⃝2016 Copyright held by the owner/author(s).
interaction impossible.
Our aim in this work is to enable real-time pitch shifting
and time-stretching in browsers, which is currently an underexplored aspect of the WAA.
This paper presents an overview of the current implementations for both algorithms using JavaScript in the browser
environment and two new implementations. Additionally,
we discuss the impact of certain decisions in the WAA design
and philosophy regarding the absence of frequency-based operators like the Fast Fourier Transform (FFT), and the subsequent impact on performance.
For both implementations, we have the following nonfunctional requirements:
• Constant memory usage, with fixed size circular
arrays, in order to minimize the impact of the garbage
collector by maintaining a constant memory profile.
• Intuitive API and documentation, stating the
trade-offs between audio quality and performance.
• Minimize assumptions regarding sample rate, number of channels, the type of audio content (percussive or harmonic) being processed, third party software
components and execution environments.
The outline of the paper is as follows. First, we review the
basic theory for time and frequency domain time stretching
and pitch shifting algorithms. Then, we describe the existing
Javascript implementations for each. After that, we present
our two new implementations for two well know algorithms:
(1) Phase Vocoder with Identity Phase Locking [6] and (2)
a modified Overlap & Add (OLA) algorithm. Finally, we
discuss the trade-offs between existing implementations and
problems with the WAA regarding these two operations.
2.
THEORETICAL BACKGROUND
For both tasks, there are algorithms that work in time
domain, like Overlap and Add (OLA), Waveform Similarity
based OLA (WSOLA) [12] and delay line modulation [4],
and others that work in the frequency domain, like the Phase
Vocoder [5] and Spectral Modelling [18]. In this section, we
give an overview of three popular methods: OLA, WSOLA
and the Phase Vocoder.
Algorithms in both time and frequency domains, for time
stretching and pitch shifting, are more sophisticated ver-


### OLA


### WSOLA


### Phase Vocoder

<!-- p.2 -->
sions of OLA. For this reason, we start with the basic OLA
algorithm.
2.1
OLA
Let x ∈RM be the input signal of size M, α ∈R be the
stretching factor and y ∈RL be the output signal of size
L = α · M. There are three main steps for OLA:
1. Partition the input signal x into a set of analysis frames
of size N, each overlapping with the previous one in
Ha ∈N+ (i.e.: the analysis hop size) samples.
xi(n) = x(n + i · Ha), xi ∈RN
(1)
2. Apply a window w (e.g.: Hamming window) to each
analysis frame
xwi(n) = w(n) · xi(n), w ∈RN
(2)
3. Add the (synthesis) frame to the output, by overlapping it with Hs ∈N+, the synthesis hop size, samples
of the "tail" of the output signal y
y(n + i · Hs) =
(
yi(n),
if i = 0
y(n + i · Hs) + w(n)·yi(n)
w(n)2
, if i > 0
(3)
with yi = xwi for the basic OLA, n ∈N ∧0 ≤n ≤N and
i ∈N ∧i · Ha ≤M ∧i · Hs ≤L. The relation between both
overlap/hop sizes and the stretching factor is defined as:
α = Hs
Ha .
(4)
Usually, one of the hop sizes is fixed while the other is a
function of α. We should note that α can change at each
new frame, which is particularly relevant for real-time audio
processing. OLA does not preserve phase relations between
consecutive frames and, as such, there are noticeable artifacts in the output signal: modulation of harmonic structures (e.g.: human voice) and reverberation. The temporal
complexity of OLA is O(N). In figure 1(a), we can see what
happens to both Ha and Hs when changing α.
To perform pitch shifting with OLA, we could couple a
re-sampler to an OLA time stretcher.
In order to allow
simultaneous time stretching and pitch shifting, let t and
t + 1 be the current and next frames, βt be the new desired
pitch and Rb the sampling rate of the input signal. Then,
the new stretching factor αt+1 and the new sample rate Rt+1
are defined as
Rt+1 = Rb ∗βt+1
(5)
αt+1 = αt
Rt .
(6)
2.2
WSOLA
First introduced in [12], WSOLA applies a delay δ ∈
[−δmax : δmax] to each analysis frame, such that the waveforms of two overlapping synthesis frames are as similar as
possible in the overlapping regions, where WSOLA is equivalent to OLA when δmax = 0. The delay can be obtained
by calculating the cross-correlation between the overlapping
regions of each synthesis frame. Therefore, the analysis step
for xi is redefined as
xi(n) = x(n + Hai)
(7)
where Hai is the analysis hop size for frame i and is defined
as
Hai = i · Ha + δi
(8)
and
δi = xi ⋆xi−1[δmax]
(9)
where δmax < Ha. This algorithm removes reverberation
and modulation but, for transient rich sounds (percussion,
guitar riffs), there might be some missed transients and
stuttering (i.e.: repeated transients). Regarding the temporal complexity of WSOLA, if the cross-correlation is implemented with FFT Convolution [14], we get O(Nlog2N).
Else, with a "naive" implementation of the convolution, we
get O(N 2). To perform pitch shifting, we can use the same
method described for OLA.
2.3
Phase Vocoder
The Phase Vocoder is a well documented [3, 5, 6, 8, 18]
algorithm used for time stretching [5], pitch shifting [8] and
other audio effects like robotization [18]. In general, it has
a higher computational cost than time domain methods like
WSOLA but offers higher quality audio, without missing
transients. Each iteration of the Phase Vocoder has eight
steps which occur in-between steps 2 and 3 of OLA:
1. Calculate the forward Fourier transform of xwi
Xi(n, Ωk) =
N
X
n=0
xwi(n) · e−jΩkn, Xi ∈CN
(10)
where Ωk = 2πk
N
is the frequency center for frequency
bin k and e−jΩkn is a complex sinusoid of frequency
Ωk.
2. Calculate the magnitude |Xi| ∈RN and phase ∠Xi ∈
RN spectra for Xi by converting to polar coordinates.
3. Calculate the difference between current and previous
phase spectra and, then, the sample-wise difference
with the frequency centres Ωk
∆∠Xi = ∠Xi −∠Xi−1 −Ha · Ωk
(11)
4. Because phase values are given in modulo 2π and, as
such, phase 'jumps' can occur, we unwrap the phase
in order to obtain a continuous phase function
∆p
∠Xi = ∆∠Xi −2π · ⌊∆∠Xi
2
⌉
(12)
5. Compute the instantaneous frequency ω for each bin k
ωk = Ωk +
∆p
∠Xi
Ha
(13)
6. Use ωk to compute the output phase spectra ∠Yi by
advancing the previous output ∠Yi−1 according to the
synthesis hop size Hs
∠Yi = ∠Yi−1 + Hs · ωk
(14)
7. Compute the synthesis frame Yi ∈CN by reusing the
input magnitude spectra and the new phase spectra
Yi = |Xi| · ej·∠Yi
(15)


## Existing Implementations

<!-- p.3 -->
(a)
(b)
Figure 1: Illustrations for (a) the basic OLA algorithm, with both analysis and synthesis steps and (b) the
WSOLA analysis step. For time compression, we have Ha < Hs and for time expansion, Ha > Hs. In WSOLA,
the main difference is within the "reading head" position. For each analysis frame i, the analysis hop size Hai
is calculated according to the optimal displacement δi, obtained through cross-correlation between analysis
frame i and i −1, for a maximum delay of δmax: Hai = i · Ha + δi
8. Finally, calculate the inverse Fourier transform yi of
the frequency Yi
yi(n) = w(n) ·
N
X
k=0
Yi(n, Ωk) · ejΩkn
(16)
This algorithm ensures horizontal phase coherence, i.e.:
phase continuity for the same frequency bin for consecutive frequency frames is guaranteed. However, vertical phase
coherence, i.e.: phase relations between different frequency
bins, in the same frame, is usually destroyed in the phase
correction process. The loss of vertical phase coherence results in a distinct artefact: phasiness (i.e.: a metallic tunnel
sound). The temporal complexity of the Phase Vocoder is
O(N log2N).
To maintain both vertical and horizontal coherence, we
can apply Identity Phase-Locking [7]. The main idea is that
frequency bins that are not spectral peaks contribute to the
partials of the nearest spectral peak.
A spectral peak is
a local maximum in the magnitude spectra.
In order to
find the spectral peaks, we can use a simple heuristic: if a
frequency bin has the maximum magnitude when compared
with four neighbour bins, then it is a spectral peak. After
identifying all spectral peaks, we need to infer the "region
of influence" of each peak (i.e.: for a given peak, which are
the non-peak bins that contribute to the peak partial) (see
section IIIC of [7]). After identifying both the spectral peaks
and the "regions of influence", the usual phase correction
method is applied to the peak bins. The phase of a non-peak
bin will be equal to the phase of its corresponding peak bin.
To pitch shift with a Phase Vocoder, there are two methods available. The first is re-sampling, in the same manner
as OLA and WSOLA. The second is adding an additional
step to the phase correction, as described in [8], which proceeds with the following steps. After identifying the spectral
peaks, for a pitch shift factor β, each peak will be shifted
to a new (angular) frequency βω, corresponding to a freq.
shift ∆ω = ω(β −1). When ∆ω is an integer, we just need
to copy the Fourier transform values from the original "region of influence" to the new one (around the new peak bin).
If ∆ω is a fractional number, a naive solution is to round
∆ω to the nearest integer. This solution presents acceptable
results for low sample rates and large FFT frame sizes.
3.
EXISTING IMPLEMENTATIONS
In this section we give an overview regarding time stretching and pitch shifting implementations with web technologies like JavaScript and the WAA, as well as native web
browser implementations, available through the Audio Element [11], via its playbackRate attribute [16].
For pitch shift only implementations in JavaScript, there
is pitchshift.js [1] and jungle.js.5 The first is a port of a C++
implementation6 of the Phase Vocoder for pitch shifting [8]
while the second is an implementation of [4].
In Vexwarp,7 time stretching is performed with the basic
phase vocoder algorithm [5]. With this application, it is not
possible to perform real-time processing of the input signal.
Soundtouch.js8 is a port of the C++ library SoundTouch,9
a WSOLA implementation. This library performs both time
stretching and pitch shifting (through re-sampling) with
some additional features:
• Cross-correlation is computed with an interleaved array with all audio channels.
• Instead of implementing the "naive"approach to crosscorrelation, the developers used a hierarchical algorithm.
This port is tightly coupled regarding buffers, buffer management, stretcher, re-sampler and parameter adjustments,
as well as some hard coded parameters, making integration
into new applications a difficult task.
There is another WSOLA implementation: tempo.js [1],
the result of the compilation of a port of the SoX tempo
effect, using Emscripten [17]. Currently, it has no documentation and the only demo uses deprecated APIs that are no
longer available.
5https://github.com/cwilso/Audio-Input-Effects
6http://downloads.dspdimension.com/smbPitchShift.cpp
7http://www.vexflow.com/vexwarp/
8https://github.com/also/soundtouch-js
9http://www.surina.net/soundtouch/


## Proposed Implementations


### OLA-TS.js


### PhaseVocoder.js

<!-- p.4 -->
In the WAVES project,10 the Audio library [13] supports
time stretching and pitch shifting through granular synthesis
and re-sampling, offering two classes to perform both tasks:
GranularEngine and SegmentEngine. The first causes significant transient smearing. The second class requires the
developer to pass a JSON object detailing the segmentation
of the input audio buffer.
Regarding the native implementations in web browsers,
all major browsers, like Opera, Safari, Chrome and Firefox,
implement time stretching to be used with the Audio tag,
controlling the stretching factor with the playbackRate attribute of the Audio tag/object. The stretch factor in the
current implementations seems to be limited to the range
α ∈[0.5 : 4], where 0.5 is the slowest speed and 4 is the
fastest, meaning that web browsers perform an additional
step to ensue α complies with equation (4). Currently, we
can only detail the implementation of Firefox and Chromium
due to the closed-source nature of Opera and Safari. In Firefox, time stretching is performed by the SoundTouch library.
Chromium uses a custom WSOLA implementation.
For
both browsers, when slowing down, there is some stuttering
(more noticeable in Firefox). When speeding up, namely for
playbackRate values greater than 1.2, there are some missing
transients for percussive sounds.
4.
PROPOSED IMPLEMENTATIONS
We now detail our two implementations for time stretching,
OLA-TS.js
(modified
OLA)
and
PhaseVocoder.js
(Phase Vocoder with Identity Phase-Locking), as well as
some helper classes to ease the integration of the time
stretchers.
Both implementations operate on a single audio channel
and can be included in a ScriptProcessor or AudioWorker
for real-time interaction/processing, or they can be used in
batch processsing, in a similar way to Vexwarp, in order to
integrate in frameworks and applications like Flocking and
EarSketch. They do not include pitch shifting capabilities
but that can be easily adapted by coupling a re-sampler
to the helper classes.
To maintain a static memory footprint, we used an existing circular buffer implementation,
CBuffer.11 Even though our time stretchers are implementations of (totally) different algorithms, there is a common
API to both:
• process(Array
inputFrame,
CBuffer
outputFrame):
given a (mono) frame, performs a time stretching iteration and pushes Hs samples in the output CBuffer.
• get ha: returns the current analysis hop size.
This
function calculates the increment to the "read head" of
the input signal, when playing an audio file.
• get hs: returns the current synthesis hop size. This
function calculates the increment to the output signal
position and can be used to guide the cursor in the UI
of an audio player using OLA-TS.js or PhaseVocoder.js
as time stretchers.
• clear buffers: clears all internal buffers, like the overlapping buffer. This can be useful for audio players
that need to create a noticeable stop in the transition
10http://wavesjs.github.io/
11https://github.com/trevnorris/cbuffer
to the next file in a playlist, to avoid using the phase
of the previous song to adjust the phase of the next
song.
• set alpha(Number newAlpha): given the new stretching factor, it computes the new values for Hs, Ha
(both integers) and invokes the function pointed by
overlap fn.
• get alpha: returns the last specified stretching factor.
• overlap fn: a public field pointing to a function that,
given a stretching factor α, will return a new overlapping factor.
• get real alpha: there are stretching factors that do not
allow Hs and Ha to be integers and this might present
a problem because the input signal "read head" is an
integer number (Ha is used to increment the "read
head"). When the developer uses set alpha to specify
a new stretching factor, both Hs and Ha are rounded
to the closest integer. As a result, there will be a difference between the specified α and the real α. This
difference can cause problems in use cases like a DJ
application that automatically synchronizes two songs
to a master tempo. If there is a divergence between the
specified α and the real α, after a certain amount of
time, this divergence can cause the beats of both songs
to drift out of sync. Therefore, we created this function in order to allow the developer to create adequate
controllers to adjust the speed of the audio players to
circumvent this issue.
4.1
OLA-TS.js
OLA-TS.js diverges from the basic OLA algorithm as follows: the window has an exponent that is a function of the
stretching factor, W ′(n) = W(n)β(α). The overlapping factor is also a function of α, Ovl(α). We include two default
functions for both the overlapping factor and the exponent.
The exponent function can be redefined by changing the
public field beta fn. The default functions for the exponent
and overlapping factor were designed through experimentation. Both of them are a series of step functions design to
minimize the modulation described in section 2.1.
Both OLA-TS.js and PhaseVocoder.js use the following
formulas to define the analysis and synthesis hop sizes:
Ha =
N
Ovl(α)
(17)
Hs = α ∗Ha
(18)
where Ovl(α) is the function defined in overlap fn. In order to properly stretch an input signal, the developer should
use a predetermined sequence of instructions. To make integration in other applications easier, we implemented helper
classes to manage the buffering and the "read heads" for the
input buffers.
4.2
PhaseVocoder.js
PhaseVocoder.js uses, by default, fourier.js, an FFT
library offering methods implemented in both asm.js12
and "raw" JavaScript.
In order to use a different FFT
library,
the developer can use the following methods:
12http://asmjs.org


### Helper Classes


## Analysis and Discussion


## Time stretching and pitch shifting issues with the WAA


## Conclusions and Future Work


## Acknowledgments

<!-- p.5 -->
set stft fn(Function stftCallback), set istft fn(Function istftCallback) and init fft fn(Function initCallback):
• stftCallback(Array inputFrame, Array windowFrame,
Number wantedSize, Object out): inputFrame is a sequence of samples; windowFrame is the discretization
of the window function; wantedSize is the desired size
for the real and imaginary arrays of the output13; out
is a JSON object with four arrays: real, imaginary,
magnitude and phase, all of them describing the result
of the forward Short Time Fourier Transform (STFT).
This function will be invoked for each time frame being
processed by PhaseVocoder.js.
• istftCallback(Array
real,
Array
imag,
Array
windowFrame, Array timeFrame):
real and imag are
the real and imaginary arrays describing a frequency
frame; timeFrame is the result of the inverse STFT.
This function will be invoked when synthesizing a frequency frame, after the phase adaptation.
• initCallback(Number frameSize): this function is invoked after being added to a PhaseVocoder.js instance.
4.3
Helper Classes
For both implementations, we created a set of helpers with
a common API: BufferedTS and WAAPlayer.
In BufferedTS, we manage the output buffering of
two time
stretchers
(i.e.:
two
channels),
as well
as
the the "read head" position.
For this class, we provide two (public) methods, (1) process(AudioBuffer oBuf)
which writes the next output frame into oBuf
and (2)
set audio buffer(AudioBuffer iBuf) which defines the input
audio buffer to be processed with the time stretchers, and
two (public) read/write fields, position and alpha, allowing
access to both the "read head" and the stretch factor α.
To ease integration with the WAA, we implemented
WAAPlayer, which integrates a BufferedTS instance into
a ScriptProcessor.
5.
ANALYSIS AND DISCUSSION
In this section, we analyze our implementations and compare them with the existing ones, reviewed in Section 3.
Unlike Vexwarp, PhaseVocoder.js allows real-time and
block-wise processing of the input signal, with a minimized
impact in transient smearing and no metallic sound, due to
the inclusion of vertical phase coherence. Unfortunately, due
to the number of FFTs used (for α > 1, there are 4 forward
and 4 inverse FFTs per output buffer), the computational
costs are greater than soundtouch.js. So, in order to avoid
missing transients in soundtouch.js, we must decrease the
frame size and/or increase the cross-correlation range, which
will increase the computational costs of soundtouch.js and,
as a consequence, can make PhaseVocoder.js competitive.
OLA-TS.js allows O(N) time stretching, unlike PhaseVocoder.js, O(N log2N), and soundtouch.js, O(N 2), but can
introduce noticeable modulation in harmonic structures like
the voice of a human singer, for frame sizes smaller than
4096 samples, with a sample rate of 44100 Hz. Additionally, it may require some manual experimentation with the
overlap and beta parameters to reduce the modulation.14
13wantedSize can not be bigger than windowFrame.length.
14We have two default functions to adjust both parameters.
Due to the recommended frame size (4096 samples), OLATS.js is adequate for applications where there are smooth
adjustments in the stretching factor.
To make it simple for the reader to understand some of
the main features and problems with each reviewed and/or
discussed implementation, Table 1 includes, for each implementation, its algorithm, audio artefacts and the effect(s)
implemented.
6.
TIME
STRETCHING
AND
PITCH
SHIFTING ISSUES WITH THE WAA
Currently, the WAA offers two classes to work in frequency domain: (1) AnalyserNode, allowing the developer
to obtain the magnitude spectra (but no phase spectra) of
a time sequence, (2) PeriodicWave, an interface to define a
periodic waveform for an OscillatorNode in order to perform
synthesis using a similar method to the one described in [10].
Currently, there is no way to retrieve the full frequency description in a ScriptProcessor or AudioWorker. This situation requires developers to use JavaScript implements of the
FFT in order to implement high quality time stretching with
Phase Vocoders, instead of relying on native implementations exposed in a JavaScript API like the WAA. This leads
to an increased overhead in computational costs because
JavaScript is an interpreted language. This overhead can
cause sudden audio dropouts when using algorithms like the
Phase Vocoder, Spectral Modelling or Percussive-Harmonic
Separation [15] within a ScriptProcessor. And, in a Phase
Vocoder, the bulk of the computational cost is due to the
FFT. This absence caused significant discussion within the
WAA community.15
7.
CONCLUSIONS AND FUTURE WORK
In this paper, we presented the existing time stretching
and pitch shifting implementations using web technologies,
as well as two new implementations. Then, we compared
the implementations regarding computational costs and the
existence of audio artefacts.
Additionally, we commented
on the current state of the WAA specification regarding frequency operations and how that affects time stretching and
pitch shifting.
Our next step regarding OLA-TS.js and PhaseVocoder.js
will be to integrate the implementations in creative frameworks and applications like Flocking and EarSketch. Additionally, we plan to integrate a re-sampler in the helper
classes to provide pitch shifting. For PhaseVocoder.js, we
plan to include new audio effects like robotization and
whiperization.
Both implementations and their helper classes are public
and open source, each one with it's own Git repository.1617
Additionally, we implemented a small demo page where the
user can drag & drop several songs and play them simultaneously, controlling the volume and the stretching factor.
Finally, we will conduct a formal evaluation and comparison
of time stretching and pitch shifting implementations.
8.
ACKNOWLEDGMENTS
15https://github.com/WebAudio/web-audio-api/issues/468
16https://github.com/echo66/OLA-TS.js
17https://github.com/echo66/PhaseVocoderJS


## References

<!-- p.6 -->
Table 1: Comparison of Time Stretching/Pitch Shift JavaScript and Native implementations
Name
T. Stretch/P. Shift
Algorithm
Audio Artifacts
SoundTouch.js
Both
WSOLA + Re-Samplig
Missing Transients
WAVES Audio library
Both
G. Synthesis + Re-Sampling
Smeared Transients
pitchshift.js
Pitch Shift
Phase Vocoder
Smeared Transients
jungle.js
Pitch Shift
Delay-Line Modulation
Reverberation
Vexwarp
Time Stretch
Phase Vocoder
Metal Tunnel
tempo-sox.js
Time Stretch
WSOLA
Unknown
PhaseVocoder.JS
Time Stretch
Phase Vocoder
Smeared Transients
OLA-TS.JS
Time Stretch
Modified OLA
Some modulation in harm. structures
Firefox Audio
Time Stretch
WSOLA
Missing Transients
Chromium Audio
Time Stretch
WSOLA
None
This work was partly supported by national funds through
FCT - Funda ̧c ̃ao para a Ciˆencia e Tecnologia, under projects
EXCL/EEI-ESS/0257/2012
and
UID/CEC/50021/2013
and by post-doctoral grant SFRH/BPD/88722/2012. This
work was partly supported by Luso-American Development
Foundation.
9.
REFERENCES
[1] KievII: GUI Javascript library, for web audio
applications
https://github.com/janesconference/KievII/, 2013.
[2] C. Clark and A. Tindale. Flocking: A Framework for
Declarative Music-Making on the Web. In Proceedings
of the ICMC, pages 1550-1557, Athens, 2014.
[3] A. de Gotzen, N. Bernardini, and D. Arfib.
Traditional implementations of a phase-vocoder: The
tricks of the trade. In Proceedings DAFx, pages 37-43,
Verona, Italy, 2000.
[4] S. Disch and U. Zolzer. Modulation and Delay Line
Based Digital Audio Effects. In Proceedings of DAFx,
pages 5-8, NTNU, Trondheim, 1999.
[5] M. Dolson. The phase vocoder: A tutorial. Computer
Music Journal, 10(4):14-27, 1986.
[6] J. Laroche and M. Dolson. Phase-vocoder: about this
phasiness business. In Proceedings of WASPAA, pages
4-8, 1997.
[7] J. Laroche and M. Dolson. Improved phase vocoder
time-scale modification of audio. IEEE Transactions
on Speech and Audio Processing, 7(3):323-332, 1999.
[8] J. Laroche and M. Dolson. New phase-vocoder
techniques for pitch-shifting, harmonizing and other
exotic effects. In Proceedings of WASPAA, pages
91-94, 1999.
[9] A. Mahadevan, J. Freeman, and B. Magerko.
EarSketch: Teaching computational music remixing in
an online Web Audio based learning environment. In
1st Web Audio Conference, Paris, 2015.
[10] J. A. Moorer. The Synthesis of Complex Audio
Spectra by Means of Discrete Summation Formulas.
Journal of Audio Engineering Society, 24(9):717-727,
1976.
[11] S. Pieters, A. van Kesteren, et al. HTML 5.1, W3C
Working Draft (http://www.w3.org/TR/html51/),
2015.
[12] M. Roelands and W. Verhelst. Waveform similarity
based overlap-add (WSOLA) for time-scale
modification of speech: structures and evaluation. In
EUROSPEECH, pages 337-340, 1993.
[13] N. Schnell, V. Saiz, K. Barkati, and S. Goldszmith. Of
Time Engines and Masters - An API for Scheduling
and Synchronizing the Generation and Playback of
Event Sequences and Media Streams for the Web
Audio API. In 1st Web Audio Conference, Paris, 2015.
[14] S. W. Smith. The Scientist and Engineer's Guide to
Digital Signal Processing. 2011.
[15] H. Tachibana, N. Ono, H. Kameoka, and S. Sagayama.
Harmonic/percussive sound separation based on
anisotropic smoothness of spectrograms. IEEE/ACM
Transactions on Audio, Speech and Language
Processing, 22(12):2059-2073, 2014.
[16] Teoli and C. Mills. Web Audio playbackRate
explained (https://developer.mozilla.org/en-US/
Apps/Build/Audio and video delivery/WebAudio
playbackRate explained), 2014.
[17] A. Zakai. Emscripten: an LLVM-to-JavaScript
compiler. In 26th Annual ACM SIGPLAN Conference
on Object-Oriented Programming, Systems,
Languages, and Applications, OOPSLA, Portland,
OR, USA, 2011.
[18] U. Zolzer. DAFX: Digital Audio Effects. Wiley, New
Jersey, 2nd edition, 2011.
