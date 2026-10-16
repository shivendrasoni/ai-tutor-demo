/** Hand-written curriculum for the demo: chapters, notes material and a small question bank per chapter. */
export type Band = 'junior' | 'middle' | 'senior';
export type SubjectKey = 'sub-math' | 'sub-sci' | 'sub-eng' | 'sub-soc';

type Mcq = [prompt: string, options: [string, string, string, string], correct: number];
/** [prompt, model answer, keywords looked for (case-insensitive substrings), how many must appear for full marks] */
type Short = [prompt: string, model: string, keywords: string[], need: number];

export type ChapterDef = { title: string; sum: string; pts: string[]; mcq: Mcq[]; short: Short };

const C = (title: string, sum: string, pts: string[], mcq: Mcq[], short: Short): ChapterDef => ({ title, sum, pts, mcq, short });

export const BOOKS: Record<Band, Record<SubjectKey, string>> = {
  junior: { 'sub-math': 'Math Magic 5', 'sub-sci': 'Looking Around 5', 'sub-eng': 'English Reader 5', 'sub-soc': 'Our World Around Us 5' },
  middle: { 'sub-math': 'Mathematics 7', 'sub-sci': 'Science 7', 'sub-eng': 'English Honeydew 7', 'sub-soc': 'Our Pasts and Our World 7' },
  senior: { 'sub-math': 'Mathematics Part I (Class 11)', 'sub-sci': 'Physics, Chemistry and Biology (Class 11)', 'sub-eng': 'Hornbill and Writing Skills 11', 'sub-soc': 'Contemporary India (Class 11)' },
};

export const CURRICULUM: Record<Band, Record<SubjectKey, ChapterDef[]>> = {
  junior: {
    'sub-math': [
      C('Fractions: Parts of a Whole', 'A fraction describes equal parts of a whole, such as a pizza cut into slices.',
        ['The bottom number (denominator) says how many equal parts the whole has.', 'The top number (numerator) says how many parts we are talking about.', 'Fractions with the same denominator are added by adding the numerators.'],
        [['Which fraction is the same as one half?', ['1/4', '2/4', '3/4', '1/3'], 1], ['What is 1/4 + 2/4?', ['3/8', '3/4', '2/4', '1/2'], 1]],
        ['Explain what the bottom number of a fraction tells you.', 'The denominator tells how many equal parts the whole is divided into.', ['equal', 'parts', 'whole'], 2]),
      C('Shapes and Angles', 'Angles measure how much a line turns, and shapes are named by their sides and angles.',
        ['A right angle is 90 degrees, like the corner of a book.', 'A triangle with three equal sides is equilateral.', 'A straight line makes an angle of 180 degrees.'],
        [['How many degrees are there in a right angle?', ['45', '90', '180', '360'], 1], ['A triangle with all three sides equal is called?', ['Scalene', 'Isosceles', 'Equilateral', 'Right-angled'], 2]],
        ['Name two things in your classroom that have right angles.', 'The corner of a book and the corner of a desk or door are right angles.', ['corner', 'book', 'door', 'desk', 'board', 'window'], 1]),
      C('Area and Perimeter', 'Perimeter is the distance around a shape and area is the space inside it.',
        ['Perimeter of a rectangle = 2 × (length + breadth).', 'Area of a rectangle = length × breadth.', 'Area is measured in square units such as cm².'],
        [['A rectangle is 5 cm long and 3 cm wide. What is its area?', ['8 cm²', '15 cm²', '16 cm²', '30 cm²'], 1], ['What is the perimeter of a square with side 4 cm?', ['8 cm', '12 cm', '16 cm', '4 cm'], 2]],
        ['How is area different from perimeter?', 'Perimeter is the distance around a shape; area is the space inside it.', ['around', 'inside', 'space', 'boundary', 'edge', 'surface'], 2]),
      C('Multiplication and Patterns', 'Multiplication is repeated addition, and number patterns follow a rule.',
        ['6 × 4 means six added four times, or four groups of six.', 'Doubling patterns multiply by 2 each time: 3, 6, 12, 24.', 'Knowing one table fact helps you find the next one.'],
        [['What is 8 × 7?', ['54', '56', '63', '48'], 1], ['What comes next: 3, 6, 12, 24, ?', ['30', '36', '48', '27'], 2]],
        ['How can 6 × 4 help you find 6 × 5?', 'Add one more group of 6 to 6 × 4 (24) to get 30.', ['add', 'one more', 'group', '30'], 2]),
    ],
    'sub-sci': [
      C('How Plants Make Food', 'Green plants make their own food in their leaves using sunlight, water and air.',
        ['Roots take in water and minerals from the soil.', 'Leaves use sunlight to make food; this is called photosynthesis.', 'Plants give out oxygen that we breathe.'],
        [['Which part of the plant absorbs water from the soil?', ['Leaf', 'Stem', 'Root', 'Flower'], 2], ['Plants make food in their?', ['Roots', 'Leaves', 'Seeds', 'Petals'], 1]],
        ['Why do plants need sunlight?', 'Leaves use sunlight, water and air to make food.', ['food', 'sunlight', 'leaves', 'energy'], 2]),
      C('The Water Cycle', 'Water keeps moving between the sea, the air and the land.',
        ['The sun heats water and it evaporates into vapour.', 'Vapour cools and condenses to form clouds.', 'Water falls back as rain, hail or snow.'],
        [['What do we call water turning into vapour when heated?', ['Condensation', 'Evaporation', 'Freezing', 'Melting'], 1], ['Clouds form when water vapour...', ['cools and condenses', 'boils', 'freezes into ice cubes', 'turns into soil'], 0]],
        ['Describe how rain forms.', 'The sun heats water, it evaporates and rises, cools into clouds and falls as rain.', ['evaporat', 'cloud', 'cool', 'condens', 'rise', 'sun'], 3]),
      C('Our Skeleton and Muscles', 'Bones and muscles work together to hold up our body and let us move.',
        ['An adult has 206 bones.', 'The skull protects the brain and the rib cage protects the heart.', 'Muscles pull on bones to make us move.'],
        [['How many bones does an adult human have?', ['106', '206', '306', '156'], 1], ['Which bone protects the brain?', ['Skull', 'Rib', 'Thigh bone', 'Spine'], 0]],
        ['Why do we need a skeleton?', 'It gives the body shape, protects organs like the heart and brain, and helps us move with muscles.', ['shape', 'protect', 'support', 'move'], 2]),
      C('Solids, Liquids and Gases', 'Matter exists as solid, liquid or gas, depending on how its tiny particles are arranged.',
        ['A solid has its own shape and size.', 'A liquid flows and takes the shape of its container.', 'A gas spreads out to fill any space.'],
        [['Which one is a gas?', ['Ice', 'Steam', 'Juice', 'Stone'], 1], ['When ice melts it changes into a...', ['gas', 'solid', 'liquid', 'powder'], 2]],
        ['How is a liquid different from a solid?', 'A solid keeps its own shape; a liquid takes the shape of its container.', ['shape', 'container', 'flow'], 2]),
    ],
    'sub-eng': [
      C('Nouns and Pronouns', 'Nouns name people, places and things; pronouns take the place of nouns.',
        ['A proper noun names a particular person or place and starts with a capital letter.', 'Pronouns like he, she, it and they avoid repeating a noun.', 'A common noun names any one of a kind, like city or girl.'],
        [['Which word is a proper noun?', ['city', 'Mumbai', 'river', 'school'], 1], ['"She" is a...', ['noun', 'verb', 'pronoun', 'adjective'], 2]],
        ['Write a sentence using a pronoun in place of "Riya".', 'Riya went to the park. She played on the swing.', ['she', 'her'], 1]),
      C('Verbs and Simple Tenses', 'Verbs tell us what someone does, and tenses tell us when.',
        ['Present tense: she sings. Past tense: she sang. Future tense: she will sing.', 'Many verbs change form in the past: run becomes ran.', 'Regular verbs add -ed in the past: jump becomes jumped.'],
        [['What is the past tense of "run"?', ['runned', 'ran', 'running', 'runs'], 1], ['Choose the sentence in the present tense.', ['She sang.', 'She sings.', 'She will sing.', 'She had sung.'], 1]],
        ['Change to past tense: "I eat an apple."', 'I ate an apple.', ['ate'], 1]),
      C('Adjectives: Describing Words', 'Adjectives describe nouns and make our writing colourful.',
        ['An adjective answers: what kind? how many? which one?', 'Opposites such as brave and cowardly are called antonyms.', 'Adjectives come before the noun: a tall tree.'],
        [['Which word describes the noun in "the tall tree"?', ['the', 'tall', 'tree', 'none of these'], 1], ['What is the opposite of "brave"?', ['bold', 'cowardly', 'strong', 'kind'], 1]],
        ['Write two adjectives to describe your school bag.', 'My school bag is big and blue.', [], 0]),
      C('Reading a Story: The Little Fisherman', 'Stories have characters, a setting, a problem and a lesson.',
        ['The main character is the protagonist.', 'The setting is the place and time of the story.', 'The moral is the lesson a story teaches.'],
        [['The main character of a story is also called the...', ['villain', 'protagonist', 'narrator', 'setting'], 1], ['The place and time of a story is its...', ['plot', 'setting', 'moral', 'title'], 1]],
        ['What is the moral of a story?', 'The moral is the lesson the story teaches.', ['lesson', 'teach', 'learn'], 1]),
    ],
    'sub-soc': [
      C('India: Land and Rivers', 'India has mountains, plains, plateaus, deserts and many great rivers.',
        ['The Himalayas lie in the north of India.', 'The Ganga is the most important river of the northern plains.', 'River plains have fertile soil, so farming is easy there.'],
        [['Which great river flows through the northern plains of India?', ['Yamuna', 'Ganga', 'Godavari', 'Narmada'], 1], ['In which direction of India are the Himalayas?', ['South', 'West', 'North', 'East'], 2]],
        ['Why are river plains good for farming?', 'Rivers deposit fertile soil and give water for crops.', ['fertile', 'soil', 'water', 'crops'], 2]),
      C('How the Village Runs: The Panchayat', 'A gram panchayat is the local government of a village.',
        ['The head of a gram panchayat is the Sarpanch.', 'Villagers elect the panchayat members.', 'The panchayat looks after roads, wells, schools and cleanliness.'],
        [['Who leads a gram panchayat?', ['Sarpanch', 'Collector', 'Mayor', 'Governor'], 0], ['Who is the head of the elected government of India?', ['President', 'Prime Minister', 'Sarpanch', 'Chief Justice'], 1]],
        ['Name one job of the panchayat.', 'It looks after village roads, water supply and schools.', ['road', 'water', 'school', 'clean', 'light'], 1]),
      C('Maps and Directions', 'Maps show places from above using symbols, a scale and directions.',
        ['The four main directions are north, south, east and west.', 'A scale shows how map distance matches real distance.', 'A compass rose shows directions on a map.'],
        [['Which direction is opposite to north?', ['East', 'West', 'South', 'North-east'], 2], ['What does a map scale show?', ['Height', 'Real distance', 'Weather', 'Population'], 1]],
        ['Why does a map have a compass rose?', 'To show directions: north, south, east and west.', ['direction', 'north'], 1]),
      C('Festivals and Unity in Diversity', 'People in India celebrate many festivals, and each one adds to our shared culture.',
        ['Diwali is the festival of lights.', 'Eid-ul-Fitr comes at the end of Ramadan.', 'Respecting each other\'s festivals keeps us united.'],
        [['Diwali is the festival of...', ['colours', 'lights', 'kites', 'boats'], 1], ['Eid-ul-Fitr is celebrated at the end of...', ['Ramadan', 'Lent', 'Navratri', 'Onam'], 0]],
        ['How can we respect friends who celebrate different festivals?', 'Greet them, learn about their festival and join in kindly.', ['respect', 'learn', 'greet', 'join', 'share'], 2]),
    ],
  },
  middle: {
    'sub-math': [
      C('Integers', 'Integers include positive numbers, negative numbers and zero.',
        ['On a number line, adding a positive moves right and adding a negative moves left.', 'A negative times a negative gives a positive.', 'A negative times a positive gives a negative.'],
        [['(−7) + 4 = ?', ['−11', '−3', '3', '11'], 1], ['(−3) × (−5) = ?', ['−15', '15', '−8', '8'], 1]],
        ['Why is a negative times a negative positive?', 'Multiplying by a negative reverses direction; doing it twice returns to positive.', ['reverse', 'twice', 'opposite', 'positive'], 2]),
      C('Simple Equations', 'An equation says two expressions are equal, and solving it means finding the unknown value.',
        ['Do the same thing to both sides to keep the equation balanced.', 'To undo addition, subtract; to undo multiplication, divide.', 'Always check your answer by putting it back in the equation.'],
        [['Solve: x + 7 = 15', ['6', '8', '22', '9'], 1], ['Solve: 3x = 21', ['7', '18', '63', '24'], 0]],
        ['Solve 2x − 3 = 9 and show your steps.', 'Add 3 to both sides: 2x = 12. Divide by 2: x = 6.', ['12', '6'], 2]),
      C('Triangles and Their Properties', 'Triangles are classified by sides and angles, and their angles always add up to 180°.',
        ['The three angles of a triangle add up to 180°.', 'An exterior angle equals the sum of the two opposite interior angles.', 'In a right triangle, a² + b² = c² (Pythagoras).'],
        [['What is the sum of the angles in a triangle?', ['90°', '180°', '270°', '360°'], 1], ['A triangle with sides 3, 4 and 5 is...', ['equilateral', 'right-angled', 'isosceles', 'obtuse'], 1]],
        ['Two angles of a triangle are 50° and 60°. Find the third.', '180 − (50 + 60) = 70°.', ['70'], 1]),
      C('Perimeter and Area', 'Perimeter measures the boundary; area measures the surface a shape covers.',
        ['Area of a rectangle = l × b; area of a triangle = ½ × b × h.', 'Circumference of a circle = 2πr.', 'Area of a circle = πr².'],
        [['What is the area of a rectangle 8 m by 5 m?', ['13 m²', '26 m²', '40 m²', '80 m²'], 2], ['Circumference of a circle with radius 7 cm (π = 22/7)?', ['22 cm', '44 cm', '154 cm', '49 cm'], 1]],
        ['Why is area measured in square units?', 'Because it counts how many unit squares cover the surface.', ['square', 'cover', 'surface', 'unit'], 2]),
    ],
    'sub-sci': [
      C('Nutrition in Plants', 'Green plants make food by photosynthesis; other living things depend on them.',
        ['Chlorophyll is the green pigment that traps sunlight.', 'Carbon dioxide + water → glucose + oxygen, in sunlight.', 'Stomata on leaves let gases in and out.'],
        [['The green pigment in leaves is...', ['melanin', 'chlorophyll', 'haemoglobin', 'keratin'], 1], ['Which gas do plants release during photosynthesis?', ['Carbon dioxide', 'Nitrogen', 'Oxygen', 'Hydrogen'], 2]],
        ['Write the word equation for photosynthesis.', 'Carbon dioxide + water, in sunlight and chlorophyll, gives glucose + oxygen.', ['carbon dioxide', 'water', 'glucose', 'oxygen', 'sunlight'], 3]),
      C('Heat and Temperature', 'Heat is energy that flows from hot objects to cold ones; temperature tells how hot something is.',
        ['Conduction passes heat through solids, convection through fluids and radiation through empty space.', 'Metals are good conductors; wood and plastic are insulators.', 'A clinical thermometer reads body temperature.'],
        [['Heat travels through solids mainly by...', ['conduction', 'convection', 'radiation', 'evaporation'], 0], ['Which of these is a good conductor of heat?', ['Wood', 'Plastic', 'Copper', 'Rubber'], 2]],
        ['Why are cooking pans made of metal but their handles of plastic?', 'Metal conducts heat well to cook food, while plastic is an insulator so the handle stays cool.', ['conduct', 'insulat', 'heat', 'metal'], 2]),
      C('Acids, Bases and Salts', 'Acids taste sour, bases feel soapy, and indicators help us tell them apart.',
        ['Blue litmus turns red in acids; red litmus turns blue in bases.', 'Lemon juice and vinegar are acids; baking soda and soap are bases.', 'An acid and a base neutralise each other to make a salt and water.'],
        [['Blue litmus paper turns red in...', ['a base', 'an acid', 'water', 'salt'], 1], ['Which of these is a base?', ['Lemon juice', 'Vinegar', 'Baking soda', 'Curd'], 2]],
        ['What happens when an acid and a base are mixed?', 'They neutralise each other and form a salt and water.', ['neutral', 'salt', 'water'], 2]),
      C('Motion and Time', 'Speed tells how fast something moves: distance covered per unit time.',
        ['Speed = distance ÷ time.', 'In uniform motion, equal distances are covered in equal times.', 'A distance-time graph of uniform motion is a straight line.'],
        [['Speed equals...', ['distance × time', 'distance ÷ time', 'time ÷ distance', 'distance + time'], 1], ['A car travels 120 km in 2 hours. What is its speed?', ['240 km/h', '60 km/h', '122 km/h', '118 km/h'], 1]],
        ['What is the difference between uniform and non-uniform motion?', 'In uniform motion equal distances are covered in equal times; in non-uniform motion they are not.', ['equal', 'same', 'different', 'time'], 2]),
    ],
    'sub-eng': [
      C('Parts of Speech Revisited', 'Every word plays a role: noun, verb, adjective, adverb, conjunction and more.',
        ['Adverbs tell how, when or where an action happens.', 'Conjunctions such as because, but and and join ideas.', 'The same word can be different parts of speech in different sentences.'],
        [['In "She quickly ran", the word "quickly" is a...', ['adjective', 'adverb', 'verb', 'noun'], 1], ['Which of these is a conjunction?', ['because', 'table', 'happy', 'run'], 0]],
        ['Write a sentence with an adverb.', 'He spoke softly.', [], 0]),
      C('Active and Passive Voice', 'In the active voice the doer acts; in the passive voice the receiver of the action comes first.',
        ['Passive voice uses a form of "to be" plus the past participle.', 'The doer can be shown with "by" or left out.', 'Active voice is usually clearer and more direct.'],
        [['Passive form of "The cat chased the mouse."', ['The mouse chased the cat.', 'The mouse was chased by the cat.', 'The mouse is chased by the cat.', 'The cat was chased by the mouse.'], 1], ['Active form of "The cake was baked by Meena."', ['Meena baked the cake.', 'Meena bakes the cake.', 'Meena has baked the cake.', 'The cake baked Meena.'], 0]],
        ['Convert to the passive voice: "Rahul wrote the letter."', 'The letter was written by Rahul.', ['was written', 'by rahul'], 2]),
      C('Understanding Poems', 'Poets use sound, comparison and imagery to make us feel something.',
        ['A simile compares using "like" or "as".', 'Personification gives human actions to non-living things.', 'A poem is divided into stanzas.'],
        [['Comparing two things using "like" or "as" is a...', ['metaphor', 'simile', 'personification', 'rhyme'], 1], ['"The wind whispered" is an example of...', ['simile', 'personification', 'alliteration', 'idiom'], 1]],
        ['What is a stanza?', 'A stanza is a group of lines in a poem, like a paragraph in prose.', ['group', 'lines', 'paragraph'], 2]),
      C('Writing a Formal Letter', 'A formal letter follows a fixed layout and uses a polite, brief tone.',
        ['Begin with the sender\'s address, the date and the receiver\'s address.', 'Use "Respected Sir/Madam" and end with "Yours faithfully" when the name is unknown.', 'State the purpose clearly in the first paragraph.'],
        [['A formal letter to a principal should begin with...', ['Dear friend', 'Respected Sir/Madam', 'Hey', 'Hi sir'], 1], ['"Yours faithfully" is used when...', ['you know the name', 'you do not know the name', 'writing to friends', 'sending a text'], 1]],
        ['Why should a formal letter be brief and polite?', 'It is clear, respectful and more likely to get a response.', ['clear', 'respect', 'polite', 'response'], 2]),
    ],
    'sub-soc': [
      C('The Mughal Empire', 'The Mughals ruled much of India from 1526 and shaped its art, architecture and administration.',
        ['Babur founded the empire after winning the First Battle of Panipat in 1526.', 'Akbar built a strong administration with the mansabdari system.', 'Shah Jahan built the Taj Mahal.'],
        [['Who founded the Mughal Empire in 1526?', ['Akbar', 'Babur', 'Humayun', 'Shah Jahan'], 1], ['Which Mughal emperor built the Taj Mahal?', ['Akbar', 'Jahangir', 'Shah Jahan', 'Aurangzeb'], 2]],
        ['Why was the First Battle of Panipat (1526) important?', 'Babur defeated Ibrahim Lodi, ending the Delhi Sultanate and beginning Mughal rule.', ['babur', 'lodi', 'mughal'], 2]),
      C('Climate and the Monsoon', 'The monsoon winds bring most of India\'s yearly rainfall.',
        ['Monsoon winds blow from the south-west in summer.', 'The Western Ghats force moist winds upward, causing heavy rain.', 'Farmers depend on monsoon rain for most crops.'],
        [['Summer monsoon winds blow to India from the...', ['north-east', 'south-west', 'north-west', 'south-east'], 1], ['The Western Ghats get heavy rain because...', ['they are flat', 'moist winds are forced up the slopes', 'they are near a desert', 'they have no trees'], 1]],
        ['Why is the monsoon important for Indian farmers?', 'Most crops depend on monsoon rain for water, so it affects harvests and incomes.', ['crop', 'rain', 'water', 'farm'], 2]),
      C('Democracy and Equality', 'In a democracy people choose their leaders and every citizen has an equal vote.',
        ['Universal adult franchise gives every adult citizen the right to vote.', 'Equality means no one is treated unfairly because of caste, religion or gender.', 'Elections let people hold leaders accountable.'],
        [['In a democracy the rulers are chosen by...', ['the army', 'the people through voting', 'the richest', 'birth'], 1], ['Universal adult franchise means...', ['only men can vote', 'all adult citizens can vote', 'only educated people vote', 'voting starts at 25'], 1]],
        ['Why is it important that every vote counts equally?', 'Every citizen is equal, so each voice has the same weight in choosing the government.', ['equal', 'citizen', 'voice', 'weight'], 2]),
      C('Markets Around Us', 'Goods reach us through weekly markets, shops and online platforms.',
        ['Weekly markets set up on a fixed day and have many sellers.', 'Wholesale means selling in bulk; retail means selling to the final buyer.', 'Competition between sellers often lowers prices.'],
        [['A weekly market is one where...', ['shops are permanent', 'traders set up on a fixed day each week', 'only online orders are taken', 'only wholesale happens'], 1], ['Selling goods in large quantities to shopkeepers is called...', ['retail', 'wholesale', 'barter', 'auction'], 1]],
        ['Why are goods often cheaper in a weekly market?', 'Sellers pay less rent and compete with each other, so prices stay low.', ['rent', 'compet', 'cost', 'bulk', 'cheap'], 2]),
    ],
  },
  senior: {
    'sub-math': [
      C('Quadratic Equations', 'A quadratic equation ax² + bx + c = 0 has two roots, found by factorising or by the formula.',
        ['Roots = (−b ± √(b² − 4ac)) / 2a.', 'The discriminant D = b² − 4ac decides the nature of the roots.', 'D > 0: two real roots; D = 0: equal roots; D < 0: no real roots.'],
        [['What is the discriminant of x² − 5x + 6 = 0?', ['1', '25', '−1', '49'], 0], ['What are the roots of x² − 5x + 6 = 0?', ['2 and 3', '1 and 6', '−2 and −3', '2 and −3'], 0]],
        ['What does a negative discriminant tell you about the roots?', 'There are no real roots; the roots are complex conjugates.', ['no real', 'complex'], 1]),
      C('Trigonometric Functions', 'Trigonometric ratios link angles to ratios of sides, and satisfy several identities.',
        ['sin²θ + cos²θ = 1 for every angle θ.', 'tanθ = sinθ / cosθ.', 'sin 30° = 1/2 and cos 60° = 1/2.'],
        [['sin²θ + cos²θ = ?', ['0', '1', '2', 'tan θ'], 1], ['What is sin 30°?', ['√3/2', '1/2', '1', '0'], 1]],
        ['Show why 1 + tan²θ = sec²θ.', 'Divide sin²θ + cos²θ = 1 throughout by cos²θ.', ['divide', 'cos'], 2]),
      C('Sequences and Series', 'An arithmetic progression has a constant difference between consecutive terms.',
        ['nth term of an AP: aₙ = a + (n − 1)d.', 'Sum of first n terms: Sₙ = n/2 × (2a + (n − 1)d).', 'Sum of the first n natural numbers is n(n + 1)/2.'],
        [['The sum of the first n natural numbers is...', ['n(n + 1)/2', 'n²', 'n(n − 1)/2', '2n'], 0], ['The nth term of an AP is...', ['a + nd', 'a + (n − 1)d', 'a·dⁿ', 'a + (n + 1)d'], 1]],
        ['Find the 10th term of the AP 2, 5, 8, ...', 'a = 2 and d = 3, so the 10th term is 2 + 9 × 3 = 29.', ['29'], 1]),
      C('Limits and Derivatives', 'A derivative measures how fast a function changes at a point.',
        ['The derivative of xⁿ is n·xⁿ⁻¹.', 'The limit of sin x / x as x approaches 0 is 1.', 'Geometrically, the derivative is the slope of the tangent.'],
        [['d/dx (x³) = ?', ['x²', '3x²', '3x', 'x⁴/4'], 1], ['The limit of sin x / x as x approaches 0 is...', ['0', '1', '∞', 'undefined'], 1]],
        ['What does the derivative represent geometrically?', 'It is the slope of the tangent to the curve at that point.', ['slope', 'tangent'], 1]),
    ],
    'sub-sci': [
      C('Laws of Motion', 'Newton\'s laws connect force, mass and acceleration.',
        ['First law: a body stays at rest or in uniform motion unless a net force acts.', 'Second law: F = ma (net force = rate of change of momentum).', 'Third law: every action has an equal and opposite reaction.'],
        [['The SI unit of force is the...', ['joule', 'newton', 'watt', 'pascal'], 1], ['A 2 kg body accelerates at 3 m/s². What is the net force?', ['1.5 N', '5 N', '6 N', '0.67 N'], 2]],
        ['State Newton\'s second law of motion.', 'The net force on a body equals the rate of change of its momentum; F = ma for constant mass.', ['force', 'mass', 'acceleration', 'momentum'], 2]),
      C('Work, Energy and Power', 'Work transfers energy; power is the rate of doing work.',
        ['Work = F d cosθ.', 'Kinetic energy = ½mv².', 'Power = work ÷ time, measured in watts.'],
        [['Work done by a force is...', ['F d cosθ', 'F ÷ d', 'm g', 'F t'], 0], ['The kinetic energy of a 2 kg body moving at 3 m/s is...', ['6 J', '9 J', '18 J', '3 J'], 1]],
        ['State the work-energy theorem.', 'The work done by the net force equals the change in kinetic energy.', ['work', 'kinetic', 'change'], 2]),
      C('Structure of the Atom', 'Atoms have a dense nucleus of protons and neutrons, with electrons in shells around it.',
        ['The atomic number is the number of protons.', 'Isotopes have the same atomic number but different mass numbers.', 'The n-th shell holds at most 2n² electrons.'],
        [['The number of protons in an atom is its...', ['mass number', 'atomic number', 'neutron number', 'valency'], 1], ['What is the maximum number of electrons in the n = 2 shell?', ['2', '8', '18', '32'], 1]],
        ['Why do isotopes of an element have the same chemical properties?', 'They have the same number of protons and electrons, and chemistry depends on the electronic configuration.', ['electron', 'same', 'proton'], 2]),
      C('Cell: Structure and Function', 'The cell is the basic unit of life, with organelles that each do a job.',
        ['Mitochondria release energy from food.', 'Ribosomes make proteins.', 'Plant cells have a rigid cell wall that animal cells lack.'],
        [['Which organelle is called the powerhouse of the cell?', ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi body'], 1], ['Protein synthesis takes place at the...', ['ribosomes', 'lysosomes', 'vacuole', 'centriole'], 0]],
        ['Why do plant cells have a cell wall?', 'It gives rigid support, protection and a fixed shape to the cell.', ['support', 'shape', 'protect', 'rigid'], 2]),
    ],
    'sub-eng': [
      C('Reading Comprehension and Inference', 'Good readers infer meaning from clues and judge the writer\'s tone.',
        ['An inference is a conclusion drawn from clues in the text.', 'Tone is the writer\'s attitude to the subject.', 'Facts can be verified; opinions express judgements.'],
        [['Inference means...', ['stating a fact from the text', 'reaching a conclusion from clues', 'copying a line', 'summarising'], 1], ['An author\'s tone is...', ['the length of the text', 'the attitude towards the subject', 'the plot', 'the rhyme'], 1]],
        ['How would you tell a fact from an opinion in a passage?', 'Facts can be verified with evidence; opinions express beliefs or judgements, often with words like best or should.', ['verif', 'belief', 'judg', 'evidence', 'prove'], 2]),
      C('Essay and Argumentative Writing', 'A strong essay has a clear thesis, supporting paragraphs and a considered conclusion.',
        ['The thesis statement is your central claim.', 'Each paragraph starts with a topic sentence and gives evidence.', 'A counter-argument shows you have weighed the other side.'],
        [['A thesis statement is...', ['the last sentence', 'the main claim of the essay', 'a quotation', 'the title'], 1], ['The purpose of a counter-argument is to...', ['fill space', 'acknowledge an opposing view and rebut it', 'change the topic', 'conclude'], 1]],
        ['What makes a strong topic sentence?', 'It states the single main idea of the paragraph and links back to the thesis.', ['main idea', 'thesis', 'paragraph'], 2]),
      C('Literary Devices', 'Writers use figurative language to add depth and emotion.',
        ['A metaphor says one thing is another: life is a journey.', 'Irony says or shows the opposite of what is expected.', 'Symbolism uses an object to stand for an idea.'],
        [['"Life is a journey" is a...', ['simile', 'metaphor', 'hyperbole', 'irony'], 1], ['Saying the opposite of what you mean, to mock, is...', ['sarcasm', 'simile', 'oxymoron', 'allusion'], 0]],
        ['Explain symbolism with an example.', 'An object or image stands for an idea, for example a dove for peace.', ['stand', 'represent', 'idea', 'dove', 'peace'], 2]),
      C('Grammar: Agreement and Clauses', 'Verbs must agree with their subjects, and clauses build complex sentences.',
        ['"Neither of the boys is ready": neither takes a singular verb.', 'A clause has a subject and a verb; a phrase does not.', 'A subordinate clause cannot stand alone.'],
        [['Choose the correct verb: "Neither of the boys ___ ready."', ['are', 'is', 'were', 'have been'], 1], ['Which is a subordinate clause?', ['She left', 'because it rained', 'The sun set', 'Open the door'], 1]],
        ['What is the difference between a phrase and a clause?', 'A clause has a subject and a verb; a phrase does not.', ['subject', 'verb'], 2]),
    ],
    'sub-soc': [
      C('The Indian Constitution', 'The Constitution is the supreme law that sets up the government and protects citizens\' rights.',
        ['It was adopted on 26 November 1949 and came into force on 26 January 1950.', 'Dr B. R. Ambedkar chaired the Drafting Committee.', 'Fundamental Rights can be enforced by approaching the courts.'],
        [['The Constitution of India came into force on...', ['15 August 1947', '26 November 1949', '26 January 1950', '2 October 1950'], 2], ['Who chaired the Drafting Committee?', ['Jawaharlal Nehru', 'B. R. Ambedkar', 'Vallabhbhai Patel', 'Rajendra Prasad'], 1]],
        ['What are Fundamental Rights and why are they enforceable?', 'They are basic freedoms guaranteed to citizens, and courts can enforce them against the State.', ['court', 'citizen', 'enforce', 'freedom'], 2]),
      C('Federalism', 'Power is shared between the Union and the States.',
        ['The Seventh Schedule has the Union, State and Concurrent Lists.', 'Parliament makes laws on Union List subjects.', 'India has a federal structure with a strong centre.'],
        [['Laws on subjects in the Union List are made by...', ['State legislatures', 'Parliament', 'Panchayats', 'Courts'], 1], ['The Seventh Schedule contains the...', ['Fundamental Rights', 'three legislative lists', 'languages of India', 'oaths of office'], 1]],
        ['Why is India often called quasi-federal?', 'It has a federal structure but a strong centre, with a single constitution and emergency powers.', ['centre', 'strong', 'state', 'unitary'], 2]),
      C('Economic Planning and Liberalisation', 'India moved from planned development to market-led reform in 1991.',
        ['Five Year Plans were drawn up by the Planning Commission.', 'The 1991 reforms were liberalisation, privatisation and globalisation.', 'Reforms cut licensing and opened the economy to trade.'],
        [['India\'s LPG economic reforms began in...', ['1951', '1971', '1991', '2001'], 2], ['Five Year Plans were prepared by the...', ['Planning Commission', 'RBI', 'SEBI', 'Supreme Court'], 0]],
        ['Name two features of the 1991 economic reforms.', 'Liberalisation (less licensing), privatisation and globalisation.', ['liberal', 'privati', 'global'], 2]),
      C('Climate and Sustainable Development', 'Development must meet today\'s needs without harming future generations.',
        ['Carbon dioxide is the main greenhouse gas from burning fossil fuels.', 'Renewable energy such as solar and wind reduces emissions.', 'Sustainable development balances growth, people and the planet.'],
        [['Which greenhouse gas is most responsible for global warming?', ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Argon'], 1], ['Sustainable development means meeting present needs without...', ['harming the ability of future generations to meet theirs', 'spending less', 'stopping all industry', 'building fewer schools'], 0]],
        ['Give two ways India can lower its carbon emissions.', 'Expand solar and wind power, improve public transport, plant forests and use energy efficiently.', ['solar', 'wind', 'transport', 'forest', 'renewable', 'efficien'], 2]),
    ],
  },
};

export const SUBJECT_KEYS: SubjectKey[] = ['sub-math', 'sub-sci', 'sub-eng', 'sub-soc'];

export const chapterId = (band: Band, subject: SubjectKey, idx: number) => `ch-${band}-${subject.replace('sub-', '')}-${idx + 1}`;

export type ChapterRef = { id: string; band: Band; subject: SubjectKey; idx: number; def: ChapterDef; book: string; pageStart: number };

const BY_ID = new Map<string, ChapterRef>();
for (const band of ['junior', 'middle', 'senior'] as Band[]) {
  for (const subject of SUBJECT_KEYS) {
    CURRICULUM[band][subject].forEach((def, idx) => {
      const id = chapterId(band, subject, idx);
      BY_ID.set(id, { id, band, subject, idx, def, book: BOOKS[band][subject], pageStart: 12 + idx * 26 });
    });
  }
}
export const getChapter = (id: string) => BY_ID.get(id);

export const chaptersFor = (band: Band, subject: SubjectKey): ChapterRef[] =>
  CURRICULUM[band][subject].map((_, i) => BY_ID.get(chapterId(band, subject, i))!);

export type ExamPattern = { key: string; name: string; durationMinutes: number; gradeMin: number; gradeMax: number; mcq: number; short: number };
export const PATTERNS: ExamPattern[] = [
  { key: 'unit_test_30', name: 'Unit test · 30 minutes', durationMinutes: 30, gradeMin: 1, gradeMax: 6, mcq: 6, short: 2 },
  { key: 'half_yearly_45', name: 'Half-yearly style · 45 minutes', durationMinutes: 45, gradeMin: 5, gradeMax: 9, mcq: 8, short: 3 },
  { key: 'board_style_60', name: 'Board style · 60 minutes', durationMinutes: 60, gradeMin: 8, gradeMax: 12, mcq: 8, short: 4 },
];
