# Trust, measured

## The problem

We are handing AI agents the ability to act on the web: click, buy, send, delete.
An agent that acts needs to know when it has misunderstood, and today it does not.

The reason is specific. A language model's confidence is a number it generates,
the same way it generates any other token. It is not a measurement. RLHF is
documented to make it worse. So agents act decisively when they should hesitate,
and the cost lands on the actions you cannot undo.

The industry response has been to add a confirmation dialog to everything, which
users click through, or to add nothing at all.

## What we built

A voice-driven browser where **every decision carries a probability, the system
refuses to act when that probability is too low, and we measure whether the
probabilities are telling the truth.**

Three parts:

1. **Decide.** One Jev request per spoken command asks several independent
   questions in parallel over the page: what kind of action is this, which of the
   300-plus candidates did they mean, what are the exact words to search for, is
   the goal already met. Every answer comes back as a distribution over options,
   with an explicit NONE.

2. **Abstain.** Code, not the model, decides what a probability means. Above the
   bar it acts. In the middle band it asks. Below the floor it refuses and says
   nothing matched confidently.

3. **Measure.** This is the part nobody else has. Every decision is logged with
   the probability the model assigned. Ground truth then arrives **for free from
   normal use**: when the system asks and you pick a candidate, your pick is the
   truth. When it acts alone, you mark it right or wrong in one click. From those
   pairs we build the reliability curve live: when this model says 0.7, how often
   is it actually right?

So the thresholds are not taken from a vendor's marketing. They are set from our
own measured curve, and the curve is on screen while we demo.

## Why this could not be built two weeks ago

Be precise, because the obvious objection is that voice browsing is thirty years
old and probabilistic classifiers are older.

Both true. Neither is the point.

- A **trained classifier** has a fixed label set. You cannot train one for "which
  of these 347 links on this page", because the classes do not exist until the
  page loads.
- An **LLM** can take options at inference time, but it is too slow and too
  expensive to ask about everything, and its confidence is not calibrated, so a
  threshold on it means nothing.

What changed is a model class that takes the option set at call time, returns a
real distribution, and costs little enough to ask about everything, continuously.
That is what makes a measured decision boundary possible rather than decorative.

## The numbers

Measured live during the demo, not quoted:

- Median speed multiple against a frontier LLM on the identical question
- Median cost multiple on the identical question
- How often the two models agreed
- Measured accuracy, ECE and Brier score on decisions with ground truth
- The reliability curve, bucket by bucket

## What it cannot do

- The calibration curve needs samples. Below about eight resolved decisions it
  says so instead of showing a number, because a curve drawn from three points is
  a lie.
- Ground truth from the confirm tier is biased toward lower-confidence decisions,
  which is why executed runs can be rated too.
- It is one vendor's hosted model, US-hosted, with no self-host path today. For a
  production system that is a real dependency and we would say so.
- Voice input is the browser's Web Speech API, so Chrome or Edge only.
