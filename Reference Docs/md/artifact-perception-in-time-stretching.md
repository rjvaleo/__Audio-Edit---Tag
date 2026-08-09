# FULLTEXT01

> Extracted from `FULLTEXT01.pdf` — 13 pages.
> Page markers are kept so a claim can be traced back to the original.

<!-- p.1 -->
Degree Project in Media Technology
First cycle, 15 credits
Artifact Perception in Algorithms for
Audio Time Stretching
Uppfattning av artefakter i algoritmer för tidsskaleändringar av ljud
Elias Benson, Hannes Westerberg

<!-- p.2 -->
Artifact Perception in Algorithms for Audio Time Stretching
Elias Benson
EECS, School of Electrical Engineering and Computer
Science, KTH
ebens@kth.se
Hannes Westerberg
EECS, School of Electrical Engineering and Computer
Science, KTH
hanneswe@kth.se
Abstract
This study explores user preferences and perceptions regarding
algorithms used for time-scale modification (TSM) of audio. While
features for adjusting playback speed are widely available in media
players, the underlying algorithms and their differences are often
not well understood by everyday users. Given that different TSM
algorithms can produce vastly different audio artifacts, we investigate whether non-expert users exhibit consistent preferences or
can articulate qualitative opinions about the results produced by
different algorithms.
Our findings may be relevant for software developers faced with
a selection of audio stretching algorithms, as understanding user
perception of algorithmic artifacts can inform design decisions.
Drawing on previous research in TSM techniques and methods
for qualitative and quantitative analysis, we provide context for
the causes of TSM-related artifacts and use it to interpret user
preferences.
We conducted a within-subjects study with 29 participants, who
evaluated four TSM algorithms across 16 test conditions, which
were combinations of audio types and playback speeds. Rankings
were analyzed using the Friedman test and aligned rank transform
ANOVA to assess the statistical significance of algorithm preferences. Additionally, participants provided qualitative feedback describing their listening strategies and perceptions.
Results indicate strong agreement among participants on the
best-performing algorithm within each tested condition. While no
single algorithm consistently outperformed the others across all
scenarios, playback rate and audio type significantly influenced
which algorithm was preferred. Despite this variability, participants
largely converged in their rankings for most conditions. The qualitative analysis revealed recurring themes in artifact perception,
including a dislike of fluttering, phasiness and lack of clarity.
Sammanfattning
Denna studie undersöker användarpreferenser och uppfattningar
kring algoritmer som används för ändringar i tidsskalan (TSM)
av ljud. Funktioner för att justera uppspelningshastighet är vitt
tillgängliga i mediaspelare, men de underliggande algoritmerna
och deras skillnader är ofta inte väl förstådda av gemene användare. Eftersom olika TSM-algoritmer kan producera mycket olika
ljudartefakter, undersöker vi huruvida icke-experter uppvisar konsekventa preferenser eller kan formulera kvalitativa åsikter om
resultaten som fås av olika algoritmer.
Våra resultat kan vara relevanta för mjukvaruutvecklare som
står inför valet av algoritm för tidsskaleändringar för ljud, eftersom
förståelse för hur användare uppfattar artefakter kan stödja beslut i designprocessen. Med utgångspunkt i tidigare forskning om
TSM-tekniker och metoder för kvalitativ och kvantitativ analys, presenterar vi orsakerna till TSM-relaterade artefakter och använder
denna kunskap för att tolka användarpreferenser.
Vi genomförde en inomgruppsstudie med 29 deltagare, som utvärderade fyra TSM-algoritmer över 16 testförhållanden, som utgjordes av kombinationer av ljudtyper och uppspelningshastigheter.
Rankningarna analyserades med hjälp av Friedmantestet och aligned rank transform ANOVA för att undersöka statistisk signifikans
i algoritmpreferenser. Deltagarna gav även kvalitativ återkoppling
där de beskrev sina lyssningsstrategier och upplevelser.
Resultaten visar på stark enighet bland deltagarna om vilken
algoritm som presterade bäst för varje testförhållande. Ingen enskild algoritm presterade konsekvent bäst i alla scenarier, utan
uppspelningshastighet och ljudtyp hade en stor påverkan på vilken
algoritm som föredrogs. Trots denna variation tenderade deltagarna
att vara överens i sina rankningar i de flesta fall. Den kvalitativa
analysen visade återkommande teman i uppfattningen av artefakter,
där ogillande av hackighet, "phasing"-fenomen, samt en brist på
klarhet i ljudet var vanliga.
CCS Concepts
• Applied computing →Sound and music computing; • Humancentered computing; • Computing methodologies →Perception;
Keywords
Audio; Perception; Time-Scale Modification; Time Warping; Pitch
Shifting; Listening; Sound Manipulation; Sound Artifacts; Playback
Speed
Supervisor:  Maurizio Berta
  Examiner:  Roberto Bresin

<!-- p.3 -->
Elias Benson and Hannes Westerberg
1
Introduction
Features for changing playback speed have become common in
digital media players. Their use ranges from speeding up lengthy
podcast episodes and recorded lectures, to slowing down difficult
pieces of music when practicing an instrument. However, simply
changing the playback rate of audio brings about a corresponding
change in pitch. This may be preferable in some cases — perhaps
when altering the tempo of non-tonal material such as drums and
percussion — but entirely unsuitable when dealing with harmonic
content. Therefore, choosing appropriate algorithms to perform
the change in playback rate while preserving pitch is vital in order
to retain the character of the original audio.
The task of altering the playback speed of audio without changing its pitch is called time-scale modification (TSM) [8], often referred to as time stretching or time warping. It is applied to audio
in many different settings; podcast or audio book listeners may
speed up content, musicians slow down difficult pieces of music,
language learners slow down speech recordings, and deejays match
the tempo of two recordings. Additionally, whenever the playback
speed of a video is altered, it is usually desired that the audio playback rate is matched to the video rate.
Different algorithms for TSM introduce different artifacts — unwanted effects resulting from an operation on a signal. More complex, high-end algorithms may perform better in preventing unwanted artifacts, but are difficult to implement in real time due
to their processing requirements. Conversely, simpler algorithms
often introduce more unwanted artifacts, but work flexibly in real
time and may still yield acceptable results if the change in playback
rate is small.
From a software developer's perspective, the implementation of a
time stretching algorithm must be made with several considerations
in mind. What artifacts will the algorithm produce? How high are
the computational demands? Will the algorithm function in real
time or cause latency? On mobile and tablet devices, features for
altering playback speed can be implemented using algorithms that
come with the operating systems' software development kits [2].
Web browsers also feature similar built-in functionality [9, 23, 24].
In applications intended for media playback, it's often desired
that users may change playback speed on the fly with no latency. In
settings where audio is being processed rather than simply played
back — such as music production or audio editing — algorithms can
afford to be more computationally intensive since these applications
are not constrained by real-time requirements.
The purpose of this study is to investigate whether any patterns
can be identified with regards to user preferences in algorithms
for time-scale modification of audio. We do not seek to identify a
single "best" algorithm or to draw performance conclusions about
the specific algorithms included in our evaluation. Rather, we aim
to discover whether consistent preference trends arise when listeners adjust playback speed for various types of audio. To this
end, participants completed a survey in which they ranked four
different TSM algorithms according to personal preference. Each
participant evaluated 16 combinations of four audio types and four
playback speeds, providing insight into how algorithm preference
varies under these conditions.
The broader topics of audio processing and audio engineering
have been widely studied, but only limited research has covered
the layperson's perspective on common audio processing techniques, despite their application in software used daily by many.
Understanding user preferences in TSM algorithms may be of importance to developers who are faced with a choice between several
algorithms. If preferences tend to converge significantly, this may
indicate that an informed developer could safely trust their own
taste as it is likely to conform with that of users. If preferences
are greatly varied, developers may need to take measures to better
understand their users and how to accommodate their preferences.
2
Background
The task of changing the playback rate of audio while preserving
pitch can be achieved using a number of different algorithms. They
require varying amounts of computational power, and have different sonic characteristics owing to the artifacts they introduce.
Some cause what is known as "smearing", characterized by a loss of
transients. Others, a noticeable "choppiness" as changes in playback
rate become large.
A main challenge in audio time stretching is preserving different
kinds of sonic characteristics. Procedures well-suited to retaining
harmonic information, such as sustained musical notes, may be
ill-suited to preserving transients and non-periodic sounds, such
as clicks and noises. For example, when stretching a recording of a
violin played together with castanets, the violin's pitch and timbre
must be maintained, as well as the castanets' non-tonal clicks and
their precise timing. [8]
Pitch-scale modification (or pitch shifting, pitch warping) is a
procedure closely related to time-scale modification. It involves
changing the pitch of audio signals without affecting their duration.
Many of the same algorithms can be used for pitch shifting as are
used for time stretching [13, 14].
2.1
Fundamentals of Time-Scale Modification
Featured in nearly all TSM algorithms is some form of overlap-add
(OLA) mechanism. It involves dividing an audio signal into short
frames of equal size, shifting them forward or backward along the
time axis, and joining them back together. The division of the signal
into frames preserves local information within each frame, such as
frequency and phase relationships, while the time shifting of the
frames performs the global time-scale modification.
The distance between the starting points of two consecutive
frames, prior to shifting them in time, is called the analysis hopsize.
After the time shift has been performed, the distance is referred to
as the synthesis hopsize. The synthesis hopsize is thus a function
of the analysis hopsize and the stretch factor. Similarly, the frames
themselves are referred to as analysis frames and synthesis frames.
In order to prevent discontinuities in the signal resulting from the
rejoining of the time-shifted synthesis frames, the analysis frames
are constructed with some amount of overlap. In the overlap of
two frames, a crossfade is typically applied using a Hann window,
resulting in a smoother transition between neighboring synthesis
frames. [8]
A common artifact resulting from the basic overlap-add approach
is fluttering, caused by phase jumps during the transition between

<!-- p.4 -->
Artifact Perception in Algorithms for Audio Time Stretching
Figure 1: Illustration by Zölzer (2011) visualizing the synchronous overlap-add (SOLA) algorithm. a) Segmentation of
input signal, b) repositioning of the blocks, c) computation
of cross-correlation and synchronization of the blocks, d)
overlap and add. [27]
two neighboring frames. It occurs when the waveforms of the
frames at their respective crossover points are not similar, or are
out of phase, causing a drop in amplitude at the crossover. This
effect is remedied in the SOLA (synchronous overlap-add) variation proposed by Roucos and Wilgus [16]. The SOLA algorithm
uses a variable-size overlap, where the point of transition between
two successive frames is determined by the maximum of a crosscorrelation function. As a result, the transition between frames
occurs where the two are as "similar" as possible, and fluttering
artifacts are greatly reduced. The SOLA algorithm is illustrated in
figure 1.
2.2
Frequency-Domain Operations
The OLA and SOLA procedures for TSM are constrained to the time
domain. By performing the discrete Fourier transform on analysis
frames, called a short-time Fourier transform (STFT), an input signal
is deconstructed into its constituent frequency components. This
produces a representation of the signal in a joint time and frequency
domain, consisting of time-successive frequency-domain frames.
[14]
The phase vocoder algorithm makes use of the short-time Fourier
transform and is thus able to produce time-scale modified signals
where the phases of the component frequencies between synthesis frames are aligned individually, resulting in an output signal
with no phase jumps. However, the per-frequency phase alignment
causes a misalignment of frequency components within the same
synthesis frame. This results in a loss of transients, or "peaks" in
the audio signal — an artifact known as smearing. Modern phase
vocoders contain countermeasures for reducing smearing, such
as peak detection mechanisms 'resetting' the phase of individual
frequency components to match those of the analysis frames at the
time of a peak [13].
2.3
Algorithms Used in the Test
Four TSM algorithms were selected for evaluation in the survey.
They will throughout the text be referred to as OLA, SOLA, phase
vocoder, and élastique. These specific algorithms were chosen because they produce artifacts with different characteristics and require varying amounts of computational effort. Although they do
not come close to covering the full range of TSM techniques, we
expected their qualitatively different outputs to produce distinct
and meaningful responses from the test participants. The OLA and
SOLA algorithms operate in the time domain, making them suitable for real-time use. The élastique and phase vocoder algorithms
contain more computationally demanding frequency-domain operations, which makes them unsuitable for real-time use.
2.3.1
OLA. The OLA (overlap-add) algorithm is a basic mechanism
featured in most TSM algorithms, described in section 2. The simple
windowed option featured in digital audio workstation Reaper is
based on the OLA technique, and offers a choice of window size
and crossfade lengths. For this test, we opted for the default settings
of 50-millisecond windows with a 50 percent fade. These settings
were consistent across all playback speeds and audio types. We
used Reaper version 7.34.
2.3.2
SOLA. For the SOLA algorithm, we used version 3.7.1 of
Audacity, a free and open source software for sound recording and
editing [4]. Audacity offers two algorithms for time stretching, one
simple and one complex. The simple algorithm is based on the
SOLA technique, and was used for our test. The algorithm itself
was provided to Audacity by the SoundTouch library [15].
2.3.3
Phase Vocoder. Apple's music production software Logic Pro
version 11.1.2 features the Flex Time - Polyphonic algorithm, based
on the phase vocoder technique. Being proprietary software, we
have no means of investigating the exact properties of the algorithm
other than its general implementation of the phase vocoder, as
described on Apple's support page [3]. The 'complex' setting was
enabled, which is said to improve handling of transients.
2.3.4
Élastique. The élastique 3.3.3 pro algorithm is proprietary
software by zplane used for deejaying, music production, and live
performance [26]. We applied the algorithm using Reaper, and
used the default settings for the élastique pro option. Élastique can
operate in real time, but requires much processing power as well
as an analysis of the entire input signal. As with Logic Pro's phase
vocoder algorithm, we cannot know what precise processes are
included in the élastique algorithm.
2.4
Previous Work
Research into time-scale modification of audio has mainly focused
on the development and refinement of existing algorithms from a
computer science and mathematics perspective [7, 11-14, 16, 21].
Additionally, research into perception aspects of audio processing
has mainly covered the application of conventional effects, such
as distortion, equalization, and compression [5, 6]. However, these

<!-- p.5 -->
Elias Benson and Hannes Westerberg
studies have used test groups consisting exclusively of music production students with experience in audio engineering, instead of
media consumers with "untrained ears".
3
Method
The method consisted of the selection of algorithms, playback
speeds and audio files, the creation and distribution of a survey,
and analysis of the collected data. From an early stage, we decided
the survey had to be large enough to accommodate a variety of
test conditions, but short enough to avoid causing the participants
listening fatigue.
The following sections will detail each step in our process. First,
the creation of audio files for use in the survey. Then, the creation
of the survey and our distribution strategy. Finally, we will describe
the methods used for processing and analyzing the collected data.
3.1
Audio Files
Four eight-second audio clips were selected for the test: a speech
recording, a classical music recording, an instrumental band recording, and a musical recording with vocals. The recordings were
selected with a variety of spectral and musical properties in mind:
the speech recording is a clean, high-fidelity recording of a single
voice with no background sounds; the classical music recording
is of a polyphonic string orchestra; the instrumental band recording contains drums, electric bass, electric guitar, and keys; and the
musical recording with vocals contains singing, guitar and lighter
drums.
The speech recording was sourced from the Sveriges Radio program Bildningsresan: Paris (29 June 2024).1 The classical recording
is a snippet of Beethoven's Symphony No. 5 in C Minor, Op. 67: I.
Allegro Con Brio, performed by the Dresden Philharmonic Orchestra & Herbert Kegel.2 The instrumental band recording is Nightfall
by Mezzoforte.3 The music recording with vocals is Joni Mitchell's
You Turn Me On I'm A Radio.4
3.1.1
Playback Speeds. Each combination of audio and algorithm
was rendered at four different playback speeds (1.5x, 0.9x, 0.75x,
0.5x), for a total of 64 audio files to be used in the test. The selection
of playback speeds was made with three main considerations in
mind: (1) all four playback speeds are common options in media
players; (2) slowing down audio is a more complicated process
which introduces more artifacts compared to speeding up audio;
(3) choosing more than four speeds made the survey too time consuming for participants.
3.1.2
Other Processing and Rendering. Both prior to applying the
time warping and after rendering, each audio file was separately
normalized to an integrated loudness of -20 LUFS (loudness units relative to full scale) using Logic Pro's loudness normalization feature.
This step proved important, as one stretching algorithm resulted in
around 2 dB of amplitude loss compared to the original audio files.
No other processing was applied.
1At 8:30. Recorded from https://www.sverigesradio.se/avsnitt/bildningsresan-paris
2At 2:32. Recorded from the collection Beethoven, Brahms & Others: Orchestral Works
on Apple Music.
3At 0:40. Recorded from the album Forward Motion on Apple Music.
4At 1:12. Recorded from the album For the Roses (2022 Remaster) on Apple Music.
3.2
Survey
The survey was created using the free, web-based platform Aidaform
[1]. It was designed with six pages, where the first asked participants for personal information, the middle four dealt with each
respective audio file, and the last asked participants for follow-up
information. Before these six pages was a welcome page, where
general information and instructions were presented.
Some questions required participants to write their answers
freely, while others required selecting a number on a scale. Some
also had a multiple choice format. From now on, free-text questions
will be marked with [text], multiple choice with [multichoice], and
scale-based questions will be marked with [scale]. This distinction is
important because the scale responses are intended for quantitative
analysis, whereas the text and multiple choice responses will be
discussed qualitatively to contextualize the scale rankings. The way
we treat scale ranking data is presented in section 3.4. We will now
detail the layout of the survey pages.
3.2.1
Initial Questions. The first survey page collected information
on demographics, previous experience with audio time stretching,
and playback speed habits for media consumption. These were
collected before subjecting the participants to any listening. In
order to keep the parameters narrow, demographic information was
restricted to age and gender. Participants were asked the following
specific questions about their background and habits:
• How much experience do you have with audio time stretching? [multichoice]
• How bothered are you by poor audio quality in speech?
[scale]
• How bothered are you by poor audio quality in music?
[scale]
• Do you ever change the playback speed when consuming
audiovisual media such as music, podcasts, movies and
TV-shows, or recorded lectures? [multichoice]
• If you ever change media playback speed, why? Do you
have a particular use for it? [text]
3.2.2
Ranking Questions. The four ranking pages of the survey
each pertained to one of the four audio files. Every page first presented the original eight-second audio at 1.0x speed for comparison,
as shown in figure 2. Then, divided into subsections based on playback speed, four versions of the audio were presented at a time,
time-stretched by the different algorithms. Using a ranking matrix, participants were asked to rank the algorithms at the current
playback speed according to their preference. Participants were instructed to award tie ranks to algorithms that were not discernibly
different. This process was repeated for each playback speed and
audio file. Figure 3 shows the layout of a ranking subsection.
In each section, the algorithms were anonymized with labels
A, B, C, and D. In order to reduce learning effects, the algorithm
labels were shuffled after each audio clip. However, the labels were
consistent across the different playback speeds for the same audio
clip.
To aid in a more nuanced understanding of the participants'
listening criteria when examining the audio files, each page had
a dedicated question at the bottom about what sonic aspects the

<!-- p.6 -->
Artifact Perception in Algorithms for Audio Time Stretching
Figure 2: The initial text of a ranking page, followed by the
audio at normal speed.
listener had focused on when deciding the ranking order. The questions were not the same on all pages. For both the instrumental
song and the song with vocals, we asked what specific instruments
participants had focused on and provided multiple answer choices.
More than one option was allowed to be selected. For the classical
and speech recordings, we instead asked the participants about
their listening focus in a free text format.
3.2.3
Closing Questions. To make sure any unpredicted factors
didn't interfere with the results, the final page was dedicated to
retrieving data on each participant's specific test environment. The
specific questions were as follows:
• What type of headphones/speakers did you use in the test?
[multichoice]
• Did you take the test in a quiet environment? [multichoice]
• How important do you believe the choice of algorithm
for audio stretching is to your listening experience when
consuming audiovisual media? [scale]
• When comparing speech to music, which do you think
is most sensitive to the choice of stretching algorithm?
[multichoice]
• Did you experience a loss of focus or listening fatigue as
the test progressed? [multichoice]
• Any closing thoughts? (optional) [text]
3.3
Distribution
We distributed the survey publicly via Slack and Discord channels
associated with the Chapter for Media Technology at KTH, as well
as directly to friends and family. Since age group and gender was
the only demographic information collected, we have no means of
identifying individual respondents. As a consequence of our choice
of distribution channels, a majority of respondents were predicted
to be current or former engineering students aged between 19 and
30 years. The actual age distribution is presented in section 4.
Figure 3: The ranking subsection layout.
3.4
Quantitative Data
The algorithm rankings were stored as numbers between 1 and 4,
where 1 corresponds to the respondent's favorite algorithm for each
testing condition; a certain audio type played at a certain speed.
Since respondents were allowed to give two or more algorithms a
tied ranking if they perceived them to be indistinguishable, data
entries had to be manually corrected to represent a standardized
format. We used the standard competition ranking method (or "1224
ranking") for handling ties. In some cases, participants had shifted
the scale down, marking 2 or 3 as the highest rank. In those cases,
the rankings were simply shifted up to start from rank 1 and then
adjusted according to the competition ranking system. Examples
of this process are shown in table 1.

<!-- p.7 -->
Elias Benson and Hannes Westerberg
Table 1: Examples of ranking standardization.
Algorithm
A
B
C
D
User ranking
3
2
3
4
Corrected ranking
2
1
2
4
User ranking
4
4
4
4
Corrected ranking
1
1
1
1
User ranking
2
2
2
3
Corrected ranking
1
1
1
4
Although the results are represented numerically, the numbers
have to be treated like data points on an ordinal scale. An ordinal
scale only indicates the order of items, not the distance between
them [18, 19]. Therefore, the individual scale value of an algorithm
is by itself void of information but gains meaning when compared
to the rankings of the others. For ordinal scales, parametric methods
such as mean and standard deviation are inappropriate as the values
on which they would be based have no numerical significance [18].
Instead, we will use non-parametric statistical methods like the
Friedman test [17], ART ANOVA [25], and Nemenyi-test [10].
The code for performing the Friedman, Nemenyi and ART ANOVA
tests is provided on GitHub.5
3.4.1
Friedman Test. The Friedman test was used to analyze the
variance in rankings for the four algorithms across the 16 combinations of audio type and playback speed. The test answers the
question: Within this specific audio type and speed, do participants
rank the algorithms differently? The Friedman test performs oneway repeated measures analysis of variance (ANOVA). "One-way"
refers to one dependent variable, in this case a specific combination
of audio type and speed, meaning it cannot help us draw conclusions
about the effects of audio type and playback speed on algorithm
rankings independently [17]. The Friedman test was performed
using scipy.stats.friedmanchisquare in Python 3.10 [22].
3.4.2
Aligned Rank Transform (ART) ANOVA. Due to the fact that
only one independent variable is allowed, the Friedman test lacks
the ability to describe the individual effects of audio types and playback speeds on algorithm rankings. A factorial repeated measures
ANOVA test is needed to analyze the effects of audio type and playback speed separately. Due to our ordinal-scale data, the method
would also need to be non-parametric. The aligned rank transform
allows us to use a parametric repeated measures ANOVA by first
aligning the ranking data. This was done using ARTool in R. [25]
3.4.3
Post-Hoc Tests. A deeper understanding of patterns in algorithm preference was gained using the Nemenyi test, which
performs pairwise comparisons of each algorithm included in the
Friedman test [10]. The Nemenyi test thus provides insight into
whether algorithms significantly outperform other algorithms, although only overall and not per condition.
3.5
Qualitative Data
Summary and analyses of qualitative data were performed according to the General Inductive Approach proposed by Thomas [20].
5Code for statistical tests: https://github.com/hanneswesterberg/dm128x_stats
The respondents' descriptions of their listening experiences and
their sonic criteria for TSM algorithms frequently involved the use
of terminology that was informal or even incorrect or inaccurate
given the context. We have attempted to interpret the free text
responses in a way that captures their essence and intended meaning, and placed them into categories of themes which appeared in
several of the responses. The themes and categories were defined
with the evaluation objectives in mind, but the findings themselves
stem from the raw data alone and not from previous expectations
or presumptions.
4
Results
We found that there is significant conformity in the preferences of
time-stretching algorithms, depending on the playback speed and
audio type. The real-time algorithms OLA and SOLA performed
significantly worse overall compared to the more computationally
heavy élastique and phase vocoder algorithms in most conditions.
One notable exception was the speech recording at 0.9x speed,
where the SOLA algorithm performed best.
A total of 29 participants completed the survey. The largest age
group was 18-24 (N = 15), followed by 25-34 (N = 10), 55-64 (N =
3) and 65+ (N = 1). 17 respondents were women and 12 were men.
The following sections will provide details of the responses for
background information and test environment, the rankings, and
finally the results of the statistical analysis.
4.1
Playback Speed Habits
When asked about their previous experience with audio time stretching, 20 out of 29 respondents chose "None", eight chose "A little,
I have tried it when working with audio", and one chose "Quite a
bit, I know which algorithms are appropriate for different types of
audio". The fourth option, "I am an industry expert familiar with
the coding and mathematics of algorithms", was not chosen by any
respondent. Of the nine respondents who indicated some level of
previous experience, three were women and six were men.
Respondents were asked to rate how bothered they are by poor
audio quality in speech and music, on a scale 1-5. The results are
summarized in table 2.
Table 2: Participants' self-reported disturbance by poor audio
quality (1 = low, 5 = high).
SPEECH
MUSIC
Total
Women
Men
Total
Women
Men
Average
3.48
3.65
3.25
4.00
4.18
3.75
Std. dev.
1.06
0.79
1.36
0.93
0.64
1.22
When asked if they ever changed the playback speed of media,
16 respondents chose "I sometimes speed up media content", eight
chose "Never", and five chose "I sometimes speed up and sometimes
slow down content". No respondent chose the option "I sometimes
slow down media content". Six out of 12 male respondents indicated
that they never change playback speed, compared to only two out
of 17 female respondents.

<!-- p.8 -->
Artifact Perception in Algorithms for Audio Time Stretching
Lastly, participants were asked to provide a brief description of
their use cases to change media playback speed if they had any. 17
respondents indicated that they speed up content, such as podcasts
or recorded lectures, when the presenter or teacher speaks too
slowly. Other reasons for increasing the playback speed were due
to the respondent feeling bored, impatient, or in a hurry. Reasons
for reducing playback speed included making it easier to follow
along in tutorials, having more time to take notes, learning difficult
pieces of music, and learning dance choreographies.
4.2
Respondent Listening Focus
The respondents were asked to describe whether they had focused
their listening on any particular aspect of the recording while examining the algorithms for each type of audio. Additionally, they
were asked whether they they considered speech or music more
sensitive to the choice of TSM algorithm, after taking part in the
test.
4.2.1
Classical Recording. After listening to the classical music
recording, five respondents said they were unsure whether they
had focused on something particular, while two said they simply
focused on what sounded "best" or "most pleasing". Eight respondents mentioned either a preference for "smoothness", or a dislike
of "choppiness", "stutter", or "vibrations". We have chosen to interpret these as one consistent theme, as some of these comments
were made in direct reference to the OLA algorithm, whose windowing becomes very audible at lower playback speeds. It is worth
noting that the SOLA algorithm exhibits a similar behavior, so some
of the comments may also be referred to it. Another respondent
mentioned a dislike for an "eco/delay" effect, which may be a reference to the same windowing artifact. Additional listening criteria
included "similarity to the original", "clarity", and "pureness". Some
respondents mentioned a dislike for "distortion" and "brokenness".
Several respondents reported focusing on the quality of the high
frequencies, although this may be a consequence of our question
description containing a reference to spectral properties, which
may not have occurred to the respondents to consider otherwise.
4.2.2
Speech Recording. For the speech recording, some respondents reported that they focused on specific words, parts of words,
or sounds produced by the speaker. Three participants mentioned
fricatives or s sounds. Others mentioned general spectral properties
of the sound, with three mentioning a dislike of "metallic" or "tinny"
sounds. Again, there were mentions of "eco/delay" effects, but this
time also a "chorus" effect, which likely was in reference to the
phase vocoder algorithm which can yield a smeared, phasy result
when applied to monophonic sounds with transient content. The
number of respondents who said they were uncertain or simply
focused on what they liked best was the same as for the classical
recording, although some of them were different respondents this
time. "Clarity" was a popular listening criterion.
4.2.3
Instrumental Music Recording. After listening to the instrumental music recording, participants were asked which instruments
they mainly focused on. They were allowed to select multiple answers. The results are summarized in table 3.
Table 3: Respondent focus on instruments when assessing
algorithm quality for instrumental music.
Instrument
Chosen by (out of 29)
Lead guitar
19
Drums
13
Bass
8
Keys/piano
8
Everything equally
2
Other
4
Two of the respondents who chose "other" made reference to a
trumpet which they believed was part of the mix. The song contained no trumpet playing, but there was a synthesizer doubled
with the lead guitar playing the melody which may have caused
the confusion. A third respondent specifically referenced the hi-hat
cymbal of the drum kit, while the fourth made no reference to any
particular instrument.
4.2.4
Music With Vocals Recording. Respondents were asked which
instruments they focused on when listening to music with vocals.
Results are summarized in table 4. In both the instrumental recordTable 4: Respondent focus on instruments when assessing
algorithm quality for music with vocals.
Instrument
Chosen by (out of 29)
Vocals
27
Guitar
16
Drums/percussion
4
Everything equally
1
Other
0
ing and the one with vocals, respondents appeared to focus mainly
on the most upfront elements in the mix. The lead guitar in the
instrumental song serves as the main vehicle of melody — just as
the vocals do in the recording of music with singing.
4.2.5
Perceived Algorithm Sensitivity of Speech and Music. Prior to
listening to and evaluating the audio examples, participants rated
how bothered they were by poor audio quality in general for both
speech and music (see table 2). After completing the test, participants were asked whether considered speech or music to be more
sensitive to the choice of stretching algorithm. 17 participants chose
"Speech", six chose "Music", and another six chose "Both". Participants also rated the importance of the time-stretching algorithm for
the overall listening experience on a scale from 1 ("not important")
to 5 ("crucial"). The median and mode ratings were both 4, with an
average of 3.83 and a standard deviation of 1.04.
4.3
Algorithm Rankings
Tables 5-8 show the median and mode of algorithm rankings across
all four playback speeds for each audio file (N=29).

<!-- p.9 -->
Elias Benson and Hannes Westerberg
Table 5: Median | mode of algorithm rankings for the classical
music recording.
Speed
OLA
SOLA
Phase voc
Élastique
1.5x
4 | 4
2 | 1
1 | 1
2 | 3
0.9x
4 | 4
2 | 1
1 | 1
2 | 1
0.75x
4 | 4
3 | 3
1 | 1
2 | 2
0.5x
3 | 3
3 | 3
1 | 1
2 | 1
Table 6: Median | mode of algorithm rankings for the speech
recording.
Speed
OLA
SOLA
Phase voc
Élastique
1.5x
3 | 3
1 | 1
4 | 4
2 | 2
0.9x
3 | 3
1 | 1
3 | 4
2 | 2
0.75x
3 | 4
3 | 2
3 | 4
1 | 1
0.5x
3 | 3
4 | 4
2 | 2
1 | 1
Table 7: Median | mode of algorithm rankings for the instrumental music recording.
Speed
OLA
SOLA
Phase voc
Élastique
1.5x
4 | 4
2 | 1
1 | 1
1 | 1
0.9x
4 | 4
3 | 3
1 | 1
1 | 1
0.75x
3 | 3
3 | 3
1 | 1
1 | 1
0.5x
4 | 4
3 | 3
1 | 1
1 | 1
Table 8: Median | mode of algorithm rankings for the recording of music with vocals.
Speed
OLA
SOLA
Phase voc
Élastique
1.5x
4 | 4
3 | 3
2 | 1
1 | 1
0.9x
4 | 4
1 | 1
2 | 2
1 | 1
0.75x
3 | 3
3 | 3
2 | 2
1 | 1
0.5x
3 | 3
4 | 4
2 | 2
1 | 1
4.4
Friedman Test
We conducted the Friedman test on the ranking data in order to determine statistical significance of ranking variance. Each algorithm
was ranked 16 times by each participant, for all combinations of
audio type and playback speed. All 16 combinations were treated
as test conditions, with 29 data points for each. Having four different algorithms, the test was done with three degrees of freedom.
We chose a significance level of 95% which, given three degrees of
freedom, gives us a critical chi-square value of 7.815. The null hypothesis of the Friedman test is that the variance in ranks is caused
by chance, which will be rejected for chi-square values above the
critical value of 7.815. The results of the Friedman test are summarized in table 9. All tested conditions produced a chi-square
value well above the critical, and a p-value far below 0.05. The null
hypothesis was therefore rejected and further post-hoc tests were
performed.
Table 9: Friedman statistics per combination of audio type
and playback speed
Audio
Speed
Chi-square
p-value
Classical
0.5
58.904
1.008e-12
0.75
66.896
1.971e-14
0.9
34.305
1.708e-07
1.5
37.533
3.550e-08
Instr. music
0.5
54.548
8.571e-12
0.75
55.297
5.934e-12
0.9
48.920
1.357e-10
1.5
40.792
7.238e-09
Music w/ vocals
0.5
54.096
1.070e-11
0.75
53.283
1.596e-11
0.9
39.909
1.114e-08
1.5
43.905
1.581e-09
Speech
0.5
53.599
1.366e-11
0.75
39.583
1.306e-08
0.9
52.185
2.735e-11
1.5
48.032
2.097e-10
4.5
Aligned Rank Transform ANOVA
To capture individual effects of audio and playback speed on algorithm rankings, as well as their interactions, we performed an
aligned rank transform analysis of variance as described by Wobbrock et al. [25]. Results are shown in table 10.
Table 10: Aligned Rank Transform ANOVA (Type III Wald F
Tests with Kenward-Roger df)
Effect
F
Df
Dfres
Pr(>F)
Main Effects
Audio
0.004
3
1764
0.9997
Speed
0.144
3
1764
0.9336
Algorithm
489.50
3
1764
< 2 × 10−16
Two-Way Interactions
Audio:Speed
0.052
9
1764
0.9999
Audio:Algorithm
54.13
9
1764
< 2 × 10−16
Speed:Algorithm
54.50
9
1764
< 2 × 10−16
Three-Way Interaction
Audio:Speed:Algorithm
8.47
27
1764
< 2 × 10−16
The ART ANOVA results indicate that algorithm is a significant
main effect on rankings, along with the two-way interactions between algorithm-audio and algorithm-playback speed, and the
three-way interaction between algorithm-audio-playback speed.
4.5.1
Main Effects. Algorithm being a significant main effect should
be interpreted in the same manner as the results of the Friedman
test: that there are clear preferences when it comes to algorithms.
Audio and playback speed alone are not main effects, which is to be
expected given that the rankings pertain to the algorithms — not
the audio types nor the playback speeds.

<!-- p.10 -->
Artifact Perception in Algorithms for Audio Time Stretching
4.5.2
Two-Way Interactions. Both two-way interactions involving
algorithm (algorithm-audio and algorithm-playback speed) are
shown to be highly significant. This should be interpreted as algorithm preferences being highly dependent on both audio type and
playback speed, independently. The two-way interaction between
audio and playback speed is not significant, which is to be expected
for the same reason as why they are not significant main effects.
4.5.3
Three-Way Interaction. The three-way interaction between
algorithm, audio, and playback speed also had a highly significant
effect on rankings. This indicates that the way algorithm preference
varies with playback speed varies itself across audio types—and
vice versa.
4.6
Post-Hoc Tests
4.6.1
Nemenyi Test. After the Friedman test showed significant
results, the Nemenyi test was performed to reveal how each algorithm performed compared to the others. Results are summarized
in table 11. We determine the directionality of the difference in performance using the mean rankings for each algorithm, summarized
in table 12.
Table 11: Nemenyi post-hoc test results with significant pvalues in bold (< 0.05).
Élastique
Phase voc
OLA
Phase voc
8.93 × 10−2
-
-
OLA
1.43 × 10−13
7.36 × 10−7
-
SOLA
7.36 × 10−7
1.68 × 10−2
8.93 × 10−2
Table 12: Mean rankings of algorithms (1 = best, 4 = worst).
Algorithm
Mean ranking
Élastique
1.57
Phase voc
1.96
SOLA
2.60
OLA
3.25
Using the information in tables 11 and 12, we see that both the
Élastique and Phase vocoder algorithms perform significantly better
than both the OLA and SOLA algorithms. The Nemenyi test does
not show a significant difference between the Élastique and Phase
vocoder algorithms, nor between the OLA and SOLA algorithms.
These results do not account for specific effects on rankings of audio
type and playback speed, but show overall algorithm preference.
4.6.2
Pairwise t-tests with Bonferroni Correction. After the aligned
rank transform ANOVA test produced significant results, we performed pairwise t-tests with Bonferroni correction to determine
which pairs of algorithms perform significantly different. Results
are shown in table 13, and reveal that differences in performance
between all algorithms are statistically significant. These results
contrast with those of the Nemenyi test.
Table 13: Pairwise t-test with Bonferroni correction. All pvalues significant (< 0.05).
Élastique
Phase voc
OLA
Phase voc
9.7 × 10−11
-
-
OLA
< 2 × 10−16
< 2 × 10−16
-
SOLA
< 2 × 10−16
< 2 × 10−16
< 2 × 10−16
5
Discussion
With this study, we set out to investigate whether user preferences
in algorithms for time-scale modification of audio signals tend
to converge or diverge for different combinations of audio types
and playback speeds. We chose this topic because the playback
speed feature has become ubiquitous in digital media players and is
frequently used daily by a large group of media consumers. Despite
this, only a handful of interested people possess knowledge about
the algorithms which perform the change in playback rate, even
though they produce greatly varying results.
Our results indicate that there is a great deal of conformity in the
preferences of TSM algorithms. The respondents tended to mostly
agree on which algorithms performed the best and worst, regardless
of playback speed and audio type. However, the specific playback
speed and audio type determined which algorithms were the most
preferred and least preferred, indicating that there is no universally
best algorithm.
Looking at tables 10 and 12, we see that algorithms containing frequency-domain operations performed significantly better
than time-domain algorithms. This is not unexpected, given that
frequency-domain algorithms are not constrained by real-time requirements and can afford a higher computational cost. The élastique algorithm was the clear favorite overall, which was to be
expected given its level of sophistication.
A key finding is that participants tended to agree even on deviations from typical ranking patterns. The SOLA algorithm was
the clear favorite for the speech recording at 0.9x speed, and also
performed well for the music with vocals recording at 0.9x speed.
An interesting observation from comparing the background responses to the end of form responses, was that participants seemed
to change their mind on whether it was music or voice audio that
was more important when trying to retain quality. In table 2 from
section 4.1, we can see that music was ranked an average of 4 on
the 1-5 disturbance scale, while speech was ranked an average of
3,48. This indicates that before answering the survey, participants
believed that good audio quality was slightly more important for
music than for speech. In contrast, the responses to the final survey
page showed that the participants found voice recordings to be
more sensitive to algorithm choice.
The common themes which appeared in the participants' artifact
perceptions aligned with the overall ranking patterns. Whenever
a particular algorithm underperformed, comments pertaining to
the artifacts of that algorithm appeared in the accompanying description of participants' listening strategies. Several participants
commented on the fluttering artifacts caused by the time-domain
algorithms, especially OLA.

<!-- p.11 -->
Elias Benson and Hannes Westerberg
5.1
Method Discussion
The methods for data collection and statistical analysis used in this
study could easily have been improved. Due to technical limitations
in the Aidaform survey application, we were unable to randomly
select the order in which audio types and playback speeds appeared,
which may have contributed to learning effects. However, as previously stated, we did shuffle the order in which the algorithms
appeared on each of the survey pages and used anonymous labeling.
Our use of the Friedman test was not appropriate given the data
we had. The Friedman test is only appropriate given a single independent variable, when we had three. We circumvented this by
reducing our independent variables down to one, by letting each
combination of audio type and playback speed serve as separate
testing conditions, leaving algorithm as the only independent variable. This step was not necessary using the aligned rank transform
ANOVA test, which produced essentially the same results as the
Friedman test in addition to more detailed information regarding
two-way and three-way interactions.
As for the post-hoc tests, the Nemenyi test was less appropriate
for the same reasons as the Friedman test. This time, results actually
differed between our two post-hoc tests, and we are more inclined
to trust the results of the pairwise t-tests with Bonferroni correction
due to it being more appropriate for our dataset. The pairwise ttests showed statistically significant differences in performance
between all pairs of algorithms, whereas the Nemenyi test showed
no significant difference between the phase vocoder and élastique
algorithms, nor between the OLA and SOLA algorithms.
We wish to further justify our selection of playback speeds. The
results of the first part of our survey showed that it was far more
common for participants to increase playback speed than to decrease it, which was expected. Nonetheless, we opted for three
speeds below 1.0x and only one above. This is because increasing
playback rate is comparatively simple and produces fewer artifacts,
as the algorithm has an abundance of material from which to subtract. In contrast, lowering playback rate requires interpolating
audio where there is none, leading to more noticeable artifacts.
As artifact perception was the main focus of the study, we felt it
was more important to include multiple speeds below 1.0x rather
than above. Moreover, adding additional increased speeds, such as
1.25x and 2.0x, would have made the survey intolerably long for
participants.
5.2
Future Work
There are many endeavors which can further our understanding of
human perception and TSM artifacts. For a start, future research
could look to create more robust descriptions of the specific artifacts
media consumers are most bothered by. Even further, researching
and refining TSM techniques using a human perception-centered
approach, rather than a technical one, could lead to interesting ways
of making algorithms more computationally efficient by ignoring
the correction of certain artifacts completely.
We are also aware of the limited scope of this study, especially
with regards to our survey demographic. Therefore, we encourage
future researchers to conduct similar studies with a larger and
more diverse group of respondents, especially with varying levels
of experience within sound editing and production.
6
Conclusion
Our results indicate that there is significant conformity in preferences for time-stretching algorithms for audio. The most preferred
and least preferred algorithms depended on the type of audio and
the playback speed. However, there were clear favorites overall.
Algorithms making use of frequency-domain operations performed
significantly better than time-domain algorithms, with the notable
exception of small changes in playback rate for speech signals.
The high degree of conformity in subjective preferences for
algorithms is supported by recurring themes regarding artifact
perception. The choppy sound produced by phase discontinuities
between synthesis frames in time-domain algorithms was particularly disliked by participants, and resulted in unfavorable rankings.
7
Acknowledgments
We would like to thank our thesis supervisor Maurizio Berta for
providing indispensable source material and feedback during the
writing of this paper. We also wish to thank everyone who completed our survey for donating a moment of their time.
References
[1] Aidaform. [n. d.]. https://aidaform.com/. Accessed: 2025-04-08.
[2] Apple. [n. d.].
audioTimePitchAlgorithm.
https://developer.apple.com/
documentation/avfoundation/avplayeritem/audiotimepitchalgorithm/. Accessed:
2025-04-23.
[3] Apple support [n. d.].
https://support.apple.com/en-sa/guide/logicpro/
lgcpa77a4a3f/10.7/mac/11.0. "Flex Time algorithms and parameters in Logic Pro"
under section "Use the Polyphonic algorithm".
[4] Audacity® software is copyright © 1999-2025 Audacity Team. Web site:
https://audacityteam.org/. It is free software distributed under the terms of
the GNU General Public License. The name Audacity® is a registered trademark
of Dominic Mazzoni. [n. d.].
[5] Gary Bromham, David Moffat, Mathieu Barthet, Anne Danielsen, and György
Fazekas. 2019. The Impact of Audio Effects Processing on the Perception of Brightness and Warmth. In Proceedings of the 14th International Audio Mostly Conference:
A Journey in Sound (Nottingham, United Kingdom) (AM '19). Association for Computing Machinery, New York, NY, USA, 183-190. doi:10.1145/3356590.3356618
[6] Gary Bromham, Dave Moffat, Mathieu Barthet, and György Fazekas. 2018. The
Impact of Compressor Ballistics on the Perceived Style of Music. Journal of the
Audio Engineering Society 10080 (October 2018).
[7] David Dorran, Robert Lawlor, and Eugene Coyle. 2003. High quality time-scale
modification of speech using a peak alignment overlap-add algorithm (PAOLA).
ICASSP, IEEE International Conference on Acoustics, Speech and Signal Processing -
Proceedings 1 (2003), 700-703. 2003 IEEE International Conference on Accoustics,
Speech, and Signal Processing ; Conference date: 06-04-2003 Through 10-04-2003.
[8] Jonathan Driedger and Meinard Müller. 2016. A review of time-scale modification of music signals. Applied Sciences (Switzerland) 6, 2 (2016). doi:10.3390/
app6020057 Cited by: 65; All Open Access, Gold Open Access, Green Open
Access.
[9] Google. [n. d.]. Chromium Code Search. https://source.chromium.org/chromium/
chromium/src/+/main:media/audio/. Accessed: 2025-04-30.
[10] Myles Hollander, Douglas A. Wolfe, and Eric Chicken. 2015. Approximate twosided all-treatments multiple comparisons based on signed ranks(Nemenyi). John
Wiley Sons, Inc., 379-382. doi:10.1002/9781119196037
[11] G. Kafentzis, G. Degottex, O. Rosec, and Y. Stylianou. 2013. Time-Scale Modifications Based on a Full-Band Adaptive Harmonic Model. In Proc. IEEE International Conference on Acoustics, Speech and Signal Processing (ICASSP).
Vancouver, Canada. http://gillesdegottex.eu/wp-content/papercite-data/pdf/
KafentzisGP2013timescaleahm.pdf
[12] Adam Kupryjanow and Andrzej Czyżewski. 2009. Time-scale modification
of speech signals for supporting hearing impaired schoolchildren. In Signal
Processing Algorithms, Architectures, Arrangements, and Applications SPA 2009.
159-162.
[13] J. Laroche and M. Dolson. 1997. Phase-vocoder: about this phasiness business.
In Proceedings of 1997 Workshop on Applications of Signal Processing to Audio and
Acoustics. 4 pp.-. doi:10.1109/ASPAA.1997.625603
[14] Eric Moulines and Jean Laroche. 1995. Non-parametric techniques for pitchscale and time-scale modification of speech. Speech Communication 16, 2 (1995),

<!-- p.12 -->
Artifact Perception in Algorithms for Audio Time Stretching
175-205. doi:10.1016/0167-6393(94)00054-E Voice Conversion: State of the Art
and Perspectives.
[15] Olli Parviainen. [n. d.].
SoundTouch.
https://www.surina.net/soundtouch/.
SoundTouch library Copyright © Olli Parviainen 2001-2025.
[16] S. Roucos and A. Wilgus. 1985. High quality time-scale modification for speech.
In ICASSP '85. IEEE International Conference on Acoustics, Speech, and Signal
Processing, Vol. 10. 493-496. doi:10.1109/ICASSP.1985.1168381
[17] Michael R. Sheldon, Michael J. Fillyaw, and W. Douglas Thompson.
1996.
The use and interpretation of the Friedman test in the analysis of ordinal-scale data in repeated measures designs.
Physiotherapy Research International
1, 4 (1996), 221-228.
doi:10.1002/pri.66
arXiv:https://onlinelibrary.wiley.com/doi/pdf/10.1002/pri.66
[18] S. S. Stevens. 1946. On the Theory of Scales of Measurement. Science 103, 2684
(1946), 677-680. http://www.jstor.org/stable/1671815
[19] S. S. Stevens. 1968. Measurement, Statistics, and the Schemapiric View. Science
161, 3844 (1968), 849-856. http://www.jstor.org/stable/1724851
[20] David R. Thomas. 2006. A General Inductive Approach for Analyzing Qualitative
Evaluation Data. American Journal of Evaluation 27, 2 (2006), 237-246. doi:10.
1177/1098214005283748 arXiv:https://doi.org/10.1177/1098214005283748
[21] W. Verhelst and M. Roelands. 1993. An overlap-add technique based on waveform
similarity (WSOLA) for high quality time-scale modification of speech. In 1993
IEEE International Conference on Acoustics, Speech, and Signal Processing, Vol. 2.
554-557 vol.2. doi:10.1109/ICASSP.1993.319366
[22] Pauli Virtanen, Ralf Gommers, Travis E. Oliphant, Matt Haberland, Tyler
Reddy, David Cournapeau, Evgeni Burovski, Pearu Peterson, Warren Weckesser,
Jonathan Bright, Stéfan J. van der Walt, Matthew Brett, Joshua Wilson, K. Jarrod Millman, Nikolay Mayorov, Andrew R. J. Nelson, Eric Jones, Robert Kern,
Eric Larson, C J Carey, İlhan Polat, Yu Feng, Eric W. Moore, Jake VanderPlas,
Denis Laxalde, Josef Perktold, Robert Cimrman, Ian Henriksen, E. A. Quintero,
Charles R. Harris, Anne M. Archibald, Antônio H. Ribeiro, Fabian Pedregosa,
Paul van Mulbregt, and SciPy 1.0 Contributors. 2020. SciPy 1.0: Fundamental Algorithms for Scientific Computing in Python. Nature Methods 17 (2020), 261-272.
doi:10.1038/s41592-019-0686-2 Original Author: Pierre GF Gerard-Marchant
(2007).
[23] W3C. [n. d.]. HTMLMediaElement. https://developer.mozilla.org/en-US/docs/
Web/API/HTMLMediaElement. Accessed: 2025-04-23.
[24] WHATWG. 2025. HTML Living Standard: Audio Element. https://html.spec.
whatwg.org/#htmlaudioelement. Accessed: 2025-04-30.
[25] Jacob O. Wobbrock, Leah Findlater, Darren Gergle, and James J. Higgins. 2011.
The aligned rank transform for nonparametric factorial analyses using only
anova procedures. In Proceedings of the SIGCHI Conference on Human Factors in
Computing Systems (Vancouver, BC, Canada) (CHI '11). Association for Computing Machinery, New York, NY, USA, 143-146. doi:10.1145/1978942.1978963
[26] Zplane [n. d.]. https://licensing.zplane.de/uploads/SDK/ELASTIQUE-PRO/V3/
manual/elastique_pro_v3_sdk_documentation.pdf. Elastique Pro 3.3.7 Manual.
[27] U. Zölzer. 2011. DAFX: Digital Audio Effects (second ed.). John Wiley Sons, Ltd,
192.

<!-- p.13 -->
TRITA-EECS-EX-2025:172
Stockholm, Sverige 2025
www.kth.se
