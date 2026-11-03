export const TEMPLATE = `---
title: Chest pain in a 62-year-old man
intro: "You are a medical student in the emergency department. Mr Peter Walsh, 62, has presented with chest pain. Take a focused history."
question: "What is your most likely diagnosis, and what are two differentials you would want to exclude?"
answer: |
  Most likely: acute coronary syndrome (unstable angina / NSTEMI).
  Differentials: aortic dissection, pulmonary embolism, pericarditis, GORD.
---

## Introduction
- Name: Peter Walsh, 62, retired electrician.
- Opening line: "I've had this horrible pain in my chest this morning."
- Sitting forward slightly, rubbing sternum, anxious but cooperative.

## Presenting complaint
Central chest pain for 2 hours.

## History of presenting complaint
- Site: centre of chest, "behind the breastbone".
- Onset: came on at 7 am while carrying the bins up the driveway.
- Character: "heavy, like someone sitting on me".
- Radiation: **only if asked** - into the left arm and jaw.
- Associations: sweaty and a bit sick in the stomach.
- Timing: constant since onset, eased a little with rest but not gone.
- Exacerbating / relieving: worse walking, no change with position or breathing.
- Severity: 7/10.
- If asked about previous episodes: "I've had tightness walking up hills for a month or so, but it always went away after a few minutes."

## Systems review
- If asked about shortness of breath: "A bit, yes."
- If asked about palpitations, cough, fever, leg swelling, recent travel: no.
- If asked about indigestion: "No, this isn't like heartburn."

## PMHx
- Type 2 diabetes for 10 years.
- High blood pressure.
- High cholesterol - "I was meant to start a tablet but never did."
- No previous heart attacks or stents.

## Medications
- Metformin 1 g twice daily.
- Perindopril 5 mg daily.
- No over-the-counter medications.

## Allergies
- Penicillin - rash as a child.

## FHx
- Father died of a heart attack at 58.
- Mother alive, 85, has dementia.

## SHx
- Lives with wife in a single-storey house; independent.
- Smoking: 30 pack-years, **quit 5 years ago** (only if asked).
- Alcohol: 2-3 beers most nights.
- No recreational drugs.
- Retired; plays lawn bowls weekly.

## ICE
- Ideas: "I'm worried it's my heart - Dad went the same way."
- Concerns: wife at home doesn't know he's here.
- Expectations: "I just want to know what's going on."

## Role-player notes
- Become more anxious if the candidate is rushed or uses jargon.
- Ask "Am I having a heart attack?" at about 5 minutes if not addressed.
`;

export const PROMPT = `Write a mock OSCE history-taking case for a medical student, as a single Markdown file and nothing else.

Case: [presenting complaint, setting, patient age/sex, intended diagnosis, difficulty]

Format rules (the file is parsed by a timer app, so follow them exactly):
1. Start with YAML front matter between two lines of three dashes (---). Required keys:
   - intro: one or two sentences the candidate reads before entering (setting, patient name/age, task, e.g. "Take a focused history.")
   - question: the single question the examiner asks in the final minute.
   Optional keys: title (short case name), answer (model answer; use "answer: |" then indented lines for multiple lines).
   Wrap single-line values in double quotes.
2. After the front matter, use level-2 headings (##) in this order, omitting none unless irrelevant:
   Introduction, Presenting complaint, History of presenting complaint, Systems review, PMHx, Medications, Allergies, FHx, SHx, ICE, Role-player notes.
   Add other ## headings only if the case needs them (e.g. Obstetric history, Sexual history, Developmental history).
3. Under each heading use short bullets written for the actor playing the patient:
   - Facts in plain lay language, first person where it is something the patient says (in quotes).
   - Information the patient only gives when specifically asked: "- If asked about <topic>: <answer>".
   - Mark key facts the patient must never volunteer in **bold** with "(only if asked)".
   - Include pertinent negatives the candidate is expected to ask about.
4. "Introduction" gives name, age, occupation, the patient's opening line, and demeanour.
5. "History of presenting complaint" covers SOCRATES (or the relevant framework) and timeline.
6. "Medications" includes doses. "SHx" covers living situation, function, smoking (pack-years), alcohol (standard drinks), drugs, occupation, and anything case-relevant.
7. "ICE" gives the patient's ideas, concerns and expectations.
8. "Role-player notes" gives cues, emotional reactions, and a question the patient asks if the candidate doesn't address something.
9. The history must be completable in 7 minutes by a competent student: one coherent diagnosis with 2-3 plausible differentials, realistic for an Australian hospital or general practice setting (Australian drug names and units).
10. Do not include headings or text outside this structure. Use - for bullets.`;
