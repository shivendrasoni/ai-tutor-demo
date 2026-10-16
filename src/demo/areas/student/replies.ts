import { CURRICULUM, chapterId, getChapter, type Band, type SubjectKey } from './curriculum';
import { citationFor, type Citation } from './engine';

/** Scripted tutor: picks a reply by keyword, shaped by the student's age band and the chosen skill. No LLM involved. */
type Variants = { junior: string; older: string };
type Topic = {
  key: string;
  re: RegExp;
  refs: Partial<Record<Band, [SubjectKey, number]>>;
  explain: Variants;
  socratic: Variants;
  follow: string[];
};

const TOPICS: Topic[] = [
  {
    key: 'fractions', re: /fraction|numerator|denominator|pizza|\bhalf\b|quarter/, refs: { junior: ['sub-math', 0] },
    explain: {
      junior: 'A fraction shows **equal parts of a whole**. 🍕 If a pizza is cut into 4 equal slices and you eat 1, you ate **1/4** of it. The bottom number (4) is how many equal slices there are, and the top number (1) is how many you took.',
      older: 'A fraction names part of a whole: the **numerator** counts the parts you have and the **denominator** says how many equal parts the whole is split into. With the same denominator you add the numerators and keep the denominator, so 1/4 + 2/4 = 3/4.',
    },
    socratic: {
      junior: "Great question! 🍕 Let's think about a pizza together. If we cut it into **4 equal slices** and you eat **1 slice**, what do you think we should call the part you ate? Take a guess, there is no wrong answer!",
      older: "Let's build this from a picture. Imagine a chocolate bar with 8 equal pieces and you eat 3. How would you write what you ate as a fraction, and what does each of the two numbers tell us? Try it, then we'll check together.",
    },
    follow: [
      'Nice thinking! Yes, the **bottom number** counts all the equal parts and the **top number** counts the parts you have. Now try this: if you eat 2 more slices out of the same 8, what fraction have you eaten in total?',
      'Exactly. When the pieces are the same size, we just add the tops. What would you do if one fraction had 4 as its bottom number and another had 8? Tell me what you would try first.',
    ],
  },
  {
    key: 'photosynthesis', re: /photosynth|chlorophyll|plants?\b.*(food|sun|need|make)|\bleaf\b|leaves|sunlight/, refs: { junior: ['sub-sci', 0], middle: ['sub-sci', 0], senior: ['sub-sci', 3] },
    explain: {
      junior: 'Plants are like tiny kitchens! 🌱 Their green leaves catch **sunlight**, drink **water** from the roots and take in **air**, and mix them to make food. This is called **photosynthesis**, and the plant gives out oxygen for us to breathe.',
      older: 'Photosynthesis is how green plants make food. **Chlorophyll** in the leaves traps sunlight, and the plant combines **carbon dioxide + water** to make **glucose + oxygen**. Stomata on the leaf let the gases move in and out.',
    },
    socratic: {
      junior: 'Ooh, plants are amazing! 🌱 Here is a puzzle: animals eat food to get energy, but a plant cannot walk to a shop. Where do you think a plant gets its food from? Think about what a plant needs to grow well.',
      older: 'Good topic. A plant has no mouth, yet it grows. Think about what a leaf takes in from its surroundings: what are the raw materials, and what energy source does it use? Give me your best guess before we put it together.',
    },
    follow: [
      "Yes, that's right! Sunlight gives the energy, and the plant needs water and carbon dioxide as raw materials. So what do you think is made, and what is released as a by-product?",
      'Well done. Now connect it: which part of the leaf traps the sunlight, and what colour does that make the leaf? Why would a leaf kept in the dark turn pale?',
    ],
  },
  {
    key: 'water', re: /water cycle|evaporat|condens|\brain\b|cloud/, refs: { junior: ['sub-sci', 1] },
    explain: {
      junior: 'The **water cycle** is water going on a trip! ☁️ The sun warms the sea and puddles, and the water turns into vapour (**evaporation**). High up it cools and makes clouds (**condensation**), then falls down as rain, and the trip starts again.',
      older: 'The water cycle has three main steps: **evaporation** (the sun turns water into vapour), **condensation** (vapour cools into clouds) and **precipitation** (water falls as rain, hail or snow). Rivers then carry it back to the sea.',
    },
    socratic: {
      junior: 'What a fun thing to wonder about! ☁️ Imagine a wet T-shirt drying in the sun. Where does the water go? Tell me what you think happens to it, and then we will follow it up to the clouds.',
      older: "Let's trace one drop of water. It starts in the sea and the sun warms it. What happens to it, and what must happen to the vapour as it rises into colder air? Walk me through the steps you know.",
    },
    follow: [
      'Right, the water became vapour and rose up. Now, what happens to vapour when it meets colder air high above? Think about the drops on the outside of a cold glass.',
      'Exactly: that is **condensation**. Many tiny droplets together make a cloud. What do you think makes the droplets fall down as rain?',
    ],
  },
  {
    key: 'force', re: /newton|\bforce\b|gravity|motion|accelerat|inertia|momentum/, refs: { middle: ['sub-sci', 3], senior: ['sub-sci', 0] },
    explain: {
      junior: 'A **force** is a push or a pull. 🚀 A kick makes a football move, and **gravity** is the pull that brings it back down to the ground. Heavier things need a bigger push to move.',
      older: "Newton's laws: (1) a body stays at rest or in uniform motion unless a net force acts, (2) **F = ma**, so the same force gives a smaller acceleration to a larger mass, and (3) every action has an equal and opposite reaction. Gravity is the force that gives falling bodies g ≈ 9.8 m/s².",
    },
    socratic: {
      junior: "Let's play detective! 🚀 When you push a heavy school bag and a light pencil case with the same push, which one moves faster? Why do you think that happens?",
      older: 'Start with an experiment you can picture: you push an empty shopping trolley and then a full one with the same force. Which accelerates more, and what does that suggest about how force, mass and acceleration are related? Write down what you expect before we formalise it.',
    },
    follow: [
      'Good observation. So the same push gives a **bigger acceleration to a smaller mass**. If you doubled the force on the same trolley, what would you expect to happen to the acceleration?',
      "That's it: acceleration is proportional to force and inversely proportional to mass. Can you now put that into one short formula and use it for a 2 kg object pushed with 6 N?",
    ],
  },
  {
    key: 'quadratic', re: /quadratic|discriminant|\broots?\b|x\^2|x²|factori[sz]e/, refs: { senior: ['sub-math', 0], middle: ['sub-math', 1] },
    explain: {
      junior: 'That is a big-kid topic, but here is the idea: some number puzzles have **two answers**. 🧩 We will learn more about them in higher classes!',
      older: 'For ax² + bx + c = 0, the roots are **x = (−b ± √(b² − 4ac)) / 2a**. The **discriminant** D = b² − 4ac tells you the nature of the roots: D > 0 gives two real roots, D = 0 gives equal roots and D < 0 gives no real roots. Example: x² − 5x + 6 has D = 25 − 24 = 1, so the roots are (5 ± 1)/2 = 3 and 2.',
    },
    socratic: {
      junior: "That's a puzzle for bigger classes, but let's try a taste! 🧩 I'm thinking of two numbers that multiply to 6 and add to 5. Can you find them?",
      older: "Let's try to factorise x² − 5x + 6 = 0 before using any formula. Which two numbers multiply to give +6 and add to give −5? Once you have them, what must x be for each bracket to become zero? Tell me where you get stuck.",
    },
    follow: [
      'Good, so the numbers are −2 and −3 and the factors are (x − 2)(x − 3). Each bracket can be zero, so what are the two roots? Then check: what is b² − 4ac for this equation, and what does that value tell you?',
      'Nice work. The discriminant is 1, which is positive, so two different real roots. If I changed c from 6 to 9, what would the discriminant become and what would that say about the roots?',
    ],
  },
  {
    key: 'equation', re: /equation|algebra|solve|variable|unknown|\bx\b/, refs: { middle: ['sub-math', 1], senior: ['sub-math', 0] },
    explain: {
      junior: 'An equation is like a **balance scale** ⚖️. Whatever you do to one side, you must do to the other. If x + 3 = 8, take 3 away from both sides and you find x = 5.',
      older: 'To solve a linear equation, keep it balanced: do the **same operation on both sides**. For 2x − 3 = 9, add 3 to both sides to get 2x = 12, then divide both sides by 2 to get **x = 6**. Check by substituting back: 2(6) − 3 = 9.',
    },
    socratic: {
      junior: 'Think of a balance scale ⚖️ with a mystery bag x and 3 blocks on one side, and 8 blocks on the other, and it is perfectly level. What could you take off both sides to find out what the bag weighs?',
      older: "Let's treat the equation like a balance. Look at your equation and ask: what is being done to x, in what order? What would undo the last operation, and what must you do to the other side to keep it balanced? Try the first step and tell me what you get.",
    },
    follow: [
      'Good first step! Now you have fewer things on the left. What is the next operation you need to undo, and what does the equation look like after you do it?',
      'You have found a value for x. The final habit of a good mathematician: substitute it back into the original equation. Does the left side equal the right side?',
    ],
  },
  {
    key: 'grammar', re: /tense|\bnouns?\b|pronoun|\bverbs?\b|adjective|adverb|passive|active voice|grammar|clause|sentence/, refs: { junior: ['sub-eng', 1], middle: ['sub-eng', 1], senior: ['sub-eng', 3] },
    explain: {
      junior: 'Nouns name things (**cat**, **Mumbai**), verbs tell what someone does (**jump**), and adjectives describe (**tall**). ✏️ Tense tells *when*: she **plays** (now), she **played** (before), she **will play** (later).',
      older: 'Tense and voice shape meaning. In the **active** voice the doer comes first ("Rahul wrote the letter"); in the **passive** the receiver comes first ("The letter was written by Rahul") using *to be* + past participle. A clause needs a subject and a verb; a phrase does not.',
    },
    socratic: {
      junior: 'Let\'s be word detectives! ✏️ Look at this sentence: "The little dog runs fast." Which word is the *doing* word, and which word tells us what the dog is *like*? Tell me what you find.',
      older: 'Try this one yourself first: take "The committee approved the plan." Who does the action and who receives it? Now, can you rewrite the sentence so that the receiver comes first, and tell me which verb form you had to use?',
    },
    follow: [
      "You're getting it! The doing word is the verb. Now change that sentence so it happened *yesterday*. What happens to the verb?",
      "Good. Let's test it with a new sentence. Write one of your own and tell me which part of speech each word is. I'll check it with you.",
    ],
  },
  {
    key: 'mughal', re: /mughal|babur|akbar|panipat|shah jahan|taj mahal|history/, refs: { middle: ['sub-soc', 0], senior: ['sub-soc', 0] },
    explain: {
      junior: 'Long ago, kings called the **Mughals** ruled much of India. 🏰 Babur started it in 1526, and Shah Jahan built the beautiful **Taj Mahal** in Agra.',
      older: 'The Mughal Empire began when **Babur** defeated Ibrahim Lodi at the First Battle of Panipat (1526). **Akbar** (1556–1605) strengthened it with the mansabdari system and a policy of tolerance, and **Shah Jahan** is remembered for the Taj Mahal. The empire weakened after Aurangzeb.',
    },
    socratic: {
      junior: 'Time travel! 🏰 Imagine you are in India in the year 1526. A king named Babur has just arrived. Why do you think a king would want to rule a new land? What would he need to do first?',
      older: "Let's reason like a historian. In 1526 Babur defeated Ibrahim Lodi at Panipat. What do you think made it hard to hold an empire after winning a single battle, and what would Akbar later need to build in order to keep it together? Give me one idea about each.",
    },
    follow: [
      'Good thinking. A ruler needs an army, but also officers, taxes and the support of local people. Which of these do you think Akbar was best known for improving?',
      'Right: Akbar organised the **mansabdari system** and land revenue. Why would a fair tax system make an empire more stable than only using force?',
    ],
  },
  {
    key: 'democracy', re: /democra|\bvote\b|voting|election|constitution|panchayat|sarpanch|fundamental rights/, refs: { junior: ['sub-soc', 1], middle: ['sub-soc', 2], senior: ['sub-soc', 0] },
    explain: {
      junior: 'In a village, people choose a leader called the **Sarpanch** by voting. 🗳️ Everyone gets one vote, and the leader looks after things like roads, wells and the school.',
      older: 'In a democracy, people choose their rulers by voting, and **universal adult franchise** gives every adult citizen one equal vote. The Constitution guarantees Fundamental Rights, and the courts can enforce them. Elections let citizens hold leaders accountable.',
    },
    socratic: {
      junior: "Let's pretend our class is choosing a class monitor! 🗳️ How could we decide fairly so that everybody has a say? What would be a fair way to count?",
      older: 'Suppose a country decided that only landowners could vote. Who would be left out, and how might that change the laws they make? Based on your answer, why do you think equal voting rights matter in a democracy?',
    },
    follow: [
      'Yes, fairness means every person gets the same number of votes. In real elections, why do you think the vote is secret?',
      'Good point. Now link it to our Constitution: which Fundamental Right would let a citizen go to court if their right was denied? Take a guess.',
    ],
  },
  {
    key: 'area', re: /\barea\b|perimeter|rectangle|circle|triangle|square units/, refs: { junior: ['sub-math', 2], middle: ['sub-math', 3], senior: ['sub-math', 1] },
    explain: {
      junior: '**Perimeter** is the distance around a shape, like walking along a fence. 🚶 **Area** is the space inside, like the grass in the garden. A rectangle 5 cm by 3 cm has perimeter 2 × (5 + 3) = **16 cm** and area 5 × 3 = **15 cm²**.',
      older: 'Perimeter is the boundary length and area is the surface covered. Rectangle: P = 2(l + b) and A = l × b. Triangle: A = ½ × b × h. Circle: C = 2πr and A = πr². Area is measured in **square units** because we count unit squares.',
    },
    socratic: {
      junior: 'Imagine a rectangle garden that is 5 steps long and 3 steps wide. 🌳 If you walk all the way around the edge, how many steps would you take? And how could we count the squares of grass inside?',
      older: 'Take an 8 m by 5 m rectangular floor. Which measurement would you need to buy a fence for, and which one to buy tiles for? Try finding both and tell me how you decided.',
    },
    follow: [
      'Nice! Walking around the edge gives the **perimeter**. Now, for the squares inside, can you think of a quicker way than counting them one by one?',
      'Exactly: rows × columns. What would happen to the area if you doubled both the length and the breadth? Predict before you calculate!',
    ],
  },
  {
    key: 'cell', re: /\bcells?\b|mitochondri|nucleus|organelle|ribosome/, refs: { senior: ['sub-sci', 3], middle: ['sub-sci', 0] },
    explain: {
      junior: 'Every living thing is made of tiny building blocks called **cells**. 🔬 They are so small that we need a microscope to see them.',
      older: 'The **cell** is the basic unit of life. The nucleus holds the DNA, **mitochondria** release energy from food, ribosomes make proteins, and plant cells also have a rigid cell wall and chloroplasts.',
    },
    socratic: {
      junior: 'Let us think of a cell as a tiny city! 🔬 A city has a town hall, power stations and walls. If a cell had a boss that gives instructions, what do you think that part is called?',
      older: 'Think of the cell as a factory. If the nucleus is the office with the blueprints, which organelle would be the power plant, and which would be the assembly line for proteins? Match them up and tell me your reasoning.',
    },
    follow: [
      'Good match. The nucleus stores the instructions (DNA). Now, why would a muscle cell have far more mitochondria than a skin cell?',
      'Yes: more energy demand needs more power plants. How is a plant cell different from an animal cell in terms of support and food-making?',
    ],
  },
];

const EXPLAIN_DEFAULT: Variants = {
  junior: "I'd love to help with that! 🌟 Tell me the chapter or the page from your book, and I'll explain it step by step in a simple way.",
  older: 'Happy to help. To explain it well, I need a little more context: which chapter or page is this from, and what part is unclear? Share the question and I will walk through it step by step.',
};
const SOCRATIC_DEFAULT: Variants = {
  junior: "That's an interesting thing to wonder about! 🌟 Before I explain anything, tell me: what do you already know about it? Even one small idea helps us start.",
  older: 'Good question. Before we dive in, tell me what you already know about this and where exactly you get stuck. Share what you have tried and I will guide you from there.',
};

export type ConvState = { topic?: string; stage?: number; quiz?: { options: string[]; correct: number; model: string } | null };
export type Reply = { text: string; citations: Citation[]; state: ConvState };

const refCitations = (t: Topic, band: Band): Citation[] => {
  const useBand = (t.refs[band] ? band : Object.keys(t.refs)[0]) as Band;
  const ref = t.refs[useBand];
  if (!ref) return [];
  const ch = getChapter(chapterId(useBand, ref[0], ref[1]));
  return ch ? [citationFor(ch, 0)] : [];
};

const letterOf = (t: string): number => {
  const m = /^\(?([a-d])\)?(?:[.)\s]|$)/i.exec(t.trim());
  return m ? m[1]!.toLowerCase().charCodeAt(0) - 97 : -1;
};

const SUBJECTS: SubjectKey[] = ['sub-math', 'sub-sci', 'sub-eng', 'sub-soc'];

export function scriptedReply(input: { text: string; band: Band; skillKey: string; subjectId: string | null; prev: ConvState; userTurns: number }): Reply {
  const { band, skillKey, prev } = input;
  const text = input.text.trim();
  const low = text.toLowerCase();
  const v = (x: Variants) => (band === 'junior' ? x.junior : x.older);
  const socratic = skillKey !== 'explain';

  // Answering a quick-quiz question the tutor just asked.
  if (prev.quiz) {
    const idx = letterOf(low) >= 0 ? letterOf(low) : prev.quiz.options.findIndex((o) => low.includes(o.toLowerCase()));
    const right = idx === prev.quiz.correct;
    const lead = right ? (band === 'junior' ? 'Yes, that is right! 🎉 ' : 'Correct! ') : idx >= 0 ? (band === 'junior' ? 'Almost! 💪 ' : 'Not quite. ') : '';
    const verdict = right ? 'Well done.' : `The answer is **${String.fromCharCode(65 + prev.quiz.correct)}) ${prev.quiz.options[prev.quiz.correct]}**.`;
    return {
      text: `${lead}${verdict} ${prev.quiz.model}\n\nWant another one? Just say "quiz me" again, or ask about something else.`,
      citations: [],
      state: { ...prev, quiz: null },
    };
  }

  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(low)) {
    return {
      text: v({ junior: "Hi there! 👋 I'm Tutu. What would you like to learn about today? You can ask me about maths, science, English or social studies.", older: "Hello! I'm Tutu, your study buddy. What are you working on today? Tell me the subject and the topic and we'll start from there." }),
      citations: [], state: prev,
    };
  }
  if (/thank|thx|got it|understood/.test(low)) {
    return {
      text: v({ junior: "You're so welcome! 🌟 You worked hard. Do you want to try one more question, or learn something new?", older: "You're welcome! A good next step is to try a practice question on this topic without looking at the notes. Want me to give you one?" }),
      citations: [], state: prev,
    };
  }
  if (/quiz me|test me|\bquiz\b/.test(low)) {
    const subj = (input.subjectId as SubjectKey | null) ?? SUBJECTS[input.userTurns % 4]!;
    const chs = CURRICULUM[band][subj];
    const chIdx = input.userTurns % chs.length;
    const ch = chs[chIdx]!;
    const q = ch.mcq[input.userTurns % ch.mcq.length]!;
    const opts = q[1].map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('\n\n');
    const body = `${band === 'junior' ? 'Quick quiz time! 🎯' : 'Quick check.'} From *${ch.title}*:\n\n**${q[0]}**\n\n${opts}\n\nReply with A, B, C or D.`;
    const ref = getChapter(chapterId(band, subj, chIdx));
    return {
      text: body,
      citations: ref ? [citationFor(ref, 0)] : [],
      state: { quiz: { options: [...q[1]], correct: q[2], model: `This comes from **${ch.title}**: ${ch.sum}` } },
    };
  }
  if (/summar|revis/.test(low)) {
    const ch = CURRICULUM[band]['sub-sci'][0]!;
    const ref = getChapter(chapterId(band, 'sub-sci', 0))!;
    return {
      text: `Here is a quick revision card for **${ch.title}**:\n\n${ch.pts.map((p) => `- ${p}`).join('\n')}\n\nTry explaining each point in your own words. Which one feels the shakiest?`,
      citations: [citationFor(ref, 1)], state: prev,
    };
  }

  const topic = TOPICS.find((t) => t.re.test(low));
  if (topic) {
    return { text: socratic ? v(topic.socratic) : v(topic.explain), citations: refCitations(topic, band), state: { topic: topic.key, stage: 1 } };
  }
  if (/homework|assignment/.test(low)) {
    return {
      text: v({ junior: "I'm happy to help with homework! 📚 I won't just give the answer, we will work it out together. What is the question? Type it here.", older: "Sure. I won't hand over the answer, but I'll help you work it out. Type the question exactly as it appears in your homework and tell me what you have tried so far." }),
      citations: [], state: prev,
    };
  }
  const cur = TOPICS.find((t) => t.key === prev.topic);
  if (cur) {
    const stage = prev.stage ?? 1;
    const stuck = /don'?t know|no idea|not sure|stuck|confus|hint|help/.test(low);
    const line = stuck
      ? v({ junior: "That's okay! 😊 Let's make it smaller. ", older: "That's fine, let's break it into smaller steps. " }) + (socratic ? v(cur.socratic) : v(cur.explain))
      : cur.follow[Math.min(stage - 1, cur.follow.length - 1)]!;
    return { text: line, citations: refCitations(cur, band), state: { topic: cur.key, stage: stuck ? stage : stage + 1 } };
  }
  return { text: v(socratic ? SOCRATIC_DEFAULT : EXPLAIN_DEFAULT), citations: [], state: prev };
}
