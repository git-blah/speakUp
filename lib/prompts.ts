export type Mode = "word" | "topic" | "situation" | "explain" | "speech";
export type Difficulty = 1 | 2 | 3;

export interface Prompt {
  id: string;
  mode: Mode;
  difficulty: Difficulty;
  text: string;
}

export const MODES: Record<Mode, { label: string; hint: string }> = {
  word: {
    label: "Random word",
    hint: "Talk about anything this word makes you think of: a story, an opinion, a memory.",
  },
  topic: {
    label: "Topic",
    hint: "Take a clear position. State it, give a reason, back it with an example, then restate it.",
  },
  situation: {
    label: "Situation",
    hint: "Speak as if the other person is in front of you. Be natural, polite and clear.",
  },
  explain: {
    label: "Explain it",
    hint: "Assume your listener knows nothing. Use simple words and one good analogy.",
  },
  speech: {
    label: "Impromptu speech",
    hint: "You have an audience. Open strong, make two or three points, close with a memorable line.",
  },
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  1: "Easy",
  2: "Medium",
  3: "Hard",
};

// [difficulty, text]
type Seed = [Difficulty, string];

const SEEDS: Record<Mode, Seed[]> = {
  word: [
    [1, "Coffee"],
    [1, "Rain"],
    [1, "Weekend"],
    [1, "Music"],
    [1, "Breakfast"],
    [1, "Friendship"],
    [1, "Holiday"],
    [2, "Lighthouse"],
    [2, "Mirror"],
    [2, "Deadline"],
    [2, "Bridge"],
    [2, "Silence"],
    [2, "Compass"],
    [2, "Habit"],
    [3, "Ambition"],
    [3, "Nostalgia"],
    [3, "Paradox"],
    [3, "Integrity"],
    [3, "Entropy"],
    [3, "Legacy"],
  ],
  topic: [
    [1, "Is it better to live in a city or the countryside?"],
    [1, "Should everyone learn to cook?"],
    [1, "Cats or dogs: which make better pets?"],
    [1, "Is breakfast the most important meal of the day?"],
    [1, "Are books better than films?"],
    [2, "Is remote work better than working in an office?"],
    [2, "Should university education be free?"],
    [2, "Do social media platforms do more harm than good?"],
    [2, "Should children have smartphones before age 13?"],
    [2, "Is it ever okay to lie?"],
    [2, "Should cities ban cars from their centres?"],
    [2, "Is failure necessary for success?"],
    [3, "Should AI be allowed to make medical decisions?"],
    [3, "Is economic growth compatible with fighting climate change?"],
    [3, "Should voting be compulsory?"],
    [3, "Does privacy still matter in the digital age?"],
    [3, "Should wealthy nations open their borders?"],
    [3, "Is meritocracy a myth?"],
    [3, "Should we colonise Mars?"],
    [3, "Can art be separated from the artist?"],
  ],
  situation: [
    [1, "Introduce yourself to a new neighbour."],
    [1, "Order food at a restaurant and ask about one dish."],
    [1, "Ask a stranger for directions to the train station."],
    [1, "Leave a voicemail rescheduling a dentist appointment."],
    [1, "Describe your perfect day to a new friend."],
    [2, "Your flight is cancelled. Talk to the gate agent."],
    [2, "Return a faulty product to a shop without a receipt."],
    [2, "Tell your flatmate they need to clean up more often."],
    [2, "You're late to a meeting. Apologise and explain."],
    [2, "Convince your friend to join you on a hiking trip."],
    [2, "Ask your lecturer for an extension on an assignment."],
    [2, "Answer the interview question: 'Tell me about yourself.'"],
    [3, "Negotiate a higher salary for a job offer."],
    [3, "Give critical feedback to a teammate who missed a deadline."],
    [3, "Answer the interview question: 'What is your biggest weakness?'"],
    [3, "Calm down an angry customer whose order went wrong."],
    [3, "Pitch your startup idea to an investor in the lift."],
    [3, "Tell your manager you disagree with their decision."],
    [3, "Turn down a friend's request for a large loan."],
    [3, "Explain to a client why their project will be delayed."],
  ],
  explain: [
    [1, "Explain how to make a cup of tea."],
    [1, "Explain the rules of your favourite game or sport."],
    [1, "Explain why we have seasons."],
    [1, "Explain how to ride a bicycle."],
    [2, "Explain inflation to a 10-year-old."],
    [2, "Explain how the internet works."],
    [2, "Explain what a credit score is and why it matters."],
    [2, "Explain how vaccines work."],
    [2, "Explain the difference between weather and climate."],
    [2, "Explain how a bill becomes a law in your country."],
    [2, "Explain what DNA is."],
    [3, "Explain how a stock market works."],
    [3, "Explain machine learning without using jargon."],
    [3, "Explain compound interest and why it matters for saving."],
    [3, "Explain supply and demand with a real example."],
    [3, "Explain how blockchain works."],
    [3, "Explain the placebo effect."],
    [3, "Explain opportunity cost using a decision from your own life."],
    [3, "Explain why the sky is blue."],
    [3, "Explain how a nuclear power plant generates electricity."],
  ],
  speech: [
    [1, "Give a short toast at a friend's birthday dinner."],
    [1, "Thank your team at the end of a successful project."],
    [1, "Welcome new students on their first day."],
    [1, "Recommend your favourite book to a book club."],
    [2, "Give a toast at your best friend's wedding."],
    [2, "Motivate your sports team at half-time when you're losing."],
    [2, "Give a speech accepting an award you didn't expect."],
    [2, "Open a charity fundraising event."],
    [2, "Persuade your class to vote for you as class representative."],
    [2, "Say farewell to a colleague who is retiring."],
    [2, "Present a new idea to improve your workplace."],
    [3, "Give a graduation speech to your old school."],
    [3, "Deliver a TED-style talk: 'The best advice I ever got.'"],
    [3, "Address a town meeting about building a new park."],
    [3, "Give a eulogy for a fictional famous inventor."],
    [3, "Rally volunteers after a natural disaster."],
    [3, "Present quarterly results that were worse than expected."],
    [3, "Convince a sceptical audience to take climate action."],
    [3, "Give a keynote on why curiosity is a superpower."],
    [3, "Defend an unpopular opinion you genuinely hold."],
  ],
};

export const PROMPTS: Prompt[] = (Object.keys(SEEDS) as Mode[]).flatMap((mode) =>
  SEEDS[mode].map(([difficulty, text], i) => ({
    id: `${mode}-${i}`,
    mode,
    difficulty,
    text,
  })),
);

export interface PromptFilter {
  modes: Mode[];
  difficulty: Difficulty | "any";
}

/** Pick a random prompt matching the filter, avoiding `excludeId` when possible. */
export function pickPrompt(filter: PromptFilter, excludeId?: string): Prompt {
  const matching = PROMPTS.filter(
    (p) =>
      filter.modes.includes(p.mode) &&
      (filter.difficulty === "any" || p.difficulty === filter.difficulty),
  );
  const pool = matching.length > 0 ? matching : PROMPTS;
  const fresh = pool.length > 1 ? pool.filter((p) => p.id !== excludeId) : pool;
  return fresh[Math.floor(Math.random() * fresh.length)];
}
