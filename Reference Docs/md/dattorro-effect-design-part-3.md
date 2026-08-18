

<!-- p.1 -->

PAPERS
7L OW-FREQUENCY SINUSOIDAL
OSCILLATOR107
The low-frequency sinusoidal oscillator (LFO) is ubiq-
uitous in effect design. What we seek is high computa-
tional efficiency and high signal purity in an algorithmic
approach to real-time sinusoid generation. This section is
presented more as a cookbook than the others because for
the oscillator topologies that we analyze, each has distinct
advantages; that is to say, each is useful. We offer the fol-
lowing implementation options:
1) Direct form
2) Coupled form
3) First modified coupled form
4) Second modified coupled form
5) Normalized waveguide.
7.1 Direct-Form Oscillator
The direct-form oscillator is the most efficient option
requiring only one multiply, but it is noisy unless trunca-
tion error feedback is used [52], [12]. The error feedback
can be implemented using only one or two adds, so it is
attractive. (We do not consider error feedback here.) The
single coefficient γ requires high resolution for very low
frequencies of oscillation, however.
The direct-form oscillator was analyzed using state-
variable theory,
108 the results of which are shown in Fig.
54. This type of analysis excels at finding the zero input
response (ZIR) (see Section 7.6, Appendix 5). The
selected output is expressed in terms of the initial condi-
tions of all the memory elements, the state variables. This
method of analysis differs considerably from the tech-
nique of solving the recursive difference equation for the
selected output, in so far as the initial conditions required
by the latter are of the output itself. In the case of the
direct form, these two methods coincide.
Obviously, by choosing the initial states y
1[0] /H110050 and
y2[0] /H11005/H11002sin ω, we get
y1[n] /H11005sin nω .
There is no quadrature sinusoid at any node. But by choos-
ing, for example, y1[0] /H11005 1 and y2[0] /H11005 cos ω, we get
y1[n] /H11005sinsin ω
1 [sin(ω /H11001nω) /H11002cos ω sin nω] /H11005 cos nω .
The direct-form oscillator is hyperstable 109 under coef-
ficient quantization, as proven by the equation for the pole
locations in the z plane in Fig. 54. Regardless of the quan-
tization of γ, the pole radii are exactly 1 as determined
from the pole magnitude. Any instability in the sinusoidal
waveform can only be attributed to signal quantization
effects, primarily in the form of truncation error in this
recursive topology.
One must be cognizant of the relationship between
oscillation frequency ω and amplitude when using the dif-
J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March 115
Effect Design*
Part 3 Oscillators: Sinusoidal and Pseudonoise
JON DATTORRO,AES Member
CCRMA, Stanford University, Stanford, CA, USA
In 1997, Jon Dattorro published articles entitled “Effect Design” that were to appear in the
Journal in three parts. Parts 1 and 2 were published in the September and October issues. Part
3 is now being published, unedited. The paper is a tutorial intended to serve as a reference in
the field of digital audio effects in the electronic music industry for those who are new to this
specialization of digital signal processing. The effects presented are those that are demanded
most often, hence they will serve as a good toolbox. The algorithms chosen are of such a
fundamental nature that they will find application ubiquitously and often.
* Manuscript received 1996 March 14; revised 1996
September 14 and 1997 June 28.
107 Special thanks to Julius Orion Smith for reviewing this sec-
tion.
108 Following the type of analysis presented in [53] for the
coupled form and the second modified coupled form.
109 We shall define hyperstable in this context to mean stabil-
ity of oscillation in the face of coefficient quantization. The
impact of signal quantization in digital circuits is not included in
this definition.

<!-- p.2 -->

DATTORRO PAPERS
ferent oscillators presented in this section. The equations
of Fig. 54 predict that when the frequency is changed via
γ after the oscillator has been running for some time, the
amplitude will deviate, in general. One theoretically over-
comes this problem by simultaneously updating the mem-
ory elements (the states), but this can be difficult in prac-
tice, depending on the particular oscillator topology.
The direct-form oscillator circuit can be derived from
one trigonometric identity,
110
sin[(n /H110011)ω] /H11005cos ω sin nω /H11001sin ω cos nω
sin[(n /H110021)ω] /H11005cos ω sin nω /H11002sin ω cos nω
where ω is the normalized radian frequency of oscillation
(2π fT ) controlled by γ,w hich should be in q22 format.111
Summing the two equations yields
sin[(n /H110011)ω] /H110052 cos ω sin nω /H11002 sin[(n /H110021)ω] .
Making the substitution y1[n] ← sin nω, we get
y1[n /H110011] /H110052 cos ω y1[n] /H11002y1[n /H110021]
which is the difference equation for the circuit. 112
7.2 Coupled-Form Oscillator
The coupled form is an established topology known by
several names, including Rader – Gold and normal form.
The coupled form is a state-space digital filter structure
and is one of the foremost contributions of the branch of
linear systems theory known as state-variable analysis.
The coupled form has many attributes, including low trun-
cation noise and low coefficient sensitivity, respectively
due to signal and coefficient quantization within a finite-
precision machine [11, ch. 4.4]. The latter attribute makes
tuning easier. Its primary detriment is that four multiplys
are required in its unmodified form.
The unmodified coupled form in Fig. 55(a) shows the
four multiplys required for oscillation, including two
cos ω coefficients. Using all four coefficients, the pole
116 J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March
110 This was pointed out to us by Michael A. Chen.
111 See Section 9.1, Appendix 7.
112 This also happens to be the generating recurrence relation
of the Chebyshev polynomials,Tn/H110011(x) /H110022xTn(x) /H11001Tn/H110021(x) /H110050
[54, ch. 28.3, p. 473].
Fig. 54. Direct-form sinusoidal oscillator.
Fig. 55. (a) Coupled-form (four-multiplier) sinusoidal oscillator.
(b) First modified coupled-form (two-multiplier) low-frequency
oscillator.
(b)
(a)


<!-- p.3 -->

PAPERS EFFECT DESIGN
locations are ideally on the unit circle. It can be deduced
from the equations given in Fig. 55(a) that for any initial
states (y[0], y
q[0]) the outputs at y[n] and yq[n] yield quad-
rature sinusoids. But when the ideal filter coefficients be-
come quantized to their representation in a finite-precision
machine, the pole locations are perturbed in a direction
dependent on the polarity of the coefficient quantization
error. The impact of this is that the pole radii are no longer
exactly 1, so the oscillator amplitude either decays to zero
or clips (assuming automatic saturation arithmetic) after
some time has passed. We do not relish the four multiply
requirement and we recall that the direct form does not
suffer from this particular problem. This is because the
direct-form pole radii can be fixed by the second-order
recursive coefficient [12, Eq. (30)], which is always set
precisely to 1 for our present application.
The coupled form has a simpler trigonometric deriva-
tion, but uses two identities,
cos[(n /H110011)ω] /H11005cos ω cos nω /H11002sin ω sin nω
sin[(n /H110011)ω] /H11005sin ω cos nω /H11001cos ω sin nω .
Making the substitutions, y[n] ← sin nω and y
q[n] ←
cos nω, we get
yq[n /H110011] /H11005cos ω yq[n] /H11002sin ω y[n]
y[n /H110011] /H11005sin ω yq[n] /H11001cos ω y[n] .
We will make a modified coupled-form digital filter
behave as an oscillator by placing its poles either slightly
beyond or precisely on the unit circle in the z plane, even
in the presence of coefficient quantization error. We will
see that both of these choices of pole locations can be
achieved using only two multiplys, and both have useful
purposes.
7.2.1 First Modified Coupled-Form Oscillator
If the coupled-form oscillator is used as an LFO, we
make the observation that the two cos ω coefficients are
close to 1. If we set them to 1 permanently, we eliminate
two multiplys and arrive at the first modified coupled form
in Fig. 55(b). Using the first modified coupled form, the
quadrature sinusoids at y[n] and y
q[n] will always clip
somewhat (assuming saturation arithmetic) because the
pole radii are in excess of unity. When the oscillator fre-
quency is very low, the clipping will be slight.
The advantage of this first modified coupled-form
implementation is that its output amplitude is at least
unity, even after oscillation frequency is abruptly changed.
The oscillator never blows up, as the equations in Fig.
55(b) predict, if a saturation nonlinearity is built into the
computation units. The detriment to the use of this oscil-
lator is that the frequency of oscillation is practically
restricted to a portion of the first quadrant in the z plane.
113
This modified coupled form of the oscillator would be
chosen when the criteria for the selection of an LFO do
not include sinusoid purity, but full-amplitude stable
quadrature signals are a must.
7.2.2 Second Modified Coupled-Form Oscillator
The second modified coupled form, first presented in
[53], is shown in Fig. 56. This oscillator produces a high-
purity sinusoid at the two outputs y[n] and y
q[n], whose
noise floor is low enough to characterize digital-to-analog
converters. The two outputs are no longer exactly in quad-
rature as before,
114 but the oscillator is hyperstable
because the pole radii are exactly 1 (even when ε is quan-
tized).115 The tradeoff for this stability is the linking of
amplitude to the frequency of oscillation, as seen in the
equations in Fig. 56. By observation of the poles, the fre-
quency of oscillation now spans dc to Nyquist as ε goes
from 0 to 2, and so the range of oscillation is not restricted
to low frequencies, as in the first modified coupled form.
We have found as predicted, using the second modified
coupled form, that when ε (the frequency control) is
changed abruptly, the oscillator amplitude will change
itself to a new value. This is because we ignore the new
initial states y
q[0] and y[0] at the time of the tuning
J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March 117
Fig. 56. Gordon – Smith sinusoidal oscillator, also called second
modified coupled-form (two-multiplier) oscillator.
113 This restriction is overcome in practice by running the
oscillator twice as fast, which means twice the code.
114 From the equations in Fig. 56 it can be shown trigonomet-
rically for any initial states that the two sinusoids are in a near
quadrature relationship, being off by exactly one-half sample at
any frequency of oscillation. This was first pointed out to the
author by Timothy S. Stilson.
115 Like the direct form, any instability in the sinusoidal wave-
form can only be attributed to signal quantization effects, prima-
rily in the form of truncation error in this recursive topology.

<!-- p.4 -->

DATTORRO PAPERS
change; that is, no attempt is made to adjust them. We
observed these consequent deviations in amplitude and
empirically found them to be less than a decibel over a
very useful range of oscillation frequency for an LFO. It
was never found necessary, in any of our applications, to
compensate for these small changes in amplitude. Built-in
saturation arithmetic within the computation units will
eliminate any possibility of long-term clipping com-
pletely.
The ideal digital integrators 1/(1 /H11002z
/H110021) have never pre-
sented a problem in practice because there is zero trans-
mission at z /H110051 (dc) across each embedded integrator
from its input to its output. This comment applies to both
modified coupled forms.
7.3 Real-Time Measure of Sinusoid Purity
We made measurements of THD /H11001N for the direct-
form and the second modified coupled-form oscillators,
each running at a sample rate of 69 818.181 Hz in a real-
time hardware development system. For each oscillator,
the two parameters are frequency of oscillation and the
number of bits in the two’s complement signal path.
Binary truncation post-accumulation is used to limit the
path width. The results are tabulated in Table 8.
The hardware system average noise is roughly /H1100286 dB
relative to full scale, which prevented measurements sig-
nificantly below that level. The readings at /H1100288 dB are
probably due to some system signal-transfer anomaly. The
term Flatline in Table 8 refers to a complete lack of any
form of oscillation as viewed on an oscilloscope.
7.3.1 Purity of Direct versus Coupled Form
We now postulate the reason pertaining to the foregone
conclusion from the empirical data that the direct-form
oscillator is inferior to the second modified coupled form.
It is that the latter has truncation error feedback built into
its topology. We state this in an equivalent way: each noise
transfer function of the second modified coupled form has
zeros of transfer, whereas that of the direct form has not.
Fig. 57 shows how high-rate truncation noise sources e[n]
and e
q[n] are conceptually inserted into a circuit in a lin-
ear fashion [12, Eq. (6)]. We have drawn each determinis-
tic noise source into the circuit so that it resides in front of
a multiplier, because that is the only location where trun-
cation is demanded by the architecture in contemporary
DSP chips.
116
Each noise source (acting as input) can make its way to
either of two outputs for this coupled topology in Fig. 57:
y
q[n] or y[n]. In each case the noise transfer either picks up
a zero at dc, or is multiplied by ε2,w hich yields the same
outcome at low frequencies ( ω < π/3). In order for the
direct-form oscillator to perform as well, truncation error
feedback [12] must be used to introduce a zero into its
deterministic noise transfer function, as stated at the out-
set.
7.3.2 Purity versus Frequency
The data in Table 8 indicate that signal purity is a func-
tion of oscillator frequency for both topologies. Binary
truncation noise can be modeled like quantization noise
[14, ch. 6.9.1, p. 353]. Gray demonstrates [55, ch. 6.3]
how the quantization noise of a sampled pure sinusoid is
never characteristically white, regardless of its amplitude
118 J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March
116 Were we instead to place the noise sources following the
accumulators, for truncation post-accumulation, we would reach
similar conclusions in the analysis of this topology. The ideal
digital integrators would not pose a practical problem in this case
either, as demonstrated by Table 8.
Table 8. Measurement of oscillator THD /H11001N in decibels.
Direct Form Second Modified Coupled FormNumber
of Bits 20 Hz 100 Hz 1000 Hz 20 Hz 100 Hz 1000 Hz
24 /H1100260 /H1100275 /H1100286 /H1100288 /H1100286 /H1100286
23 /H1100258 /H1100275 /H1100286 /H1100288 /H1100286 /H1100286
22 /H1100253 /H1100273 /H1100285 /H1100288 /H1100286 /H1100286
21 /H1100245 /H1100270 /H1100284 /H1100287 /H1100286 /H1100286
20 /H1100237 /H1100264 /H1100284 /H1100287 /H1100286 /H1100286
19 Flatline /H1100260 /H1100279 /H1100286 /H1100285 /H1100285
18 /H1100258 /H1100274 /H1100285 /H1100284 /H1100285
17 /H1100250 /H1100273 /H1100279 /H1100280 /H1100284
16 /H1100240 /H1100267 /H1100270 /H1100273 /H1100282
15 /H1100225 /H1100261 /H1100267 /H1100268 /H1100278
14 Flatline /H1100256 /H1100259 /H1100265 /H1100273
13 /H1100254 /H1100247 /H1100261 /H1100268
12 /H1100245 /H1100240 /H1100260 /H1100262
11 /H1100239 /H1100225 /H1100250 /H1100256
10 /H1100237 Flatline /H1100245 /H1100248
9 /H1100223 /H1100230 /H1100243
8 /H1100219 /H1100221 /H1100242
7 Flatline Flatline /H1100235
6 /H1100234
5 /H1100228
4 /H1100224
3 Flatline
2
1

<!-- p.5 -->

PAPERS EFFECT DESIGN
or frequency. He explains that the deterministic noise
spectrum is discrete, because the signal is sinusoidal, 117
and that the noise spectral components exist at odd har-
monics of the sinusoid frequency, including the funda-
mental. These findings refine the traditional [14] high-rate
analysis. Gray’s references indicate that these results have
been known for decades. The conclusions drawn can be
generalized to the present truncation noise situation
depicted in Fig. 57:
n e be /H11005
m
m
m
oddodd
j
/H11005/H110023
3
mωn!7 A (55)
where ω is the normalized (fundamental) radian frequency
of oscillation. Eq. (55) has the form of a continuous-time
complex Fourier series [56], then sampled in time,nT. The
Fourier series coefficients b
m form a conjugate-symmetric
set, thus e[ n] is real valued. The expression for e q[n] is
similar. Each nonuniform bm will be some function of
weighted ordinary Bessel functions of integer order m and
real argument.
Thus far we have presented all the equations for oscil-
lation in terms of the ZIR. But the noise model in Fig. 57
suggests that the noise sources e[ n] and e
q[n] are subject
to the zero-state response (ZSR) of the circuit. The ZSR of
the oscillator is precisely that of an integrator centered (in
the frequency domain) at the frequency of oscillation.
118
The fundamental frequency of the noise spectrum is the
same as the center frequency of the integrator, which is the
same as the frequency of oscillation. Any noise energy in
the vicinity of the oscillation frequency should cause the
oscillator to blow up. This does not happen in practice
because of the saturation nonlinearity built into most con-
temporary DSP chips. The injected noise just causes phase
jitter and amplitude perturbations, which decrease signal
purity.
119 Signal quantization in a recursive circuit, then, is
a secondary form of instability. The primary determinant
of stability is pole location, which is why we were con-
cerned with the quantization of filter coefficients.
It appears from Table 8 that the quantity of noise goes
up as the center frequency moves down. It is plain that the
frequency-shifted integrator becomes more disturbed at
low frequencies of oscillation, thus the worsening THD 
+ N
for a given number of bits. We speculate that an explana-
tion of this phenomenon might simply be excessive fre-
quency-domain foldover of the shifted integrator fre-
quency response. Perhaps when the oscillation frequency
is low, more harmonics from the left-side noise spectrum
(negative frequencies) fall under the shifted integrator that
is on the right-side, and vice versa.
7.3.3 Chaotic Behavior
Nonetheless, the direct-form oscillator waveform at 20
Hz is fascinating to view when the signal path bit width is
20 bit ( just before Flatline). The oscillation metamor-
phoses from the sinusoidal to a nearly triangular wave-
form and back. This chaotic but stable process occurs over
periods of real time on the order of minutes. During each
epoch, the oscillation frequency can be observed to
change by as much as one-half the desired frequency.
It should be pointed out that although we show no data
for very low frequencies in Table 8, the first and second
modified coupled-form sinusoidal oscillators are routinely
called upon to produce frequencies less than 1 Hz (0.1 Hz
typical).
7.4 More Recent Developments
Smith and Cook [57] subsequently disclosed a lattice
topology for sustained oscillation which is claimed more
suitable for VLSI implementation. The oscillator shown in
Fig. 58 is called the normalized waveguide oscillator
because it was derived as a spinoff from Smith’s results in
the theory and implementation of digital waveguides.
Although this design recaptures the quadrature relation-
ship of the sinusoids appearing at the circuit outputs, the
primary contribution of this topology to the field of oscil-
lator design is that it solves the amplitude deviation prob-
lem.
120 It is a remarkable distinction that this sinusoidal
oscillator possesses. This normalized waveguide oscillator
is designed for instantaneous change in oscillation fre-
quency without concomitant change in output ampli-
tude,
121 hence the new notation ωn showing frequency as
a function of the time index. Change in the frequency of
oscillation must be performed properly, however. Toward
this end, the amplitude coefficient G
n is introduced and
J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March 119
Fig. 57. Second modified coupled-form sinusoidal oscillator
showing noise sources.
117 To be more precise, because the analog signal, from which
the sampled signal is derived, has a discrete spectrum.
118 In the interest of avoiding confusion, we stress that we are
not talking here about the ideal digital integrators embedded in
the circuits of Fig. 55, Fig. 56, nor Fig. 57.
119 For this reason it is recommended to run all the oscillators
at full-scale amplitude and to place a volume knob at the output.
120 It is evident from the equations in Fig. 58 that sinusoid
amplitude is linked to the frequency of oscillation. This is simi-
lar to the situation for all the oscillators presented, except for the
Rader
– Gold coupled form.
121 Because we are dealing with the ZIR, change in frequency
of oscillation can be instantaneous in all the oscillators pre-
sented. But the Smith
– Cook oscillator is the first one to deal
effectively with amplitude correction at the instant of the change.

<!-- p.6 -->

DATTORRO PAPERS
specified to deviate from 1 only at the time of the occur-
rence of the frequency change, 122 that is, an amplitude
compensation factor which is engaged for one sample
period. The elegance of the Smith – Cook solution rests in
the fact that knowledge of the state time (the precise value
of n) at the occurrence is not required, neither is knowl-
edge of the state values. All that is required is knowledge
of the previous frequency.
Whenever the frequency of oscillation is changed to a
new value, the control G
n is all that is required to maintain
constant amplitude at the oscillator circuit output y1,t h a t
is, the memory elements need never be adjusted in the
implementation. From Fig. 58,
y
1[n] /H11005y1[0] cos nωn /H11002 y2G[0] cot ω
2
ne o sin nωn
(56)
y2[n] /H11005y1[0] tan ω
2
ne o sin nωn /H11001y2G[0] cos nωn .
For the analytical Eq. (56) to remain valid, however,
y2G[0] and y1[0] must be re-evaluated whenever Gn devi-
ates,
y1[0] ← y1[n0]
y2G[0] ← y2[n0]Gn0
/H11005y2G[n0]( 57)
where n0 is the time index at the change; n0 /HS110050. It is
important that we interpret Eq. (56) properly so that we
may show the technique on paper. We will now demon-
strate the validity of these assertions by example.
7.4.1 Example
Suppose that at absolute time n /H110050, we are given ω
0 /H11005
ω/H110021, y1[0] /H110051, and y2G[0] /H110050. Then while Gn remains
static, we expect for n /H110050 → n0
y1[n] /H11005cos nω0
(58)
y2[n] /H11005tan ω
2
0e o sin nω0 .
Suppose we suddenly freeze time at n /H11005n0/H11001. At this time
we desire a change in the frequency of oscillation, which
is effectively to take place at n /H11005n
0. We do this by chang-
ing the one tuning coefficient from cos ω0 to cos ωn0
at
time n0, and by letting Gn deviate from 1, but only for one
sample period at n0,
Gn0
/H11005( /
( /
tantan
tantan
ω
ω
n
n
10
0
- )
)
2
2 .                                           (59) 
We then have the new initial states from Eqs. (58)
and (57),
ωn0/H110021 /H11005ω0
y1[n0] /H11005 cos(n0ωn0/H110021)
y2G[n0] /H11005tan ω
2
n0
f p sin(n0ωn0/H110021) .                           (60)
120 J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March
122 Gn is not at all involved with frequency tuning. The special
case G0 /H110051. But Gn can be greater than 1, albeit momentarily,
which will necessitate at most q22 arithmetic.
Fig. 58. Smith – Cook normalized-waveguide sinusoidal oscillator.


<!-- p.7 -->

PAPERS EFFECT DESIGN
for n /H11005n0 → /H11009.
Eq. (61) simplifies by trigonometric identity to
y1[n] /H11005cos[n0ωn0/H110021 /H11001(n /H11002 n0)ωn0
]
(62)
y2[n] /H11005tan ω
2
n0
f p sin[n0ωn0/H110021 /H11001(n /H11002 n0)ωn0
]
for n /H11005n0 → /H11009.
In both outputs the phase is correct in light of the new
starting time. Comparing Eqs. (62) and (58), we see that
the amplitude of y
1[n] remains as it was, which is the
desired result. To change the frequency successfully again
and again, the same procedure can be repeated to get sim-
ilar results. But the amplitude of y
2[n] changes from its
original value of tan(ω0/2). So we have not maintained the
amplitude of y2[n], although we have managed to keep the
amplitude of y1[n] constant throughout the process of
changing the frequency of oscillation.
It is interesting to note that Smith and Cook originally
derived the same result using principles of energy conser-
vation across transformer-coupled waveguides.
7.4.2 Stability
The Smith – Cook oscillator is hyperstable because
there is only one tuning coefficient, cos ω
n. The equation
for the poles in Fig. 58 shows that even under coefficient
quantization, the pole magnitude is always unity. Like the
direct form, however, the single tuning coefficient requires
high resolution at very low frequencies of oscillation.
Inaccuracy in the representation of G
n when it deviates
cannot affect the frequency of oscillation.
7.4.3 Truncation Noise
We will only permit speculation regarding the noise
performance of the Smith – Cook oscillator topology as
compared to the (Gordon – Smith) second modified cou-
pled form, as we have made no actual measurements of
THD + N to bolster any analytical findings.
Recalling our discussion of purity of direct versus cou-
pled form (Section 7.3.1) there the importance of zeros in
the deterministic noise transfer function was revealed. We
have not been able to devise an implementation that would
place a zero into the time-invariant truncation noise trans-
fer (amplitude coefficient G
n set to 1) while maintaining
freedom from amplitude deviation across a change in
oscillation frequency.
123 Hence we speculate that the noise
performance of the Smith – Cook sinusoidal oscillator is
not as good as that of the Gordon – Smith.
7.5 Miscellany
Some other papers relevant to the field of oscillator
design are [58], [59].
7.6 Appendix 5: Derivation of Oscillator
Equation
We demonstrate the derivation of the oscillator equa-
tions for one case only –– the first modified coupled-form
oscillator. This analysis is adapted from [53], where the
derivation of the coupled form and the second modified
coupled form is shown.
[ ] [ ] [ ]
[ ] [ ] [ ] .
ε
ε
y n y n y n
y n y n y n
1
1
/H11001/H11005/H11002
/H11001/H11005 /H11001
q q
q
*
These state equations describe the ZIR of the circuit in
Fig. 55(b), which is duplicated here in Fig. 59. From the
state equations we read the matrix
A /H11005
ε
ε1
1
-R
T
S
SS
V
X
W
WW.
If we define the vector
yn /H11005
[ ]
[ ]
y n
y n
q
R
T
S
SS
V
X
W
WW,
then we may write yn/H110011 /H11005Ayn. This state-variable descrip-
tion [11] has the solution
yn /H11005An y0 ,f or all time n ≥ 0
where An is the state transition matrix and y0 is the vector
of initial states, that is, yn at n /H110050.
If we can find the eigenvectors and eigenvalues of A,
J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March 121
Fig. 59. First modified coupled-form sinusoidal oscillator.
123 This topic is worthy of further research, however. One
complicating circumstance is the potentially large disparity in
amplitude between the two outputs, as shown by Eq. (56).
Using the new initial states [Eq. (60)], we find from Eq. (56) that
y1[n] /H11005cos(n0ωn0/H110021) cos[(n /H11002 n0)ωn0
] /H11002sin(n0ωn0/H110021) sin[(n /H11002n0)ωn0
]
(61)
y2[n] /H11005cos(n0ωn0/H110021) tan ω
2
n0
f p sin[(n /H11002n0)ωn0
] + tan ω
2
n0
f p sin(n0ωn0/H110021) cos[(n /H11002n0)ωn0
]

<!-- p.8 -->

DATTORRO PAPERS
then we may write equivalently
yn /H11005T Λn T/H110021y0
where T holds the conjugate eigenvectors (given by
Mathematica) in its columns, and Λ holds the correspon-
ding eigenvalues along its diagonal. Specifically,
Λ /H11005 *
j
j
λ
λ
1
0
0
1 0
0/H11001
/H11002/H11005Oε
ε
R
T
S
SS
R
T
S
SS
V
X
W
WW
V
X
W
WW
T /H11005j j
1 1
/H11002R
T
S
SS
V
X
W
WW
T/H110021 /H11005
j
j2
1 1
1
/H11002R
T
S
SS
V
X
W
WW.
By constructing the diagonal matrix Λ, the exponentiation
no longer requires matrix multiplication. Hence it is easier
to acquire a solution analytically for large n. The eigen-
values are the poles of the system under study. λ* denotes
the conjugate eigenvalue. If we define each eigenvalue in
polar form,
λ λ e/H11005jO ω
then we can make the identifications from Λ
⇒ .
coscos
sinsin
λ ω
ε λ ω
1 /H11005
/H11005*
From these we conclude
coscos
sinsinε ω
ω/H11005
,coscosλ ω
1= ω < π
2
where the actual oscillator coefficient ε is expressed in
terms of the desired normalized radian frequency of oscil-
lation ω. It follows that
TΛ
nT/H110021
coscos
coscos
sinsin
sinsin
coscosω
ω
ω
ω
ω
n
n
n
n
1/H11005n
-R
T
S
SS
V
X
W
WW.
8 SONICALLY PLEASANT NOISE GENERATION
8.1 Sonic Musing 124
The author presently owns about five gadgets for sonic
noise generation. These devices are analog and emit elec-
tronically amplified sound through a loudspeaker, except
for one, which consists of an encased fan driven by an
induction motor. The fan-type unit was first purchased
from Marpac Corporation in 1977. Their analog noise
generators, which amplify and filter transistor noise, were
found to be quite suitable substitutes for the earlier
electromechanical version. The noise generators are used
when sleeping, concentrating, or to mask unwanted ambi-
ent disturbances.
Several years ago the same company announced a new
“improved” digital sonic noise generator. Not only is the
noise generation digital and algorithmic, but the front
panel has been computerized. After living with the unit for
a while, the author concluded that the noise was not pleas-
ant, so back it went to the factory for repair. Discussion
with a Marpac engineer revealed that the device was oper-
ating within normal parameters and was not in need of re-
pair. He confided that he too liked the analog units better.
The author no longer uses that particular digital device
because, in the author’s opinion, it sounds bad. Notwith-
standing, the Marpac company claims growing sales of the
digital unit and has since released yet newer models.
When evaluating various algorithms for noise genera-
tion, we use our ears. Our purpose for transcribing these
events is to convey the knowledge that digital methods for
noise generation are not inherently bad, but some algo-
rithms sound better than others. We believe that the fun-
damental algorithm to be presented herein sounds as good
as any analog method of noise generation; that is our ulti-
mate criterion for choosing it.
The technique that we prefer to create pleasant audio
noise is called the maximal-length pseudorandom noise
(PN) sequence [60], [61].
125 Since the PN sequence is
generated by a digital circuit called the PN generator, it is
a completely deterministic binary sequence {0, 1}. The
PN generator circuit comprises a solitary binary register
(see Fig. 60) as would be found in almost every micropro-
cessor. Because the recursive circuit has no perturbing in-
put (only initial states) and is marginally stable, the binary
PN sequence is periodic. The PN sequence is not truly
noise because it is not the realization of any random pro-
cess; hence the prefix “pseudo.” Still, we prefer to charac-
terize the binary output by adapting concepts from the
field of statistical signal processing [62]. Thus our charac-
terization of the PN sequence will mainly consist of cal-
culations of sample average (or sample mean), sample var-
iance, circular (or cyclic) sample autocovariance,
126 and
power spectrum, all over one period. As much as possible,
we apply the language of DSP to this characterization.
Hence we adopt a simple definition of power spectrum,
which is the magnitude squared of the discrete Fourier
transform (DFT) of the PN sequence over one period, nor-
malized by the number of samples per period M. This def-
inition of power spectrum is consistent with the engineer’s
notion of the average power of a signal [31], [14, app. A].
Even though the PN sequence generated by the digital
circuit is completely deterministic, we still refer to the
emanating pseudorandom binary sequence as “noise”
because it is incoherent (but perhaps soothing) to our ears.
We analyze two distinct ways of observing (rather, listen-
122 J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March
124 Thanks go to Robert M. Gray for a careful review.
125 Often referred to as a maximal-length PN sequence in the
literature.
126 Autocovariance is like autocorrelation, but having the
mean removed prior to its calculation. The prefix “sample” indi-
cates that the calculation is performed upon one realization of a
noise process, rather than an expectation over a noise probability
distribution. The realization comprises the PN sequence in our
case. Circular autocovariance is the autocovariance of a periodic
waveform.

<!-- p.9 -->

PAPERS EFFECT DESIGN
ing to) that binary sequence. The first method, called the
single-bit method, is what we also call the traditional
method, that is, the observation of a single bit from the PN
generator register. Analysis and implementation of the tra-
ditional single-bit output of the PN generator are well
described in the literature but not always in the language
of DSP [60], [63], [64]. The second method of observing
the binary sequence, called the multibit method, is the
simultaneous observation of multiple bits from the gener-
ator register. Analysis of the multibit (word) output from
the PN generator is touched upon in [65], where it is noted
that both the single- and multibit sequences have the same
period M. This multibit method is critically dependent on
the assignment of weights to (the format of) the individual
bits constituting the word output. We discuss a few distinct
formats that are readily available within most micro-
processors, including two’s complement and unsigned for-
mat, and we analyze the impact of each. Regardless of the
particular format chosen, the multibit output is perfectly
uniform in its distribution of amplitude over one period
when the number of bits in the word output is the same as
the generator word length.
Because the source of our noise is known and hence
deterministic, the pseudonoise power spectrum is defined
as the discrete Fourier transform of the sample autocorre-
lation of the periodic PN sequence [62], [66, ch. 7.6], [67].
The pseudonoise created using the traditional single-bit
method is spectrally white because the (circular) sample
autocovariance of a maximal-length single-bit PN
sequence is a Kronecker delta, periodic in M [60]; that is,
the single-bit PN process is uncorrelated. We find that this
property of the (sample) autocovariance remains approxi-
mately intact for an unsigned multibit output, and that the
multibit sequence remains maximal in length. So the
pseudonoise power spectrum created using a multibit out-
put is nearly white (see Fig. 66) because the autocovari-
ance of the resulting maximal-length PN sequence is
spiky, as we shall see (see Fig. 67).
White noise is easily filtered to create noise for audio
having spectral color. Filtering white noise by means of a
low-pass filter having a cutoff frequency of approximately
400 Hz, for example, yields a very soothing rumble. Such
narrow-band noise might then be transposed (shifted) in
the frequency domain; achieved through multiplication
(ring modulation) in the time domain by a sinusoid of the
desired transposition frequency. This simple and pleasant
effect is reminiscent of gurgling brooks.
127
It is certainly reasonable to digitally filter the spectrally
white single-bit PN sequence to make multibit audio noise
having a desired color. Filtering the single-bit sequence
with no forethought yields arbitrary distribution of ampli-
tude.
128 What we seek here are specific filters which yield
a perfectly uniform amplitude distribution over one period
M of the filtered sequence while simultaneously shaping
the white spectrum of the single-bit PN sequence. We
make no attempt to enumerate all the appropriate filter
types, but we do investigate a few designs in detail which
incorporate the finite impulse response (FIR) filter. FIR
filtering turns out to be the proper interpretation of the
multibit output from the PN generator. Beyond these few
goals, we make no further attempt to investigate colored
noise generation.
129
8.2 Recursive PN Circuit
We present two example PN generator circuits for audio
in Fig. 60, each showing all the individual bits bi of one
24-bit register such as would be found inside a typical
DSP chip [1], [49]. The symbol 5 is the notation for eX-
clusive – OR logic or, equivalent, modulo 2 binary addi-
tion. At each sample period T the logic is performed on the
J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March 123
127 Say that f0 is our desired transposition frequency. Then a
simple way to enhance our gurgling brook would be to transpose
two independent noise generators; one of them to f
0 /H11001fε the
other to f0 /H11002fε where fε is only a few hertz. By so doing we dis-
mantle the spectral symmetry of the noise that would otherwise
exist about f
0.
128 The central limit theorem [56], [61], [62], [66] –[68] pre-
dicts that under certain conditions, recursive filtering of a signal
(having pretty much any statistical distribution of amplitude)
will tend to make the amplitude distribution of the filtered output
Gaussian.
129 The term “pink noise” refers to a random process having a
power spectrum that falls as 3 dB per octave, thus its power Eq.
(37) over any octave interval is the same. Often employed in the
audio field because it is subjectively spectrally white, its power
spectrum is proportional to 1/ f in the linear frequency variable f.
More algorithms and computer programs for colored noise gen-
eration and stochastic processes can be found in [69].
Fig. 60. Two maximal-length PN generators. word length /H1100523 bit. (a) Generator equation: Xn/H110011 /H11005b23[n + 1] /H11005b6[n] 5 b1[n]. (b) Its
reciprocal: Yn/H110011 /H11005b23[n /H110011] /H11005b19[n] 5 b1[n]. For K-bit-wide output, take K unsigned MSBs; K ∈1, 2, . . . , 24.
(b)
(a)

<!-- p.10 -->

DATTORRO PAPERS
selected bits and then the whole register is shifted right by
1 bit, accepting the logical result into the most significant
bit (MSB). When the PN generator’s feedback entry port
is at the MSB, we say that the generator is left-justified
within the register. For any left-justified PN generator,
b
i/H110021[n /H110011] /H11005bi[n] , 0 < i ≤ 23 .
Each PN generator in Fig. 60 then is fundamentally a
single-bit shift register having feedback.
The PN generator output for each example in Fig. 60 is
taken to be the succession of 24-bit-wide unsigned regis-
ter values at the rate 1/ T. The MSBs would be selected
from each respective example for fewer than 24 bit of
desired output from a 24-bit register. Strictly speaking, the
proper bit-width output for these examples is 23 MSBs
because the generator word length is 23 bit. The word
length of the left-justified generator is determined by the
location of the rightmost logic input.
Using the logic shown in Fig. 60(a), a uniformly dis-
tributed asymptotically uncorrelated
130 PN sequence of
length M /H11005223 /H110021 is generated (ignoring bit b0) com-
prising unique 23-bit words. In Fig. 60(b) another uncor-
related maximal-length PN sequence is generated, asymp-
totically uncorrelated to itself. We shall examine only
autocorrelation in detail.
As suggested by the circuits in Fig. 60, the unsigned
register value 0 cannot be produced in general. To start a
given generator, the significant bits of its register are ini-
tialized with any positive value. Using a different initial
register value only shifts the periodic sequence in time,
that is, the same sequence is started at a different phase of
its M /H110052
word length /H110021 long cycle.
Both example circuits in Fig. 60 are derived from word
length entry 23 in Table 9. The generator equation for Fig.
124 J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March
130 We adapt the term “asymptotic” [62] here to mean that the
circular sample autocovariance of a PN sequence is not a peri-
odic Kronecker delta. Rather it is periodically spiky, decaying to
near zero at midcycle. One cycle of such a spiky autocovariance
might have a shape like that in Fig. 67.
131 The time index [n] appears once for each logic equation in
Table 9 because all time indices on the right-hand side are the
same. The logic equations themselves are not solitary; that is,
there exist more generators for a given word length that are max-
imal length and unique in PN sequence. More generator equa-
tions can be found in [61, ch. 7.4], [65], [60] and in Appendix 6,
Section 8.6.
Table 9. Generator equations for maximal-length PN sequences. 131

<!-- p.11 -->

representative polynomials. The following Mathematica
script produces 0 as output when the candidate polynomial
would generate a maximal-length PN sequence:
We do not pursue polynomial theory any further here.
The ardent reader is pointed to [65]. We provide an
exhaustive listing of two- and four-term generators for a
limited number of useful word lengths in Section 8.6,
Appendix 6. Table 10 provides an exhaustive list for an 8-
bit word length. Each generator equation in Table 10 pro-
duces a unique PN sequence.
As long as the maximal-length PN sequence is of suffi-
cient duration that its period (in seconds) MT is imper-
ceptible, every generator equation is suitable for audio,
and the corresponding PN sequence so synthesized sounds
like any other over long duration.
8.3 Single-Bit PN Generator
Before proceeding to the multibit case, we first examine
the power spectrum and circular (sample) autocovariance
of the single-bit maximal-length PN sequence,
X
n /H11013b23[n]
where bit b23 is shown in Fig. 60. Using the language of
DSP, we wish to verify that the circular autocovariance of
60(a) simply adds 1 to the bit indices of entry 23 to
account for the left justification by 1 bit within the 24-bit
register.
132 The reciprocal PN generator, Fig. 60(b), is
derived by reversing the bit indices of entry 23, that is,
bi[n] → bword length/H11002i[n]
then add 1 to the indices for justification. The reciprocal
generator produces an asymptotically uncorrelated
sequence of the same maximal length [65, Eq. (15)].
133
Table 9 notation is for a word length bit register, but Fig.
60 demonstrates how the implementation is translated to a
more suitable left-justified format within a 24-bit register.
Hence we can fit any one of the first 24 generator logic
equations from Table 9, each of differing word length, into
a 24-bit register, and so on. The required justification left
is (24 /H11002word length) bits. Fig. 60 then shows two of all
the possible word length bit generators (see Section 8.6,
Appendix 6) that might occupy a 24-bit register. Keep in
mind that word length (/H1100523 in Fig. 60) is a variable
selected by the designer.
The number of terms in the generator equation is simi-
larly a design variable. Here is an example having more
terms and a 16-bit word length:
On the other hand, Fig. 60 also represents two of many
possible logic configurations for a fixed 23-bit word
length. For example, given an 8-bit desired word length,
we find 12 (but only 12) maximal-length PN sequences
using four-term generators.
134 Those unique asymptoti-
cally uncorrelated sequences are listed in Table 10 in
terms of their generator equations, and were found by
brute force examination of the periodicity of all possible
sequences. But there are more elegant methods of finding
generator equations by formulating the search in terms of
PAPERS EFFECT DESIGN
J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March 125
132 We did not choose word length entry 24 because we antic-
ipate the need for an extra bit of precision if we wish to properly
convert the unsigned register to two’s complement bipolar for-
mat. We discuss an example of this conversion later.
133 When multiple uncorrelated noise sources are required, we
may try the next largest word length from Table 9 that fits the
available register width.
134 The number of terms (operands) in the generator equations
is always even. There are no two-term generators in the 8-bit
case, as suggested by Table 9. (See Appendix 6, Section 8.6.1.)
Nonjustified 16-bit generator b15[n /H110011] /H11005b5[n] 5 b3[n] 5 b2[n] 5 b0[n]
Reciprocal generator b15[n /H110011] /H11005b16-2[n] 5 b16-3[n] 5 b16-5[n] 5 b0[n]
/H11005b14[n] 5 b13[n] 5 b11[n] 5 b0[n]
Left-justified 16-bit generator     b23[n /H110011] /H11005b13[n] 5 b11[n] 5 b10[n] 5 b8[n]
Reciprocal generator                  b23[n /H110011] /H11005b22[n] 5 b21[n] 5 b19[n] 5 b8[n]
wordlength /H110058; (* execution time proportional to wordlength *)
p[x_] /H11005x^wordlength /H11001x^6 /H11001x^5 /H11001x^1 /H110011; (* candidate generator *)
px /H11005Simplify[x^wordlength p[1/x]];
PolynomialMod[PolynomialRemainder[x^(2^wordlength /H11002 1) /H110011, px, x], 2]
8-bit polynomial x8 /H11001x6 /H11001x5 /H11001x /H110011 ↔ b7[n /H110011] /H11005b6[n] 5 b5[n] 5 b1[n] 5 b0[n]
Reciprocal polynomial x8 /H11001x7 /H11001x3 /H11001x2 /H110011 ↔ b7[n /H110011] /H11005b7[n] 5 b3[n] 5 b2[n] 5 b0[n] .
The generator polynomial is related to the Table 9 (or Table 10) word length entry as in the
following 8-bit word length example:

<!-- p.12 -->

DATTORRO PAPERS
the periodic single-bit PN sequence is indeed a periodic
Kronecker delta, and we wish to characterize and quantify
the parameters of the corresponding white power spec-
trum X
n[k]2/M,n amely, to show that the true power spec-
trum of the single-bit PN sequence is indeed white. Xn[k]
is the length- N DFT of the ( N /H11002M)-zero padded PN
sequence Xn
Xn[k] /H11005X e ( πjn
n
N
2
0
1
/H11002
/H11005
/H11002
k/ nN)! .
The sequence period M is always odd for maximal-length
PN sequences,
M /H110052word length /H110021 .
As we will explain, the true power spectrum can be found
when N /H11005M.
The single-bit PN generator topology is the same as that
for the circuits of Fig. 60, except that only the MSB is
observed at the output. Because the single-bit sequence
has only two possible amplitudes {0, 1}, we calculate and
then remove the dc component (the mean) of the PN
sequence when we view its circular (sample) autocorrela-
tion. We allow the dc component to remain in the calcula-
tion of the power spectrum, however. The precise calcula-
tion of sample variance and mean proceeds as follows:
Eq. (63) follows directly from the standard definitions
[62], [66], [67]. The relationship to the frequency domain
X
n[k] comes from Parseval’s relation for the DFT [14].
The DFT length N is typically (but not necessarily) even
because we often calculate the DFT using an FFT algo-
rithm which demands that constraint. That is why Eq. (63)
and later Eq. (65) account for a potential disparity
between the original sequence length M (which is here
odd) and the DFT length N.
Because any single-bit maximal-length unipolar PN
sequence has 2
word length/H110021 countable ones {1} per period
M, the numerical value of the sample variance and mean
over one period M can be predetermined exactly via
Eq. (63),
( )
.
σ
m
4
1
1 2
1 2
2
1
1 2
1
/H11005
/H11005
( )
X wordword lengthlength
wordword lengthlength
X wordword lengthlength
2
2
1
n
n
$
$
-
-
-
-
- -
-
(64)
In other words, for any given period M there appears one
more 1 than there appear {0} [65]. The distribution of
amplitude is then discrete {0, 1} and nearly uniform.
Hence the sample variance and mean asymptotically
approach 
1⁄4 and 1⁄2 respectively, with increasing word
length.
The proper term for the mean-removed autocorrelation
is autocovariance [67].135 Both the circular autocovariance
and the circular autocorrelation can be expressed in terms
of the power spectrum of the single-bit PN sequence Xn
σ
l l
l
k
IDFTIDFT
C R m
C M
X
m
C 0
/H11005
/H11005
/H11005X
X X X
X N
n
X
X
2
2
2
2
n
n n n
n n
n
-
-
7 7
7
7
7
A A
A
A
A
Z
[
\
]]
]]
_
`
a
bb
bb
(65)
where CXn[l] is the circular autocovariance (for two-sided
lag index l) of the PN sequence Xn calculated by inverse
discrete Fourier transform (IDFT) of the same length N as
the DFT Xn[k], RXn[l] is the circular autocorrelation, and
M is the original record length (rather, the period in the
case of PN sequences).
126 J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March
135 We will view the circular [14, ch. 11.7.1] as opposed to the
linear autocovariance, which is appropriate and justified by the
fact that the PN sequence is periodic in M.
,
, , , , .
σ
k
N
k
N M
X
m M X M X
M
X
m N
N M M N
m M
X
M X M X X X X
1 1 1
1
0 1 1 0
/H11005 /H11002/H11005 /H11002
/H11005 /H11002 /H11002
/H11005 /H11005 /H11005 /H11005
X
n
k
N
X n
n
M
n
n
M
n
k
N
X
X
n
n
n
M
n
n
N
M M N
2
2
0
1
2 2
0
1
0
1 2
2
1
1
2
0
1
0
1
1 1
/H11005 /H11005 /H11005
/H11005
/H11005 /H11005
/H11002 /H11002 /H11002
/H11002
/H11002 /H11002
/H11002
n n
n
n f
#
+
! ! !
!
! !
J
L
KK
N
P
OO
7
7
7
A
A
A
(63)
Table 10. Four-term 8-bit maximal-length PN sequence
generator equations.

<!-- p.13 -->

PAPERS EFFECT DESIGN
8.3.1 Single-Bit PN Sequence Power Spectrum
and Autocovariance
Fig. 61 shows the expected power spectrum as it would
be calculated by a nonwindowed zero-padded length- N
DFT of the single-bit PN sequence. The power spectrum
of the original length- M PN sequence is truly discrete in
the Fourier sense because the sequence is periodic in M.
Since M is not necessarily equal to N, the expected power-
spectrum levels would be as given in Fig. 61.
The levels shown in Fig. 61 are termed “expected”
because the power spectrum of the single-bit PN sequence
calculated using a length- N DFT for N /HS11005M is generally
not so flat. Hence in Fig. 61 each non-dc expected level
should be considered to be the average of the calculated
levels over the frequency index k. Indeed, from Eq. (63)
σ
k
N
N m N
N M
N M
X
1 1 1
1/H11001 /H11005X X
n
k
N
2
2
1
1
2
/H11005
/H11002
n n- -
-
- !
7 A
.
For the analysis of periodic sequences, the most accurate
estimation of the power spectrum would have N set to be
the same as M, the period length, as is well known. The
true power-spectral levels for the original periodic
sequence would be seen by letting
N → M and indices{ N/2, N/2 /H110021} → (M /H110021)/2
in Fig. 61, that is, were the power spectrum calculated
instead using a DFT having length M. When N /H11005M,t h e
power-spectral levels shown in Fig. 61 are the true (not
average) spectral levels. In other words, the single-bit
sequence has the exact spectral shape shown in Fig. 61
when measured properly, that is, when N /H11005M. For then
the power spectrum levels in Fig. 61 converge in the
Fourier sense to their true values,
$, ,..., ;
,
σ
M
X k M
M k M N M
MmMm k
1 1 1
0
/H11005 /H11002 /H11005 /H11002
/H11005
n X
X
2 2
2
n
n
7 A
Z
[
\
]]
]]
(66)
which is constant, hence flat over k /HS110050 mod M. We forgo
plotting an actual power spectrum for a single-bit PN gen-
erator because it is identical to the theoretical drawing in
Fig. 61 when N → M. The dc component level [Eq. (63)]
at k /H110050 is insensitive to the choice of N.
It seems that we have gone to much trouble to distin-
guish between the DFT length N and the original sequence
length M when the development would have been much
simpler had we made these two lengths equivalent.
Although simplicity is always desirable, the present state
of the equations should make our findings easier to cor-
roborate as power-of-2 FFT algorithms are common-
place. Because DFT algorithms are more appropriate, we
will discontinue this distinction between N and M from
here on, that is, we will now let N /H11005M.
Because the true power spectrum is white (flat, except
for dc), the single-bit circular autocovariance is a periodic
Kronecker delta, as postulated. More precisely, from Eq.
(65) we may write the (length-M) IDFT,
for the Kronecker delta δ,w hich becomes periodic in M.
Note that Eq. (67) has a small negative offset [60, ch. 5],
[65].
8.4 Multibit PN Generator
We now examine the case of the multibit output
maximal-length PN sequence generator. Strictly speaking,
all amplitude in DSP is discrete, hence all associated dis-
tribution of probability must also be. For example, the
single-bit PN generator already considered has only two
possible amplitudes {0, 1} asymptotically (with increas-
ing word length) equal in distribution over one period M
of the corresponding uncorrelated PN sequence. In either
the single- or the multibit case of a maximal-length PN
generator, the distribution of probability is discrete. In this
section we therefore think in terms of the more appropri-
ate (discrete) probability mass function (pmf) [62], [67]
rather than its continuous amplitude counterpart, called
the probability density function. The generator equations
given in the various tables each realize a unique asymp-
totically uncorrelated maximal-length PN sequence hav-
ing perfectly uniform pmf when applied as in the circuit of
Fig. 60 and when a multibit output is observed over one
period M. The pmf is uniform because each word length
bit value produced by the generator is equiprobable over
J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March 127
Fig. 61. Expected levels of single-bit PN power spectrum. M —
record length; N — length of DFT. Power spectrum is periodic in
N as implied by ellipses.
, < <σ
σ
δ
l
l qMqM
C M MmMm M
M e m l
M M
1
1
1 1
/H11005 /H11001 /H11002 /H11002 /H11002
/H11005/H11002 /H11002/H11002
πjX X X
k
M
X
X
q
2 2 2
1
1
2
2
/H11005
/H11002
/H11005/H11002
n n n n
n
3 3
3
3
kl/M!
!
J
L
K
KK
N
P
O
OO
7
7
A
A
* 4
(67)

<!-- p.14 -->

DATTORRO PAPERS
one period M [65]. The sequence is maximal length
because every word length bit unsigned value (except 0) is
generated only once before the sequence repeats. The
sequence is noiselike because the successive values are
produced in a seemingly incoherent order and the period
of repetition MT is long in duration. Using the maximal-
length generators given in Table 9, Table 10, or Appendix
6, the sequence length is the same as for the single-bit
case: M /H110052
word length /H110021 samples. This length is the
longest possible for a given word length since the
unsigned register value 0 is precluded.
8.4.1 Digital Filter Interpretation of the Multibit
PN Process
In practice it is customary to take the full 24-bit
unsigned register as the output. But it is understood that a
PN generator nestled within a 24-bit register may be
designed to use an abbreviation of that register. The bits to
the right of the word length MSBs may be masked in that
case, but it is easier to accept them as they likely have lit-
tle audible consequence. Alternately, some implementa-
tions may send fewer than word length MSBs to ensuing
circuitry. When we speak of “uniform probability mass,”
however, we are implicitly referring here to the distribu-
tion of amplitude, over period M, ascribed to the word
length MSBs that constitute the generator. Regardless of
the constraints imposed by a particular implementation,
one should always choose the MSBs from the left-justified
format that we propose in Fig. 60.
We have yet to discuss exactly how to numerically con-
vert the unsigned register X depicted in Fig. 60 to a more
suitable word format. When a multibit unipolar (0, 1)
(non-negative) PN sequence X is desired, the register MSB
must be cleared like in Fig. 62(a)
136 because most con-
temporary DSP chips default to two’s complement format,
which is bipolar [70], [1], [71], [49]. But to convert the
unsigned register to multi-bit bipolar ( /H110021, 1) format, one
must first convert to two’s complement unipolar format.
After the ensuing operations indicated in Fig. 62(b), the
resulting sequence 
Xu may then safely be interpreted as
two’s complement bipolar.
This next point is critical. If one simply casts the
unsigned generator register to integer (two’s complement)
format
Xs without clearing the MSB, as illustrated in Fig.
62(c), the consequent audio noise power spectrum suffers
a deep cut in the low-frequency region.
To prove the foregoing statements, we must understand
what happens to the single-bit PN sequence X
n in its con-
version to word format. Fig. 63 shows the example of Fig.
60(a), but this time having weights hi attached to each of
the bits, which are then summed in a linear fashion. But
the sum Σ in Fig. 63 is simply a depiction of the numeri-
cal definition of two’s complement format (see Section
9.1.1, Appendix 7, Fig. 70).
128 J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March
136 If the unsigned register is logically shifted right 1 bit, then
the result is a two’s complement unipolar sequence; that is the
method we consider. Another way to clear the MSB is simply to
mask it. (Some of the succeeding equations will require alter-
ation if the latter method is used.)
; ,
; ,
, , . . . ,
’
’
h
h
X
h
h
X
i
twotwos complementcomplement castcast q
twotwos complementcomplement castcast q
1
2
2
2
1 2323
2323
2222
/H11005/H11002
/H11005
/H11005/H11002
/H11005
/H11005
i i
i i
0
0
1/H11001
-
-
h
s
s
*
*
_
`
a
b
b
b
b
bb
b
b
b
b
bb
.
Having a slightly different set of weights, the sum Σ could also be a depiction
of unsigned or two’s complement unipolar format,
(68)
; ,
; ,
; , , , . . . ,
h X
h X
h X i
unsignedunsigned q
unsignedunsigned q
unsignedunsigned q
2 2424
2 2323
2 2222 0 2323
/H11005
/H11005
/H11005 /H11005
i i
i i
i i
1
1
/H11002/H11002
/H11002
/H11002/H11001
h
_
`
a
b
bb
b
bb
or
; , , , . . . ,’
h
h X itwotwos complementcomplement unipolarunipolar q
0
2 2323 1 2323
/H11005
/H11005 /H11005
i i
0
/H11002*
; , , , . . . , .’
h
h X i
h
twotwos complementcomplement unipolarunipolar q
0
0 2222 2 2323
2
/H11005
/H11005 /H11005
/H11005i i
0
1
1/H11002/H11001
h
Z
[
\
]]
]]

<!-- p.15 -->

PAPERS EFFECT DESIGN
Any chosen format is applied to the shift register that
constitutes a PN generator. Fig. 63 is then an accurate
multibit model of the actual generator circuit in Fig. 60(a).
A single-bit PN sequence model would have all h
i /H110050
except for h0 /H110051.
The single-bit causal digital filter depicted in Fig. 63 is
of type IIR, direct form II. Each successive bit z/H110021 of that
digital filter sees a delayed replica of the single-bit PN
sequence Xn. The arrangement of the weight and single-bit
PN sequence indices in Fig. 63 suggests convolution in the
formation of the multibit output. Indeed, the IIR digital fil-
ter can be broken apart into recursive and nonrecursive
parts, as in Fig. 64.
137
J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March 129
137 Thanks go to Jeffrey Barish for pointing this out, and for
reviewing the entire manuscript.
Fig. 64. Decomposition of direct form II into recursive and nonrecursive parts.
Fig. 63. Interpretation of register conversion to unsigned or two’s complement as a digital filtering of single-bit PN sequence  Xn.
Fig. 62. Right way (a), (b) and wrong way (c) to take register contents. (a) Right way to convert unsigned register X to two’s comple-
ment unipolar format. (b) Right way to convert to two’s complement bipolar format. (c) Cast method places a deep cut at dc in a udio
noise power spectrum. /H11022/H110221 indicates a logical shift right by 1 bit. (int) means cast as in C code.
(a)
(b)
(c)

<!-- p.16 -->

DATTORRO PAPERS
The geometric interrelationship of the FIR coefficients
allows a more compact z transform [Eq. (69)] that resem-
bles an IIR transfer function. The large register width (24
bit) diminishes the high powers of z
/H110021, yielding the
approximate transfers that are less cumbersome. The two’s
complement transfer function 
( )H zXs is a consequence of
the “wrong” way to perform the format conversion; it
places a zero of transmission close to dc (Fig. 65). The
others have near-unity transfer at dc, but are not flat (Fig.
66). The two’s complement unipolar transfer H
X(z) is pre-
multiplied by z because the right-shift 1-bit in Fig. 62 is
equivalent to a unit advance of Xn.
The deep cut into the magnitude response of the cast-
method filter ( )H zXs [Fig. 62 (c)] is shown in Fig. 65. A
significant range of the audio noise power spectrum is
consequently lost. Fig. 66 shows the approximate magni-
tude response for the transfer function 
( )H zX of unsigned
word format or conversion to two’s complement unipolar
format zHX(z) as in Fig. 62(a); there is a loss of 9.5 dB at
Nyquist. Sonically the transfer of Fig. 66 is preferable for
musical purposes.
8.4.2 Multibit PN Sequence Power Spectrum
and Autocovariance
The multibit PN generator is simply a digital filtering of
the single-bit PN sequence. As is well known for linear
130 J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March
Fig. 65. Approximate magnitude response of two’s complement
integer-cast filter transfer function.
Fig. 66. Approximate magnitude response of unsigned or two’s
complement unipolar filter transfer function.
( )H z h z/H11005i
i
i
0
2323
/H11005
/H11002! (69)
( )
, !, ’ ,
H z z
z
z
z
z castcast twotwos complementcomplement q WRONGWRONG
1 2
1 2
1
1 2 2
1 2
1
1 2323
/H11005/H11002/H11001 /H11005
/H11002
/H11002 /H11002
/H11002
/H11002
/H11002
i i
i
X
1
2323
1
2424 2424
1
1
/H11002/H11002
/H11005 /H11002
/H11002/H11002
/H11002
/H11002
.
!s
( )
, .
H z z
z
z
z
unsignedunsigned q
2 2
1
1 2
1
1 2
1 2
1
2
1
2424
/H11005 /H11005
/H11002
/H11002
/H11002
X i i
i
1
0
2323
1
2424 2424
1
/H11002/H11002/H11002
/H11005 /H11002
/H11002/H11002
/H11002
:
.
!
( )
, ., ’
zHzH z z z
z
z
z
unipolarunipolar twotwos complementcomplement q
2
1 2
1
1 2 1
1 2
1
2
1
2323
/H11005 /H11005
/H11002
/H11002 /H11002
/H11002
zX i i
i 1
2323
1
2424 2424
1
/H11002/H11002
/H11005 /H11002
/H11002/H11002
/H11002
.
!
J
L
K
K
K
KK
N
P
O
O
O
OO
The FIR filter H(z) in Fig. 64 is identified as the nonrecursive part. Its z domain transfer function depends on the
chosen word format,

<!-- p.17 -->

PAPERS EFFECT DESIGN
systems [62], [68], the expressions for filter output power
spectra are simply
.
M
X k
M
X k
H
M
X k
M
X k
H
M
X k
M
X k
H
e
e
e
/H11005
/H11005
/H11005
π
π
π
n
X
n
X
n
X
j
j
j
2 2
2
2
2 2
2
2
2 2
2
2
k
k
k
/
/
/
M
M
M
s
s `
`
`
j
j
j
7 7
7 7
7 7
A A
A A
A A
(70)
The numerical value of the sample variance and mean for
the multibit maximal-length PN sequence can be predeter-
mined exactly via expectations, simply because the pmf is
precisely uniform over one period M,
The multibit unipolar (0, 1) and bipolar (/H110021, 1) [/H110021, 1)
domains are presumed quantized to word length bits. The
quantization ∆ for both bipolar domains are identical.
With the advent of our digital filter interpretation of the
multibit PN sequence, the (complex) general expression
for autocovariance in terms of the autocorrelation
becomes
C[l] /H11005R[l] /H11002m
2 
( )
.σ
m m h m H
C
1
0
/H11005 /H11005
/H11005
X i
i
X
0
2323
2
/H11005
n n!
7 A
The standard linear systems derivation finds the circu-
lar autocovariance C[l] of the multibit PN sequence via
the length- M IDFT of Eq. (70). That calculation is
expressed in Eq. (72), the multibit generalization of Eq.
(65),
.
R l C l m M
X k
R l C l m M
X k
R l C l m M
X k
IDFTIDFT
IDFTIDFT
IDFTIDFT
/H11005/H11001/H11005
/H11005/H11001/H11005
/H11005/H11001/H11005
X X X M
X X X M
X X X M
2
2
2
2
2
2
s
s s s7 7
7
7 7
7
7 7
7
A A
A
A A
A
A A
A
Z
[
\
]]
]]
Z
[
\
]]
]]
Z
[
\
]]
]]
_
`
a
bb
bb
_
`
a
bb
bb
_
`
a
bb
bb
(72)
The autocovariance is thus dependent on the chosen word
format. That particular format determines H(z) as in Eq.
(69), namely,
( ) ( )
( ) ( )
( ) ( ) .
C l C l H z H z
C l C l H z H z
C l C l H z H z
/H11005 /H11005
/H11005 /H11005
/H11005 /H11005
X X
X X
X X
s s7 7
7 7
7 7
A A
A A
A A
(73)
The simpler time-domain derivation of circular autoco-
variance [Eq. (74)] in [62, ch. 6.2] requires the digital fil-
ter H(z)  to be causal, and assumes that the single-bit noise
process {Xn} is weakly stationary and two sided (in time),
J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March 131
*( ) * ( )
σ
δ
σ
δ
C l M M l qMqM h h h h
M M l qMqM Z H z H z H
1
1
1 1
/H11005/H11002 /H11002 /H11002
/H11005/H11002 /H11002 /H11002
* *X
i
i
i l i
i
r
rq
X
q
2
0
2323
0
2323
0
2323
2
1 2
/H11005
/H11002
/H11005/H11005/H11005/H11002
/H11002
/H11005/H11002
n
n
3
3
3
3
*
*
! ! !!
!
J
L
K
KK
J
L
K
KK e
N
P
O
OO
N
P
O
OOo
7 7
7
A A
A
* 4
(74)
, ( , )X 0 1!
!
,
, ( , )
( )
, [ , ),),
, ./H11022
σ σ
σ σ
m m
X
m
X
m
X X
wordword lengthlength
/H9268
1212
1
1212
2
2
1
3
1
3
2
0
1 1
2 1
2 2
1 2
1
1 1 0
1
/H11005/H11005/H11002
/H11005/H11005
/H11005/H11002
/H11005
/H11002
/H11005/H11001
/H11002
/H11002
/H11005
/H11002
/H11002
( )
( )
wordword lengthlength
wordword lengthlength
wordword lengthlength
wordword lengthlength
wordword lengthlength
X X
X X
X
X
X X
X
1
1
2
2 2
2
2 2
/H11002 /H11002
/H11002 /H11002
!
!
u
s s
u
u
s u
s
_
`
a
b
b
b
b
bb
_
`
a
b
bb
b
bb
_
`
a
b
b
bb
b
b
bb
_
`
a
b
b
b
b
b
b
b
b
b
b
bb
b
b
b
b
b
b
b
b
b
b
bb
(71)
C[0] /H11005σ2 .

<!-- p.18 -->

DATTORRO PAPERS
where the centered asterisks * denote linear convolution
(with precedence), while the asterisk superscripts denote
conjugation. The inverse z transform in Eq. (74) is a func-
tion of lag l (which extends infinitely in both directions, as
before). We note a strong resemblance of Eqs. (74) and
(67). The periodic Kronecker delta of Eq. (67) now under-
goes convolution in Eq. (74). The trailing 1 in Eq. (67)
becomes H(1)
2.
The correct evaluation of Eq. (74) assumes that the gen-
erator word length is properly related to the register width,
as in Table 11. As stated previously, it is not necessary to
mask off bits to the right of short word length MSBs for
musical purposes. Hence the relationships in Table 11 are
purely theoretical.
8.4.3 Two’s Complement Bipolar Word Format
We now examine the important case of a uniform pmf
two’s complement bipolar q23 (Section 9.1, Appendix 7)
PN sequence as in Fig. 62(b). Given the current trend in
DSP chip design which defaults to two’s complement for-
mat [70], [1], [71], [49], this multibit bipolar case is
important because it is probably the most desirable (spec-
trally and numerically) of the format conversions that we
have discussed. The true power spectrum can be deter-
mined in two ways. The first way is via frequency-domain
interpretation of Fig. 62(b) itself,
) δ [(
{ / }
modmod
M
X k
M
X k
M
M
X k
H M k M
DFTDFT
e
4
4
1 2
/H11005 /H11002
/H11005 /H11002π
M
n
X j
2 2
2
2
2 2
]k/M
u
J
L
K
K
K
K
KK
N
P
O
O
O
O
OO
7 7
7
A A
A (75)
where δ is the Kronecker delta. The power spectrum
Xn[k]2/M of the single-bit PN sequence is shown in Fig.
61. (Recall that the power spectrum converges to its true
value [Eq. (66)] when N /H11005M.)
The second way to determine the true power spectrum
of this multibit sequence follows from the DFT of the cir-
cular sample autocorrelation
(76)
σ
R l C l m
C l C l
m
C
4
0
0
/H11005/H11001
/H11005
/H11005
/H11005
X X X
X X
X
X X
2
2
u u u
u
u
u u
7 7
7 7
7
A A
A A
A
for CX[l] as in Eqs. (73) and (74). [The sample variance is
given in Eq. (71).] From Eq. (76) we get an expression for
the power spectrum that is equivalent to Eq. (75),
(77)
Proper evaluation of Eqs. (75) and (77) depends on the
word length being exactly 1 bit less than the register width
to accommodate the right-shift 1 bit in Fig. 62(b).
Pertinent to our example in Figs. 60 and 63, word length
is assumed to be 23 bit, as specified in Table 11. Also, the
exact expression for H
X(z) from Eq. (69) must be used.
Given those caveats, we find that the true multibit bipolar
PN sequence power spectrum [Eq. (75) or (77)] is zero at
dc, discrete, but otherwise has the envelope shown in Fig.
66.
The plot of autocovariance in Fig. 67 is a numerical
evaluation of Eq. (76) via Eqs. (73), (74), (68), and (64).
Fig. 67 shows just how spiky the autocovariance of the
multibit bipolar PN sequence is. It is significantly dimin-
ished for lags outside of l /H11005/H1100611, but never goes [Eq.
(74)] to precisely 0. The example shown has (M /H110021)/2 /H11005
4 194 303, so the significant correlation is relatively brief
indeed.
8.4.4 Spectral Equalization
The IIR form of the transfer functions H(z) in Eq. (69)
suggests that multibit PN sequence equalization is easy.
Introduction of the term
H
EQ(z) /H11005(1 /H110022z/H110021) v , v constant
into the numerator of zHX(z) makes that transfer function
become asymptotically all pass with increasing register
width,
( )z ( )z
2
2
( )zX X
( )
.
z H
z
z
v
1
/H11005
/H11002
/H11002
EQEQ
1 1
1 1
/H11002
/H11002
EQEQ
:.
zH H7 A
Fig. 68 shows how equalization is actually performed
upon a two’s complement bipolar PN sequence. Fig. 68 is
simply a digital filtering of the output of the circuit in Fig.
62(b).
Once equalization is performed on a multibit PN
sequence in this manner, the power spectrum becomes
asymptotically white
138 with increasing word length, and
the circular autocovariance becomes a periodic Kronecker
delta. The drawback to equalization is that the resulting
multibit sequence no longer has uniform pmf.
The equalized multibit bipolar PN sequence over one
period M has sample variance asymptotically equal to the
132 J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March
138 This is true assuming that the relationship between word
length and register width as shown in Table 11 is maintained.
Table 11. Theoretical relationship of word length
to 24-bit register width.
X Unsigned word length /H1100524 bit
Xs Two’s complement cast method word length /H1100524 bit
X Two’s complement unipolar word length /H1100523 bit
Xu Two’s complement bipolar word length /H1100523 bit
)
{ } { }
( ( ) .modmodσ δ
M
X k
R l C l
M
M H H k M
DFTDFT DFTDFT
e
4
4 1 1
/H11005 /H11005
/H11005 /H11002 /H11002π
M M
j
X X
X X X
2
2 2 22
n
k/M
u
u
f p
7
7 7
7
A
A A
A

<!-- p.19 -->

given constant squared v2,n amely, Eq. (78),139
We do not investigate equalization any further here
because our multibit PN sequences, as derived previously,
suit most of our musical purposes.
8.4.5 Uniform pmf Multibit Realization
Fig. 69 shows a brief realization (PN sequence) of a
two’s complement bipolar PN process generated by a cir-
cuit similar to that in Fig. 60 having format conversion as
in Fig. 62(b). This sequence has sample variance approxi-
mately equal to 1/3 and mean [Eq. (71)] exactly equal to
0. The plot reveals that maximal-length PN sequence gen-
PAPERS EFFECT DESIGN
erators are fundamentally relaxation-type oscillators. The
arrows in the figure highlight exponential growth and
decay, which are fairly obvious in that microscopic view.
J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March 133
139 The sample variance Eq. (78) is found analytically by solv-
ing the autocovariance equation 4CXEQ
[l] for lag l /H110050 [substitut-
ing the impulse response of the equalized digital filter HXEQ
(z)
into 4 * Eq. (74)]. When Eq. (78) is verified by simulation, it is
critical to initialize the old state of HEQ(z). The proper initializa-
tion is determined by recognizing that the filter input is periodic.
Fig. 68. Right way to convert unsigned register to two’s complement bipolar format while equalizing audio noise power spectrum.
Fig. 67. Autocovariance of two’s complement bipolar PN sequence having length M /H110052word length /H110021; word length /H1100523.
, ( , ), ./H11022
σ v
m
X wordword lengthlength
1
1 2
2
0
1 1 1
/H11005/H11001
/H11002
/H11005
/H11002
( )
wordword lengthlength
wordword lengthlength
EQEQ
X
X
2 2 1
2
/H11002
/H11002 /H11002
EQEQ
EQEQ
!u
u
u
J
L
KK
N
P
OO
_
`
a
b
bb
b
bb
(78)

<!-- p.20 -->

DATTORRO PAPERS
This exponential relaxation in time is easily explained by
the right-shift by 1 bit that occurs as part of the algorithm
on every sample generated. Exponential relaxation in the
PN sequence betrays the existence of correlation,
140 that
is, the circular autocovariance of this PN sequence would
not produce a periodic Kronecker delta (Fig. 67). Hence
we may conclude that noise realized in this manner cannot
be perfectly spectrally white (Fig. 66). Since exponential
growth and decay are common physical occurrences in the
real world, this may help explain why these PN generators
are sonically acceptable.
8.5 Pseudnoise Conclusions
Further research is required to formulate precise expres-
sions for the distribution of amplitude and the power spec-
tra of functions and combinations of these deterministic
PN sequences over one common period, that is, to synthe-
size other exacting pmfs having known power spectra
[72]. We have expended some energy doing so here for the
uniform pmf, and we are providing new exhaustive lists of
two- and four-term PN generator equations for selected
word lengths in Appendix 6.
From a musical perspective, the sample variance is
handy to help quantify perceived loudness with respect to
other sequences having possibly different pmfs. We have
learned that the two’s complement cast method, the
“wrong” way to convert the unsigned generator register to
a bipolar format, will destroy low frequencies in the audio
noise power spectrum. We have demonstrated the proper
way to perform the conversion as well as an easy method
for equalizing the power spectrum of the multibit PN
sequence.
8.6 Appendix 6: Maximal-Length PN Sequence
Generator Equations
8.6.1 Two-Term Exhaustive Generator-Equation
Listing
We show only the subscript of the middle term in the
two-term generator equations. The last subscript is always
0 while the first (left-hand side of the earlier table equa-
tions) is word length /H110021, that is,
b
word length/H110021[n /H110011] /H11005b{} [n] 5 b0[n] .
134 J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March
Fig. 69. Bipolar uniform pmf noise realization, exhibiting correlation.
140 The exponential artifacts cannot be decorrelated by choos-
ing a different logic equation from the tables.


<!-- p.21 -->

PAPERS EFFECT DESIGN
8.6.2 Four-Term Exhaustive Generator-Equation
Listing
We show only the subscripts of the three middle terms
in the four-term generator equations. The last subscript is
always 0 while the first (left-hand side of the earlier table
equations) is word length /H110021, such as
b4[n /H110011] /H11005{b3[n] 5 b2[n] 5 b1[n]} 5 b0[n]
from the first { } entry in the listing that follows.
J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March 135


<!-- p.22 -->

DATTORRO PAPERS
136 J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March

<!-- p.23 -->

PAPERS EFFECT DESIGN
J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March 137

<!-- p.24 -->

DATTORRO PAPERS
138 J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March

<!-- p.25 -->

PAPERS EFFECT DESIGN
J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March 139

<!-- p.26 -->

DATTORRO PAPERS
9 GENERAL APPENDIXES
9.1 Appendix 7: q Format for DSP Chips
9.1.1 Scientific and Binary-Radix Notation
These notations are of the form
mantissa /H11003radixexponent
Scientific notation has radix 10, while binary-radix nota-
tion has radix 2. The exponent is conventionally an inte-
ger.
The scientific notation of floating-point constants as in,
for example, 7e3, is mathematically equivalent to 7 /H1100310
3.
Binary-radix notation [70] is similar. For example, 7q3 is
defined as mathematically equivalent to 7 /H110032
3 (where q
stands for quanta). This notation comes in handy when we
want to specify the location of the binary point in a fixed-
point number which is to be assigned as the contents of
some register, that is, to specify the register format.
Fig. 70 shows the two most commonly used formats of
a 24-bit register used for holding a coefficient in a digital
filtering application. In Fig. 70(a) the range of the coeffi-
cient
141 is [ /H110021., 1.) for q23, whereas in Fig. 70(b) it is
[/H110022., 2.) for q22. Here q23 is the maximum binary-radix
locator in 24-bit two’s complement fixed point.
One way to look at binary-radix notation, then, is as a
140 J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March
141 The notation [ ) means that the positive extreme cannot be
reached exactly.

<!-- p.27 -->

PAPERS EFFECT DESIGN
conversion from floating-point representation,
floating.expression, to fixed-point representation. For
example,
SOME_REGISTER /H11005floating.expression q22
This declares the binary point in the 24-bit register to be
fixed at 2 bit away from the MSB (or 22 bit away from the
LSB). This in turn implies that floating.expression is
known to have a magnitude less than 2.
Generally speaking, any numerical expression followed
with binary-radix notation will be multiplied by 2 raised to
the indicated power. But we should instead think of
binary-radix notation as a mnemonic tool that provides the
location (the q format) of the binary point within some
fixed-point register, as in the examples of Fig. 70.
9.1.2 Fixed-Point Arithmetic within a DSP Chip
Next we turn to the subject of numerical computation
within the executing hardware numerical function units.
The rules of fixed-point arithmetic are easy when the q
format is employed.
Rule 1— Addition and Subtraction :T o add or subtract
two fixed-point numbers, their respective binary points
must have the same location, that is, the same q.
If they do not have the same q, then a shifter must be
used to first bring them into alignment.
Rule 2—Multiplication : In two’s complement, when
multiplying a 24-bit number having qN with another 24-bit
number having qM, the product is a 48-bit number having
q(N /H11001M /H110011) format. The 24 MSBs of the product have
q(N /H11001M /H110011 /H1100224) format.
The extra 1 in rule 2 arises from the common practice of
designing the signed multiplier such that there is a built-in
permanent shift-left 1-bit of the product to remove the
extra sign bit [70], [1], [71], [49].
142 Most often only the
MSBs of an accumulation of products constitute some
desired result. So, for example, suppose we multiply a q0
signal at 24 bit (typically 16 bit of signal left-justified into
a 24-bit word) by a q23 coefficient at 24 bit. The result is
a 48-bit product in q24. Now, if we truncate the least sig-
nificant 24 bit storing only the MSBs, we end up with a
24-bit result in q0. In this case, the q of the result is the
same as that of the signal.
9.1.3 Numerical Precision
If the programmer is scrupulous, it is not too difficult to
implement block floating-point arithmetic. Block floating-
point arithmetic is a numerical implementation of an algo-
rithm using a fixed-point DSP chip where the binary-radix
point of a block (some collection or group) of operands is
fixed, but fixed only over some intermediate portion of a
longer computation. A different block (or the same block
computed at a different phase of the program) may have a
different binary point location. The block floating-point
technique finds use such as applied to fast Fourier trans-
form (FFT) [73], [74] or amplitude compression algo-
rithms implemented on fixed-point processors having bar-
rel shifters. When the fundamental word length of a
fixed-point processor is large enough (at least 24 bit), the
need for block floating point diminishes and fixed-point
computations may suffice. An alternative to block floating
point is double-precision arithmetic [12].
9.2 Appendix 8: Truncation Mathematics for
DSP Chips
9.2.1 Math Function Definitions: Magnitude
Truncation, Rounding, and Truncation
int result;
double value;
/* magnitude truncation */
result /H11005floor(fabs(value)) * SIGN(value);
/* rounding */
result /H11005floor(fabs(value) /H110010.5) * SIGN(value);
/* truncation */
result /H11005floor(value);
Shown are the C-program floating-point definitions of
the three truncation functions. The truncation functions
(magnitude truncation, rounding, truncation) operate on
floating-point values typically greater than 1.0 ,p roduc-
ing integer results. Magnitude truncation and rounding are
J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March 141
142 The LSB of the 48-bit product should be 0 as a result of the
permanent shift left. Typical DSP chips have hardware multiply
units that are not designed to multiply integers, that is, they are
designed to execute fixed-point multiplys.
Fig. 70. Two’s complement fixed-point format examples.


<!-- p.28 -->

DATTORRO PAPERS
symmetrical functions. On many machines it is helpful to
keep in mind that the (int) or (long) C-cast of a floating-
point number actually performs a magnitude truncation.
The SIGN( ) macro is defined to return {1., 0., /H110021.} for
strictly positive, zero, and negative arguments, respec-
tively. Recall that the floor( x) function, defining simple
truncation, returns the largest integer not greater than x;
truncation simply throws away or masks off the fractional
part.
9.2.2 Real-Time Compute Statistics
It would be interesting to analyze the statistical impact
of each signal-truncation function type when used in real-
time computation, such as in a DSP chip program execut-
ing some digital filter algorithm. For that application, the
meaning of the truncation functions pertains to the han-
dling of what is considered to be the fractional part (the
LSBs to the right of the radix point) of some binary word.
A specific example might be the conversion from a
double-precision (48-bit) result to single precision (24
bit). The most notable outcome is that the use of magni-
tude truncation introduces noise into the resultant signal,
which is statistically 6 dB higher in power than that pro-
duced by either rounding or truncation. Although round-
ing and truncation produce equivalent (to each other) ac
noise power, truncation, which introduces a negative dc
offset of one-half quantum, is not a zero-mean process.
These statistical results can be explained by considering
the distribution of the magnitude and sign of the quantiza-
tion errors due to each truncation function [11, ch. 11.2].
Alternately, we may represent the action of each trun-
cation function in terms of the instantaneous change to
some two’s complement number, as illustrated in Fig. 71,
assuming a nonzero fractional part. None of the truncation
functions can change a positive number into a negative
number, and vice versa. Iconic Fig. 71 indicates that trun-
cation will increase the magnitude of negative numbers
only, whereas rounding can increase the magnitude of all
numbers. Further, truncation always increases the magni-
tude of negative numbers, but rounding does not always
increase magnitude (explaining the bidirectional arrows).
On the other hand, magnitude truncation always decreases
the magnitude of both positive and negative numbers.
The truncation function simply called “truncation” has
no point of symmetry; it causes the same direction of
change everywhere in the continuum. This lack of sym-
metry accounts for the statistical dc offset. Of the three
truncation functions, both rounding and truncation have
the propensity for producing results that exceed the mag-
nitude of their arguments. This idiosyncrasy explains one
of the causes of limit-cycle tones produced in direct form
and lattice digital filter topologies [11, ch. 11.5].
Magnitude truncation does not share this characteristic
and can sometimes remedy limit-cycle oscillation [9].
(Check out Section 1.3.4.)
9.2.3 Real-Time Compute Implementation
We wish to know how the truncation functions are each
implemented in the binary domain. For the sake of illus-
tration, let us assume that we are given 24-bit two’s com-
plement binary numbers in q8 format defined in hexadec-
imal ($) as follows:
For the two values, after binary magnitude truncation,
val1 /H11005$007F00 and val2 /H11005$FF8100. This is how mag-
nitude truncation might be programmed in a real-time
computation within a DSP chip. In decimal, we are adding
0.999 . . . to val when it is negative. We conditionally add
$0.FFF . . . to val, rather than $1.0, to avoid bumping up a
perfect negative integer. This implies that if any of the
fractional bits of val are nonzero when it is negative, then
magnitude truncation will increase val.
But as it often happens, the given 24-bit binary number
may itself constitute the MSBs of a higher precision 48-bit
result. It is likely that the 24 LSBs of the higher precision
142 J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March
Fig. 71. Direction and relative magnitude of change after quanti-
zation of 24-bit two’s complement number.
val1 /H11005$007FFF // q8 format means $007F.FF /H11005127.99609375
val2 /H11005$FF8001 // q8 format means $FF80.01 /H11005/H11002127.99609375
1) Binary Magnitude Truncation: In the binary domain, the corresponding oper-
ation to magnitude truncation is,
Pseudocode: if(val < 0) val /H11001/H11005$0.FFF . . . ;       /* binary magnitude truncation */
val /H11005binary truncation(val);       /* discard bits to right of binary point */

<!-- p.29 -->

PAPERS EFFECT DESIGN
result were nonzero and the situation is such that we are
not sure. Statistically it is much better to err on the side of
caution if we do not know what those higher precision
LSBs were. So in this circumstance, we would amend the
pseudocode to conditionally add $1.0 to val instead of
$0.FFF....  Empirically, we have observed much better
outcome under this latter assumption.
2) Binary Rounding : Curiously, in the case of two’s
complement binary rounding there is no conditional addi-
tion. In the binary domain, the corresponding operation to
rounding is,
For the two given values, after binary rounding, val1 /H11005
$008000 and val2 /H11005$FF8000. This is how rounding
might be programmed in a real-time computation within a
DSP chip. In decimal, we are unconditionally adding 0.5
to val,r egardless of its sign.
143
3) Binary Truncation: In the binary domain the corre-
sponding operation to truncation is simply,
For the two given values, after binary truncation, val1 /H11005
$007F00 and val2 /H11005$FF8000; the 8 LSBs are masked
off, or simply discarded.
One useful fact regarding truncation is that the frac-
tional part (rather, the part that is discarded or masked off)
is always positive in sign. This fact could be used to
advantage within a digital filtering circuit having trunca-
tion error feedback for the purpose of minimizing trunca-
tion noise [12].
144
Fig. 72 shows an example of truncating any 24-bit q8
two’s complement number by taking the 16 MSBs and
discarding the 8 LSBs. We are interested in the sign of the
error e[n] that results from subtracting the truncated num-
ber 
yt[n] from the full-precision number y[n], that is,
[ ] [ ] [ ] .y n y n ne 0/H11002/H11005$t
Since the bi can only take on the value 0 or 1, in two’s
complement, the stated result follows regardless of the
sign of y[n]. By induction, this result extends to other q,
hence other truncation widths.
10 ACKNOWLEDGMENT
The author wishes to express his gratitude to Jennie
Columba and Antonio for unflagging encouragement and
support in the pursuit of knowledge.
11 REFERENCES
[1] D. C. Andreas, J. Dattorro, and J. W. Mauchly,
“Digital Signal Processor for Audio Applications,” U.S.
patent 5,517,436 (1996 May 14).
[2] W. G. Gardner, “Reverberation Algorithms,” in
Applications of Digital Signal Processing to Audio and
Acoustics,” M. Kahrs and K. Brandenburg, Eds. (Kluwer
Academic, Norwell, MA, 1998).
[3] J. A. Moorer, “About this Reverberation Business,”
Computer Music J.,v ol. 3, pp. 13–28 (1979 June), also in
Foundations of Computer Music,C . Roads and J. Strawn,
Eds. (MIT Press, Cambridge, MA, 1988).
[4] D. Griesinger, “Practical Processors and Programs
for Digital Reverberation,” in Audio in Digital Times ,
Proc. Audio Eng. Soc. 7th Int. Conf. (Toronto, Ont.,
Canada, 1989 May 14–17), pp. 187–195.
J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March 143
Fig. 72. Example showing how truncation error is always positive.
143 When comparing rounding results in the floating-point
domain with the corresponding results in the binary domain, it is
wise not to use test values having a fractional part /H110050.5 exactly,
because this special case produces different results in each
domain.
144 This noise, due to ongoing internal signal quantization
error, is also known as roundoff noise [11]. Truncation error feed-
back is also known to minimize limit-cycle oscillation [18], thus
providing an alternative to magnitude truncation as a remedy.
Pseudocode: val /H11005binary truncation(val) ; /* binary truncation */
/* discard bits to right of binary point */
Pseudocode: val /H11001/H11005$0.8; /* binary rounding */
val /H11005binary truncation(val);       /* discard bits to right of binary point */

<!-- p.30 -->

DATTORRO PAPERS
[5] B. A. Blesser and K. O. Bader, “Electric Reverber-
ation Apparatus,” U.S. patent 4,181,820 (1980 Jan. 1).
[6] D. Griesinger, “Room Impression, Reverberance,
and Warmth in Rooms and Halls,” presented at the 93rd
Convention of the Audio Engineering Society, J. Audio
Eng. Soc. (Abstracts) ,v ol. 40, p. 1064 (1992 Dec.),
preprint 3383.
[7] M. Schroeder, “Natural Sounding Artificial
Reverberation,” J. Audio Eng. Soc.,v ol. 10, p. 219 (1962
July).
[8] J. M. Jot and A. Chaigne, “Digital Delay Networks
for Designing Artificial Reverberators,” presented at the
90th Convention of the Audio Engineering Society, J.
Audio Eng. Soc. (Abstracts) ,v ol. 39, p. 383 (1991 May),
preprint 3030.
[9] J. O. Smith, “Elimination of Limit Cycles and
Overflow Oscillations in Time-Varying Lattice and
Ladder Digital Filters,” in Music Applications of Digital
Waveguides,R ep. STAN-M-39, Center for Computer
Research in Music and Acoustics (CCRMA), Dept. of
Music, Stanford University, Stanford, CA (1987 May).
[10] A. V . Oppenheim, Ed., Applications of Digital
Signal Processing (Prentice-Hall, Englewood Cliffs, NJ,
1978).
[11] L. B. Jackson, Digital Filters and Signal Process-
ing,3 rd ed. (Kluwer Academic, Norwell, MA, 1996).
[12] J. Dattorro, “The Implementation of Recursive
Digital Filters for High-Fidelity Audio,” J. Audio Eng.
Soc.,v ol. 36, pp. 851–878 (1988 Nov.); Comments, ibid.
(Letters to the Editor ), vol. 37, p. 486 (1989 June);
Comments, ibid. ( Letters to the Editor ), vol. 38, pp.
149–151 (1990 Mar.).
[13] P. A. Regalia and S. K. Mitra, “Tunable Digital
Frequency Response Equalization Filters,” IEEE Trans.
Acoust., Speech, Signal Process. ,v ol. ASSP-35, pp.
118–120 (1987 Jan.).
[14] A. V . Oppenheim and R. W. Schafer, Discrete-
Time Signal Processing (Prentice-Hall, Englewood Cliffs,
NJ, 1989).
[15] J. Strawn, Ed., Digital Audio Signal Processing
(A-R Editions, Madison, WI, 1985).
[16] J. A. Moorer, “The Manifold Joys of Conformal
Mapping: Applications to Digital Filtering in the Studio,”
J. Audio Eng. Soc.,v ol. 31, pp. 826–841 (1983 Nov.).
[17] D. P. Rossum, “Dynamic Digital IIR Audio Filter
and Method which Provides Dynamic Digital Filtering for
Audio Signals,” U.S. patent 5,170,369 (1992 Dec.).
[18] T. I. Laakso, “Error Feedback for Reduction of
Quantization Errors due to Arithmetic Operations in
Recursive Digital Filters,” D. Tech. Thesis, Rep. 9, Lab-
oratory of Signal Processing and Computer Technology,
Helsinki University of Technology, Espoo, Finland
(1991).
[19] K. Steiglitz, A Digital Signal Processing Primer
(Addison-Wesley, Menlo Park, CA, 1996).
[20] Moog Voltage-Controlled Ladder Filter, Internet:
http://dropmix.xs4all.nl/rick/Emusic/Moog (Rick Jansen)
and Internet: http://www-ccrma.stanford.edu/~stilti/pap
ers/moogvcf.pdf
[21] D. Rossum, “Making Digital Filters Sound
‘Analog,’” in Proc. Int. Computer Music Conf. (San Jose,
CA, 1992), pp. 30–33.
[22] “CEM3328 Four Pole Low Pass VCF,” Curtis
Electromusic Specialties, Los Gatos, CA (1983).
[23] H. Chamberlin, Musical Applications of Micro-
processors (Hayden, Indianapolis, IN, 1980).
[24] Mathematica ,v ersion 2, Wolfram Research,
Champaign, IL (1994).
[25] B. L. Evans, L. J. Karam, K. A. West, and J. H.
McClellan, “Learning Signals and Systems with
Mathematica,” IEEE Trans. Education,v ol. 36, pp. 72–78
(1993 Feb.).
[26] K. W. Martin and M. T. Sun, “Adaptive Filters
Suitable for Real-Time Spectral Analysis,” IEEE Trans.
Circuits Sys.,v ol. CAS-33, pp. 218–229 (1986 Feb.); also
IEEE J. Solid-State Circuits ,v ol. SC-21, no. 1 (1986
Feb.), pp. 108–119.
[27] M. R. Petraglia, S. K. Mitra, and J. Szczupak,
“Adaptive Sinusoid Detection Using IIR Notch Filters and
Multirate Techniques,” IEEE Trans. Circuits Sys. II ,v ol.
41, pp. 709–717 (1994 Nov.).
[28] T. Kwan and K. Martin, “Adaptive Detection and
Enhancement of Multiple Sinusoids Using a Cascade IIR
Filter,” IEEE Trans. Circuits Sys. ,v ol. 36, pp. 937–947
(1989 July).
[29] P. P. Vaidyanathan, Multirate Systems and Filter
Banks (Prentice-Hall, Englewood Cliffs, NJ, 1993).
[30] T. I. Laakso, P. S. R. Diniz, I. Hartimo, and T. C.
Macdeo, Jr., “Elimination of Zero-Input and Constant-
Input Limit Cycles in Single-Quantizer Recursive Filter
Structures,” IEEE Trans. Circuits Sys. II ,v ol. 39, pp.
638–646 (1992 Sept.).
[31] A. Luthra, “Extension of Parseval’s Relation to
Nonuniform Sampling,” IEEE Trans. Acoust., Speech,
Signal Process.,v ol. 36 (1988 Dec.), pp. 1909–1911.
[32] R. W. Schafer and L. R. Rabiner, “A Digital Signal
Processing Approach to Interpolation,” Proc. IEEE,v ol.
61, pp. 692–702 (1973 June).
[33] F. R. Moore, “Table Lookup Noise for Sinusoidal
Digital Oscillators,”Computer Music J.,v ol. 1, pp. 26– 29
(1977 Apr.), also in Elements of Computer Music
(Prentice-Hall, Englewood Cliffs, NJ, 1990), chap. 3.
[34] R. E. Crochiere and L. R. Rabiner, Multirate
Digital Signal Processing (Prentice-Hall, Englewood
Cliffs, NJ, 1983).
[35] M. Renfors and T. Saramäki, “Recursive Nth-
Band Digital Filters — Parts I and II,” IEEE Trans.
Circuits Sys.,v ol. CAS-34, pp. 24–51 (1987 Jan.).
[36] D. Rossum, “An Analysis of Pitch Shifting
Algorithms,” presented at the 87th Convention of the
Audio Engineering Society, J. Audio Eng. Soc.
(Abstracts),v ol. 37, p. 1072 (1989 Dec.), preprint 2843.
[37] R. Adams and T. Kwan, “Theory and VLSI
Architectures for Asynchronous Sample-Rate Convert-
ers,” J. Audio Eng. Soc. ,v ol. 41, pp. 539–555 (1993
July/Aug.).
[38] T. A. Ramstad, “Digital Methods for Conversion
between Arbitrary Sampling Frequencies,” IEEE Trans.
Acoust., Speech, Signal Process. ,v ol. ASSP-32, pp.
577–591 (1984 June).
144 J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March

<!-- p.31 -->

PAPERS EFFECT DESIGN
[39] T. I. Laakso, V . Välimäki, M. Karjalainen, and
U. K. Laine, “Splitting the Unit Delay — Tools for
Fractional Delay Filter Design,” IEEE Signal Process.
Mag.,v ol. 13, pp. 30–60 (1996 Jan.).
[40] J. Dattorro, “The Implementation of Digital
Filters for High Fidelity Audio, Part II — FIR,” in Audio in
Digital Times, Proc. Audio Engineering Society 7th Int.
Conf. (Toronto, ON, Canada, 1989 May 14–17), pp.
168–180.
[41] J. C. Dattorro, A. J. Charpentier, and D. C.
Andreas, “Decimation Filter as for a Sigma – Delta
Analog-to-Digital Converter,” U.S. patent 5,027,306
(1991 June 25).
[42] D. C. Andreas, “VLSI Implementation of a One-
Stage 64:1 FIR Decimator,” presented at the 89th
Convention of the Audio Engineering Society, J. Audio
Eng. Soc. (Abstracts),v ol. 38, p. 872 (1990 Nov.), preprint
2976.
[43] J. O. Smith and B. Friedlander, “Adaptive, Inter-
polated Time-Delay Estimation,” IEEE Trans. Aerospace
Electron. Sys.,v ol. 21, pp. 180–199 (1985 Mar.).
[44] J. O. Smith III, “Techniques for Digital Filter
Design and System Identification with Application to the
Violin,” Rep. STAN-M-14, Center for Computer Research
in Music and Acoustics (CCRMA), Dept. of Music,
Stanford University, Stanford, CA (1983 June).
[45] V . Välimäki, T. I. Laakso, and J. Mackenzie,
“Elimination of Transients in Time-Varying Allpass
Fractional Delay Filters with Application to Digital
Waveguide Modeling,” in Proc. Int. Computer Music
Conf. (Banff, AB, Canada, 1995), pp. 327–334.
[46] J. O. Smith, “An Allpass Approach to Digital
Phasing and Flanging,” Rep. STAN-M-21, Center for
Computer Research in Music and Acoustics (CCRMA),
Dept. of Music, Stanford University, Stanford, CA (1982
Spring).
[47] W. M. Hartmann, “Flanging and Phasers,” J.
Audio Eng. Soc. (Engineering Reports),v ol. 26, pp. 439–
443 (1978 June).
[48] M. L. Beigel, “A Digital ‘Phase Shifter’ for
Musical Applications, Using the Bell Labs (Alles –
Fischer) Digital Filter Module,” J. Audio Eng. Soc.
(Engineering Reports) ,v ol. 27, pp. 673–676 (1979
Sept.).
[49] DSP56000/DSP56001 Digital Signal Processor
User’s Manual,r ev. 2 (Motorola, DSP Division, Austin,
TX, 1990).
[50] F. F. Lee, “Time Compression and Expansion of
Speech by the Sampling Method,” J. Audio Eng. Soc.,v ol.
20, pp. 738–742 (1972 Nov.); also in Speech Enhance-
ment,J . S. Lim, Ed. (Prentice-Hall, Englewood Cliffs, NJ,
1983), pp. 286–290.
[51] J. Dattorro, “Using Digital Signal Processor Chips
in a Stereo Audio Time Compressor/Expander,” presented
at the 83rd Convention of the Audio Engineering Society,
J. Audio Eng. Soc. (Abstracts) ,v ol. 35, p. 1062 (1987
Dec.), preprint 2500.
[52] A. I. Abu-el-Haija and M. M. Al-Ibrahim, “Im-
proving Performance of Digital Sinusoidal Oscillators by
Means of Error Feedback Circuits,” IEEE Trans. Circuits
Sys.,v ol. CAS-33, pp. 373–380 (1986 Apr.).
[53] J. W. Gordon and J. O. Smith, “A Sine Generation
Algorithm for VLSI Applications,” in Proc. Int. Computer
Music Conf. (1985), pp. 165–168.
[54] R. W. Hamming, Numerical Methods for
Scientists and Engineers , 2nd ed. (Dover, Mineola, NY ,
1973).
[55] R. M. Gray, Source Coding Theory (Kluwer,
Norwell, MA, 1990).
[56] R. M. Gray and J. W. Goodman, Fourier
Transforms — An Introduction for Engineers (Kluwer,
Norwell, MA, 1995).
[57] J. O. Smith and P. R. Cook, “The Second-Order
Digital Waveguide Oscillator,” in Proc. Int. Computer
Music Conf. (1992), pp. 150–153.
[58] N. J. Fliege and J. Wintermantel, “Complex
Digital Oscillators and FSK Modulators,” IEEE Trans.
Signal Process.,v ol. 40, pp. 333–342 (1992 Feb.).
[59] B. K. Thoen, “Practical Aspects of Digital
Sinewave Generation Using a Second-Order Difference
Equation,” IEEE Trans. Circuits Sys. ,v ol. CAS-32, pp.
510–511 (1985 May).
[60] S. W. Golomb, Ed., Digital Communications with
Space Applications (Peninsula Publishing, Los Altos, CA,
1964).
[61] W. H. Press, S. A. Teukolsky, W. T. Vetterling, and
Brian P. Flannery, Numerical Recipes in C , 2nd ed.
(Cambridge University Press, New York, 1992).
[62] R. M. Gray and L. D. Davisson, An Introduction
to Statistical Signal Processing (Stanford University,
Stanford, CA, 1997) Internet: http://www-isl.stanford.edu
/~gray/sp.html
[63] J. Borish and J. B. Angell, “An Efficient Algo-
rithm for Measuring the Impulse Response Using Pseu-
dorandom Noise,” J. Audio Eng. Soc. ,v ol. 31, pp. 478–
488 (1983 July/Aug.).
[64] D. B. Keele, Jr., “The Design and Use of a Simple
Pseudo Random Pink-Noise Generator,” J. Audio Eng.
Soc.,v ol. 21, pp. 33–41 (1973 Jan./Feb.).
[65] F. J. MacWilliams and N. J. A. Sloane, “Pseudo-
Random Sequences and Arrays,” Proc. IEEE,v ol. 64, pp.
1715–1731 (1976 Dec.).
[66] G. R. Cooper and C. D. McGillem, Probabilistic
Methods of Signal and System Analysis , 2nd ed. (Oxford
University Press, Cary, NC, 1986).
[67] A. Leon-Garcia, Probability and Random
Processes for Electrical Engineering , 2nd ed. (Addison-
Wesley, Menlo Park, CA, 1994).
[68] R. N. Bracewell, The Fourier Transform and Its
Applications, 2nd ed., rev. (McGraw-Hill, New York,
1986).
[69] N. J. Kasdin, “Discrete Simulation of Colored
Noise and Stochastic Processes and 1/ f
a Power Law
Noise generation,” Proc. IEEE ,v ol. 83, pp. 800–827
(1995 May).
[70] TMS32010 User’s Guide, Doc.SPRU001B, Texas
Instruments, Digital Signal Processor Products Division,
Stafford, TX (1985).
[71] ADSP-2100 Family User’s Manual ,3 rd ed.,
Analog Devices, Computer Products Division, Norwood,
J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March 145

<!-- p.32 -->

DATTORRO PAPERS
MA (1995).
[72] J. G. Proakis, Digital Communications , 2nd ed.
(McGraw-Hill, New York, 1989).
[73] ADSP-2100 Family Applications Handbook ,3 r d
ed., vol. 1, Analog Devices, Digital Signal Processing
Division, Norwood, MA (1989).
[74] S. Kim and W. Sung, “A Floating-Point to Fixed-
Point Assembly Program Translator for the TMS
320C25,” IEEE Trans. Circuits Sys. II ,v ol. 41, pp.
730–739 (1994 Nov.).
146 J. Audio Eng. Soc., Vol. 50, No. 3, 2002 March
THE AUTHOR
Jon Dattorro is from Providence, RI. He trained as a
classical pianist, attended the New England Conservatory
of Music where he studied composition and electronic
music, and performed as soloist with Myron Romanul and
the Boston Symphony Orchestra for Children’s Concerts
at Symphony Hall. His scores include a ballet and a piano
concerto.
Mr. Dattorro received a B.S.E.E. with highest distinc-
tion from the University of Rhode Island in 1981, where
he was a student of Leland B. Jackson. In 1984 he
received an M.S.E.E. from Purdue University, specializ-
ing in digital signal processing under S. C. Bass. He is
currently working towards a Ph.D. in electrical engineer-
ing at Stanford University.
He designed the Lexicon Inc. model 2400 Time
Compressor with Charles Bagnaschi and Francis F. Lee in
1986, and he designed most of the audio effects from
Ensoniq Corp. between 1987 and 1995. He shares two
patents in digital signal processing chip design with David
C. Andreas, J. William Mauchly, and Albert J.
Charpentier. Personal mentors are Salvatore J. Fransosi,
Pozzi Escot, and Chae T. Goh.
