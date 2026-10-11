/**
 * Original demo textbook text (not NCERT). Each chapter is a list of page texts; the first page of a chapter
 * starts with "Chapter N" + title so the ingest heading detector splits chapters. Every page is kept above the
 * 200-character OCR threshold so ingestion never needs an OCR model.
 */
export type DemoChapter = { title: string; pages: string[] };
export type DemoBook = {
  key: string;
  title: string;
  kind: 'book' | 'material';
  scope: 'school' | 'branch' | 'section';
  grade: number;
  subject: 'Mathematics' | 'Science';
  /** For branch/section scope. */
  branch?: 'Main Campus' | 'North Campus';
  section?: string;
  /** Heading word used on each chapter's first page. */
  heading: 'Chapter' | 'Lesson';
  chapters: DemoChapter[];
};

export const DEMO_BOOKS: DemoBook[] = [
  {
    key: 'maths8',
    title: 'Class 8 Mathematics',
    kind: 'book',
    scope: 'school',
    grade: 8,
    subject: 'Mathematics',
    heading: 'Chapter',
    chapters: [
      {
        title: 'Rational Numbers',
        pages: [
          `A rational number is a number that can be written in the form p/q, where p and q are integers and q is not zero. Examples are 3/4, -5/7, 6 (which is 6/1) and 0 (which is 0/1). Every integer is a rational number, and so is every fraction and every terminating or repeating decimal. The rational numbers are closed under addition, subtraction and multiplication: the sum, difference or product of two rational numbers is again a rational number. They are not closed under division, because division by zero is not defined. Addition and multiplication are commutative and associative. For example, 1/2 + 1/3 = 1/3 + 1/2 = 5/6. The number 0 is the additive identity because a + 0 = a for every rational number a, and 1 is the multiplicative identity because a x 1 = a.`,
          `Every non-zero rational number has an additive inverse and a multiplicative inverse. The additive inverse of p/q is -p/q, because p/q + (-p/q) = 0. The multiplicative inverse, also called the reciprocal, of p/q is q/p, because p/q x q/p = 1. Zero has no reciprocal. To compare two rational numbers, write them with the same positive denominator and compare the numerators. For example, to compare 2/3 and 3/4, rewrite them as 8/12 and 9/12, so 3/4 is greater. Between any two rational numbers there are infinitely many rational numbers. One of them is their mean: the rational number between a and b can be found as (a + b)/2. On the number line, positive rational numbers lie to the right of zero and negative rational numbers lie to the left.`,
        ],
      },
      {
        title: 'Linear Equations in One Variable',
        pages: [
          `A linear equation in one variable is an equation that can be written in the form ax + b = 0, where a and b are numbers and a is not zero. The highest power of the variable is one, and the equation has exactly one solution. To solve an equation we keep both sides balanced: whatever we do to one side we must do to the other. We can add or subtract the same number on both sides, and we can multiply or divide both sides by the same non-zero number. For example, to solve 3x + 5 = 20, subtract 5 from both sides to get 3x = 15, and then divide both sides by 3 to get x = 5. We check the answer by substituting x = 5 back into the original equation: 3(5) + 5 = 20, which is true.`,
          `Many equations have the variable on both sides. To solve 5x - 3 = 2x + 9, move the terms containing x to one side by subtracting 2x from both sides, which gives 3x - 3 = 9. Then add 3 to both sides to get 3x = 12, so x = 4. Linear equations are useful for word problems. Suppose the sum of two consecutive numbers is 47. Let the smaller number be x, so the larger is x + 1. Then x + (x + 1) = 47, so 2x + 1 = 47, 2x = 46 and x = 23. The numbers are 23 and 24. When an equation has fractions, multiply both sides by the least common multiple of the denominators to clear the fractions, and then solve as usual. Always read the question again to make sure the answer fits the situation described.`,
        ],
      },
      {
        title: 'Understanding Quadrilaterals',
        pages: [
          `A quadrilateral is a closed figure with four sides, four vertices and four angles. The sum of the interior angles of any quadrilateral is 360 degrees. This can be shown by drawing a diagonal, which splits the quadrilateral into two triangles, each with an angle sum of 180 degrees. A polygon is convex if every diagonal lies inside it, and concave if at least one diagonal lies outside. For any polygon with n sides, the sum of the interior angles is (n - 2) x 180 degrees. A regular polygon has all sides equal and all angles equal. The sum of the exterior angles of any convex polygon, taken one at each vertex, is always 360 degrees, whatever the number of sides.`,
          `A parallelogram is a quadrilateral whose opposite sides are parallel. In a parallelogram the opposite sides are equal, the opposite angles are equal, and the diagonals bisect each other. A rhombus is a parallelogram with all four sides equal, and its diagonals are perpendicular bisectors of each other. A rectangle is a parallelogram with four right angles, and its diagonals are equal. A square is both a rectangle and a rhombus, so it has all the properties of both: four equal sides, four right angles, and equal diagonals that bisect each other at right angles. A trapezium has exactly one pair of parallel sides. A kite has two pairs of adjacent sides that are equal, and its diagonals meet at right angles.`,
        ],
      },
      {
        title: 'Squares and Square Roots',
        pages: [
          `The square of a number is the number multiplied by itself. For example, the square of 7 is 7 x 7 = 49. Numbers like 1, 4, 9, 16, 25 and 36 are called perfect squares. A perfect square can only end in the digits 0, 1, 4, 5, 6 or 9, never in 2, 3, 7 or 8. If a number ends in an odd number of zeros it cannot be a perfect square. The square of an even number is even and the square of an odd number is odd. There is a useful pattern: the sum of the first n odd numbers is n squared. For example, 1 + 3 + 5 + 7 = 16, which is 4 squared. Also, the difference between the squares of two consecutive numbers n and n + 1 equals n + (n + 1).`,
          `The square root of a number is the number that, multiplied by itself, gives the original number. The square root of 49 is 7, written as the square root of 49 = 7. Finding a square root is the inverse of squaring. One way to find the square root of a perfect square is prime factorisation: group the prime factors into pairs and take one factor from each pair. For example, 144 = 2 x 2 x 2 x 2 x 3 x 3, so its square root is 2 x 2 x 3 = 12. For larger numbers we use the long division method, which finds the root digit by digit. The square root of a number that is not a perfect square, such as 2, is not a rational number; we can only estimate it, and 1.41 is a good approximation.`,
        ],
      },
    ],
  },
  {
    key: 'science8',
    title: 'Class 8 Science',
    kind: 'book',
    scope: 'school',
    grade: 8,
    subject: 'Science',
    heading: 'Chapter',
    chapters: [
      {
        title: 'Crop Production and Management',
        pages: [
          `Crops are plants of the same kind grown on a large scale for food, fibre or other uses. In India crops are grouped by season. Kharif crops are sown with the onset of the monsoon in June or July and harvested in September or October; paddy, maize, soyabean and cotton are examples. Rabi crops are sown in winter, in October or November, and harvested in March or April; wheat, gram, peas and mustard are examples. Farmers carry out agricultural practices in an order: preparing the soil, sowing, adding manure and fertilisers, irrigation, protecting crops from weeds, harvesting and storage. Preparing the soil by ploughing loosens it so that roots can breathe easily and earthworms and microbes can grow, and it brings nutrient-rich soil to the top.`,
          `Sowing is done with good-quality seeds, and seed drills ensure even spacing and depth. Manure is organic matter made from animal waste and plant residue, and it improves the texture and water-holding capacity of soil. Fertilisers such as urea, potash and NPK are chemicals rich in particular nutrients, but their excess use can pollute water and reduce soil fertility. Crop rotation, growing different crops in turn in the same field, restores soil nutrients naturally, and leguminous plants help because bacteria in their root nodules fix nitrogen. Irrigation supplies water at regular intervals through wells, canals, tube wells and tanks. Sprinkler and drip systems save water. Unwanted plants called weeds are removed by weeding or by weedicides. Cutting the mature crop is called harvesting, and winnowing separates grain from chaff.`,
        ],
      },
      {
        title: 'Microorganisms: Friend and Foe',
        pages: [
          `Microorganisms are living things too small to be seen without a microscope. They include bacteria, fungi, protozoa and some algae, and viruses, which are different because they multiply only inside a host cell. They live everywhere: in air, water, soil, and inside the bodies of plants and animals. Many microorganisms are useful. Yeast is a fungus used to make bread rise, because it respires and produces carbon dioxide gas that makes the dough puff up. Yeast is also used in making alcohol by fermentation of sugar. Lactobacillus bacteria turn milk into curd. Bacteria in the root nodules of pulses fix atmospheric nitrogen into the soil, and microorganisms help in cleaning the environment by decomposing dead plants and animals into manure.`,
          `Some microorganisms cause disease and are called pathogens. Diseases such as cholera, typhoid and tuberculosis are caused by bacteria, and malaria is caused by a protozoan carried by the female Anopheles mosquito. Dengue is caused by a virus spread by the Aedes mosquito. Disease-carrying organisms are called carriers. Food can be spoiled by microorganisms, which is why we preserve it. Common methods of preservation are chemical methods using salt or acids like vinegar, heating and cooling, and storage in sealed packets. Salting is used for meat, fish and pickles, and sugar for jams. Vaccines teach the body to make antibodies against a pathogen without making us ill; Edward Jenner developed the first vaccine, against smallpox. Antibiotics such as penicillin kill bacteria but must be taken only on a doctor's advice.`,
        ],
      },
      {
        title: 'Force and Pressure',
        pages: [
          `A force is a push or a pull. A force can make a stationary object move, change the speed or direction of a moving object, or change the shape of an object. Force has both magnitude and direction, and its unit is the newton. Forces can be contact forces or non-contact forces. Muscular force and friction act through contact. Magnetic force, electrostatic force and gravitational force act without contact. Friction is the force that opposes the relative motion between two surfaces in contact. It is larger for rough surfaces and smaller for smooth ones. When two forces act on an object in the same direction they add, and when they act in opposite directions the net force is their difference. Balanced forces do not change the motion of an object.`,
          `Pressure is the force acting on a unit area of a surface, so pressure equals force divided by area. The unit of pressure is the pascal, which is one newton per square metre. For the same force, a smaller area gives a larger pressure. That is why a sharp knife cuts better than a blunt one, and why a camel's wide feet do not sink into sand. Liquids and gases exert pressure on the walls of their container, and the pressure of a liquid increases with depth, which is why dams are built thicker at the bottom. Air also exerts pressure, called atmospheric pressure. We do not feel it because the pressure inside our body balances it. A vacuum cleaner and a drinking straw work because the pressure is lowered, and the higher outside air pressure pushes the material in.`,
        ],
      },
      {
        title: 'Light',
        pages: [
          `Light travels in a straight line, and we see an object when light from it enters our eyes. A surface that is smooth and polished, like a mirror, reflects most of the light falling on it. The laws of reflection state that the angle of incidence is equal to the angle of reflection, and that the incident ray, the reflected ray and the normal at the point of incidence all lie in the same plane. The image formed by a plane mirror is erect, of the same size as the object, and as far behind the mirror as the object is in front. It is laterally inverted, so the left of the object appears as the right of the image. This is why the word AMBULANCE is written reversed on the front of the vehicle.`,
          `Light can be split into its component colours. White light passing through a glass prism spreads into seven colours: violet, indigo, blue, green, yellow, orange and red. This band is called a spectrum, and the splitting is called dispersion. A rainbow is formed when sunlight is dispersed by tiny water droplets in the air. Newton's disc, with the seven colours painted on it, looks nearly white when it is spun quickly. The human eye works like a camera. Light enters through the cornea and the pupil, and the lens focuses it on the retina, where rod cells detect dim light and cone cells detect colour. Short sight and long sight are corrected by spectacles with suitable lenses. The Braille system helps visually impaired people to read by touch.`,
        ],
      },
    ],
  },
  {
    key: 'maths9',
    title: 'Class 9 Mathematics',
    kind: 'book',
    scope: 'school',
    grade: 9,
    subject: 'Mathematics',
    heading: 'Chapter',
    chapters: [
      {
        title: 'Number Systems',
        pages: [
          `The natural numbers are 1, 2, 3 and so on. Adding zero gives the whole numbers, and adding the negatives gives the integers. The rational numbers are all numbers of the form p/q with q not equal to zero. A number that cannot be written in this form is called an irrational number. The square root of 2, the square root of 3 and pi are irrational numbers: their decimal expansions never end and never repeat. Together the rational and irrational numbers make up the real numbers, and every real number corresponds to exactly one point on the number line. A rational number has a decimal expansion that either terminates, like 3/8 = 0.375, or repeats in a pattern, like 1/3 = 0.333 and so on.`,
          `The laws of exponents help us work with powers. For a positive real number a, a to the power m times a to the power n equals a to the power (m + n), and a to the power m divided by a to the power n equals a to the power (m - n). Also, (a to the power m) to the power n equals a to the power mn. A fractional exponent represents a root: a to the power 1/n is the nth root of a. To rationalise a denominator that contains a square root, multiply the numerator and denominator by a suitable expression. For example, 1 divided by the square root of 2 becomes the square root of 2 divided by 2. Rationalising makes it easier to compare and add expressions that contain square roots.`,
        ],
      },
      {
        title: 'Polynomials',
        pages: [
          `A polynomial in one variable x is an expression of the form a0 + a1 x + a2 x squared + and so on, where the powers of x are whole numbers and the coefficients are real numbers. The highest power of x with a non-zero coefficient is called the degree. A polynomial of degree one is linear, of degree two is quadratic, and of degree three is cubic. A constant polynomial has degree zero, and the zero polynomial has no defined degree. A zero of a polynomial p(x) is a number c such that p(c) = 0. For example, 2 is a zero of x - 2, since p(2) = 0. A linear polynomial has exactly one zero, and a polynomial of degree n has at most n zeros.`,
          `The Remainder Theorem says that if a polynomial p(x) is divided by x - a, the remainder is p(a). The Factor Theorem is its special case: x - a is a factor of p(x) if and only if p(a) = 0. For example, x - 1 is a factor of x cubed - 6x squared + 11x - 6 because p(1) = 1 - 6 + 11 - 6 = 0. We can then factorise the polynomial fully as (x - 1)(x - 2)(x - 3). Some algebraic identities save time: (x + y) squared = x squared + 2xy + y squared; (x - y) squared = x squared - 2xy + y squared; and x squared - y squared = (x + y)(x - y). These identities are used to expand products and to factorise expressions quickly.`,
        ],
      },
    ],
  },
  {
    key: 'worksheet8a',
    title: 'Rational Numbers: Worked Examples and Practice (8-A)',
    kind: 'material',
    scope: 'section',
    grade: 8,
    subject: 'Mathematics',
    branch: 'Main Campus',
    section: '8-A',
    heading: 'Lesson',
    chapters: [
      {
        title: 'Worked examples on rational numbers',
        pages: [
          `Worked example one: add 2/3 and 5/6. The denominators are 3 and 6, and the least common multiple is 6. Rewrite 2/3 as 4/6. Then 4/6 + 5/6 = 9/6, which simplifies to 3/2. Worked example two: find the reciprocal of -7/9. The reciprocal is obtained by turning the fraction upside down, so it is -9/7, and the sign stays the same. Check: (-7/9) x (-9/7) = 1. Worked example three: find a rational number between 1/4 and 1/2. Using the mean, (1/4 + 1/2) / 2 = (3/4) / 2 = 3/8. Remember that these examples were done in class, and that students should write every step, including the common denominator, when they answer a question in the exam.`,
          `Common mistakes to avoid. First, adding the denominators: 1/2 + 1/3 is not 2/5, it is 5/6. Second, forgetting that the negative sign belongs to the whole fraction, so -3/4 is the same as 3/-4 but not the same as -3/-4, which equals positive 3/4. Third, saying that zero has a reciprocal. It does not. Fourth, claiming that division is closed for rational numbers; it is not, because dividing by zero is undefined. Practice set for homework: simplify 3/5 + (-7/10); find the additive inverse of -11/13; show that the product of a rational number and its reciprocal is one; and write three rational numbers between -1 and 0. Bring your answers to the next lesson.`,
        ],
      },
    ],
  },
  {
    key: 'labsafety',
    title: 'Science Lab Safety Handbook (North Campus)',
    kind: 'material',
    scope: 'branch',
    grade: 8,
    subject: 'Science',
    branch: 'North Campus',
    heading: 'Lesson',
    chapters: [
      {
        title: 'Staying safe in the science lab',
        pages: [
          `Safety rules for the school laboratory. Enter the laboratory only when your teacher is present, and never run inside it. Tie back long hair, wear a lab coat, and wear safety goggles whenever you heat a substance or handle a chemical. Never taste or directly smell a chemical; if you must smell it, waft the vapour gently towards your nose with your hand. Read the label on every bottle twice before use, and return it to its place after use. Do not mix chemicals unless the experiment tells you to. Always add acid to water slowly, never water to acid. Keep your bench tidy, and report any spill or breakage to the teacher immediately instead of cleaning it up with bare hands.`,
          `Handling heat and equipment. When heating a test tube, hold it with a holder at a slant, point its mouth away from yourself and your classmates, and move it gently over the flame. Switch off the burner when you have finished. Never leave a flame unattended. Hot glassware looks the same as cold glassware, so let it cool before you touch it. Know where the fire extinguisher, the first-aid box and the exits are. For a minor burn, hold the burn under cool running water for at least ten minutes. For a chemical splash in the eye, rinse with plenty of water and tell the teacher at once. Wash your hands with soap after every practical, and dispose of waste in the correct bins as instructed.`,
        ],
      },
    ],
  },
];

/** Page text for one chapter's page, with the chapter heading on the first page. */
export function pageTexts(book: DemoBook): string[] {
  return book.chapters.flatMap((ch, i) =>
    ch.pages.map((text, p) => (p === 0 ? `${book.heading} ${i + 1}\n${ch.title}\n\n${text}` : text)),
  );
}
