/** Hand-written practice questions per (book, chapter index), used to seed realistic graded attempts. */
export type DemoQuestion =
  | { type: 'mcq'; prompt: string; options: [string, string, string, string]; correct: number; marks: 1 }
  | { type: 'short'; prompt: string; modelAnswer: string; rubric: string[]; marks: 2 };

export const QUESTIONS: Record<string, DemoQuestion[]> = {
  'maths8:0': [
    { type: 'mcq', prompt: 'Which of these numbers has no reciprocal?', options: ['1', '0', '-1', '1/2'], correct: 1, marks: 1 },
    { type: 'mcq', prompt: 'What is the additive inverse of -5/7?', options: ['5/7', '-7/5', '7/5', '0'], correct: 0, marks: 1 },
    { type: 'mcq', prompt: 'Which property says a + b = b + a?', options: ['Associative', 'Distributive', 'Commutative', 'Closure'], correct: 2, marks: 1 },
    { type: 'mcq', prompt: 'The rational numbers are NOT closed under which operation?', options: ['Addition', 'Subtraction', 'Multiplication', 'Division'], correct: 3, marks: 1 },
    {
      type: 'short', prompt: 'Find a rational number between 1/4 and 1/2 and show your working.',
      modelAnswer: 'The mean of the two numbers lies between them: (1/4 + 1/2) / 2 = (3/4) / 2 = 3/8.',
      rubric: ['Uses the mean (a + b)/2', 'Adds the fractions with a common denominator', 'States 3/8 as the answer'], marks: 2,
    },
  ],
  'maths8:1': [
    { type: 'mcq', prompt: 'Solve 3x + 5 = 20.', options: ['x = 3', 'x = 5', 'x = 8', 'x = 15'], correct: 1, marks: 1 },
    { type: 'mcq', prompt: 'Solve 5x - 3 = 2x + 9.', options: ['x = 2', 'x = 3', 'x = 4', 'x = 6'], correct: 2, marks: 1 },
    { type: 'mcq', prompt: 'The sum of two consecutive numbers is 47. What is the smaller number?', options: ['22', '23', '24', '25'], correct: 1, marks: 1 },
    { type: 'mcq', prompt: 'What may you do to both sides of an equation without changing its solution?', options: ['Add different numbers', 'Divide by zero', 'Multiply by the same non-zero number', 'Square only one side'], correct: 2, marks: 1 },
    {
      type: 'short', prompt: 'Solve 2x + 1 = 15 and verify your answer.',
      modelAnswer: 'Subtract 1: 2x = 14, so x = 7. Check: 2(7) + 1 = 15, which is true.',
      rubric: ['Isolates the term with x', 'Gets x = 7', 'Substitutes back to verify'], marks: 2,
    },
  ],
  'maths8:3': [
    { type: 'mcq', prompt: 'Which of these numbers can be a perfect square?', options: ['1522', '2023', '1024', '3027'], correct: 2, marks: 1 },
    { type: 'mcq', prompt: 'The sum of the first 5 odd numbers is', options: ['10', '20', '25', '30'], correct: 2, marks: 1 },
    { type: 'mcq', prompt: 'What is the square root of 144?', options: ['11', '12', '14', '72'], correct: 1, marks: 1 },
    {
      type: 'short', prompt: 'Use prime factorisation to find the square root of 144.',
      modelAnswer: '144 = 2 x 2 x 2 x 2 x 3 x 3. Taking one factor from each pair gives 2 x 2 x 3 = 12.',
      rubric: ['Writes the prime factorisation', 'Pairs the factors', 'Gets 12'], marks: 2,
    },
  ],
  'science8:0': [
    { type: 'mcq', prompt: 'Which of these is a Rabi crop?', options: ['Paddy', 'Maize', 'Wheat', 'Cotton'], correct: 2, marks: 1 },
    { type: 'mcq', prompt: 'Why do farmers practise crop rotation?', options: ['To waste less water', 'To restore soil nutrients naturally', 'To kill all weeds', 'To make harvesting faster'], correct: 1, marks: 1 },
    { type: 'mcq', prompt: 'Which process separates grain from chaff?', options: ['Ploughing', 'Irrigation', 'Winnowing', 'Sowing'], correct: 2, marks: 1 },
    {
      type: 'short', prompt: 'Why is the soil loosened by ploughing before sowing?',
      modelAnswer: 'Loose soil lets roots breathe and penetrate easily, helps earthworms and microbes grow, and brings nutrient-rich soil to the top.',
      rubric: ['Roots can breathe or grow easily', 'Earthworms and microbes benefit', 'Nutrient-rich soil comes to the top'], marks: 2,
    },
  ],
  'science8:1': [
    { type: 'mcq', prompt: 'Which microorganism makes bread dough rise?', options: ['Lactobacillus', 'Yeast', 'Amoeba', 'Penicillium'], correct: 1, marks: 1 },
    { type: 'mcq', prompt: 'Malaria is caused by a', options: ['Bacterium', 'Virus', 'Protozoan', 'Fungus'], correct: 2, marks: 1 },
    { type: 'mcq', prompt: 'Which bacterium helps turn milk into curd?', options: ['Rhizobium', 'Lactobacillus', 'Vibrio', 'Salmonella'], correct: 1, marks: 1 },
    {
      type: 'short', prompt: 'Name two methods of preserving food and give one example of each.',
      modelAnswer: 'Salting, for example in fish or pickles, and using sugar, for example in jams. Heating and cooling or vinegar are also valid.',
      rubric: ['Names a valid method', 'Names a second valid method', 'Gives a correct example for each'], marks: 2,
    },
  ],
  'science8:2': [
    { type: 'mcq', prompt: 'What is the SI unit of pressure?', options: ['Newton', 'Pascal', 'Joule', 'Watt'], correct: 1, marks: 1 },
    { type: 'mcq', prompt: 'A sharp knife cuts better than a blunt one because it has', options: ['A smaller area, so more pressure', 'A larger area, so more pressure', 'More mass', 'Less friction'], correct: 0, marks: 1 },
    { type: 'mcq', prompt: 'Which of these is a non-contact force?', options: ['Friction', 'Muscular force', 'Gravitational force', 'Push'], correct: 2, marks: 1 },
    {
      type: 'short', prompt: 'Why are dam walls built thicker at the bottom?',
      modelAnswer: 'The pressure of a liquid increases with depth, so the wall must be stronger near the bottom.',
      rubric: ['States that pressure increases with depth', 'Links it to wall strength or thickness'], marks: 2,
    },
  ],
  'maths9:0': [
    { type: 'mcq', prompt: 'Which of these is an irrational number?', options: ['0.375', 'The square root of 2', '1/3', '0.5'], correct: 1, marks: 1 },
    { type: 'mcq', prompt: 'What is a to the power m times a to the power n?', options: ['a to the power mn', 'a to the power (m + n)', 'a to the power (m - n)', '2a to the power mn'], correct: 1, marks: 1 },
    {
      type: 'short', prompt: 'Rationalise the denominator of 1 divided by the square root of 2.',
      modelAnswer: 'Multiply the numerator and denominator by the square root of 2 to get the square root of 2 divided by 2.',
      rubric: ['Multiplies top and bottom by root 2', 'Gets root 2 over 2'], marks: 2,
    },
  ],
};
